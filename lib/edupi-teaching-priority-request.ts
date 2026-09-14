import type { TeachingPriorityValues, TeachingPriorityVersionSide } from "@/lib/edupi-teaching-priorities";

type RawRecord = Record<string, unknown>;

export type TeachingPriorityCreateBody = Omit<TeachingPriorityValues, "status">;
export type TeachingPriorityUpdateBody = {
  priorityId: string;
  expectedRevision: number;
  patch: Partial<TeachingPriorityValues>;
};
export type TeachingPriorityRestoreBody = {
  versionId: string;
  versionSide: TeachingPriorityVersionSide;
  expectedRevision: number;
};

const CREATE_KEYS = new Set(["subject", "className", "topic", "note"]);
const UPDATE_KEYS = new Set(["priorityId", "expectedRevision", "patch"]);
const PATCH_KEYS = new Set(["subject", "className", "topic", "note", "status"]);
const RESTORE_KEYS = new Set(["versionId", "versionSide", "expectedRevision"]);

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max && !/[\u0000-\u001f\u007f]/u.test(normalized) ? normalized : null;
}

function nullableText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === "") return null;
  return boundedText(value, max) ?? undefined;
}

function parsePatch(value: unknown): Partial<TeachingPriorityValues> | null {
  const source = record(value);
  if (!source || Object.keys(source).length === 0 || Object.keys(source).some((key) => !PATCH_KEYS.has(key))) return null;
  const result: Partial<TeachingPriorityValues> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (key === "subject") { const parsed = boundedText(raw, 120); if (!parsed) return null; result.subject = parsed; }
    else if (key === "className") { const parsed = nullableText(raw, 120); if (parsed === undefined) return null; result.className = parsed; }
    else if (key === "topic") { const parsed = boundedText(raw, 240); if (!parsed) return null; result.topic = parsed; }
    else if (key === "note") { const parsed = nullableText(raw, 2000); if (parsed === undefined) return null; result.note = parsed; }
    else if (key === "status") {
      if (raw !== "active" && raw !== "paused" && raw !== "completed") return null;
      result.status = raw;
    }
  }
  return result;
}

export function parseTeachingPriorityId(value: unknown): string | null {
  return boundedText(value, 160);
}

export function parseTeachingPriorityCreateBody(value: unknown): TeachingPriorityCreateBody | null {
  const source = record(value);
  if (!source || Object.keys(source).length !== CREATE_KEYS.size || Object.keys(source).some((key) => !CREATE_KEYS.has(key))) return null;
  const subject = boundedText(source.subject, 120);
  const className = nullableText(source.className, 120);
  const topic = boundedText(source.topic, 240);
  const note = nullableText(source.note, 2000);
  return subject && topic && className !== undefined && note !== undefined ? { subject, className, topic, note } : null;
}

export function parseTeachingPriorityUpdateBody(value: unknown): TeachingPriorityUpdateBody | null {
  const source = record(value);
  if (!source || Object.keys(source).length !== UPDATE_KEYS.size || Object.keys(source).some((key) => !UPDATE_KEYS.has(key))) return null;
  const priorityId = parseTeachingPriorityId(source.priorityId);
  const patch = parsePatch(source.patch);
  return priorityId && Number.isInteger(source.expectedRevision) && Number(source.expectedRevision) >= 0 && patch
    ? { priorityId, expectedRevision: Number(source.expectedRevision), patch }
    : null;
}

export function parseTeachingPriorityRestoreBody(value: unknown): TeachingPriorityRestoreBody | null {
  const source = record(value);
  if (!source || Object.keys(source).length !== RESTORE_KEYS.size || Object.keys(source).some((key) => !RESTORE_KEYS.has(key))) return null;
  const versionId = boundedText(source.versionId, 160);
  return versionId && (source.versionSide === "before" || source.versionSide === "after")
    && Number.isInteger(source.expectedRevision) && Number(source.expectedRevision) >= 0
    ? { versionId, versionSide: source.versionSide, expectedRevision: Number(source.expectedRevision) }
    : null;
}
