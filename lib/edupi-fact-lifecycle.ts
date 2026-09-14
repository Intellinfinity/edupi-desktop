import { createHash, randomUUID } from "node:crypto";
import { runCoreProcess } from "./edupi-core-process-client";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import type { DeletedEducationFact, DeletedEducationFactPage, FactMutationInput, FactMutationReceipt } from "./edupi-fact-lifecycle-model";

type RawRecord = Record<string, unknown>;
const FACT_KINDS = new Set(["error_pattern", "progress", "behavior", "general", "safety", "academic", "material", "evidence"]);
const FACT_STATUSES = new Set(["candidate", "pending_review", "held", "accepted", "rejected", "stale", "superseded", "deleted"]);

export class FactLifecycleError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "FactLifecycleError";
  }
}

function fail(message = "Core 事实响应无效"): never {
  throw new FactLifecycleError("invalid_response", message);
}

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function exact(value: RawRecord, keys: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...keys, ...optional]);
  return keys.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return normalized && normalized.length <= max && !/[\u0000-\u001f\u007f]/u.test(normalized) ? normalized : null;
}

function timestamp(value: unknown): string | null {
  const normalized = text(value, 64);
  if (!normalized || Number.isNaN(Date.parse(normalized))) return null;
  try { return new Date(normalized).toISOString() === normalized ? normalized : null; }
  catch { return null; }
}

function wireSemantic(factId: string, input: FactMutationInput) {
  if (input.action === "review") return { action: input.action, fact_id: factId, expected_revision: input.expectedRevision, decision: input.decision, reviewer: input.reviewer, note: input.note, supersedes_fact_id: input.supersedesFactId, supersedes_expected_revision: input.supersedesFactRevision };
  if (input.action === "modify") return { action: input.action, fact_id: factId, expected_revision: input.expectedRevision, replacement_value: input.replacementValue, reviewer: input.reviewer, note: input.note };
  if (input.action === "delete") return { action: input.action, fact_id: factId, expected_revision: input.expectedRevision, reviewer: input.reviewer };
  return { action: input.action, fact_id: factId, expected_revision: input.expectedRevision, reviewer: input.reviewer, supersedes_fact_id: input.supersedesFactId, supersedes_expected_revision: input.supersedesFactRevision };
}

export function factMutationRequestId(factId: string, input: FactMutationInput): string {
  return `education-fact-${input.action}-${createHash("sha256").update(JSON.stringify(wireSemantic(factId, input))).digest("base64url")}`;
}

function wireRequest(factId: string, input: FactMutationInput) {
  return { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "education-facts", request_id: factMutationRequestId(factId, input), ...wireSemantic(factId, input) };
}

function mappedError(code: string): FactLifecycleError {
  if (code === "fact_not_found") return new FactLifecycleError(code, "事实不存在");
  if (code === "stale_fact") return new FactLifecycleError(code, "事实已更新，请刷新后重试");
  if (code === "fact_conflict" || code === "invalid_review") return new FactLifecycleError(code, "事实与当前记录冲突，请刷新后重新判断");
  if (code === "invalid_fact_request") return new FactLifecycleError(code, "事实操作字段无效");
  if (code === "invalid_fact_state") return new FactLifecycleError(code, "事实数据需要修复");
  return new FactLifecycleError("unavailable", "事实操作暂不可用");
}

function normalizeError(value: RawRecord | null, requestId: string): FactLifecycleError {
  return value?.operation === "education-facts" && value.request_id === requestId && typeof value.code === "string"
    ? mappedError(value.code) : new FactLifecycleError("invalid_response", "Core 事实错误响应无效");
}

function normalizeReceipt(value: unknown, factId: string, input: FactMutationInput, requestId: string): FactMutationReceipt {
  const source = record(value);
  const keys = ["ok", "operation", "request_id", "action", "fact_id", "result_fact_id", "revision", "status", "superseded_fact_id", "replayed", "external_send"];
  const resultFactId = text(source?.result_fact_id, 160);
  const supersededFactId = source?.superseded_fact_id === null ? null : text(source?.superseded_fact_id, 160);
  if (!source || !exact(source, keys, ["snapshot"]) || source.ok !== true || source.operation !== "education-facts" || source.request_id !== requestId
    || source.action !== input.action || source.fact_id !== factId || !resultFactId || !Number.isInteger(source.revision) || Number(source.revision) < 0
    || typeof source.status !== "string" || !FACT_STATUSES.has(source.status) || (source.superseded_fact_id !== null && !supersededFactId)
    || typeof source.replayed !== "boolean" || source.external_send !== false || Object.hasOwn(source, "snapshot") && !record(source.snapshot)) return fail();
  let expectedSuperseded: string | null = null;
  if (input.action === "modify" && resultFactId !== factId) expectedSuperseded = factId;
  else if (input.action === "review" || input.action === "restore") expectedSuperseded = input.supersedesFactId;
  if (supersededFactId !== expectedSuperseded || input.action !== "modify" && resultFactId !== factId
    || input.action === "delete" && source.status !== "deleted") return fail();
  const receiptRevision = Number(source.revision);
  let expectedReviewStatus: "accepted" | "rejected" | "held" | null = null;
  if (input.action === "review") {
    if (input.decision === "accept") expectedReviewStatus = "accepted";
    else if (input.decision === "reject") expectedReviewStatus = "rejected";
    else expectedReviewStatus = "held";
  }
  if (input.action === "review" && (receiptRevision !== input.expectedRevision + 1 || source.status !== expectedReviewStatus)
    || input.action === "delete" && receiptRevision !== input.expectedRevision + 1
    || input.action === "restore" && (receiptRevision !== input.expectedRevision + 1 || source.status === "deleted")
    || input.action === "restore" && input.supersedesFactId !== null && source.status !== "accepted"
    || input.action === "modify" && (source.status !== "accepted" || (resultFactId === factId ? receiptRevision !== input.expectedRevision : receiptRevision !== 0))) return fail();
  return { requestId, action: input.action, factId, resultFactId, revision: receiptRevision, status: source.status as FactMutationReceipt["status"], supersededFactId, replayed: source.replayed, externalSend: false };
}

export async function mutateEducationFact(factId: string, input: FactMutationInput, signal?: AbortSignal): Promise<FactMutationReceipt> {
  const request = wireRequest(factId, input);
  const roots = resolveEduPiBridgeRoots();
  const invoke = () => runCoreProcess<unknown>({ ...roots, request, timeoutMs: 20_000, signal });
  let raw;
  try { raw = await invoke(); }
  catch (error) { if (signal?.aborted) throw error; raw = await invoke(); }
  const response = record(raw);
  if (response?.ok !== true) throw normalizeError(response, request.request_id);
  return normalizeReceipt(response, factId, input, request.request_id);
}

function normalizeDeletedFact(value: unknown): DeletedEducationFact {
  const source = record(value);
  const keys = ["fact_id", "entity_id", "fact_kind", "predicate", "value", "subject_ref", "topic_ref", "source_ids", "source_count", "observation_ids", "observation_count", "restore_conflicts", "restore_conflict_count", "restore_mode", "status", "deleted_previous_status", "revision", "deleted_at", "external_send"];
  const factId = text(source?.fact_id, 160);
  const entityId = text(source?.entity_id, 160);
  const predicate = text(source?.predicate, 160);
  const factValue = text(source?.value, 4000);
  const deletedAt = timestamp(source?.deleted_at);
  const subjectRef = source?.subject_ref === null ? null : text(source?.subject_ref, 160);
  const topicRef = source?.topic_ref === null ? null : text(source?.topic_ref, 160);
  const sourceIds = Array.isArray(source?.source_ids) ? source.source_ids.map((item) => text(item, 160)) : [];
  const observationIds = Array.isArray(source?.observation_ids) ? source.observation_ids.map((item) => text(item, 160)) : [];
  const restoreConflicts = Array.isArray(source?.restore_conflicts) ? source.restore_conflicts.map((value) => {
    const conflict = record(value);
    const conflictId = text(conflict?.fact_id, 160);
    return conflict && exact(conflict, ["fact_id", "revision", "external_send"]) && conflictId && Number.isInteger(conflict.revision) && Number(conflict.revision) >= 0 && conflict.external_send === false
      ? { factId: conflictId, revision: Number(conflict.revision), externalSend: false as const } : null;
  }) : [];
  if (!source || !exact(source, keys) || !factId || !entityId || !predicate || !factValue || !deletedAt || typeof source.fact_kind !== "string" || !FACT_KINDS.has(source.fact_kind)
    || source.status !== "deleted" || typeof source.deleted_previous_status !== "string" || source.deleted_previous_status === "deleted" || !FACT_STATUSES.has(source.deleted_previous_status)
    || (source.subject_ref !== null && !subjectRef) || (source.topic_ref !== null && !topicRef)
    || sourceIds.some((item) => !item) || observationIds.some((item) => !item) || sourceIds.length > 20 || observationIds.length > 20
    || restoreConflicts.some((item) => !item) || restoreConflicts.length > 10 || new Set(restoreConflicts.map((item) => item?.factId)).size !== restoreConflicts.length
    || !Number.isSafeInteger(source.restore_conflict_count) || Number(source.restore_conflict_count) < restoreConflicts.length
    || source.restore_mode !== "direct" && source.restore_mode !== "replace" && source.restore_mode !== "pending_review" && source.restore_mode !== "blocked"
    || !Number.isInteger(source.source_count) || Number(source.source_count) < sourceIds.length || Number(source.source_count) > 500
    || !Number.isInteger(source.observation_count) || Number(source.observation_count) < observationIds.length || Number(source.observation_count) > 500
    || !Number.isInteger(source.revision) || Number(source.revision) < 1 || source.external_send !== false) return fail();
  const restoreMode = source.restore_mode as DeletedEducationFact["restoreMode"];
  const restoreConflictCount = Number(source.restore_conflict_count);
  if (restoreMode === "replace" && (source.deleted_previous_status !== "accepted" || restoreConflictCount !== 1 || restoreConflicts.length !== 1)
    || restoreMode === "pending_review" && (source.deleted_previous_status !== "accepted" || restoreConflictCount < 1)
    || restoreMode === "blocked" && (source.deleted_previous_status !== "accepted" || restoreConflictCount < 2)
    || restoreMode === "direct" && source.deleted_previous_status === "accepted" && restoreConflictCount > 0) return fail();
  return { factId, entityId, kind: source.fact_kind as DeletedEducationFact["kind"], predicate, value: factValue, subjectRef, topicRef, sourceIds: sourceIds as string[], sourceCount: Number(source.source_count), observationIds: observationIds as string[], observationCount: Number(source.observation_count), restoreConflicts: restoreConflicts as DeletedEducationFact["restoreConflicts"], restoreConflictCount, restoreMode, status: "deleted", deletedPreviousStatus: source.deleted_previous_status as DeletedEducationFact["deletedPreviousStatus"], revision: Number(source.revision), deletedAt, externalSend: false };
}

export async function readDeletedEducationFacts(offset: number, limit: number, signal?: AbortSignal): Promise<DeletedEducationFactPage> {
  const requestId = `education-facts-list-${randomUUID()}`;
  const request = { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "education-facts", request_id: requestId, action: "list_deleted", offset, limit };
  const response = record(await runCoreProcess<unknown>({ ...resolveEduPiBridgeRoots(), request, timeoutMs: 15_000, signal }));
  if (response?.ok !== true) throw normalizeError(response, requestId);
  const keys = ["ok", "operation", "request_id", "action", "total", "offset", "limit", "next_offset", "facts", "external_send"];
  if (!exact(response, keys) || response.operation !== "education-facts" || response.request_id !== requestId || response.action !== "list_deleted"
    || !Number.isSafeInteger(response.total) || Number(response.total) < 0 || !Number.isInteger(response.offset) || response.offset !== offset
    || !Number.isInteger(response.limit) || response.limit !== limit || !Array.isArray(response.facts) || response.facts.length > limit
    || response.next_offset !== null && (!Number.isInteger(response.next_offset) || Number(response.next_offset) !== offset + response.facts.length || Number(response.next_offset) <= offset)
    || response.external_send !== false) return fail();
  const facts = response.facts.map(normalizeDeletedFact);
  const total = Number(response.total);
  const nextOffset = response.next_offset === null ? null : Number(response.next_offset);
  if (new Set(facts.map((fact) => fact.factId)).size !== facts.length || offset + facts.length > total || (nextOffset === null) !== (offset + facts.length >= total)) return fail();
  return { total, offset, limit, nextOffset, facts, externalSend: false };
}

type DeletedFactPageReader = (offset: number, limit: number, signal?: AbortSignal) => Promise<DeletedEducationFactPage>;

export async function findDeletedEducationFact(factId: string, revision: number, signal?: AbortSignal, readPage: DeletedFactPageReader = readDeletedEducationFacts): Promise<DeletedEducationFact | null> {
  let offset = 0;
  do {
    const page = await readPage(offset, 100, signal);
    const matches = page.facts.filter((fact) => fact.factId === factId && fact.revision === revision);
    if (matches.length > 1) return fail();
    if (matches.length === 1) return matches[0];
    if (page.nextOffset === null) return null;
    offset = page.nextOffset;
  } while (Number.isSafeInteger(offset));
  return fail();
}
