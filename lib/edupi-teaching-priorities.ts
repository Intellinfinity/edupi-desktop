import { createHash, randomUUID } from "node:crypto";
import { runCoreProcess } from "./edupi-core-process-client";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import type { EducationTeachingPriority } from "./edupi-education-contract";

export const TEACHING_PRIORITY_FIELDS = ["subject", "class_name", "topic", "note", "status"] as const;
export const TEACHING_PRIORITY_STATUSES = ["active", "paused", "completed"] as const;
export type TeachingPriorityField = typeof TEACHING_PRIORITY_FIELDS[number];
export type TeachingPriorityStatus = typeof TEACHING_PRIORITY_STATUSES[number];
export type TeachingPriorityVersionSide = "before" | "after";

export type TeachingPriorityValues = {
  subject: string;
  className: string | null;
  topic: string;
  note: string | null;
  status: TeachingPriorityStatus;
};

export type TeachingPriorityVersion = {
  versionId: string;
  priorityId: string;
  revision: number;
  beforeValues: TeachingPriorityValues;
  afterValues: TeachingPriorityValues;
  changedFields: TeachingPriorityField[];
  changedAt: string;
  sourceKind: "teacher_edit" | "agent_update" | "restore";
  requestId: string;
};

export type TeachingPriorityVersionHistory = {
  priorityId: string;
  revision: number;
  historyCount: number;
  versions: TeachingPriorityVersion[];
  externalSend: false;
};

export type TeachingPriorityMutationReceipt = {
  requestId: string;
  action: "create" | "update" | "restore";
  priorityId: string;
  versionId: string | null;
  revision: number;
  historyCount: number;
  updatedAt: string;
  total: number;
  replayed: boolean;
  externalSend: false;
};

type RawRecord = Record<string, unknown>;

export class TeachingPriorityError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "TeachingPriorityError";
  }
}

function fail(message = "Core 教学重点响应无效"): never {
  throw new TeachingPriorityError("invalid_response", message);
}

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function exactKeys(value: RawRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max && !/[\u0000-\u001f\u007f]/u.test(normalized) ? normalized : null;
}

function timestamp(value: unknown): string | null {
  const normalized = text(value, 64);
  if (!normalized || Number.isNaN(Date.parse(normalized))) return null;
  try { return new Date(normalized).toISOString() === normalized ? normalized : null; }
  catch { return null; }
}

function wireValues(value: TeachingPriorityValues) {
  return { subject: value.subject, class_name: value.className, topic: value.topic, note: value.note, status: value.status };
}

export function sameTeachingPriorityValues(left: TeachingPriorityValues, right: TeachingPriorityValues): boolean {
  return JSON.stringify(wireValues(left)) === JSON.stringify(wireValues(right));
}

function values(value: unknown): TeachingPriorityValues | null {
  const source = record(value);
  if (!source || !exactKeys(source, TEACHING_PRIORITY_FIELDS)) return null;
  const subject = text(source.subject, 120);
  const className = source.class_name === null ? null : text(source.class_name, 120);
  const topic = text(source.topic, 240);
  const note = source.note === null ? null : text(source.note, 2000);
  const status = source.status as TeachingPriorityStatus;
  if (!subject || !topic || (source.class_name !== null && !className) || (source.note !== null && !note) || !TEACHING_PRIORITY_STATUSES.includes(status)) return null;
  return { subject, className, topic, note, status };
}

export function teachingPriorityValues(value: EducationTeachingPriority): TeachingPriorityValues {
  return { subject: value.subject, className: value.className, topic: value.topic, note: value.note, status: value.status };
}

function changedFields(before: TeachingPriorityValues, after: TeachingPriorityValues): TeachingPriorityField[] {
  const beforeWire = wireValues(before);
  const afterWire = wireValues(after);
  return TEACHING_PRIORITY_FIELDS.filter((field) => JSON.stringify(beforeWire[field]) !== JSON.stringify(afterWire[field]));
}

function normalizeVersion(value: unknown, priorityId: string, index: number): TeachingPriorityVersion {
  const source = record(value);
  const keys = ["version_id", "priority_id", "revision", "before", "after", "changed_fields", "changed_at", "source_kind", "request_id"];
  const beforeValues = values(source?.before);
  const afterValues = values(source?.after);
  const versionId = text(source?.version_id, 160);
  const boundPriorityId = text(source?.priority_id, 160);
  const changedAt = timestamp(source?.changed_at);
  const requestId = text(source?.request_id, 160);
  const sourceKind = source?.source_kind;
  const expectedChanges = beforeValues && afterValues ? changedFields(beforeValues, afterValues) : [];
  if (!source || !exactKeys(source, keys) || !beforeValues || !afterValues || !versionId || boundPriorityId !== priorityId
    || !Number.isInteger(source.revision) || Number(source.revision) < 1 || !changedAt || !requestId
    || (sourceKind !== "teacher_edit" && sourceKind !== "agent_update" && sourceKind !== "restore")
    || !Array.isArray(source.changed_fields) || JSON.stringify(source.changed_fields) !== JSON.stringify(expectedChanges)) return fail(`Core 教学重点版本 ${index + 1} 无效`);
  const identity = JSON.stringify({ priority_id: priorityId, revision: Number(source.revision), before: wireValues(beforeValues), after: wireValues(afterValues), changed_at: changedAt, source_kind: sourceKind, request_id: requestId });
  const expectedId = `teaching-priority-version-${createHash("sha256").update(identity).digest("base64url")}`;
  if (versionId !== expectedId) return fail(`Core 教学重点版本 ${index + 1} 的身份无效`);
  return { versionId, priorityId, revision: Number(source.revision), beforeValues, afterValues, changedFields: expectedChanges, changedAt, sourceKind, requestId };
}

export function normalizeTeachingPriorityHistory(value: unknown, expectedPriorityId?: string): TeachingPriorityVersionHistory {
  const source = record(value);
  const keys = ["priority_id", "revision", "history_count", "versions", "external_send"];
  const priorityId = text(source?.priority_id, 160);
  if (!source || !exactKeys(source, keys) || !priorityId || (expectedPriorityId && priorityId !== expectedPriorityId)
    || !Number.isInteger(source.revision) || Number(source.revision) < 0
    || !Number.isInteger(source.history_count) || Number(source.history_count) < 0 || Number(source.history_count) > 50
    || !Array.isArray(source.versions) || source.versions.length > 50 || source.external_send !== false) return fail();
  const versions = source.versions.map((version, index) => normalizeVersion(version, priorityId, index));
  const revision = Number(source.revision);
  if (Number(source.history_count) !== versions.length || new Set(versions.map((version) => version.versionId)).size !== versions.length) return fail();
  for (let index = 0; index < versions.length; index += 1) {
    if (versions[index].revision !== revision - versions.length + index + 1) return fail("Core 教学重点版本顺序无效");
    if (index > 0 && !sameTeachingPriorityValues(versions[index - 1].afterValues, versions[index].beforeValues)) return fail("Core 教学重点版本链无效");
  }
  if (revision === 0 && versions.length > 0) return fail();
  return { priorityId, revision, historyCount: versions.length, versions, externalSend: false };
}

function requestId(prefix: string, value: unknown): string {
  return `${prefix}-${createHash("sha256").update(JSON.stringify(value)).digest("base64url")}`;
}

export function teachingPriorityCreateRequestId(input: Omit<TeachingPriorityValues, "status">): string {
  return requestId("teaching-priority-create", { subject: input.subject, class_name: input.className, topic: input.topic, note: input.note });
}

export function teachingPriorityUpdateRequestId(input: { priorityId: string; expectedRevision: number; patch: Partial<TeachingPriorityValues> }): string {
  const patch = Object.fromEntries((["subject", "className", "topic", "note", "status"] as const).filter((field) => Object.hasOwn(input.patch, field)).map((field) => [field === "className" ? "class_name" : field, input.patch[field]]));
  return requestId("teaching-priority-update", { priority_id: input.priorityId, expected_revision: input.expectedRevision, patch });
}

export function teachingPriorityRestoreRequestId(input: { priorityId: string; versionId: string; versionSide: TeachingPriorityVersionSide; expectedRevision: number }): string {
  return requestId("teaching-priority-restore", { priority_id: input.priorityId, version_id: input.versionId, version_side: input.versionSide, expected_revision: input.expectedRevision });
}

function coreError(code: string): TeachingPriorityError {
  if (code === "priority_not_found") return new TeachingPriorityError(code, "教学重点不存在");
  if (code === "priority_deleted") return new TeachingPriorityError(code, "教学重点已删除");
  if (code === "priority_conflict") return new TeachingPriorityError(code, "同一班级已有相同教学重点");
  if (code === "stale_priority") return new TeachingPriorityError(code, "教学重点已更新，请刷新后重试");
  if (code === "version_not_found") return new TeachingPriorityError(code, "这个教学重点版本已不存在");
  if (code === "version_already_current") return new TeachingPriorityError(code, "当前教学重点已经是这个版本");
  if (code === "idempotency_conflict") return new TeachingPriorityError(code, "请求与先前操作冲突，请刷新后重试");
  if (code === "priority_capacity" || code === "priority_storage_capacity" || code === "priority_history_capacity") return new TeachingPriorityError(code, "教学重点存储已达上限");
  if (code === "invalid_state") return new TeachingPriorityError(code, "教学重点数据需要修复");
  return new TeachingPriorityError("unavailable", "教学重点暂不可用");
}

function parseCoreError(source: RawRecord | null, operation: string, expectedRequestId: string): TeachingPriorityError {
  if (!source || source.operation !== operation || source.request_id !== expectedRequestId || typeof source.code !== "string") return new TeachingPriorityError("invalid_response", "Core 教学重点响应无效");
  return coreError(source.code);
}

export function normalizeTeachingPriorityReceipt(value: unknown, expected: { requestId: string; action: "create" | "update" | "restore"; priorityId?: string; expectedRevision?: number }): TeachingPriorityMutationReceipt {
  const source = record(value);
  const keys = ["ok", "operation", "request_id", "action", "priority_id", "version_id", "revision", "history_count", "updated_at", "total", "replayed", "external_send"];
  const priorityId = text(source?.priority_id, 160);
  const versionId = source?.version_id === null ? null : text(source?.version_id, 160);
  const updatedAt = timestamp(source?.updated_at);
  if (!source || !exactKeys(source, keys) || source.ok !== true || source.operation !== "teaching-priorities" || source.request_id !== expected.requestId
    || source.action !== expected.action || !priorityId || (expected.priorityId && priorityId !== expected.priorityId)
    || (source.version_id !== null && !versionId) || !Number.isInteger(source.revision) || Number(source.revision) < 0
    || !Number.isInteger(source.history_count) || Number(source.history_count) < 0 || Number(source.history_count) > 50
    || !updatedAt || !Number.isInteger(source.total) || Number(source.total) < 1 || Number(source.total) > 200
    || typeof source.replayed !== "boolean" || source.external_send !== false) return fail();
  const revision = Number(source.revision);
  if (expected.action === "create" && (revision !== 0 || versionId !== null)) return fail();
  if (expected.action === "restore" && (expected.expectedRevision === undefined || revision !== expected.expectedRevision + 1 || !versionId)) return fail();
  if (expected.action === "update" && (expected.expectedRevision === undefined || revision !== expected.expectedRevision + (versionId ? 1 : 0))) return fail();
  return { requestId: expected.requestId, action: expected.action, priorityId, versionId, revision, historyCount: Number(source.history_count), updatedAt, total: Number(source.total), replayed: source.replayed, externalSend: false };
}

async function callMutation(request: RawRecord, signal?: AbortSignal): Promise<TeachingPriorityMutationReceipt> {
  const roots = resolveEduPiBridgeRoots();
  const invoke = () => runCoreProcess<unknown>({ ...roots, timeoutMs: 15_000, signal, request });
  let raw: unknown;
  try { raw = await invoke(); }
  catch (error) {
    if (signal?.aborted) throw error;
    raw = await invoke();
  }
  const response = record(raw);
  if (response?.ok !== true) throw parseCoreError(response, "teaching-priorities", String(request.request_id));
  return normalizeTeachingPriorityReceipt(response, {
    requestId: String(request.request_id),
    action: request.action as "create" | "update" | "restore",
    priorityId: typeof request.priority_id === "string" ? request.priority_id : undefined,
    expectedRevision: typeof request.expected_revision === "number" ? request.expected_revision : undefined,
  });
}

export async function createTeachingPriority(input: Omit<TeachingPriorityValues, "status"> & { signal?: AbortSignal }): Promise<TeachingPriorityMutationReceipt> {
  const request = {
    protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "teaching-priorities",
    request_id: teachingPriorityCreateRequestId(input), action: "create",
    priority: { subject: input.subject, class_name: input.className, topic: input.topic, note: input.note },
  };
  return callMutation(request, input.signal);
}

export async function updateTeachingPriority(input: { priorityId: string; expectedRevision: number; patch: Partial<TeachingPriorityValues>; signal?: AbortSignal }): Promise<TeachingPriorityMutationReceipt> {
  const request = {
    protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "teaching-priorities",
    request_id: teachingPriorityUpdateRequestId(input), action: "update", priority_id: input.priorityId, expected_revision: input.expectedRevision,
    patch: Object.fromEntries((["subject", "className", "topic", "note", "status"] as const).filter((field) => Object.hasOwn(input.patch, field)).map((field) => [field === "className" ? "class_name" : field, input.patch[field]])),
  };
  return callMutation(request, input.signal);
}

export async function restoreTeachingPriorityVersion(input: { priorityId: string; versionId: string; versionSide: TeachingPriorityVersionSide; expectedRevision: number; signal?: AbortSignal }): Promise<TeachingPriorityMutationReceipt> {
  const request = {
    protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "teaching-priorities",
    request_id: teachingPriorityRestoreRequestId(input), action: "restore", priority_id: input.priorityId, version_id: input.versionId, version_side: input.versionSide, expected_revision: input.expectedRevision,
  };
  return callMutation(request, input.signal);
}

export async function readTeachingPriorityHistory(priorityId: string, signal?: AbortSignal): Promise<TeachingPriorityVersionHistory> {
  if (!text(priorityId, 160)) throw new TeachingPriorityError("invalid_request", "教学重点身份无效");
  const requestId = `teaching-priority-history-${randomUUID()}`;
  const roots = resolveEduPiBridgeRoots();
  const response = record(await runCoreProcess<unknown>({
    ...roots,
    timeoutMs: 10_000,
    signal,
    request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "workspace-resources", request_id: requestId, include_teaching_priority_versions: true, priority_id: priorityId },
  }));
  if (response?.ok !== true) throw parseCoreError(response, "workspace-resources", requestId);
  if (response.operation !== "workspace-resources" || response.request_id !== requestId) return fail();
  return normalizeTeachingPriorityHistory(response.teachingPriorityVersions, priorityId);
}
