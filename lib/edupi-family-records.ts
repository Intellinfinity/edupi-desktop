import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Value } from "typebox/value";
import type { TSchema } from "typebox";
import { runCoreProcess } from "./edupi-core-process-client";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import type { FamilyCaptureInput, FamilyPerson, FamilyRecord, FamilyRecordPage } from "./edupi-family-record-model";

export class FamilyRecordError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "FamilyRecordError"; }
}
const identity = { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "education-facts" } as const;
function object(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function fail(): never { throw new FamilyRecordError("invalid_response", "家校记录响应无效"); }
function assertReply(reply: Record<string, unknown> | null, requestId: string, action: string) {
  if (!reply || reply.operation !== "education-facts" || reply.request_id !== requestId) fail();
  if (reply.ok !== true) {
    const code = typeof reply.code === "string" ? reply.code : "invalid_response";
    const messages: Record<string, string> = { unknown_student_binding: "学生来源已失效，记录未写入", family_source_unavailable: "记录来源已更新，请刷新", source_conflict: "来源记录有冲突，原内容已保留", invalid_family_identity: "联系人身份需要核对", invalid_family_reviewer: "记录需要原教师审核" };
    throw new FamilyRecordError(code, messages[code] || "家校记录暂不可用");
  }
  if (reply.action !== action || reply.external_send !== false) fail();
}
async function validate(roots: ReturnType<typeof resolveEduPiBridgeRoots>, name: string, payload: Record<string, unknown>) {
  try {
    const codec = await import(/* webpackIgnore: true */ pathToFileURL(resolve(roots.runtime.root, "scripts/family_record_codec.mjs")).href);
    if (!codec[name] || !Value.Check(codec[name] as TSchema, payload)) fail();
  } catch (error) {
    if (error instanceof FamilyRecordError) throw error;
    throw new FamilyRecordError("unavailable", "当前 Core 尚未提供家校记录");
  }
}
export function familyCaptureRequest(input: FamilyCaptureInput) {
  const semantic = { action: "capture_family_record", student_id: input.studentId, parent_entity_id: input.parentEntityId,
    parent: input.parent === null ? null : { external_id: input.parent.external_id, label: input.parent.label },
    record: { recorded_relationship: input.record.recorded_relationship, teacher_explicit_quality: input.record.teacher_explicit_quality, observed_on: input.record.observed_on, note: input.record.note },
    source: { source_id: input.source.source_id, source_revision: input.source.source_revision, raw_text: input.source.raw_text, observed_at: input.source.observed_at, actor_ref: input.source.actor_ref }, confidence: { basis: "explicit", score: 1 } };
  return { ...identity, request_id: `education-fact-capture_family_record-${createHash("sha256").update(JSON.stringify(semantic)).digest("base64url")}`, ...semantic };
}
export async function readFamilyRecords(studentId: string, offset = 0, limit = 20, signal?: AbortSignal): Promise<FamilyRecordPage> {
  const roots = resolveEduPiBridgeRoots(), requestId = `family-list-${randomUUID()}`;
  const reply = object(await runCoreProcess({ ...roots, request: { ...identity, request_id: requestId, action: "list_family_records", student_id: studentId, offset, limit }, timeoutMs: 15000, signal }));
  assertReply(reply, requestId, "list_family_records");
  const payload = Object.fromEntries(["student_binding", "student_entity", "parents", "records", "total", "offset", "limit", "next_offset", "source_status", "external_send"].map((key) => [key, reply![key]]));
  await validate(roots, "FAMILY_RECORD_LIST_SCHEMA", payload);
  const records = payload.records as FamilyRecord[], studentEntity = payload.student_entity as FamilyPerson | null, parents = payload.parents as FamilyPerson[];
  if (object(payload.student_binding)?.external_id !== studentId || payload.offset !== offset || payload.limit !== limit
    || records.length > limit || new Set(records.map((row) => row.fact_id)).size !== records.length
    || studentEntity !== null && studentEntity.entity_kind !== "student" || parents.some((parent) => parent.entity_kind !== "parent")
    || records.some((row) => row.student_entity_id !== studentEntity?.entity_id || !parents.some((parent) => parent.entity_id === row.parent_entity_id))) fail();
  const total = Number(payload.total), nextOffset = payload.next_offset as number | null;
  if (offset + records.length > total || (nextOffset === null) !== (offset + records.length >= total)
    || nextOffset !== null && (nextOffset !== offset + records.length || nextOffset <= offset)) fail();
  return { studentId, studentEntity, parents, records, total, offset, limit, nextOffset, sourceStatus: payload.source_status as FamilyRecordPage["sourceStatus"], externalSend: false };
}
export async function captureFamilyRecord(input: FamilyCaptureInput, signal?: AbortSignal): Promise<FamilyRecord> {
  const roots = resolveEduPiBridgeRoots(), request = familyCaptureRequest(input);
  // An uncertain transport result is not an excuse to resubmit a new identity.
  const reply = object(await runCoreProcess({ ...roots, request, timeoutMs: 20000, signal }));
  assertReply(reply, request.request_id, "capture_family_record");
  const payload = Object.fromEntries(["family_record", "student_binding", "student_entity", "parent_entity", "replayed", "external_send"].map((key) => [key, reply![key]]));
  await validate(roots, "FAMILY_RECORD_CAPTURE_SCHEMA", payload);
  const row = payload.family_record as FamilyRecord;
  if (object(payload.student_binding)?.external_id !== input.studentId || row.student_entity_id !== object(payload.student_entity)?.entity_id
    || row.parent_entity_id !== object(payload.parent_entity)?.entity_id || payload.replayed !== true && row.status !== "pending_review"
    || input.parentEntityId !== null && row.parent_entity_id !== input.parentEntityId
    || Object.entries(input.record).some(([key, value]) => row.record[key as keyof typeof row.record] !== value)
    || Object.entries(input.source).some(([key, value]) => row.source[key as keyof typeof row.source] !== value)) fail();
  let offset = 0;
  do {
    const page = await readFamilyRecords(input.studentId, offset, 100, signal);
    const persisted = page.records.find((record) => record.fact_id === row.fact_id);
    if (persisted) {
      if (JSON.stringify(persisted) !== JSON.stringify(row)) fail();
      return persisted;
    }
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  } while (offset <= 2000);
  return fail();
}
