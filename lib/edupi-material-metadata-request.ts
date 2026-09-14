import type { MaterialMetadataValues, MaterialMetadataVersionSide } from "./edupi-material-metadata-model";

type RawRecord = Record<string, unknown>;
export type MaterialMetadataUpdateBody = { expectedRevision: number; patch: Partial<MaterialMetadataValues> };
export type MaterialMetadataRestoreBody = { versionId: string; versionSide: MaterialMetadataVersionSide; expectedRevision: number };

const UPDATE_KEYS = new Set(["expectedRevision", "patch"]);
const PATCH_KEYS = new Set(["title", "kind", "subject", "classId"]);
const RESTORE_KEYS = new Set(["versionId", "versionSide", "expectedRevision"]);
const KINDS = new Set(["worksheet", "lesson_note", "assessment", "classroom_record", "other"]);

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max && !/[\u0000-\u001f\u007f]/u.test(normalized) ? normalized : null;
}

function nullableText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === "") return null;
  return text(value, max) ?? undefined;
}

function patch(value: unknown): Partial<MaterialMetadataValues> | null {
  const source = record(value);
  if (!source || Object.keys(source).length === 0 || Object.keys(source).some((key) => !PATCH_KEYS.has(key))) return null;
  const result: Partial<MaterialMetadataValues> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (key === "title") { const parsed = text(raw, 240); if (!parsed) return null; result.title = parsed; }
    else if (key === "kind") { if (typeof raw !== "string" || !KINDS.has(raw)) return null; result.kind = raw as MaterialMetadataValues["kind"]; }
    else if (key === "subject") { const parsed = nullableText(raw, 120); if (parsed === undefined) return null; result.subject = parsed; }
    else if (key === "classId") { const parsed = nullableText(raw, 160); if (parsed === undefined) return null; result.classId = parsed; }
  }
  return result;
}

export function parseMaterialId(value: unknown): string | null {
  return text(value, 160);
}

export function parseMaterialMetadataUpdateBody(value: unknown): MaterialMetadataUpdateBody | null {
  const source = record(value);
  if (!source || Object.keys(source).length !== UPDATE_KEYS.size || Object.keys(source).some((key) => !UPDATE_KEYS.has(key))) return null;
  const parsedPatch = patch(source.patch);
  return Number.isInteger(source.expectedRevision) && Number(source.expectedRevision) >= 0 && parsedPatch
    ? { expectedRevision: Number(source.expectedRevision), patch: parsedPatch }
    : null;
}

export function parseMaterialMetadataRestoreBody(value: unknown): MaterialMetadataRestoreBody | null {
  const source = record(value);
  if (!source || Object.keys(source).length !== RESTORE_KEYS.size || Object.keys(source).some((key) => !RESTORE_KEYS.has(key))) return null;
  const versionId = text(source.versionId, 160);
  return versionId && (source.versionSide === "before" || source.versionSide === "after")
    && Number.isInteger(source.expectedRevision) && Number(source.expectedRevision) >= 0
    ? { versionId, versionSide: source.versionSide, expectedRevision: Number(source.expectedRevision) }
    : null;
}
