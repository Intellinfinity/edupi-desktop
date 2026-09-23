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
type OwnerRead = { root_ref: string; owner: { id: string } | null; grants: OwnerGrant[] };

export class EduPiProactivityRuntimeError extends Error {
  constructor(public readonly code: "proactivity_response_invalid" | "proactivity_grant_revoked" | "proactivity_runtime_unavailable") {
    super(code); this.name = "EduPiProactivityRuntimeError";
  }
}

function invalid(): never { throw new EduPiProactivityRuntimeError("proactivity_response_invalid"); }

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
  return { root_ref: rootRef, owner: owner ? { id: String((owner as Record<string, unknown>).id) } : null, grants: normalized };
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
): Promise<{ status: EffectiveGrantStatus; grantVersion: number; endsAt: string } | null> {
  if (grantId === null) return null;
  const grant = (await readOwner(host, rootRef)).grants.find((item) => item.id === grantId);
  return grant ? { status: grant.status === "active" && Date.parse(grant.ends_at) <= now ? "expired" : grant.status,
    grantVersion: grant.version, endsAt: grant.ends_at } : null;
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
