import { createHash, randomUUID } from "node:crypto";
import { runCoreProcess } from "./edupi-core-process-client";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import {
  MATERIAL_METADATA_FIELDS,
  MATERIAL_METADATA_KINDS,
  sameMaterialMetadataValues,
  type MaterialMetadataField,
  type MaterialMetadataKind,
  type MaterialMetadataValues,
  type MaterialMetadataVersion,
  type MaterialMetadataVersionHistory,
  type MaterialMetadataVersionSide,
} from "./edupi-material-metadata-model";

export {
  MATERIAL_METADATA_FIELDS,
  MATERIAL_METADATA_KINDS,
  materialMetadataPatch,
  materialMetadataValues,
  sameMaterialMetadataValues,
  type MaterialMetadataField,
  type MaterialMetadataKind,
  type MaterialMetadataValues,
  type MaterialMetadataVersion,
  type MaterialMetadataVersionHistory,
  type MaterialMetadataVersionSide,
} from "./edupi-material-metadata-model";

export type MaterialMetadataMutationReceipt = {
  requestId: string;
  action: "update" | "restore";
  materialId: string;
  versionId: string | null;
  revision: number;
  historyCount: number;
  updatedAt: string;
  replayed: boolean;
  externalSend: false;
};

type RawRecord = Record<string, unknown>;

export class MaterialMetadataError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "MaterialMetadataError";
  }
}

function fail(message = "Core 材料信息响应无效"): never {
  throw new MaterialMetadataError("invalid_response", message);
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

function wireValues(value: MaterialMetadataValues) {
  return { title: value.title, kind: value.kind, subject: value.subject, class_id: value.classId };
}

function values(value: unknown): MaterialMetadataValues | null {
  const source = record(value);
  if (!source || !exactKeys(source, MATERIAL_METADATA_FIELDS)) return null;
  const title = text(source.title, 240);
  const kind = source.kind as MaterialMetadataKind;
  const subject = source.subject === null ? null : text(source.subject, 120);
  const classId = source.class_id === null ? null : text(source.class_id, 160);
  if (!title || !MATERIAL_METADATA_KINDS.includes(kind)
    || (source.subject !== null && !subject) || (source.class_id !== null && !classId)) return null;
  return { title, kind, subject, classId };
}

function changedFields(before: MaterialMetadataValues, after: MaterialMetadataValues): MaterialMetadataField[] {
  const beforeWire = wireValues(before);
  const afterWire = wireValues(after);
  return MATERIAL_METADATA_FIELDS.filter((field) => JSON.stringify(beforeWire[field]) !== JSON.stringify(afterWire[field]));
}

function normalizeVersion(value: unknown, materialId: string, index: number): MaterialMetadataVersion {
  const source = record(value);
  const keys = ["version_id", "material_id", "revision", "before", "after", "changed_fields", "changed_at", "source_kind", "request_id"];
  const beforeValues = values(source?.before);
  const afterValues = values(source?.after);
  const versionId = text(source?.version_id, 160);
  const boundMaterialId = text(source?.material_id, 160);
  const changedAt = timestamp(source?.changed_at);
  const requestId = text(source?.request_id, 160);
  const sourceKind = source?.source_kind;
  const expectedChanges = beforeValues && afterValues ? changedFields(beforeValues, afterValues) : [];
  if (!source || !exactKeys(source, keys) || !beforeValues || !afterValues || !versionId || boundMaterialId !== materialId
    || !Number.isInteger(source.revision) || Number(source.revision) < 1 || !changedAt || !requestId
    || (sourceKind !== "teacher_edit" && sourceKind !== "agent_update" && sourceKind !== "restore")
    || !Array.isArray(source.changed_fields) || JSON.stringify(source.changed_fields) !== JSON.stringify(expectedChanges)) return fail(`Core 材料信息版本 ${index + 1} 无效`);
  const identity = JSON.stringify({ material_id: materialId, revision: Number(source.revision), before: wireValues(beforeValues), after: wireValues(afterValues), changed_at: changedAt, source_kind: sourceKind, request_id: requestId });
  const expectedId = `material-metadata-version-${createHash("sha256").update(identity).digest("base64url")}`;
  if (versionId !== expectedId) return fail(`Core 材料信息版本 ${index + 1} 的身份无效`);
  return { versionId, materialId, revision: Number(source.revision), beforeValues, afterValues, changedFields: expectedChanges, changedAt, sourceKind, requestId };
}

export function normalizeMaterialMetadataHistory(value: unknown, expectedMaterialId?: string): MaterialMetadataVersionHistory {
  const source = record(value);
  const keys = ["material_id", "revision", "history_count", "versions", "external_send"];
  const materialId = text(source?.material_id, 160);
  if (!source || !exactKeys(source, keys) || !materialId || (expectedMaterialId && materialId !== expectedMaterialId)
    || !Number.isInteger(source.revision) || Number(source.revision) < 0
    || !Number.isInteger(source.history_count) || Number(source.history_count) < 0 || Number(source.history_count) > 50
    || !Array.isArray(source.versions) || source.versions.length > 50 || source.external_send !== false) return fail();
  const versions = source.versions.map((version, index) => normalizeVersion(version, materialId, index));
  const revision = Number(source.revision);
  if (Number(source.history_count) !== versions.length || new Set(versions.map((version) => version.versionId)).size !== versions.length) return fail();
  for (let index = 0; index < versions.length; index += 1) {
    if (versions[index].revision !== revision - versions.length + index + 1) return fail("Core 材料信息版本顺序无效");
    if (index > 0 && !sameMaterialMetadataValues(versions[index - 1].afterValues, versions[index].beforeValues)) return fail("Core 材料信息版本链无效");
  }
  if (versions.length > 0 && Buffer.byteLength(JSON.stringify(source.versions), "utf8") > 64 * 1024) return fail();
  if (revision === 0 && versions.length > 0) return fail();
  return { materialId, revision, historyCount: versions.length, versions, externalSend: false };
}

function requestId(prefix: string, value: unknown): string {
  return `${prefix}-${createHash("sha256").update(JSON.stringify(value)).digest("base64url")}`;
}

export function materialMetadataUpdateRequestId(input: { materialId: string; expectedRevision: number; patch: Partial<MaterialMetadataValues> }): string {
  const patch = Object.fromEntries((["title", "kind", "subject", "classId"] as const).filter((field) => Object.hasOwn(input.patch, field)).map((field) => [field === "classId" ? "class_id" : field, input.patch[field]]));
  return requestId("material-metadata-update", { material_id: input.materialId, expected_revision: input.expectedRevision, patch });
}

export function materialMetadataRestoreRequestId(input: { materialId: string; versionId: string; versionSide: MaterialMetadataVersionSide; expectedRevision: number }): string {
  return requestId("material-metadata-restore", { material_id: input.materialId, version_id: input.versionId, version_side: input.versionSide, expected_revision: input.expectedRevision });
}

function coreError(code: string): MaterialMetadataError {
  if (code === "material_not_found") return new MaterialMetadataError(code, "材料不存在");
  if (code === "material_deleted") return new MaterialMetadataError(code, "材料已删除");
  if (code === "stale_material_metadata") return new MaterialMetadataError(code, "材料信息已更新，请刷新后重试");
  if (code === "version_not_found") return new MaterialMetadataError(code, "这个材料信息版本已不存在");
  if (code === "version_already_current") return new MaterialMetadataError(code, "当前材料信息已经是这个版本");
  if (code === "idempotency_conflict") return new MaterialMetadataError(code, "请求与先前操作冲突，请刷新后重试");
  if (code === "material_metadata_storage_capacity" || code === "material_metadata_history_capacity") return new MaterialMetadataError(code, "材料信息历史已达上限");
  if (code === "invalid_state") return new MaterialMetadataError(code, "材料信息数据需要修复");
  return new MaterialMetadataError("unavailable", "材料信息暂不可用");
}

function parseCoreError(source: RawRecord | null, operation: string, expectedRequestId: string): MaterialMetadataError {
  if (!source || source.operation !== operation || source.request_id !== expectedRequestId || typeof source.code !== "string") return new MaterialMetadataError("invalid_response", "Core 材料信息响应无效");
  return coreError(source.code);
}

export function normalizeMaterialMetadataReceipt(value: unknown, expected: { requestId: string; action: "update" | "restore"; materialId: string; expectedRevision: number }): MaterialMetadataMutationReceipt {
  const source = record(value);
  const keys = ["ok", "operation", "request_id", "action", "material_id", "version_id", "revision", "history_count", "updated_at", "replayed", "external_send"];
  const materialId = text(source?.material_id, 160);
  const versionId = source?.version_id === null ? null : text(source?.version_id, 160);
  const updatedAt = timestamp(source?.updated_at);
  if (!source || !exactKeys(source, keys) || source.ok !== true || source.operation !== "material-metadata" || source.request_id !== expected.requestId
    || source.action !== expected.action || materialId !== expected.materialId
    || (source.version_id !== null && !versionId) || !Number.isInteger(source.revision) || Number(source.revision) < 0
    || !Number.isInteger(source.history_count) || Number(source.history_count) < 0 || Number(source.history_count) > 50
    || !updatedAt || typeof source.replayed !== "boolean" || source.external_send !== false) return fail();
  const revision = Number(source.revision);
  if (expected.action === "restore" && (revision !== expected.expectedRevision + 1 || !versionId)) return fail();
  if (expected.action === "update" && revision !== expected.expectedRevision + (versionId ? 1 : 0)) return fail();
  return { requestId: expected.requestId, action: expected.action, materialId, versionId, revision, historyCount: Number(source.history_count), updatedAt, replayed: source.replayed, externalSend: false };
}

async function callMutation(request: RawRecord, signal?: AbortSignal): Promise<MaterialMetadataMutationReceipt> {
  const roots = resolveEduPiBridgeRoots();
  const invoke = () => runCoreProcess<unknown>({ ...roots, timeoutMs: 15_000, signal, request });
  let raw: unknown;
  try { raw = await invoke(); }
  catch (error) {
    if (signal?.aborted) throw error;
    raw = await invoke();
  }
  const response = record(raw);
  if (response?.ok !== true) throw parseCoreError(response, "material-metadata", String(request.request_id));
  return normalizeMaterialMetadataReceipt(response, {
    requestId: String(request.request_id),
    action: request.action as "update" | "restore",
    materialId: String(request.material_id),
    expectedRevision: Number(request.expected_revision),
  });
}

export async function updateMaterialMetadata(input: { materialId: string; expectedRevision: number; patch: Partial<MaterialMetadataValues>; signal?: AbortSignal }): Promise<MaterialMetadataMutationReceipt> {
  const request = {
    protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "material-metadata",
    request_id: materialMetadataUpdateRequestId(input), action: "update", material_id: input.materialId, expected_revision: input.expectedRevision,
    patch: Object.fromEntries((["title", "kind", "subject", "classId"] as const).filter((field) => Object.hasOwn(input.patch, field)).map((field) => [field === "classId" ? "class_id" : field, input.patch[field]])),
  };
  return callMutation(request, input.signal);
}

export async function restoreMaterialMetadataVersion(input: { materialId: string; versionId: string; versionSide: MaterialMetadataVersionSide; expectedRevision: number; signal?: AbortSignal }): Promise<MaterialMetadataMutationReceipt> {
  const request = {
    protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "material-metadata",
    request_id: materialMetadataRestoreRequestId(input), action: "restore", material_id: input.materialId, version_id: input.versionId, version_side: input.versionSide, expected_revision: input.expectedRevision,
  };
  return callMutation(request, input.signal);
}

export async function readMaterialMetadataHistory(materialId: string, signal?: AbortSignal): Promise<MaterialMetadataVersionHistory> {
  if (!text(materialId, 160)) throw new MaterialMetadataError("invalid_request", "材料身份无效");
  const requestId = `material-metadata-history-${randomUUID()}`;
  const roots = resolveEduPiBridgeRoots();
  const response = record(await runCoreProcess<unknown>({
    ...roots,
    timeoutMs: 10_000,
    signal,
    request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "workspace-resources", request_id: requestId, include_material_metadata_versions: true, material_id: materialId },
  }));
  if (response?.ok !== true) throw parseCoreError(response, "workspace-resources", requestId);
  if (response.operation !== "workspace-resources" || response.request_id !== requestId) return fail();
  return normalizeMaterialMetadataHistory(response.materialMetadataVersions, materialId);
}
