import crypto from "node:crypto";
import { runCoreProcess } from "./edupi-core-process-client";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";

export const TEACHER_CONTEXT_VERSION_FIELDS = ["name", "role", "subject", "grade", "class_name"] as const;
export type TeacherContextVersionField = typeof TEACHER_CONTEXT_VERSION_FIELDS[number];
export type TeacherContextVersionValues = Partial<Record<TeacherContextVersionField, string>>;
export type TeacherContextVersionSide = "before" | "after";

export type TeacherContextVersion = {
  versionId: string;
  contextId: string;
  revision: number;
  beforeValues: TeacherContextVersionValues;
  afterValues: TeacherContextVersionValues;
  changedFields: TeacherContextVersionField[];
  reviewedAt: string;
  reviewerId: string | null;
  note: string | null;
  receiptId: string | null;
  externalSend: false;
};

export type TeacherContextRestoreCapture = {
  requestId: string;
  versionId: string;
  versionSide: TeacherContextVersionSide;
  fieldKey: TeacherContextVersionField;
  contextId: string;
  revision: number;
  proposedValues: TeacherContextVersionValues;
  replayed: boolean;
  alreadyApplied: boolean;
};

export type TeacherContextVersionErrorCode =
  | "invalid_response"
  | "version_not_found"
  | "version_already_current"
  | "stale_revision"
  | "stale_context_source"
  | "idempotency_conflict"
  | "unavailable";

export class TeacherContextVersionError extends Error {
  constructor(public readonly code: TeacherContextVersionErrorCode, message: string) {
    super(message);
    this.name = "TeacherContextVersionError";
  }
}

type Raw = Record<string, unknown>;

function record(value: unknown): Raw | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Raw : null;
}

function text(value: unknown, maxLength = 160): string | null {
  return typeof value === "string" && value.trim() && value.length <= maxLength ? value.trim() : null;
}

function nullableText(value: unknown, maxLength: number): string | null | undefined {
  if (value === null) return null;
  return text(value, maxLength) ?? undefined;
}

function exactKeys(value: Raw, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function values(value: unknown): TeacherContextVersionValues | null {
  const source = record(value);
  if (!source || Object.keys(source).some((key) => !TEACHER_CONTEXT_VERSION_FIELDS.includes(key as TeacherContextVersionField))) return null;
  const result: TeacherContextVersionValues = {};
  for (const key of TEACHER_CONTEXT_VERSION_FIELDS) {
    if (!Object.hasOwn(source, key)) continue;
    const item = text(source[key], 120);
    if (!item) return null;
    result[key] = item;
  }
  return result;
}

function changedFields(before: TeacherContextVersionValues, after: TeacherContextVersionValues): TeacherContextVersionField[] {
  return TEACHER_CONTEXT_VERSION_FIELDS.filter((key) => before[key] !== after[key]);
}

export function confirmsTeacherContextFieldRestore(versions: TeacherContextVersion[], input: {
  contextId: string;
  revision: number;
  fieldKey: TeacherContextVersionField;
  desiredValue: string | null;
}): boolean {
  const matches = versions.filter((version) => version.contextId === input.contextId && version.revision === input.revision);
  if (matches.length !== 1 || matches[0].changedFields.length !== 1 || matches[0].changedFields[0] !== input.fieldKey) return false;
  const after = matches[0].afterValues;
  return (Object.hasOwn(after, input.fieldKey) ? after[input.fieldKey] ?? null : null) === input.desiredValue;
}

export function normalizeTeacherContextVersions(value: unknown): TeacherContextVersion[] {
  if (!Array.isArray(value) || value.length > 100) throw new TeacherContextVersionError("invalid_response", "Core 教师资料版本无效");
  const versions = value.map((entry, index) => {
    const source = record(entry);
    const keys = ["version_id", "context_id", "revision", "before_values", "after_values", "changed_fields", "reviewed_at", "reviewer_id", "note", "receipt_id", "external_send"];
    if (!source || !exactKeys(source, keys)) throw new TeacherContextVersionError("invalid_response", `Core 教师资料版本 ${index + 1} 无效`);
    const versionId = text(source.version_id);
    const contextId = text(source.context_id);
    const beforeValues = values(source.before_values);
    const afterValues = values(source.after_values);
    const reviewerId = nullableText(source.reviewer_id, 160);
    const note = nullableText(source.note, 1000);
    const receiptId = nullableText(source.receipt_id, 160);
    const reviewedAt = text(source.reviewed_at, 64);
    if (!versionId || !contextId || !beforeValues || !afterValues || !Number.isInteger(source.revision) || Number(source.revision) < 0
      || !reviewedAt || Number.isNaN(Date.parse(reviewedAt)) || reviewerId === undefined || note === undefined || receiptId === undefined || source.external_send !== false) {
      throw new TeacherContextVersionError("invalid_response", `Core 教师资料版本 ${index + 1} 无效`);
    }
    const expectedChanged = changedFields(beforeValues, afterValues);
    if (!Array.isArray(source.changed_fields) || source.changed_fields.length !== expectedChanged.length
      || !source.changed_fields.every((field, fieldIndex) => field === expectedChanged[fieldIndex])) {
      throw new TeacherContextVersionError("invalid_response", `Core 教师资料版本 ${index + 1} 的字段变化无效`);
    }
    return {
      versionId,
      contextId,
      revision: Number(source.revision),
      beforeValues,
      afterValues,
      changedFields: expectedChanged,
      reviewedAt,
      reviewerId,
      note,
      receiptId,
      externalSend: false,
    } satisfies TeacherContextVersion;
  });
  if (new Set(versions.map((version) => version.versionId)).size !== versions.length) throw new TeacherContextVersionError("invalid_response", "Core 教师资料版本 ID 重复");
  for (let index = 1; index < versions.length; index += 1) {
    if (versions[index].revision <= versions[index - 1].revision) throw new TeacherContextVersionError("invalid_response", "Core 教师资料版本顺序无效");
  }
  return versions;
}

export async function readTeacherContextVersions(): Promise<TeacherContextVersion[]> {
  const roots = resolveEduPiBridgeRoots();
  const requestId = crypto.randomUUID();
  const response = await runCoreProcess<unknown>({
    ...roots,
    timeoutMs: 10_000,
    request: {
      protocol: "edupi-desktop-bridge",
      protocol_version: 1,
      producer: "edupi-desktop",
      operation: "workspace-resources",
      request_id: requestId,
      include_teacher_context_versions: true,
    },
  });
  const result = record(response);
  if (!result || result.ok !== true || result.operation !== "workspace-resources" || result.request_id !== requestId) throw new TeacherContextVersionError("unavailable", "教师资料版本暂不可用");
  return normalizeTeacherContextVersions(result.teacherContextVersions);
}

export function teacherContextRestoreRequestId(input: {
  versionId: string;
  versionSide: TeacherContextVersionSide;
  fieldKey: TeacherContextVersionField;
  expectedRevision: number;
  expectedSourceId: string;
}): string {
  const serialized = JSON.stringify({
    version_id: input.versionId,
    version_side: input.versionSide,
    field_key: input.fieldKey,
    expected_revision: input.expectedRevision,
    expected_source_id: input.expectedSourceId,
  });
  return `context-version-${crypto.createHash("sha256").update(serialized).digest("base64url")}`;
}

function responseError(code: unknown): TeacherContextVersionError {
  if (code === "version_not_found") return new TeacherContextVersionError(code, "这个教师资料版本已不存在");
  if (code === "version_already_current") return new TeacherContextVersionError(code, "这个字段已经是该历史值");
  if (code === "stale_revision") return new TeacherContextVersionError(code, "教师资料已更新，请刷新后重试");
  if (code === "stale_context_source") return new TeacherContextVersionError(code, "教师资料来源已更新，请刷新后重试");
  if (code === "idempotency_conflict") return new TeacherContextVersionError(code, "恢复请求与先前操作冲突，请刷新后重试");
  return new TeacherContextVersionError("unavailable", "教师资料恢复暂不可用");
}

export async function captureTeacherContextFieldRestore(input: {
  versionId: string;
  versionSide: TeacherContextVersionSide;
  fieldKey: TeacherContextVersionField;
  expectedRevision: number;
  expectedSourceId: string;
}): Promise<TeacherContextRestoreCapture> {
  const requestId = teacherContextRestoreRequestId(input);
  const roots = resolveEduPiBridgeRoots();
  const response = await runCoreProcess<unknown>({
    ...roots,
    timeoutMs: 10_000,
    request: {
      protocol: "edupi-desktop-bridge",
      protocol_version: 1,
      producer: "edupi-desktop",
      operation: "teacher-context-input",
      request_id: requestId,
      action: "restore-version",
      version_id: input.versionId,
      version_side: input.versionSide,
      field_keys: [input.fieldKey],
      expected_revision: input.expectedRevision,
      expected_source_id: input.expectedSourceId,
    },
  });
  const result = record(response);
  if (!result) throw new TeacherContextVersionError("invalid_response", "Core 教师资料恢复响应无效");
  if (result.ok !== true) {
    if (result.operation !== "teacher-context-input" || result.request_id !== requestId || typeof result.code !== "string") {
      throw new TeacherContextVersionError("invalid_response", "Core 教师资料恢复响应无效");
    }
    throw responseError(result.code);
  }
  const keys = ["ok", "operation", "request_id", "version_id", "version_side", "field_keys", "context_id", "revision", "proposed_values", "replayed", "already_applied"];
  const proposedValues = values(result.proposed_values);
  const contextId = text(result.context_id);
  if (!exactKeys(result, keys) || result.operation !== "teacher-context-input" || result.request_id !== requestId || result.version_id !== input.versionId
    || result.version_side !== input.versionSide || !Array.isArray(result.field_keys) || result.field_keys.length !== 1 || result.field_keys[0] !== input.fieldKey
    || !contextId || !Number.isInteger(result.revision) || Number(result.revision) !== input.expectedRevision + (result.already_applied === true ? 1 : 0) || !proposedValues
    || typeof result.replayed !== "boolean" || typeof result.already_applied !== "boolean" || (result.already_applied && !result.replayed)) {
    throw new TeacherContextVersionError("invalid_response", "Core 教师资料恢复响应无效");
  }
  return {
    requestId,
    versionId: input.versionId,
    versionSide: input.versionSide,
    fieldKey: input.fieldKey,
    contextId,
    revision: Number(result.revision),
    proposedValues,
    replayed: result.replayed,
    alreadyApplied: result.already_applied,
  };
}
