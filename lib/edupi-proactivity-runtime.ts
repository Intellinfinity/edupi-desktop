import { randomUUID } from "node:crypto";
import type { EduPiRuntimeHandle } from "./edupi-runtime-supervisor";
import { EduPiProactivityControlError, type EduPiProactivityGrantBinding } from "./edupi-proactivity-control";
import type { EduPiProactivityDomain } from "./edupi-proactivity-config";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/u;

type OwnerGrant = { id: string; version: number; status: "active" | "paused" | "revoked"; ends_at: string };
type EffectiveGrantStatus = OwnerGrant["status"] | "expired";
type OwnerBudget = { grantId: string; budgetId: string; usedCalls: number; maxCalls: number;
  remainingCalls: number; usageUnverified: boolean };
export type EduPiStudentFollowupExecution = {
  version: 1; available: boolean; revision: number | null; externalSend: false;
  records: Array<{ executionId: string; followUpId: string; grantId: string | null;
    status: "queued" | "claimed" | "completed" | "failed" | "cancelled";
    attempt: number; errorCode: string | null; updatedAt: string;
    sourceStatus: "current" | "historical" | "unverified" }>;
};
type OwnerRead = { root_ref: string; owner: { id: string } | null; grants: OwnerGrant[];
  g1ModelBudget: OwnerBudget[] | null; g2ModelBudget: OwnerBudget[] | null;
  execution: EduPiStudentFollowupExecution | null };

export class EduPiProactivityRuntimeError extends Error {
  constructor(public readonly code: "proactivity_response_invalid" | "proactivity_grant_revoked" | "proactivity_runtime_unavailable"
    | "proactivity_budget_exhausted" | "proactivity_grant_denied" | "proactivity_preparation_blocked"
    | "proactivity_stop_uncertain") {
    super(code); this.name = "EduPiProactivityRuntimeError";
  }
}

function invalid(): never { throw new EduPiProactivityRuntimeError("proactivity_response_invalid"); }

export function inspectProactivityCatchUp(value: unknown): { queued: number; needsAttention: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value) || (value as Record<string, unknown>).ok !== true) invalid();
  const result = (value as Record<string, unknown>).result;
  if (!result || typeof result !== "object" || Array.isArray(result)) invalid();
  const { tasks, failures } = result as Record<string, unknown>;
  if (!Array.isArray(tasks) || tasks.length > 20 || !Array.isArray(failures) || failures.length > 20) invalid();
  const codes = failures.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) invalid();
    const code = (item as Record<string, unknown>).code;
    if (typeof code !== "string" || !/^[a-z_]{1,64}$/u.test(code)) invalid();
    return code;
  });
  if (codes.includes("budget_exhausted")) throw new EduPiProactivityRuntimeError("proactivity_budget_exhausted");
  if (codes.includes("permission_denied")) throw new EduPiProactivityRuntimeError("proactivity_grant_denied");
  // Core emits completed_source_changed only after validating current sources
  // and finding a durable prior draft with an older signature. A generic
  // stale_source may instead mean deleted or unreadable material and blocks.
  if (tasks.length === 0 && codes.some(code => code !== "completed_source_changed")) {
    throw new EduPiProactivityRuntimeError("proactivity_preparation_blocked");
  }
  return { queued: tasks.length, needsAttention: failures.length > 0 };
}

function modelBudget(value: unknown, grants: OwnerGrant[], maxCalls: number): OwnerBudget[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > 768) invalid();
  const budget = value.map((raw): OwnerBudget => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).length !== 7 || !["grant_id", "budget_id", "used_calls", "max_calls", "remaining_calls", "exhausted", "usage_unverified"]
      .every(key => Object.hasOwn(item, key)) || typeof item.grant_id !== "string" || !ID.test(item.grant_id)
      || typeof item.budget_id !== "string" || !ID.test(item.budget_id)
      || !Number.isSafeInteger(item.used_calls) || Number(item.used_calls) < 0 || Number(item.used_calls) > 1536
      || !Number.isSafeInteger(item.max_calls) || Number(item.max_calls) < 0 || Number(item.max_calls) > maxCalls
      || !Number.isSafeInteger(item.remaining_calls) || Number(item.remaining_calls) < 0 || Number(item.remaining_calls) > maxCalls
      || typeof item.exhausted !== "boolean" || typeof item.usage_unverified !== "boolean"
      || item.usage_unverified && (item.remaining_calls !== 0 || item.exhausted !== true)
      || !item.usage_unverified && (item.remaining_calls !== Math.max(0, Number(item.max_calls) - Number(item.used_calls))
        || item.exhausted !== (item.remaining_calls === 0))) invalid();
    return { grantId: item.grant_id, budgetId: item.budget_id, usedCalls: Number(item.used_calls),
      maxCalls: Number(item.max_calls), remainingCalls: Number(item.remaining_calls), usageUnverified: item.usage_unverified };
  });
  if (new Set(budget.map(item => item.grantId)).size !== budget.length
    || budget.some(item => !grants.some(grant => grant.id === item.grantId))) invalid();
  return budget;
}

function executionProjection(value: unknown): EduPiStudentFollowupExecution | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const execution = value as Record<string, unknown>;
  if (Object.keys(execution).length !== 5 || execution.version !== 1 || typeof execution.available !== "boolean"
    || execution.external_send !== false || !Array.isArray(execution.records) || execution.records.length > 500
    || (execution.available ? !Number.isSafeInteger(execution.revision) || Number(execution.revision) < 0
      : execution.revision !== null || execution.records.length !== 0)) invalid();
  const records = execution.records.map((raw): EduPiStudentFollowupExecution["records"][number] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).length !== 8 || typeof item.execution_id !== "string" || !ID.test(item.execution_id)
      || typeof item.follow_up_id !== "string" || !ID.test(item.follow_up_id)
      || item.grant_id !== null && (typeof item.grant_id !== "string" || !ID.test(item.grant_id))
      || typeof item.status !== "string" || !["queued", "claimed", "completed", "failed", "cancelled"].includes(item.status)
      || !Number.isSafeInteger(item.attempt) || Number(item.attempt) < 0 || Number(item.attempt) > 3
      || item.error_code !== null && (typeof item.error_code !== "string" || !/^[a-z][a-z0-9_]{0,79}$/u.test(item.error_code))
      || typeof item.updated_at !== "string" || !Number.isFinite(Date.parse(item.updated_at))
      || new Date(item.updated_at).toISOString() !== item.updated_at
      || typeof item.source_status !== "string" || !["current", "historical", "unverified"].includes(item.source_status)
      || item.source_status === "current" && item.grant_id === null) invalid();
    return { executionId: item.execution_id, followUpId: item.follow_up_id, grantId: item.grant_id as string | null,
      status: item.status as EduPiStudentFollowupExecution["records"][number]["status"], attempt: Number(item.attempt),
      errorCode: item.error_code as string | null, updatedAt: item.updated_at,
      sourceStatus: item.source_status as EduPiStudentFollowupExecution["records"][number]["sourceStatus"] };
  });
  if (new Set(records.map(item => item.executionId)).size !== records.length) invalid();
  return { version: 1, available: execution.available, revision: execution.revision as number | null, records, externalSend: false };
}

function ownerRead(value: unknown, rootRef: string): OwnerRead {
  if (!value || typeof value !== "object" || Array.isArray(value) || (value as Record<string, unknown>).ok !== true) invalid();
  const result = (value as Record<string, unknown>).result;
  if (!result || typeof result !== "object" || Array.isArray(result)) invalid();
  const read = result as Record<string, unknown>;
  const owner = read.owner;
  const grants = read.grants;
  if (read.root_ref !== rootRef || owner !== null && (!owner || typeof owner !== "object" || Array.isArray(owner)
    || !ID.test(String((owner as Record<string, unknown>).id || ""))) || !Array.isArray(grants)) invalid();
  const normalized = grants.map((raw): OwnerGrant => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
    const grant = raw as Record<string, unknown>;
    if (!ID.test(String(grant.id || "")) || !Number.isSafeInteger(grant.version) || Number(grant.version) < 1
      || !["active", "paused", "revoked"].includes(String(grant.status)) || typeof grant.ends_at !== "string"
      || !Number.isFinite(Date.parse(grant.ends_at)) || new Date(grant.ends_at).toISOString() !== grant.ends_at) invalid();
    return { id: String(grant.id), version: Number(grant.version), status: grant.status as OwnerGrant["status"], ends_at: grant.ends_at };
  });
  return { root_ref: rootRef, owner: owner ? { id: String((owner as Record<string, unknown>).id) } : null,
    grants: normalized, g1ModelBudget: modelBudget(read.g1_model_budget, normalized, 12),
    g2ModelBudget: modelBudget(read.g2_model_budget, normalized, 4), execution: executionProjection(read.g2_execution) };
}

async function readOwner(host: Pick<EduPiRuntimeHandle, "call">, rootRef: string): Promise<OwnerRead> {
  if (!HASH.test(rootRef)) invalid();
  return ownerRead(await host.call("owner_read", { root_ref: rootRef }), rootRef);
}

function receipt(value: unknown, ownerId: string, grantId: string | null): { grantVersion: number | null } {
  if (!value || typeof value !== "object" || Array.isArray(value) || (value as Record<string, unknown>).ok !== true) invalid();
  const result = (value as Record<string, unknown>).result;
  if (!result || typeof result !== "object" || Array.isArray(result)) invalid();
  const item = result as Record<string, unknown>;
  if (item.owner_id !== ownerId || item.grant_id !== grantId
    || item.grant_version !== null && (!Number.isSafeInteger(item.grant_version) || Number(item.grant_version) < 1)) invalid();
  return { grantVersion: item.grant_version === null ? null : Number(item.grant_version) };
}

export async function ensureProactivityGrant(
  host: Pick<EduPiRuntimeHandle, "call" | "callOwnerControl">,
  rootRef: string,
  binding: EduPiProactivityGrantBinding,
): Promise<{ ownerId: string; grantId: string; grantVersion: number; status: "active"; endsAt: string }> {
  let state = await readOwner(host, rootRef);
  let ownerId = state.owner?.id || null;
  if (!ownerId) {
    const boot = await host.callOwnerControl("owner_control", {
      command_id: `desktop-bootstrap-${randomUUID()}`, root_ref: rootRef, expected_owner_id: null, action: "bootstrap",
    });
    if (!boot || typeof boot !== "object" || Array.isArray(boot) || (boot as Record<string, unknown>).ok !== true) invalid();
    const result = (boot as Record<string, unknown>).result;
    ownerId = result && typeof result === "object" && !Array.isArray(result) && ID.test(String((result as Record<string, unknown>).owner_id || ""))
      ? String((result as Record<string, unknown>).owner_id) : null;
    if (!ownerId) invalid();
    state = await readOwner(host, rootRef);
    if (state.owner?.id !== ownerId) invalid();
  }
  let grant = state.grants.find((item) => item.id === binding.grantId) || null;
  if (grant?.status === "revoked") throw new EduPiProactivityRuntimeError("proactivity_grant_revoked");
  const action = grant ? "update" : "create";
  const applied = receipt(await host.callOwnerControl("owner_control", {
    command_id: `desktop-grant-${randomUUID()}`,
    root_ref: rootRef,
    expected_owner_id: ownerId,
    action,
    grant_id: binding.grantId,
    expected_version: grant?.version || 0,
    spec: binding.spec,
  }), ownerId, binding.grantId);
  if (!applied.grantVersion) invalid();
  let version = applied.grantVersion;
  if (grant?.status === "paused") {
    const resumed = receipt(await host.callOwnerControl("owner_control", {
      command_id: `desktop-resume-${randomUUID()}`, root_ref: rootRef, expected_owner_id: ownerId,
      action: "resume", grant_id: binding.grantId, expected_version: version,
    }), ownerId, binding.grantId);
    if (!resumed.grantVersion) invalid();
    version = resumed.grantVersion;
  }
  const verified = await readOwner(host, rootRef);
  grant = verified.grants.find((item) => item.id === binding.grantId) || null;
  if (verified.owner?.id !== ownerId || !grant || grant.status !== "active" || grant.version !== version || grant.ends_at !== binding.endsAt) invalid();
  return { ownerId, grantId: binding.grantId, grantVersion: version, status: "active", endsAt: binding.endsAt };
}

export async function pauseProactivityGrant(
  host: Pick<EduPiRuntimeHandle, "call" | "callOwnerControl">,
  rootRef: string,
  grantId: string,
): Promise<{ state: "paused" | "missing" | "revoked"; grantVersion: number | null }> {
  const state = await readOwner(host, rootRef);
  const ownerId = state.owner?.id;
  const grant = state.grants.find((item) => item.id === grantId);
  if (!ownerId || !grant) return { state: "missing", grantVersion: null };
  if (grant.status === "revoked") return { state: "revoked", grantVersion: grant.version };
  if (grant.status === "paused") return { state: "paused", grantVersion: grant.version };
  const paused = receipt(await host.callOwnerControl("owner_control", {
    command_id: `desktop-pause-${randomUUID()}`, root_ref: rootRef, expected_owner_id: ownerId,
    action: "pause", grant_id: grantId, expected_version: grant.version,
  }), ownerId, grantId);
  if (!paused.grantVersion) invalid();
  return { state: "paused", grantVersion: paused.grantVersion };
}

export async function readProactivityGrantStatus(
  host: Pick<EduPiRuntimeHandle, "call">,
  rootRef: string,
  grantId: string | null,
  now = Date.now(),
  domain: EduPiProactivityDomain = "teaching_preparation",
): Promise<{ status: EffectiveGrantStatus; grantVersion: number; endsAt: string;
  modelBudget: Pick<OwnerBudget, "usedCalls" | "maxCalls" | "remainingCalls" | "usageUnverified"> | null } | null> {
  if (grantId === null) return null;
  return grantStatus(await readOwner(host, rootRef), grantId, now, domain);
}

export async function readProactivityGrantDomainProof(
  host: Pick<EduPiRuntimeHandle, "call">, rootRef: string, grantId: string,
): Promise<{ grantId: string; domain: EduPiProactivityDomain; scope: { classId: string; subject: string };
  status: "active" | "paused" | "revoked"; version: number } | null> {
  if (!HASH.test(rootRef) || !ID.test(grantId)) invalid();
  const response = await host.call("owner_read", { root_ref: rootRef });
  const result = response && typeof response === "object" && !Array.isArray(response)
    ? response.result as Record<string, unknown> | null : null;
  const owner = result?.owner;
  if (response?.ok !== true || !result || result.root_ref !== rootRef || result.external_send !== false
    || !owner || typeof owner !== "object" || Array.isArray(owner)
    || !ID.test(String((owner as Record<string, unknown>).id || ""))
    || !Array.isArray(result.grants) || result.grants.length > 128) invalid();
  const matching = result.grants.filter(item => item && typeof item === "object" && !Array.isArray(item)
    && (item as Record<string, unknown>).id === grantId);
  if (matching.length > 1) invalid();
  if (matching.length === 0) return null;
  const row = matching[0] as Record<string, unknown>;
  const scope = row.scope && typeof row.scope === "object" && !Array.isArray(row.scope)
    ? row.scope as Record<string, unknown> : null;
  const domain = Array.isArray(row.domains) && row.domains.length === 1 ? row.domains[0] : null;
  if (!scope || !ID.test(String(scope.class_id || "")) || typeof scope.subject !== "string"
    || !scope.subject.trim() || scope.subject.length > 128
    || !["teaching_preparation", "student_followup", "calendar_administration", "lesson_reflection", "parent_communication"].includes(String(domain))
    || !["active", "paused", "revoked"].includes(String(row.status))
    || !Number.isSafeInteger(row.version) || Number(row.version) < 1) invalid();
  return { grantId, domain: domain as EduPiProactivityDomain,
    scope: { classId: String(scope.class_id), subject: scope.subject },
    status: row.status as "active" | "paused" | "revoked", version: Number(row.version) };
}

function grantStatus(state: OwnerRead, grantId: string | null, now: number, domain: EduPiProactivityDomain) {
  const grant = state.grants.find((item) => item.id === grantId);
  const budgets = domain === "teaching_preparation" ? state.g1ModelBudget
    : domain === "student_followup" ? state.g2ModelBudget : null;
  const budget = budgets?.find(item => item.grantId === grantId);
  if (grant && !budget && (domain === "teaching_preparation" || budgets !== null)) invalid();
  return grant ? { status: (grant.status === "active" && Date.parse(grant.ends_at) <= now ? "expired" : grant.status) as EffectiveGrantStatus,
    grantVersion: grant.version, endsAt: grant.ends_at,
    modelBudget: budget ? { usedCalls: budget.usedCalls, maxCalls: budget.maxCalls,
      remainingCalls: budget.remainingCalls, usageUnverified: budget.usageUnverified } : null } : null;
}

export async function readProactivityRuntimeState(host: Pick<EduPiRuntimeHandle, "call">, rootRef: string,
  grantId: string | null, domain: EduPiProactivityDomain, now = Date.now()) {
  const state = await readOwner(host, rootRef);
  let execution = domain === "student_followup" ? state.execution : null;
  if (execution && grantId) {
    // Unbound owner records may belong to this grant. Filtering them out
    // cannot prove an empty queue or a complete list for the selected grant.
    execution = execution.records.some(item => item.grantId === null)
      ? { version: 1, available: false, revision: null, records: [], externalSend: false }
      : { ...execution, records: execution.records.filter(item => item.grantId === grantId) };
  }
  return { grant: grantStatus(state, grantId, now, domain), execution };
}

export async function readProactivityOwnerContext(
  host: Pick<EduPiRuntimeHandle, "call">,
  rootRef: string,
  grantId: string,
  now = Date.now(),
): Promise<{ ownerId: string; grantId: string; grantVersion: number; status: EffectiveGrantStatus } | null> {
  const state = await readOwner(host, rootRef);
  const grant = state.grants.find((item) => item.id === grantId);
  return state.owner && grant ? { ownerId: state.owner.id, grantId, grantVersion: grant.version,
    status: grant.status === "active" && Date.parse(grant.ends_at) <= now ? "expired" : grant.status } : null;
}

export function proactivityRuntimeError(error: unknown): EduPiProactivityRuntimeError | EduPiProactivityControlError {
  return error instanceof EduPiProactivityRuntimeError || error instanceof EduPiProactivityControlError
    ? error : new EduPiProactivityRuntimeError("proactivity_runtime_unavailable");
}
