import crypto from "node:crypto";
import type { EduPiRuntimeHandle } from "./edupi-runtime-supervisor";
import { EDUPI_PROACTIVITY_CONVERSATION_ID } from "./edupi-proactivity-control";
import { readProactivityOwnerContext } from "./edupi-proactivity-runtime";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/u;
const MESSAGE_REF = /^owner_message:[a-f0-9]{64}$/u;
const RAW_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,127}$/u;
const INTERPRETATIONS = new Set(["request", "commitment", "preference", "question", "quote", "tentative", "cancel", "correction", "unknown"]);

type ControlBinding = { goalId: string; workCaseId: string; goalVersion: number; status: "active" | "paused" | "revoked" };
type AmbientResult = { status: "applied" | "captured" | "cancelled" | "corrected"; resolutionStatus: string; reason: string | null;
  goalId: string | null; workCaseId: string | null; externalSend: false };

export class EduPiAmbientMessageError extends Error {
  constructor(public readonly code: "proactivity_grant_unavailable" | "proactivity_response_invalid" | "proactivity_runtime_unavailable",
    public readonly stage: "input" | "owner" | "capture" | "intent" | "binding" | "resolve" | "apply" = "input") {
    super(code); this.name = "EduPiAmbientMessageError";
  }
}

function fail(code: EduPiAmbientMessageError["code"] = "proactivity_response_invalid", stage: EduPiAmbientMessageError["stage"] = "input"): never {
  throw new EduPiAmbientMessageError(code, stage);
}

function result(value: unknown, stage: EduPiAmbientMessageError["stage"]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || (value as Record<string, unknown>).ok !== true) fail("proactivity_runtime_unavailable", stage);
  const output = (value as Record<string, unknown>).result;
  if (!output || typeof output !== "object" || Array.isArray(output)) fail("proactivity_response_invalid", stage);
  return output as Record<string, unknown>;
}

function intentCandidate(value: unknown, messageRef: string): { interpretation: string } {
  const view = result(value, "intent");
  const candidate = view.candidate;
  if (view.status !== "current" || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) fail("proactivity_response_invalid", "intent");
  const item = candidate as Record<string, unknown>;
  if (view.message_ref !== messageRef || view.external_send !== false || item.domain !== "teaching_preparation"
    || !INTERPRETATIONS.has(String(item.interpretation))) {
    fail("proactivity_response_invalid", "intent");
  }
  return { interpretation: String(item.interpretation) };
}

async function controlBindings(host: Pick<EduPiRuntimeHandle, "callOwnerControl">,
  input: { rootRef: string; grantId: string }, context: { ownerId: string; grantVersion: number },
  scope: { classId: string; subject: string }): Promise<ControlBinding[]> {
  const response = await host.callOwnerControl("owner_goal_bindings_read", {
    root_ref: input.rootRef,
    expected_owner_id: context.ownerId,
    grant_id: input.grantId,
    expected_grant_version: context.grantVersion,
  });
  if (!response || typeof response !== "object" || Array.isArray(response) || (response as Record<string, unknown>).ok !== true) {
    const code = response && typeof response === "object" && !Array.isArray(response) ? (response as Record<string, unknown>).error_code : null;
    fail(["owner_grant_unavailable", "owner_clock_rollback"].includes(String(code))
      ? "proactivity_grant_unavailable" : "proactivity_runtime_unavailable", "binding");
  }
  const output = (response as Record<string, unknown>).result;
  if (!output || typeof output !== "object" || Array.isArray(output)) fail("proactivity_response_invalid", "binding");
  const projection = output as Record<string, unknown>;
  const projectedScope = projection.scope;
  let canonicalObservedAt = false;
  try { canonicalObservedAt = typeof projection.observed_at === "string" && new Date(projection.observed_at).toISOString() === projection.observed_at; } catch { canonicalObservedAt = false; }
  if (projection.version !== 1 || projection.root_ref !== input.rootRef || projection.owner_id !== context.ownerId || projection.grant_id !== input.grantId
    || projection.grant_version !== context.grantVersion || projection.apply !== false || projection.live_authority !== false
    || projection.model_execute !== false || projection.external_send !== false || !canonicalObservedAt
    || !projectedScope || typeof projectedScope !== "object" || Array.isArray(projectedScope)
    || (projectedScope as Record<string, unknown>).class_id !== scope.classId
    || (projectedScope as Record<string, unknown>).subject !== scope.subject
    || !Array.isArray(projection.bindings) || projection.bindings.length > 200) fail("proactivity_response_invalid", "binding");
  const seenGoals = new Set<string>();
  const normalized = projection.bindings.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("proactivity_response_invalid", "binding");
    const binding = value as Record<string, unknown>;
    if (!ID.test(String(binding.goal_id || "")) || !ID.test(String(binding.work_case_id || ""))
      || !ID.test(String(binding.task_id || "")) || !Number.isSafeInteger(binding.goal_version) || Number(binding.goal_version) < 1
      || !["active", "paused", "revoked"].includes(String(binding.goal_status)) || seenGoals.has(String(binding.goal_id))) {
      fail("proactivity_response_invalid", "binding");
    }
    seenGoals.add(String(binding.goal_id));
    return { goalId: String(binding.goal_id), workCaseId: String(binding.work_case_id), goalVersion: Number(binding.goal_version),
      status: binding.goal_status as ControlBinding["status"] };
  });
  return normalized;
}

function safeControlResult(value: unknown, stage: EduPiAmbientMessageError["stage"]): Record<string, unknown> {
  const applied = result(value, stage);
  if (applied.external_send !== false || !["applied", "replayed"].includes(String(applied.status))
    || applied.planning_applied !== true || applied.execution_started !== false || applied.model_execute !== false
    || applied.notify !== false || applied.live_authority !== false) fail("proactivity_response_invalid", stage);
  return applied;
}

export function predictEduPiOwnerMessageRef(rootRef: string, ownerId: string, messageId: string): string {
  if (!HASH.test(rootRef) || !ID.test(ownerId) || !RAW_ID.test(messageId)) fail();
  const digest = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
  const conversationHash = `sha256:${digest(EDUPI_PROACTIVITY_CONVERSATION_ID)}`;
  const sourceRef = `conversation:${conversationHash.slice(7)}`;
  const messageHash = `sha256:${digest(messageId)}`;
  return `owner_message:${crypto.createHash("sha256").update("edupi.owner.message.v1\0")
    .update(JSON.stringify([rootRef, ownerId, sourceRef, conversationHash, messageHash])).digest("hex")}`;
}

export async function captureAndApplyAmbientMessage(
  host: Pick<EduPiRuntimeHandle, "call" | "callOwnerControl">,
  input: { rootRef: string; grantId: string; messageId: string; text: string; occurredAt: string },
  dependencies: { findAppliedGoal?: (workCaseId: string) => Promise<{ goalId: string } | null>;
    controlScope?: { classId: string; subject: string };
    onPrepared?: (binding: { messageRef: string; ownerId: string; grantId: string; captureGrantVersion: number }) => Promise<void>;
    onCaptured?: (binding: { messageRef: string; ownerId: string; grantId: string; captureGrantVersion: number }) => Promise<void> } = {},
): Promise<AmbientResult> {
  let canonicalOccurredAt = false;
  try { canonicalOccurredAt = new Date(input.occurredAt).toISOString() === input.occurredAt; } catch { canonicalOccurredAt = false; }
  if (!HASH.test(input.rootRef) || !ID.test(input.grantId) || !RAW_ID.test(input.messageId)
    || typeof input.text !== "string" || !input.text.trim() || input.text.length > 4000
    || !canonicalOccurredAt) fail();
  const context = await readProactivityOwnerContext(host, input.rootRef, input.grantId);
  if (!context || context.status !== "active") fail("proactivity_grant_unavailable", "owner");
  const predictedMessageRef = predictEduPiOwnerMessageRef(input.rootRef, context.ownerId, input.messageId);
  const messageBinding = { messageRef: predictedMessageRef, ownerId: context.ownerId, grantId: context.grantId,
    captureGrantVersion: context.grantVersion };
  if (dependencies.onPrepared) {
    try { await dependencies.onPrepared(messageBinding); }
    catch { fail("proactivity_runtime_unavailable", "capture"); }
  }
  const captured = result(await host.callOwnerControl("owner_message", {
    action: "capture",
    root_ref: input.rootRef,
    expected_owner_id: context.ownerId,
    grant_id: context.grantId,
    expected_grant_version: context.grantVersion,
    conversation_id: EDUPI_PROACTIVITY_CONVERSATION_ID,
    message_id: input.messageId,
    occurred_at: input.occurredAt,
    text: input.text,
  }), "capture");
  const receipt = captured.receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) fail("proactivity_response_invalid", "capture");
  const capture = receipt as Record<string, unknown>;
  if (!MESSAGE_REF.test(String(capture.message_ref || "")) || capture.message_ref !== predictedMessageRef || capture.owner_id !== context.ownerId
    || capture.capture_grant_version !== context.grantVersion || capture.external_send !== false
    || typeof captured.replayed !== "boolean") fail("proactivity_response_invalid", "capture");
  const messageRef = String(capture.message_ref);
  if (dependencies.onCaptured) {
    try {
      await dependencies.onCaptured(messageBinding);
    } catch {
      try {
        await host.callOwnerControl("owner_message", { action: "withdraw", root_ref: input.rootRef,
          expected_owner_id: context.ownerId, message_ref: messageRef, expected_revision: 1 });
      } catch { /* The caller remains failed closed; an exact retry can finish withdrawal. */ }
      fail("proactivity_runtime_unavailable", "capture");
    }
  }
  if (dependencies.controlScope && (!ID.test(dependencies.controlScope.classId)
    || typeof dependencies.controlScope.subject !== "string" || !dependencies.controlScope.subject)) fail();
  const candidate = dependencies.controlScope ? intentCandidate(await host.callOwnerControl("owner_intent_read", {
    root_ref: input.rootRef,
    expected_owner_id: context.ownerId,
    message_ref: messageRef,
  }), messageRef) : null;
  let bindingsPromise: Promise<ControlBinding[]> | null = null;
  const bindings = () => bindingsPromise ??= controlBindings(host, input, context, dependencies.controlScope!);
  if (candidate?.interpretation === "cancel") {
    const projected = await bindings();
    const current = projected.filter((item) => item.status !== "revoked");
    const revoked = projected.filter((item) => item.status === "revoked" && item.goalVersion > 1);
    const binding = captured.replayed === true
      ? revoked.length === 1 ? { ...revoked[0], goalVersion: revoked[0].goalVersion - 1 }
        : revoked.length === 0 && current.length === 1 ? current[0] : null
      : current.length === 1 ? current[0] : null;
    if (!binding) return { status: "captured", resolutionStatus: "ask", reason: "cancellation_target_required", goalId: null, workCaseId: null, externalSend: false };
    const applied = safeControlResult(await host.callOwnerControl("owner_intent_cancel", {
      root_ref: input.rootRef,
      expected_owner_id: context.ownerId,
      message_ref: messageRef,
      expected_goal_id: binding.goalId,
      expected_work_case_id: binding.workCaseId,
      expected_goal_version: binding.goalVersion,
    }), "apply");
    if (applied.goal_id !== binding.goalId || applied.work_case_id !== binding.workCaseId
      || applied.goal_version !== binding.goalVersion + 1 || !applied.queue_cancellation
      || typeof applied.queue_cancellation !== "object" || Array.isArray(applied.queue_cancellation)) fail("proactivity_response_invalid", "apply");
    return { status: "cancelled", resolutionStatus: "cancelled", reason: String(applied.reason || "cancellation_applied"),
      goalId: binding.goalId, workCaseId: binding.workCaseId, externalSend: false };
  }
  const resolution = result(await host.callOwnerControl("owner_intent_resolve", {
    root_ref: input.rootRef,
    expected_owner_id: context.ownerId,
    message_ref: messageRef,
  }), "resolve");
  if (resolution.external_send !== false || typeof resolution.status !== "string"
    || resolution.reason !== null && typeof resolution.reason !== "string") fail("proactivity_response_invalid", "resolve");
  const resolutionStatus = resolution.status;
  const reason = resolution.reason as string | null;
  if (resolutionStatus !== "source_bound") {
    return { status: "captured", resolutionStatus, reason, goalId: null, workCaseId: null, externalSend: false };
  }
  const target = resolution.target;
  const workCaseId = target && typeof target === "object" && !Array.isArray(target)
    && typeof (target as Record<string, unknown>).work_case_id === "string" && ID.test(String((target as Record<string, unknown>).work_case_id))
    ? String((target as Record<string, unknown>).work_case_id) : null;
  if (!workCaseId) fail("proactivity_response_invalid", "resolve");
  if (candidate?.interpretation === "correction") {
    const projected = await bindings();
    const currentOld = projected.filter((item) => item.status !== "revoked" && item.workCaseId !== workCaseId);
    let oldBinding: ControlBinding | null = captured.replayed === true ? null : currentOld.length === 1 ? currentOld[0] : null;
    let expectedNewGoalVersion = 0;
    if (captured.replayed === true) {
      const newBindings = projected.filter((item) => item.status !== "revoked" && item.workCaseId === workCaseId && item.goalVersion > 0);
      const oldBindings = projected.filter((item) => item.status === "revoked" && item.workCaseId !== workCaseId && item.goalVersion > 1);
      if (newBindings.length === 1 && oldBindings.length === 1) {
        oldBinding = { ...oldBindings[0], goalVersion: oldBindings[0].goalVersion - 1 };
        expectedNewGoalVersion = newBindings[0].goalVersion - 1;
      } else if (oldBindings.length === 0 && newBindings.length === 0 && currentOld.length === 1) {
        oldBinding = currentOld[0];
      }
    }
    if (!oldBinding) return { status: "captured", resolutionStatus: "ask", reason: "correction_target_required", goalId: null, workCaseId: null, externalSend: false };
    const corrected = safeControlResult(await host.callOwnerControl("owner_intent_correct", {
      root_ref: input.rootRef,
      expected_owner_id: context.ownerId,
      message_ref: messageRef,
      expected_goal_id: oldBinding.goalId,
      expected_work_case_id: oldBinding.workCaseId,
      expected_goal_version: oldBinding.goalVersion,
      expected_new_goal_version: expectedNewGoalVersion,
    }), "apply");
    if (corrected.old_goal_id !== oldBinding.goalId || corrected.old_work_case_id !== oldBinding.workCaseId
      || corrected.old_goal_version !== oldBinding.goalVersion + 1 || corrected.new_work_case_id !== workCaseId
      || corrected.new_goal_version !== expectedNewGoalVersion + 1 || !ID.test(String(corrected.new_goal_id || ""))
      || !corrected.old_queue_cancellation || typeof corrected.old_queue_cancellation !== "object"
      || Array.isArray(corrected.old_queue_cancellation)) fail("proactivity_response_invalid", "apply");
    return { status: "corrected", resolutionStatus, reason: String(corrected.reason || "correction_applied"),
      goalId: String(corrected.new_goal_id), workCaseId, externalSend: false };
  }
  if (captured.replayed === true) {
    const exact = dependencies.controlScope ? (await bindings()).filter((item) => item.workCaseId === workCaseId) : [];
    const existing = exact.length === 1 ? { goalId: exact[0].goalId } : dependencies.findAppliedGoal
      ? await dependencies.findAppliedGoal(workCaseId) : null;
    if (existing) {
      if (!ID.test(existing.goalId)) fail("proactivity_response_invalid", "apply");
      return { status: "applied", resolutionStatus, reason, goalId: existing.goalId, workCaseId, externalSend: false };
    }
    if (dependencies.controlScope) return { status: "captured", resolutionStatus: "ask", reason: "replay_binding_unavailable", goalId: null, workCaseId: null, externalSend: false };
  }
  const applied = result(await host.callOwnerControl("owner_intent_apply", {
    root_ref: input.rootRef,
    expected_owner_id: context.ownerId,
    message_ref: messageRef,
    expected_goal_version: 0,
  }), "apply");
  if (applied.external_send !== false || !["applied", "replayed"].includes(String(applied.status))
    || typeof applied.goal_id !== "string" || !ID.test(applied.goal_id)) fail("proactivity_response_invalid", "apply");
  return { status: "applied", resolutionStatus, reason, goalId: applied.goal_id, workCaseId, externalSend: false };
}
