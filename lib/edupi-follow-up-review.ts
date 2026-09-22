import crypto from "node:crypto";
import { callEduPiCore } from "./edupi-core-process-client";
import {
  validateCommand,
  validateCoreEnvelopeSchema,
  validateReceiptSemantics,
  validateSnapshotSemantics,
} from "./edupi-bridge-contract";
import { activeBridgeIdentity } from "./edupi-bridge-manifest";
import { readEduPiEducationSnapshot, resolveEduPiBridgeRoots, type EduPiBridgeRoots } from "./edupi-core-snapshot";

export const FOLLOW_UP_REVIEW_COMMANDS = ["review_follow_up"] as const;
export const FOLLOW_UP_REVIEW_DECISIONS = ["accept", "modify", "reject", "hold"] as const;

export type FollowUpReviewDecision = typeof FOLLOW_UP_REVIEW_DECISIONS[number];
export type FollowUpReviewPatch = { internalDraftSummary?: string; nextStep?: string };
export type FollowUpReviewInput = {
  snapshot: unknown;
  targetId: string;
  expectedSnapshotId: string;
  expectedRevision: number;
  decision: FollowUpReviewDecision;
  patch?: FollowUpReviewPatch | Record<string, unknown> | null;
  note?: string | null;
  reviewerId?: string | null;
  reviewer?: string | null;
  issuedAt?: string;
};
export type FollowUpReviewCommandEnvelope = Record<string, unknown> & {
  contract_version: "1.1";
  producer: "edupi-desktop";
  external_send: false;
  snapshot_id: string;
  idempotency_key: string;
  command: Record<string, unknown> & { command_type: "review_follow_up" };
};
export type FollowUpReviewErrorCode = "invalid_envelope" | "unsupported_command" | "stale_snapshot" | "stale_revision" | "unavailable";

export class FollowUpReviewError extends Error {
  constructor(public readonly code: FollowUpReviewErrorCode, message: string) {
    super(message);
    this.name = "FollowUpReviewError";
  }
}

export type FollowUpReviewDependencies = {
  supportedCommands?: readonly string[];
  dispatch?: (envelope: FollowUpReviewCommandEnvelope) => Promise<unknown> | unknown;
  refreshSnapshot?: () => Promise<unknown> | unknown;
};

type RawRecord = Record<string, unknown>;
type FollowUpContext = {
  target: RawRecord;
  targetId: string;
  revision: number;
  status: string;
  summary: string;
  internalDraftSummary: string;
  nextStep?: string;
  permissionState: string;
  sourceIds: string[];
  evidenceIds: string[];
  observedEventIds: string[];
  teacherReview: RawRecord;
};

const FOLLOW_UP_STATUSES = new Set(["candidate", "pending_review", "accepted", "modified", "rejected", "held", "suppressed"]);
const FOLLOW_UP_REVIEW_STATE: Record<string, string> = {
  candidate: "pending_review",
  pending_review: "pending_review",
  accepted: "accepted",
  modified: "modified",
  rejected: "rejected",
  held: "held",
  suppressed: "rejected",
};
const SENSITIVE_LANGUAGE = /(诊断|多动症|自闭|抑郁|焦虑症|智力障碍|品行问题|坏学生|笨|懒|危险分子|暴力倾向)/u;

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new FollowUpReviewError("invalid_envelope", `${field} is invalid`);
  return value.trim();
}

function optionalNote(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, "note", 1000);
}

function finiteRevision(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new FollowUpReviewError("invalid_envelope", `${field} is invalid`);
  return value;
}

function exactList(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function boundedList(value: unknown, field: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 50) throw new FollowUpReviewError("invalid_envelope", `${field} is invalid`);
  const result = value.map((item) => requiredText(item, `${field} item`, 160));
  if (new Set(result).size !== result.length) throw new FollowUpReviewError("invalid_envelope", `${field} contains duplicates`);
  return result;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const source = value as RawRecord;
  return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalize(source[key])]));
}

function makeTransportId(prefix: string): string {
  return `desktop-${prefix}-${crypto.randomUUID()}`;
}

function snapshotParts(value: unknown): { envelope: RawRecord; payload: RawRecord } {
  const envelope = record(value);
  const payload = record(envelope?.payload);
  if (!envelope || !payload || !validateCoreEnvelopeSchema(envelope)) throw new FollowUpReviewError("invalid_envelope", "Core education snapshot envelope is invalid");
  const identity = activeBridgeIdentity();
  if (envelope.contract_version !== identity.contract.contract_version
    || envelope.schema_hash !== identity.contract.schema_hash
    || envelope.producer !== "edupi-core"
    || envelope.external_send !== false
    || typeof envelope.snapshot_id !== "string"
    || envelope.snapshot_id !== payload.snapshot_id
    || typeof payload.state_hash !== "string"
    || !exactList(record(payload.capabilities)?.supported_commands, identity.contract.supported_commands)
    || !exactList(record(payload.capabilities)?.supported_projections, identity.contract.supported_projections)
    || !validateSnapshotSemantics(payload, { supportedCommands: identity.contract.supported_commands, supportedProjections: identity.contract.supported_projections }).ok) {
    throw new FollowUpReviewError("invalid_envelope", "Core education snapshot identity or capability is invalid");
  }
  return { envelope, payload };
}

function activeFollowUpTarget(payload: RawRecord, targetId: string): FollowUpContext {
  const targets = Array.isArray(payload.review_targets) ? payload.review_targets : [];
  const matches = targets.filter((value) => {
    const projection = record(value);
    const target = record(projection?.target);
    return projection?.projection_kind === "follow_up"
      && target?.target_kind === "follow_up"
      && target.command_type === "review_follow_up"
      && target.target_id === targetId;
  });
  if (matches.length !== 1) throw new FollowUpReviewError("invalid_envelope", "Core follow-up target was not found or is ambiguous");
  const target = record(matches[0]);
  const targetRef = record(target?.target);
  const teacherReview = record(target?.teacher_review);
  if (!target || !targetRef || !teacherReview) throw new FollowUpReviewError("invalid_envelope", "Core follow-up target is malformed");
  const revision = finiteRevision(target.revision, "target.revision");
  if (teacherReview.revision !== revision) throw new FollowUpReviewError("invalid_envelope", "target.teacher_review is invalid");
  const status = requiredText(target.status, "target.status", 40);
  if (!FOLLOW_UP_STATUSES.has(status)) throw new FollowUpReviewError("invalid_envelope", "target.status is invalid");
  if (teacherReview.state !== FOLLOW_UP_REVIEW_STATE[status]) throw new FollowUpReviewError("invalid_envelope", "target.teacher_review state is invalid");
  const sourceIds = boundedList(target.source_ids, "target.source_ids");
  const evidenceIds = boundedList(target.evidence_ids, "target.evidence_ids");
  const observedEventIds = boundedList(target.observed_event_ids, "target.observed_event_ids");
  if (sourceIds.length !== 1 || sourceIds[0] !== targetId) throw new FollowUpReviewError("invalid_envelope", "Core follow-up source binding is invalid");
  if (target.external_send !== false) throw new FollowUpReviewError("invalid_envelope", "target.external_send is invalid");
  const permissionState = requiredText(target.permission_state, "target.permission_state", 40);
  if (!["not_required", "permission_required", "approved", "blocked"].includes(permissionState)) throw new FollowUpReviewError("invalid_envelope", "target.permission_state is invalid");
  const summary = requiredText(target.summary, "target.summary", 2000);
  const internalDraftSummary = requiredText(target.internal_draft_summary, "target.internal_draft_summary", 2000);
  if (SENSITIVE_LANGUAGE.test(summary) || SENSITIVE_LANGUAGE.test(internalDraftSummary)) throw new FollowUpReviewError("invalid_envelope", "follow-up target contains sensitive classification");
  const title = requiredText(target.title, "target.title", 240);
  void title;
  const nextStep = target.next_step === undefined ? undefined : requiredText(target.next_step, "target.next_step", 1000);
  return { target, targetId, revision, status, summary, internalDraftSummary, nextStep, permissionState, sourceIds, evidenceIds, observedEventIds, teacherReview };
}

function activeSourceFromSnapshot(envelope: RawRecord, context: FollowUpContext): RawRecord {
  const entries = (Array.isArray(envelope.provenance) ? envelope.provenance : [])
    .map((item) => record(item))
    .filter((item): item is RawRecord => item !== null)
    .filter((item) => item.source_kind === "core_event" && item.source_id === context.targetId);
  if (entries.length !== 1) throw new FollowUpReviewError("invalid_envelope", "Active follow-up provenance is missing or ambiguous");
  const source = entries[0];
  const sourceHash = source.source_hash === null ? null : requiredText(source.source_hash, "source.source_hash", 160);
  if (sourceHash !== null && !/^sha256:[A-Za-z0-9_-]+$/.test(sourceHash)) throw new FollowUpReviewError("invalid_envelope", "source.source_hash is invalid");
  if (source.source_path !== null || source.actor !== "core") throw new FollowUpReviewError("invalid_envelope", "source identity is invalid");
  const evidenceIds = boundedList(source.evidence_ids, "source.evidence_ids");
  const parentIds = boundedList(source.parent_ids, "source.parent_ids", true);
  if (!exactList(evidenceIds, context.evidenceIds) || !exactList(parentIds, context.observedEventIds)) throw new FollowUpReviewError("invalid_envelope", "source evidence does not match target");
  return {
    source_kind: "core_event",
    source_id: context.targetId,
    source_path: null,
    source_hash: sourceHash,
    observed_at: requiredText(source.observed_at, "source.observed_at", 64),
    actor: "core",
    evidence_ids: evidenceIds,
    parent_ids: parentIds,
  };
}

function boundedPatch(value: unknown, decision: FollowUpReviewDecision, current: FollowUpContext): RawRecord | null {
  if (value === undefined || value === null) {
    if (decision === "modify") throw new FollowUpReviewError("invalid_envelope", "modify requires a follow-up patch");
    return null;
  }
  const patch = record(value);
  if (!patch) throw new FollowUpReviewError("invalid_envelope", "review patch is invalid");
  const keys = Object.keys(patch);
  if (decision !== "modify" || keys.length === 0 || keys.some((key) => !["internalDraftSummary", "nextStep"].includes(key))) {
    throw new FollowUpReviewError("invalid_envelope", "review patch contains unsupported fields");
  }
  const normalized: RawRecord = {};
  if (patch.internalDraftSummary !== undefined) {
    const value = requiredText(patch.internalDraftSummary, "patch.internalDraftSummary", 2000);
    if (SENSITIVE_LANGUAGE.test(value)) throw new FollowUpReviewError("invalid_envelope", "follow-up draft contains sensitive classification");
    normalized.internal_draft_summary = value;
  }
  if (patch.nextStep !== undefined) {
    const value = requiredText(patch.nextStep, "patch.nextStep", 1000);
    if (SENSITIVE_LANGUAGE.test(value)) throw new FollowUpReviewError("invalid_envelope", "follow-up next step contains sensitive classification");
    normalized.next_step = value;
  }
  if (Object.keys(normalized).length === 0) throw new FollowUpReviewError("invalid_envelope", "modify requires a nonempty follow-up patch");
  if ((normalized.internal_draft_summary === undefined || normalized.internal_draft_summary === current.internalDraftSummary)
    && (normalized.next_step === undefined || normalized.next_step === current.nextStep)) {
    throw new FollowUpReviewError("invalid_envelope", "modify patch does not change the follow-up");
  }
  return normalized;
}

function semanticIdempotencyKey({ snapshotId, stateHash, targetId, revision, decision, patch, note, reviewerId }: {
  snapshotId: string; stateHash: string; targetId: string; revision: number; decision: FollowUpReviewDecision; patch: RawRecord | null; note: string | null; reviewerId: string;
}): string {
  const semantic = canonicalize({ contract_version: "1.1", snapshot: { snapshot_id: snapshotId, state_hash: stateHash }, command_type: "review_follow_up", target_id: targetId, expected_revision: revision, decision, patch, note, reviewer_id: reviewerId });
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(semantic)).digest("base64url")}`;
}

export function buildFollowUpReviewCommandEnvelope(input: FollowUpReviewInput): FollowUpReviewCommandEnvelope {
  if (!FOLLOW_UP_REVIEW_DECISIONS.includes(input.decision)) throw new FollowUpReviewError("invalid_envelope", "follow-up review decision is unsupported");
  const { envelope: snapshotEnvelope, payload } = snapshotParts(input.snapshot);
  const targetId = requiredText(input.targetId, "targetId", 160);
  const expectedSnapshotId = requiredText(input.expectedSnapshotId, "expectedSnapshotId", 160);
  if (expectedSnapshotId !== payload.snapshot_id) throw new FollowUpReviewError("stale_snapshot", "Core education snapshot is stale");
  const expectedRevision = finiteRevision(input.expectedRevision, "expectedRevision");
  const context = activeFollowUpTarget(payload, targetId);
  if (context.revision !== expectedRevision) throw new FollowUpReviewError("stale_revision", "Core follow-up revision is stale");
  const activeSource = activeSourceFromSnapshot(snapshotEnvelope, context);
  const reviewerId = requiredText(input.reviewerId ?? input.reviewer ?? "teacher", "reviewerId", 160);
  const note = optionalNote(input.note);
  const issuedAt = requiredText(input.issuedAt === undefined ? new Date().toISOString() : input.issuedAt, "issuedAt", 64);
  const patch = boundedPatch(input.patch, input.decision, context);
  const idempotencyKey = semanticIdempotencyKey({ snapshotId: payload.snapshot_id as string, stateHash: payload.state_hash as string, targetId, revision: expectedRevision, decision: input.decision, patch, note, reviewerId });
  const commandEnvelope = {
    contract_version: "1.1" as const,
    message_id: makeTransportId("message"),
    request_id: makeTransportId("request"),
    issued_at: issuedAt,
    producer: "edupi-desktop" as const,
    schema_hash: activeBridgeIdentity().contract.schema_hash,
    snapshot_id: payload.snapshot_id,
    idempotency_key: idempotencyKey,
    provenance: [clone(activeSource)],
    teacher_review: { state: "pending_review", reviewer_id: reviewerId, reviewed_at: null, note, revision: expectedRevision },
    external_send: false as const,
    command: {
      command_type: "review_follow_up" as const,
      follow_up_id: targetId,
      expected_revision: expectedRevision,
      decision: input.decision,
      patch,
      source: { source_id: activeSource.source_id, source_kind: "core_event" as const, source_hash: activeSource.source_hash, evidence_ids: activeSource.evidence_ids },
      note,
    },
  };
  const validation = validateCommand(commandEnvelope.command);
  if (!validation.ok || !validateCoreEnvelopeSchema(commandEnvelope)) throw new FollowUpReviewError("invalid_envelope", `Follow-up review command envelope is invalid (${validation.ok ? "schema" : "command"})`);
  return commandEnvelope as unknown as FollowUpReviewCommandEnvelope;
}

function errorFromDispatch(value: unknown): FollowUpReviewError | null {
  const response = record(value);
  if (!response) return null;
  const code = response.code || response.reason_code;
  if (code === "stale_snapshot") return new FollowUpReviewError("stale_snapshot", "Core rejected the stale education snapshot");
  if (code === "stale_revision") return new FollowUpReviewError("stale_revision", "Core rejected the stale follow-up revision");
  if (code === "unsupported_command" || code === "unsupported_capabilities") return new FollowUpReviewError("unsupported_command", "Core does not support follow-up review");
  if (response.ok === false || typeof code === "string") return new FollowUpReviewError("unavailable", "Core follow-up command is unavailable");
  return null;
}

function receiptEnvelopeFrom(value: unknown): RawRecord | null {
  const direct = record(value);
  if (!direct) return null;
  for (const key of ["receipt", "receipt_envelope", "envelope"]) {
    const nested = record(direct[key]);
    if (nested) return nested;
  }
  return Object.hasOwn(direct, "payload") || Object.hasOwn(direct, "producer") ? direct : null;
}

function validateReceiptForCommand(value: unknown, commandEnvelope: FollowUpReviewCommandEnvelope, beforeStateHash: string): RawRecord {
  const receiptEnvelope = receiptEnvelopeFrom(value);
  if (!receiptEnvelope || !validateCoreEnvelopeSchema(receiptEnvelope)) throw new FollowUpReviewError("invalid_envelope", "Core follow-up receipt is invalid");
  const identity = activeBridgeIdentity();
  if (receiptEnvelope.contract_version !== identity.contract.contract_version || receiptEnvelope.schema_hash !== identity.contract.schema_hash || receiptEnvelope.producer !== "edupi-core" || receiptEnvelope.external_send !== false) throw new FollowUpReviewError("invalid_envelope", "Core follow-up receipt identity is invalid");
  const payload = record(receiptEnvelope.payload);
  if (!payload || !validateReceiptSemantics(payload).ok) throw new FollowUpReviewError("invalid_envelope", "Core follow-up receipt semantics are invalid");
  const command = commandEnvelope.command;
  const target = record(payload.target);
  if (payload.command_type !== "review_follow_up" || !target || target.target_kind !== "follow_up" || target.target_id !== command.follow_up_id || target.command_type !== "review_follow_up") throw new FollowUpReviewError("invalid_envelope", "Core follow-up receipt target does not match the request");
  if (payload.command_id !== commandEnvelope.message_id || payload.request_id !== commandEnvelope.request_id || payload.decision !== command.decision || payload.before_snapshot_id !== commandEnvelope.snapshot_id || payload.before_state_hash !== beforeStateHash || payload.external_send !== false) throw new FollowUpReviewError("invalid_envelope", "Core follow-up receipt binding is invalid");
  const requestedEvidence = record(command.source)?.evidence_ids;
  const returnedEvidence = Array.isArray(payload.evidence_ids) ? payload.evidence_ids : [];
  if (!Array.isArray(requestedEvidence) || !requestedEvidence.every((id) => returnedEvidence.includes(id))) throw new FollowUpReviewError("invalid_envelope", "Core follow-up receipt evidence binding is invalid");
  if (payload.status === "stale_snapshot" || payload.reason_code === "stale_snapshot") throw new FollowUpReviewError("stale_snapshot", "Core rejected the stale education snapshot");
  if (payload.status === "stale_revision" || payload.reason_code === "stale_revision") throw new FollowUpReviewError("stale_revision", "Core rejected the stale follow-up revision");
  if (payload.status === "failed") {
    if (payload.reason_code === "unsupported_command") throw new FollowUpReviewError("unsupported_command", "Core does not support follow-up review");
    throw new FollowUpReviewError("unavailable", "Core did not apply the follow-up review");
  }
  const expectedStatus = { accept: "accepted", modify: "modified", reject: "rejected", hold: "held" }[String(command.decision) as FollowUpReviewDecision];
  if (payload.status !== expectedStatus || typeof payload.after_snapshot_id !== "string" || receiptEnvelope.snapshot_id !== payload.after_snapshot_id) throw new FollowUpReviewError("invalid_envelope", "Core follow-up receipt status or snapshot binding is invalid");
  return payload;
}

function refreshedEnvelopeFrom(value: unknown): RawRecord {
  const direct = record(value);
  const envelope = record(direct?.envelope) || direct;
  if (!envelope || !validateCoreEnvelopeSchema(envelope)) throw new FollowUpReviewError("unavailable", "Core education snapshot refresh is unavailable");
  const payload = record(envelope.payload);
  const identity = activeBridgeIdentity();
  if (!payload || envelope.producer !== "edupi-core" || envelope.external_send !== false || envelope.contract_version !== identity.contract.contract_version || envelope.schema_hash !== identity.contract.schema_hash || envelope.snapshot_id !== payload.snapshot_id || !exactList(record(payload.capabilities)?.supported_commands, identity.contract.supported_commands) || !exactList(record(payload.capabilities)?.supported_projections, identity.contract.supported_projections) || !validateSnapshotSemantics(payload, { supportedCommands: identity.contract.supported_commands, supportedProjections: identity.contract.supported_projections }).ok) throw new FollowUpReviewError("unavailable", "Core education snapshot refresh is unavailable");
  return envelope;
}

function validateRefreshedFollowUp(envelope: RawRecord, before: FollowUpContext, commandEnvelope: FollowUpReviewCommandEnvelope, receipt: RawRecord): void {
  const payload = record(envelope.payload);
  if (!payload) throw new FollowUpReviewError("invalid_envelope", "Core follow-up refreshed snapshot is invalid");
  const refreshed = activeFollowUpTarget(payload, String(commandEnvelope.command.follow_up_id));
  const decision = commandEnvelope.command.decision as FollowUpReviewDecision;
  const expectedStatus = { accept: "accepted", modify: "modified", reject: "rejected", hold: "held" }[decision];
  if (refreshed.revision !== before.revision + 1 || refreshed.status !== expectedStatus || refreshed.teacherReview.revision !== before.revision + 1) throw new FollowUpReviewError("invalid_envelope", "Core refreshed follow-up target is invalid");
  if (!exactList(refreshed.sourceIds, before.sourceIds) || !exactList(refreshed.evidenceIds, receipt.evidence_ids as string[]) || JSON.stringify(canonicalize(refreshed.teacherReview)) !== JSON.stringify(canonicalize(receipt.teacher_review))) throw new FollowUpReviewError("invalid_envelope", "Core refreshed follow-up evidence or review binding is invalid");
  if (receipt.after_snapshot_id !== payload.snapshot_id || receipt.after_state_hash !== payload.state_hash || envelope.snapshot_id !== payload.snapshot_id) throw new FollowUpReviewError("invalid_envelope", "Core refreshed follow-up snapshot binding is invalid");
  if (decision === "modify") {
    const patch = record(commandEnvelope.command.patch) || {};
    if (patch.internal_draft_summary !== undefined && refreshed.internalDraftSummary !== patch.internal_draft_summary) throw new FollowUpReviewError("invalid_envelope", "Core modified follow-up summary does not match the request");
    if (patch.next_step !== undefined && refreshed.nextStep !== patch.next_step) throw new FollowUpReviewError("invalid_envelope", "Core modified follow-up next step does not match the request");
  }
}

function productionDependencies(supportedCommands: readonly string[]): Required<Pick<FollowUpReviewDependencies, "supportedCommands" | "dispatch" | "refreshSnapshot">> {
  let roots: EduPiBridgeRoots;
  try { roots = resolveEduPiBridgeRoots(); } catch { throw new FollowUpReviewError("unavailable", "Core education bridge is unavailable"); }
  return {
    supportedCommands,
    dispatch: (envelope) => callEduPiCore({ operation: "command", requestId: envelope.request_id as string, runtime: roots.runtime, dataRoot: roots.dataRoot, envelope }),
    refreshSnapshot: async () => (await readEduPiEducationSnapshot({ roots, requestId: `desktop-follow-up-refresh-${Date.now().toString(36)}` })).envelope,
  };
}

export async function issueFollowUpReview(input: FollowUpReviewInput, deps: FollowUpReviewDependencies = {}): Promise<{ receipt: RawRecord; data: RawRecord }> {
  const identity = activeBridgeIdentity();
  const configuredCommands = deps.supportedCommands || identity.contract.supported_commands;
  if (!exactList(configuredCommands, identity.contract.supported_commands) || !configuredCommands.includes("review_follow_up")) throw new FollowUpReviewError("unsupported_command", "Follow-up review is unavailable until the pinned Core capability is enabled");
  const { payload: beforePayload } = snapshotParts(input.snapshot);
  const before = activeFollowUpTarget(beforePayload, requiredText(input.targetId, "targetId", 160));
  const commandEnvelope = buildFollowUpReviewCommandEnvelope(input);
  const defaults = deps.dispatch && deps.refreshSnapshot ? null : productionDependencies(configuredCommands);
  const production = { supportedCommands: configuredCommands, dispatch: deps.dispatch || defaults!.dispatch, refreshSnapshot: deps.refreshSnapshot || defaults!.refreshSnapshot };
  let rawReceipt: unknown;
  try { rawReceipt = await production.dispatch(commandEnvelope); } catch (error) { const mapped = errorFromDispatch(error); if (mapped) throw mapped; throw new FollowUpReviewError("unavailable", "Core follow-up command is unavailable"); }
  const receipt = validateReceiptForCommand(rawReceipt, commandEnvelope, String(beforePayload.state_hash));
  let refreshed: unknown;
  try { refreshed = await production.refreshSnapshot(); } catch { throw new FollowUpReviewError("unavailable", "Core education snapshot refresh is unavailable"); }
  const refreshedEnvelope = refreshedEnvelopeFrom(refreshed);
  validateRefreshedFollowUp(refreshedEnvelope, before, commandEnvelope, receipt);
  return { receipt, data: refreshedEnvelope };
}
