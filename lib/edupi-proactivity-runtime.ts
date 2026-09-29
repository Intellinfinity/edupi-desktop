import { randomUUID } from "node:crypto";
import type { EduPiRuntimeHandle } from "./edupi-runtime-supervisor";
import { EduPiProactivityControlError } from "./edupi-proactivity-control";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/u;

type GrantBinding = {
  grantId: string;
  endsAt: string;
  spec: { scope: { class_id: string; subject: string }; domains: ["teaching_preparation"]; actions: ["prepare", "update"];
    source_ids: string[]; starts_at: string; ends_at: string; budget: { id: string; max_calls: number } };
};

type OwnerGrant = { id: string; version: number; status: "active" | "paused" | "revoked"; ends_at: string };
type EffectiveGrantStatus = OwnerGrant["status"] | "expired";
type OwnerBudget = { grantId: string; budgetId: string; usedCalls: number; maxCalls: number;
  remainingCalls: number; usageUnverified: boolean };
type OwnerRead = { root_ref: string; owner: { id: string } | null; grants: OwnerGrant[]; g1ModelBudget: OwnerBudget[] | null };

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
  const rawBudget = read.g1_model_budget;
  if (rawBudget !== undefined && (!Array.isArray(rawBudget) || rawBudget.length > 768)) invalid();
  const g1ModelBudget = rawBudget === undefined ? null : rawBudget.map((raw): OwnerBudget => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).length !== 7 || !["grant_id", "budget_id", "used_calls", "max_calls", "remaining_calls", "exhausted", "usage_unverified"]
      .every(key => Object.hasOwn(item, key)) || !ID.test(String(item.grant_id || "")) || !ID.test(String(item.budget_id || ""))
      || !Number.isSafeInteger(item.used_calls) || Number(item.used_calls) < 0 || Number(item.used_calls) > 1536
      || !Number.isSafeInteger(item.max_calls) || Number(item.max_calls) < 0 || Number(item.max_calls) > 12
      || !Number.isSafeInteger(item.remaining_calls) || Number(item.remaining_calls) < 0 || Number(item.remaining_calls) > 12
      || typeof item.exhausted !== "boolean" || typeof item.usage_unverified !== "boolean"
      || item.usage_unverified && (item.remaining_calls !== 0 || item.exhausted !== true)
      || !item.usage_unverified && (item.remaining_calls !== Math.max(0, Number(item.max_calls) - Number(item.used_calls))
        || item.exhausted !== (item.remaining_calls === 0))) invalid();
    return { grantId: String(item.grant_id), budgetId: String(item.budget_id), usedCalls: Number(item.used_calls),
      maxCalls: Number(item.max_calls), remainingCalls: Number(item.remaining_calls), usageUnverified: item.usage_unverified as boolean };
  });
  if (g1ModelBudget && (new Set(g1ModelBudget.map(item => item.grantId)).size !== g1ModelBudget.length
    || g1ModelBudget.some(item => !normalized.some(grant => grant.id === item.grantId)))) invalid();
  return { root_ref: rootRef, owner: owner ? { id: String((owner as Record<string, unknown>).id) } : null,
    grants: normalized, g1ModelBudget };
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
  binding: GrantBinding,
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
): Promise<{ status: EffectiveGrantStatus; grantVersion: number; endsAt: string;
  modelBudget: Pick<OwnerBudget, "usedCalls" | "maxCalls" | "remainingCalls" | "usageUnverified"> } | null> {
  if (grantId === null) return null;
  const state = await readOwner(host, rootRef);
  const grant = state.grants.find((item) => item.id === grantId);
  const budget = state.g1ModelBudget?.find(item => item.grantId === grantId);
  if (grant && !budget) invalid();
  return grant ? { status: grant.status === "active" && Date.parse(grant.ends_at) <= now ? "expired" : grant.status,
    grantVersion: grant.version, endsAt: grant.ends_at,
    modelBudget: { usedCalls: budget!.usedCalls, maxCalls: budget!.maxCalls,
      remainingCalls: budget!.remainingCalls, usageUnverified: budget!.usageUnverified } } : null;
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
