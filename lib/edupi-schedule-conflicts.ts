import { desktopApiHeaders } from "./desktop-native";

export type ScheduleConflictDecision = "keep_existing" | "replace_with_candidate" | "keep_both_distinct";
type RawRecord = Record<string, unknown>;
export type ScheduleConflict = {
  conflictId: string;
  kind: "calendar" | "timetable";
  canonicalId: string;
  expectedRevision: number;
  expectedContentHash: string;
  expectedConflictHash: string;
  canonical: RawRecord;
  candidate: RawRecord;
};
export type ScheduleResolution = Pick<ScheduleConflict, "conflictId" | "kind" | "canonicalId" | "expectedRevision" | "expectedContentHash" | "expectedConflictHash"> & {
  commandId: string;
  decision: ScheduleConflictDecision;
};
export type ScheduleConflictFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const URL_PATH = "/api/edupi/schedule-conflicts";
const CONFLICT_ID = /^schedule_conflict_[a-f0-9]{32}$/;
const RESOLUTION_ID = /^schedule_resolution_[a-f0-9]{32}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]*$/;
const DECISIONS = new Set<ScheduleConflictDecision>(["keep_existing", "replace_with_candidate", "keep_both_distinct"]);

export class ScheduleConflictError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ScheduleConflictError";
  }
}

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function boundedId(value: unknown, max = 160): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && ID.test(value);
}

function boundedScheduleText(value: unknown, max = 160): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function stringList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 50 && value.every((item) => boundedScheduleText(item, 240));
}

export function normalizeScheduleConflict(value: unknown): ScheduleConflict {
  const raw = record(value);
  const canonical = record(raw?.canonical);
  const candidate = record(raw?.candidate);
  if (!raw || typeof raw.conflict_id !== "string" || !CONFLICT_ID.test(raw.conflict_id)
    || raw.kind !== "calendar" && raw.kind !== "timetable" || !boundedScheduleText(raw.canonical_id)
    || !Number.isSafeInteger(raw.expected_revision) || Number(raw.expected_revision) < 1
    || typeof raw.expected_content_hash !== "string" || !HASH.test(raw.expected_content_hash)
    || typeof raw.expected_conflict_hash !== "string" || !HASH.test(raw.expected_conflict_hash)
    || raw.external_send !== false || !canonical || !candidate
    || canonical[raw.kind === "calendar" ? "event_id" : "slot_id"] !== raw.canonical_id
    || !boundedScheduleText(candidate.source_item_id)
    || !stringList(canonical.source_ids) || !stringList(canonical.evidence_ids)
    || !stringList(candidate.source_ids) || !stringList(candidate.evidence_ids)) {
    throw new ScheduleConflictError("invalid_conflict_response");
  }
  return {
    conflictId: raw.conflict_id, kind: raw.kind, canonicalId: raw.canonical_id,
    expectedRevision: raw.expected_revision as number,
    expectedContentHash: raw.expected_content_hash, expectedConflictHash: raw.expected_conflict_hash,
    canonical, candidate,
  };
}

async function responseBody(response: Response): Promise<RawRecord> {
  try { return record(await response.json()) || {}; }
  catch { return {}; }
}

function responseError(response: Response, body: RawRecord): ScheduleConflictError {
  return new ScheduleConflictError(typeof body.errorCode === "string" ? body.errorCode : response.status === 409 ? "schedule_conflict_stale" : "schedule_conflict_unavailable");
}

export async function bootstrapScheduleConflictReview(fetcher: ScheduleConflictFetcher = fetch, headersProvider: typeof desktopApiHeaders = desktopApiHeaders): Promise<void> {
  const response = await fetcher(URL_PATH, { method: "POST", headers: await headersProvider({ "content-type": "application/json" }), body: JSON.stringify({ action: "bootstrap" }) });
  const body = await responseBody(response);
  if (!response.ok || body.ok !== true || body.externalSend !== false) throw responseError(response, body);
}

export async function readScheduleConflicts(fetcher: ScheduleConflictFetcher = fetch, headersProvider: typeof desktopApiHeaders = desktopApiHeaders, after?: string): Promise<{ conflicts: ScheduleConflict[]; nextCursor: string | null }> {
  if (after !== undefined && !CONFLICT_ID.test(after)) throw new ScheduleConflictError("invalid_conflict_request");
  const response = await fetcher(`${URL_PATH}?limit=50${after ? `&after=${encodeURIComponent(after)}` : ""}`, { method: "GET", headers: await headersProvider(), cache: "no-store" });
  const body = await responseBody(response);
  if (!response.ok || body.ok !== true) throw responseError(response, body);
  const result = record(body.result);
  if (!result || result.external_send !== false || !Array.isArray(result.conflicts) || result.conflicts.length > 50
    || result.next_cursor !== null && (typeof result.next_cursor !== "string" || !CONFLICT_ID.test(result.next_cursor))) {
    throw new ScheduleConflictError("invalid_conflict_response");
  }
  return { conflicts: result.conflicts.map(normalizeScheduleConflict), nextCursor: result.next_cursor as string | null };
}

export function captureScheduleDecision(conflict: ScheduleConflict, decision: ScheduleConflictDecision, commandId = `desktop-schedule-${globalThis.crypto.randomUUID()}`): ScheduleResolution {
  if (!DECISIONS.has(decision) || !boundedId(commandId) || !CONFLICT_ID.test(conflict.conflictId)
    || !boundedScheduleText(conflict.canonicalId) || !HASH.test(conflict.expectedContentHash) || !HASH.test(conflict.expectedConflictHash)
    || !Number.isSafeInteger(conflict.expectedRevision) || conflict.expectedRevision < 1) throw new ScheduleConflictError("invalid_conflict_request");
  const { conflictId, kind, canonicalId, expectedRevision, expectedContentHash, expectedConflictHash } = conflict;
  return { commandId, conflictId, kind, canonicalId, expectedRevision, expectedContentHash, expectedConflictHash, decision };
}

export async function resolveScheduleConflict(capture: ScheduleResolution, fetcher: ScheduleConflictFetcher = fetch, headersProvider: typeof desktopApiHeaders = desktopApiHeaders): Promise<{ replayed: boolean }> {
  const body = { action: "resolve", ...capture };
  const response = await fetcher(URL_PATH, { method: "POST", headers: await headersProvider({ "content-type": "application/json" }), body: JSON.stringify(body) });
  const value = await responseBody(response);
  if (!response.ok || value.ok !== true) throw responseError(response, value);
  const result = record(value.result);
  if (!result || typeof result.resolution_id !== "string" || !RESOLUTION_ID.test(result.resolution_id) || result.command_id !== capture.commandId
    || result.conflict_id !== capture.conflictId || result.kind !== capture.kind || result.canonical_id !== capture.canonicalId
    || result.decision !== capture.decision || result.before_revision !== capture.expectedRevision
    || result.before_content_hash !== capture.expectedContentHash || !Number.isSafeInteger(result.after_revision)
    || !HASH.test(String(result.after_content_hash)) || typeof result.replayed !== "boolean" || result.external_send !== false) {
    throw new ScheduleConflictError("invalid_conflict_response");
  }
  return { replayed: result.replayed };
}
