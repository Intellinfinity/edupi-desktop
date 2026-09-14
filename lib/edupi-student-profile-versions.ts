import { createHash, randomUUID } from "node:crypto";
import { runCoreProcess } from "./edupi-core-process-client";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";

export const STUDENT_PROFILE_VERSION_FIELDS = ["class_name", "traits", "parent_notes"] as const;
export type StudentProfileVersionField = typeof STUDENT_PROFILE_VERSION_FIELDS[number];
export type StudentProfileVersionSide = "before" | "after";
export type StudentProfileVersionSource = "roster_import" | "teacher_edit" | "agent_update" | "restore";

export type StudentProfileVersionValues = {
  className: string | null;
  traits: string[];
  parentNotes: string[];
};

export type StudentProfileVersion = {
  versionId: string;
  studentId: string;
  revision: number;
  beforeValues: StudentProfileVersionValues;
  afterValues: StudentProfileVersionValues;
  changedFields: StudentProfileVersionField[];
  changedAt: string;
  sourceKind: StudentProfileVersionSource;
  requestId: string | null;
};

export type StudentProfileVersionHistory = {
  studentId: string;
  studentName: string;
  profileRevision: number;
  profileHistoryCount: number;
  versions: StudentProfileVersion[];
  externalSend: false;
};

export type StudentProfileMutationReceipt = {
  requestId: string;
  action: "update" | "restore";
  studentId: string;
  studentName: string;
  versionId: string | null;
  profileRevision: number;
  profileHistoryCount: number;
  updatedAt: string;
  total: number;
  replayed: boolean;
  externalSend: false;
};

type RawRecord = Record<string, unknown>;

const VERSION_SOURCES = new Set<StudentProfileVersionSource>(["roster_import", "teacher_edit", "agent_update", "restore"]);
const MAX_HISTORY = 50;
const MAX_LIST = 500;

export class StudentProfileVersionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "StudentProfileVersionError";
  }
}

function fail(message = "Core 学生档案版本无效"): never {
  throw new StudentProfileVersionError("invalid_response", message);
}

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function exactKeys(value: RawRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_LIST) return null;
  const result = value.map((item) => text(item, 4096));
  return result.some((item) => item === null) ? null : result as string[];
}

function values(value: unknown): StudentProfileVersionValues | null {
  const source = record(value);
  if (!source || !exactKeys(source, STUDENT_PROFILE_VERSION_FIELDS)) return null;
  const className = source.class_name === null ? null : text(source.class_name, 120);
  const traits = stringList(source.traits);
  const parentNotes = stringList(source.parent_notes);
  if ((source.class_name !== null && className === null) || traits === null || parentNotes === null) return null;
  return { className, traits, parentNotes };
}

function wireValues(value: StudentProfileVersionValues) {
  return { class_name: value.className, traits: value.traits, parent_notes: value.parentNotes };
}

export function studentProfileValuesFromProjection(value: unknown): StudentProfileVersionValues | null {
  const source = record(value);
  if (!source) return null;
  return values({
    class_name: source.class_name ?? null,
    traits: source.traits,
    parent_notes: source.parent_notes,
  });
}

export function sameStudentProfileValues(left: StudentProfileVersionValues, right: StudentProfileVersionValues): boolean {
  return JSON.stringify(wireValues(left)) === JSON.stringify(wireValues(right));
}

function changedFields(before: StudentProfileVersionValues, after: StudentProfileVersionValues): StudentProfileVersionField[] {
  const beforeWire = wireValues(before);
  const afterWire = wireValues(after);
  return STUDENT_PROFILE_VERSION_FIELDS.filter((field) => JSON.stringify(beforeWire[field]) !== JSON.stringify(afterWire[field]));
}

function normalizeVersion(value: unknown, expectedStudentId: string, index: number): StudentProfileVersion {
  const source = record(value);
  const keys = ["version_id", "student_id", "revision", "before", "after", "changed_fields", "changed_at", "source_kind", "request_id"];
  const beforeValues = values(source?.before);
  const afterValues = values(source?.after);
  const versionId = text(source?.version_id, 160);
  const studentId = text(source?.student_id, 240);
  const changedAt = text(source?.changed_at, 64);
  const sourceKind = source?.source_kind as StudentProfileVersionSource;
  const requestId = source?.request_id === null ? null : text(source?.request_id, 160);
  const expectedChanges = beforeValues && afterValues ? changedFields(beforeValues, afterValues) : [];
  if (!source || !exactKeys(source, keys) || !beforeValues || !afterValues || !versionId || studentId !== expectedStudentId
    || !Number.isInteger(source.revision) || Number(source.revision) < 1 || !changedAt || Number.isNaN(Date.parse(changedAt))
    || !VERSION_SOURCES.has(sourceKind) || (source.request_id !== null && requestId === null)
    || !Array.isArray(source.changed_fields) || JSON.stringify(source.changed_fields) !== JSON.stringify(expectedChanges)) {
    return fail(`Core 学生档案版本 ${index + 1} 无效`);
  }
  const identity = JSON.stringify({
    student_id: studentId,
    revision: Number(source.revision),
    before: wireValues(beforeValues),
    after: wireValues(afterValues),
    changed_at: changedAt,
    source_kind: sourceKind,
    request_id: requestId,
  });
  const expectedVersionId = `student-profile-${createHash("sha256").update(identity).digest("base64url")}`;
  if (versionId !== expectedVersionId) return fail(`Core 学生档案版本 ${index + 1} 的身份无效`);
  return {
    versionId,
    studentId,
    revision: Number(source.revision),
    beforeValues,
    afterValues,
    changedFields: expectedChanges,
    changedAt,
    sourceKind,
    requestId,
  };
}

export function normalizeStudentProfileVersionHistory(value: unknown, expectedStudentId?: string): StudentProfileVersionHistory {
  const source = record(value);
  const keys = ["student_id", "student_name", "profile_revision", "profile_history_count", "versions", "external_send"];
  const studentId = text(source?.student_id, 240);
  const studentName = text(source?.student_name, 120);
  if (!source || !exactKeys(source, keys) || !studentId || !studentName || (expectedStudentId && studentId !== expectedStudentId)
    || !Number.isInteger(source.profile_revision) || Number(source.profile_revision) < 0
    || !Number.isInteger(source.profile_history_count) || Number(source.profile_history_count) < 0 || Number(source.profile_history_count) > MAX_HISTORY
    || !Array.isArray(source.versions) || source.versions.length > MAX_HISTORY || source.external_send !== false) return fail();
  const versions = source.versions.map((version, index) => normalizeVersion(version, studentId, index));
  const profileRevision = Number(source.profile_revision);
  if (Number(source.profile_history_count) !== versions.length || new Set(versions.map((version) => version.versionId)).size !== versions.length) return fail();
  for (let index = 0; index < versions.length; index += 1) {
    const version = versions[index];
    if (version.revision !== profileRevision - versions.length + index + 1) return fail("Core 学生档案版本顺序无效");
    if (index > 0 && !sameStudentProfileValues(versions[index - 1].afterValues, version.beforeValues)) return fail("Core 学生档案版本链无效");
  }
  if (profileRevision === 0 && versions.length > 0) return fail();
  return { studentId, studentName, profileRevision, profileHistoryCount: versions.length, versions, externalSend: false };
}

function responseError(code: string): StudentProfileVersionError {
  if (code === "student_not_found") return new StudentProfileVersionError(code, "学生档案不存在");
  if (code === "student_deleted") return new StudentProfileVersionError(code, "学生档案已删除");
  if (code === "version_not_found") return new StudentProfileVersionError(code, "这个档案版本已不存在");
  if (code === "version_already_current") return new StudentProfileVersionError(code, "当前档案已经是这个版本");
  if (code === "stale_student") return new StudentProfileVersionError(code, "学生档案已更新，请刷新后重试");
  if (code === "idempotency_conflict") return new StudentProfileVersionError(code, "恢复请求与先前操作冲突，请刷新后重试");
  if (code === "invalid_state") return new StudentProfileVersionError(code, "学生档案版本数据需要修复");
  return new StudentProfileVersionError("unavailable", "学生档案历史暂不可用");
}

function validateErrorResponse(source: RawRecord | null, operation: string, requestId: string): StudentProfileVersionError {
  if (!source || source.operation !== operation || source.request_id !== requestId || typeof source.code !== "string") {
    return new StudentProfileVersionError("invalid_response", "Core 学生档案响应无效");
  }
  return responseError(source.code);
}

export async function readStudentProfileVersions(studentId: string, signal?: AbortSignal): Promise<StudentProfileVersionHistory> {
  const normalizedStudentId = text(studentId, 240);
  if (!normalizedStudentId) throw new StudentProfileVersionError("invalid_request", "学生身份无效");
  const requestId = `student-profile-versions-${randomUUID()}`;
  const roots = resolveEduPiBridgeRoots();
  const response = record(await runCoreProcess<unknown>({
    ...roots,
    timeoutMs: 10_000,
    signal,
    request: {
      protocol: "edupi-desktop-bridge",
      protocol_version: 1,
      producer: "edupi-desktop",
      operation: "workspace-resources",
      request_id: requestId,
      include_student_profile_versions: true,
      student_id: normalizedStudentId,
    },
  }));
  if (response?.ok !== true) throw validateErrorResponse(response, "workspace-resources", requestId);
  if (response.operation !== "workspace-resources" || response.request_id !== requestId) fail("Core 学生档案历史响应无效");
  return normalizeStudentProfileVersionHistory(response.studentProfileVersions, normalizedStudentId);
}

export function studentProfileRestoreRequestId(input: {
  studentId: string;
  versionId: string;
  versionSide: StudentProfileVersionSide;
  expectedRevision: number;
}): string {
  const identity = JSON.stringify({
    student_id: input.studentId,
    version_id: input.versionId,
    version_side: input.versionSide,
    expected_revision: input.expectedRevision,
  });
  return `student-profile-restore-${createHash("sha256").update(identity).digest("base64url")}`;
}

export function buildStudentProfileRestoreRequest(input: {
  studentId: string;
  versionId: string;
  versionSide: StudentProfileVersionSide;
  expectedRevision: number;
}, requestId = studentProfileRestoreRequestId(input)) {
  return {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation: "students",
    request_id: requestId,
    action: "restore",
    student_id: input.studentId,
    version_id: input.versionId,
    version_side: input.versionSide,
    expected_revision: input.expectedRevision,
  } as const;
}

export function normalizeStudentProfileMutationReceipt(value: unknown, expected: {
  requestId: string;
  action: "update" | "restore";
  studentId?: string;
  studentName: string;
  expectedRevision: number;
}): StudentProfileMutationReceipt {
  const source = record(value);
  const keys = ["ok", "operation", "request_id", "action", "updated", "student_id", "student_name", "version_id", "profile_revision", "profile_history_count", "updated_at", "total", "replayed", "external_send"];
  const studentId = text(source?.student_id, 240);
  const studentName = text(source?.student_name, 120);
  const versionId = source?.version_id === null ? null : text(source?.version_id, 160);
  const updatedAt = text(source?.updated_at, 64);
  if (!source || !exactKeys(source, keys) || source.ok !== true || source.operation !== "students" || source.request_id !== expected.requestId
    || source.action !== expected.action || source.updated !== 1 || !studentId || (expected.studentId && studentId !== expected.studentId)
    || studentName !== expected.studentName || (source.version_id !== null && versionId === null)
    || !Number.isInteger(source.profile_revision) || Number(source.profile_revision) < 0
    || !Number.isInteger(source.profile_history_count) || Number(source.profile_history_count) < 0 || Number(source.profile_history_count) > MAX_HISTORY
    || !updatedAt || Number.isNaN(Date.parse(updatedAt)) || !Number.isInteger(source.total) || Number(source.total) < 1 || Number(source.total) > 500
    || typeof source.replayed !== "boolean" || source.external_send !== false) fail("Core 学生档案修改响应无效");
  const profileRevision = Number(source.profile_revision);
  const changed = versionId !== null;
  if (profileRevision !== expected.expectedRevision + (changed ? 1 : 0) || (expected.action === "restore" && !changed)) fail("Core 学生档案修改响应无效");
  return {
    requestId: expected.requestId,
    action: expected.action,
    studentId,
    studentName,
    versionId,
    profileRevision,
    profileHistoryCount: Number(source.profile_history_count),
    updatedAt,
    total: Number(source.total),
    replayed: source.replayed,
    externalSend: false,
  };
}

export async function restoreStudentProfileVersion(input: {
  studentId: string;
  studentName: string;
  versionId: string;
  versionSide: StudentProfileVersionSide;
  expectedRevision: number;
  signal?: AbortSignal;
}): Promise<StudentProfileMutationReceipt> {
  const requestId = studentProfileRestoreRequestId(input);
  const roots = resolveEduPiBridgeRoots();
  const response = record(await runCoreProcess<unknown>({
    ...roots,
    timeoutMs: 15_000,
    signal: input.signal,
    request: buildStudentProfileRestoreRequest(input, requestId),
  }));
  if (response?.ok !== true) throw validateErrorResponse(response, "students", requestId);
  return normalizeStudentProfileMutationReceipt(response, {
    requestId,
    action: "restore",
    studentId: input.studentId,
    studentName: input.studentName,
    expectedRevision: input.expectedRevision,
  });
}
