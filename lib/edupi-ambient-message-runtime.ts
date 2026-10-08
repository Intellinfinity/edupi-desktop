import crypto from "node:crypto";
import type { EduPiRuntimeHandle } from "./edupi-runtime-supervisor";
import { EDUPI_PROACTIVITY_CONVERSATION_ID, EDUPI_STUDENT_FOLLOWUP_CONVERSATION_ID,
  EDUPI_CALENDAR_ADMINISTRATION_CONVERSATION_ID, EDUPI_LESSON_REFLECTION_CONVERSATION_ID,
  EDUPI_PARENT_COMMUNICATION_CONVERSATION_ID } from "./edupi-proactivity-control";
import type { EduPiProactivityDomain } from "./edupi-proactivity-config";
import { readProactivityOwnerContext } from "./edupi-proactivity-runtime";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/u;
const MESSAGE_REF = /^owner_message:[a-f0-9]{64}$/u;
const RAW_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,127}$/u;
const INTERPRETATIONS = new Set(["request", "commitment", "preference", "question", "quote", "tentative", "cancel", "correction", "unknown"]);
const DOMAINS = new Set(["teaching_preparation", "student_followup", "lesson_reflection", "calendar_administration", "parent_communication", "safety_privacy"]);

type ControlBinding = { goalId: string; workCaseId: string; goalVersion: number; status: "active" | "paused" | "revoked" };
type AmbientResult = { status: "applied" | "captured" | "cancelled" | "corrected" | "queued" | "replayed" | "recorded"; resolutionStatus: string; reason: string | null;
  goalId: string | null; workCaseId: string | null; followUpId?: string; executionId?: string; routedDomain?: string | null; externalSend: false };

type CoreRoute = { domain: string | null; status: string; reason: string; ready: boolean; sourceBasisHash: string };
const ROUTE_READY_OPERATION: Record<string, string> = {
  teaching_preparation: "owner_intent_apply",
  student_followup: "student_followup_goal_apply",
  calendar_administration: "calendar_administration_execution_enqueue",
  lesson_reflection: "lesson_reflection_execution_enqueue",
  parent_communication: "parent_communication_execution_enqueue",
};

function coreRoute(value: unknown, messageRef: string): CoreRoute {
  const view = result(value, "resolve");
  const domain = view.domain;
  const ready = view.status === "ready" && view.interaction === "silent";
  const target = view.target;
  if (view.version !== 1 || view.message_ref !== messageRef || !/^owner_intent:[a-f0-9]{64}$/u.test(String(view.intent_id || ""))
    || domain !== null && !DOMAINS.has(String(domain))
    || !["ready", "needs_input", "deferred", "held", "withdrawn", "abstained"].includes(String(view.status))
    || typeof view.reason !== "string" || !view.reason || !["silent", "clarify", "review", "none"].includes(String(view.interaction))
    || !HASH.test(String(view.source_basis_hash || "")) || typeof view.observed_at !== "string"
    || view.automatic_continuation_allowed !== ready || view.apply !== false || view.live_authority !== false
    || view.model_execute !== false || view.external_send !== false || !Array.isArray(view.required_inputs)
    || ready && (view.next_operation !== ROUTE_READY_OPERATION[String(domain)]
      || !target || typeof target !== "object" || Array.isArray(target)
      || (target as Record<string, unknown>).kind !== domain
      || !ID.test(String((target as Record<string, unknown>).id || ""))
      || !Number.isSafeInteger(view.expected_goal_version) || Number(view.expected_goal_version) < 0)
    || !ready && view.next_operation !== null && view.status !== "needs_input") {
    fail("proactivity_response_invalid", "resolve");
  }
  return { domain: domain === null ? null : String(domain), status: String(view.status), reason: String(view.reason),
    ready, sourceBasisHash: String(view.source_basis_hash) };
}

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

function intentCandidate(value: unknown, messageRef: string): { interpretation: string | null; domain: string | null } {
  const view = result(value, "intent");
  const candidate = view.candidate;
  if (view.message_ref !== messageRef || view.external_send !== false) fail("proactivity_response_invalid", "intent");
  if ((view.status === "held" || view.status === "withdrawn") && candidate === null
    && ["ask", "defer", "abstain"].includes(String(view.action)) && typeof view.reason === "string" && view.reason) {
    return { interpretation: null, domain: null };
  }
  if (view.status !== "current" || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) fail("proactivity_response_invalid", "intent");
  const item = candidate as Record<string, unknown>;
  if (!Object.hasOwn(item, "domain")
    || item.domain !== null && !DOMAINS.has(String(item.domain)) || !INTERPRETATIONS.has(String(item.interpretation))) {
    fail("proactivity_response_invalid", "intent");
  }
  return { interpretation: String(item.interpretation), domain: item.domain === null ? null : String(item.domain) };
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

function conversationId(domain: EduPiProactivityDomain): string {
  if (domain === "teaching_preparation") return EDUPI_PROACTIVITY_CONVERSATION_ID;
  if (domain === "student_followup") return EDUPI_STUDENT_FOLLOWUP_CONVERSATION_ID;
  if (domain === "calendar_administration") return EDUPI_CALENDAR_ADMINISTRATION_CONVERSATION_ID;
  if (domain === "lesson_reflection") return EDUPI_LESSON_REFLECTION_CONVERSATION_ID;
  if (domain === "parent_communication") return EDUPI_PARENT_COMMUNICATION_CONVERSATION_ID;
  return fail();
}

export function predictEduPiOwnerMessageRef(rootRef: string, ownerId: string, messageId: string, domain: EduPiProactivityDomain = "teaching_preparation"): string {
  if (!HASH.test(rootRef) || !ID.test(ownerId) || !RAW_ID.test(messageId)) fail();
  const digest = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
  const conversationHash = `sha256:${digest(conversationId(domain))}`;
  const sourceRef = `conversation:${conversationHash.slice(7)}`;
  const messageHash = `sha256:${digest(messageId)}`;
  return `owner_message:${crypto.createHash("sha256").update("edupi.owner.message.v1\0")
    .update(JSON.stringify([rootRef, ownerId, sourceRef, conversationHash, messageHash])).digest("hex")}`;
}

export async function captureAndApplyAmbientMessage(
  host: Pick<EduPiRuntimeHandle, "call" | "callOwnerControl">,
  input: { rootRef: string; grantId: string; messageId: string; text: string; occurredAt: string; domain?: EduPiProactivityDomain },
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
  const domain = input.domain ?? "teaching_preparation";
  if (!Object.hasOwn(ROUTE_READY_OPERATION, domain) || domain !== "teaching_preparation" && domain !== "student_followup" && !dependencies.controlScope
    || dependencies.controlScope && (!ID.test(dependencies.controlScope.classId)
      || typeof dependencies.controlScope.subject !== "string" || !dependencies.controlScope.subject.trim()
      || dependencies.controlScope.subject.length > 128 || /[\u0000-\u001f\u007f]/u.test(dependencies.controlScope.subject))) fail();
  const context = await readProactivityOwnerContext(host, input.rootRef, input.grantId);
  if (!context || context.status !== "active") fail("proactivity_grant_unavailable", "owner");
  const predictedMessageRef = predictEduPiOwnerMessageRef(input.rootRef, context.ownerId, input.messageId, domain);
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
    conversation_id: conversationId(domain),
    message_id: input.messageId,
    occurred_at: input.occurredAt,
    text: input.text,
  }), "capture");
  const receipt = captured.receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) fail("proactivity_response_invalid", "capture");
  const capture = receipt as Record<string, unknown>;
  if (!MESSAGE_REF.test(String(capture.message_ref || "")) || capture.message_ref !== predictedMessageRef || capture.owner_id !== context.ownerId
    || capture.capture_grant_version !== context.grantVersion || capture.external_send !== false
    || typeof captured.replayed !== "boolean"
    || domain === "student_followup" && (capture.apply !== false || capture.live_authority !== false)) fail("proactivity_response_invalid", "capture");
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
  const candidate = dependencies.controlScope && domain === "teaching_preparation" ? intentCandidate(await host.callOwnerControl("owner_intent_read", {
    root_ref: input.rootRef,
    expected_owner_id: context.ownerId,
    message_ref: messageRef,
  }), messageRef) : null;
  const legacyGoalControl = candidate?.domain === "teaching_preparation"
    && (candidate.interpretation === "cancel" || candidate.interpretation === "correction");
  const routed = dependencies.controlScope && !legacyGoalControl ? coreRoute(await host.callOwnerControl("owner_intent_route_read", {
    root_ref: input.rootRef, expected_owner_id: context.ownerId, message_ref: messageRef,
  }), messageRef) : null;
  const g2ObservationIntake = domain === "student_followup"
    && routed && ["student_followup_not_found", "intent_unknown"].includes(routed.reason);
  if (routed?.domain === "safety_privacy") {
    if (routed.ready) fail("proactivity_response_invalid", "resolve");
    return { status: "captured", resolutionStatus: "held", reason: routed.reason,
      goalId: null, workCaseId: null, routedDomain: routed.domain, externalSend: false };
  }
  if (routed && !g2ObservationIntake && (routed.domain !== domain || !routed.ready)) {
    return { status: "captured", resolutionStatus: routed.status, reason: routed.reason,
      goalId: null, workCaseId: null, routedDomain: routed.domain, externalSend: false };
  }
  if (domain === "student_followup") {
    const response = await host.callOwnerControl("student_followup_intent_execution_enqueue", {
      root_ref: input.rootRef, expected_owner_id: context.ownerId, message_ref: messageRef,
    });
    if (response?.ok === false && ["invalid_candidate", "activation_pending", "permission_denied", "budget_exhausted", "stale_source", "stale_revision"].includes(String(response.error_code))) {
      return { status: "captured", resolutionStatus: "held", reason: String(response.error_code), goalId: null,
        workCaseId: null, routedDomain: routed?.domain ?? null, externalSend: false };
    }
    const queued = result(response, "apply");
    if (queued.version !== 1 || !["queued", "replayed"].includes(String(queued.status))
      || ![queued.follow_up_id, queued.goal_id, queued.opportunity_id, queued.execution_id].every(value => typeof value === "string" && ID.test(value))
      || !Number.isSafeInteger(queued.goal_version) || Number(queued.goal_version) < 1
      || !Number.isSafeInteger(queued.attempt) || Number(queued.attempt) < 0
      || queued.execution_started !== true || queued.model_execute !== true || queued.notify !== false
      || queued.live_authority !== false || queued.external_send !== false) fail("proactivity_response_invalid", "apply");
    return { status: queued.status as "queued" | "replayed", resolutionStatus: String(queued.status), reason: null,
      goalId: String(queued.goal_id), workCaseId: null, followUpId: String(queued.follow_up_id),
      executionId: String(queued.execution_id), routedDomain: routed?.domain ?? domain, externalSend: false };
  }
  // G3–G5 share one Core processor. Until its startup accepts a durable
  // per-grant stop fence, a local domain switch cannot authorize execution.
  if (routed && domain !== "teaching_preparation") {
    return { status: "captured", resolutionStatus: "held", reason: "activation_pending",
      goalId: null, workCaseId: null, routedDomain: routed.domain, externalSend: false };
  }
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
  if (routed && domain === "teaching_preparation") {
    const applied = result(await host.callOwnerControl("owner_intent_route_apply", {
      root_ref: input.rootRef, expected_owner_id: context.ownerId, message_ref: messageRef,
    }), "apply");
    const appliedRoute = coreRoute({ ok: true, result: applied.route }, messageRef);
    if (applied.version !== 1 || appliedRoute.ready && appliedRoute.domain !== domain || applied.model_execute !== false
      || applied.notify !== false || applied.live_authority !== false || applied.external_send !== false
      || applied.execution_started !== false || Object.hasOwn(applied, "execution")) fail("proactivity_response_invalid", "apply");
    if (!appliedRoute.ready) {
      if (applied.applied_operation !== null || applied.application !== null
        || applied.automatic_continuation_attempted !== false) fail("proactivity_response_invalid", "apply");
      return { status: "captured", resolutionStatus: appliedRoute.status, reason: appliedRoute.reason,
        goalId: null, workCaseId: null, routedDomain: appliedRoute.domain, externalSend: false };
    }
    const application = applied.application;
    if (applied.applied_operation !== "owner_intent_apply" || applied.automatic_continuation_attempted !== true
      || !application || typeof application !== "object" || Array.isArray(application)) fail("proactivity_response_invalid", "apply");
    const goal = application as Record<string, unknown>;
    if (!["applied", "replayed", "held"].includes(String(goal.status)) || !ID.test(String(goal.goal_id || ""))
      || !Number.isSafeInteger(goal.goal_version) || Number(goal.goal_version) < 1
      || typeof goal.goal_created !== "boolean" || typeof goal.replayed !== "boolean"
      || goal.replayed !== (goal.status === "replayed") || goal.source_basis_hash !== appliedRoute.sourceBasisHash
      || goal.opportunity_id !== null && !ID.test(String(goal.opportunity_id))) fail("proactivity_response_invalid", "apply");
    if (goal.status === "held") return { status: "captured", resolutionStatus: "held", reason: appliedRoute.reason,
      goalId: null, workCaseId: null, routedDomain: domain, externalSend: false };
    const recorded: AmbientResult = { status: "recorded", resolutionStatus: "needs_verification",
      reason: "work_case_unverified", goalId: String(goal.goal_id), workCaseId: null, routedDomain: domain, externalSend: false };
    let resolution: Record<string, unknown>;
    try {
      resolution = result(await host.callOwnerControl("owner_intent_resolve", {
        root_ref: input.rootRef, expected_owner_id: context.ownerId, message_ref: messageRef,
      }), "resolve");
    } catch { return recorded; }
    const target = resolution.target;
    const workCaseId = target && typeof target === "object" && !Array.isArray(target)
      ? (target as Record<string, unknown>).work_case_id : null;
    if (resolution.status !== "source_bound" || resolution.external_send !== false || !ID.test(String(workCaseId || ""))) {
      return recorded;
    }
    let currentBindings: ControlBinding[];
    try { currentBindings = await bindings(); }
    catch { return recorded; }
    if (currentBindings.filter(item => item.goalId === goal.goal_id && item.workCaseId === workCaseId
      && item.goalVersion === goal.goal_version && item.status === "active").length !== 1) return recorded;
    return { status: "applied", resolutionStatus: "source_bound", reason: appliedRoute.reason,
      goalId: String(goal.goal_id), workCaseId: String(workCaseId), routedDomain: domain, externalSend: false };
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
