export type FamilyQuality = "supportive" | "tense" | "unknown";
export type FamilyRecordDetails = { recorded_relationship: string | null; teacher_explicit_quality: FamilyQuality; observed_on: string | null; note: string };
export type FamilyRecord = {
  fact_id: string; event_id: string; student_entity_id: string; parent_entity_id: string;
  record: FamilyRecordDetails & { version: 1; student_entity_id: string; parent_entity_id: string; guardian_verification: "unknown" };
  display_quality: FamilyQuality; status: "candidate" | "pending_review" | "held" | "accepted" | "rejected" | "stale" | "superseded" | "deleted";
  revision: number; mutation_allowed: boolean;
  source: { source_id: string; source_revision: string; raw_text: string; observed_at: string; actor_ref: string; status: "active" | "stale" | "deleted" };
  history: Array<{ action: "accept" | "reject" | "hold" | "modify" | "delete" | "restore"; reviewed_at: string; reviewer: string; note: string | null }>;
  supersedes_fact_id: string | null; superseded_by: string | null; deleted_previous_status: string | null;
  logged_at: string; updated_at: string; deleted_at: string | null; external_send: false;
  review_conflicts: Array<{ fact_id: string; revision: number; record: FamilyRecord["record"] }>;
  review_conflict_count: number; review_mode: "direct" | "replace" | "blocked";
  restore_mode: "direct" | "replace" | "pending_review" | "blocked";
};
export type FamilyPerson = { entity_id: string; entity_kind: "student" | "parent"; canonical_name: string; status: "active" | "deleted"; revision: number; external_send: false };
export type FamilyRecordPage = {
  studentId: string; studentEntity: FamilyPerson | null; parents: FamilyPerson[]; records: FamilyRecord[];
  total: number; offset: number; limit: number; nextOffset: number | null; sourceStatus: "current" | "unavailable"; externalSend: false;
};
export type FamilyCaptureInput = {
  studentId: string;
  parent: { external_id: string; label: string } | null; parentEntityId: string | null;
  record: FamilyRecordDetails;
  source: { source_id: string; source_revision: string; raw_text: string; observed_at: string; actor_ref: string };
};

export function familyQualityLabel(quality: FamilyQuality): string {
  return { supportive: "配合", tense: "紧张", unknown: "未判断" }[quality];
}

function object(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function exact(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function text(value: unknown, max: number, multiline = false): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && value === value.normalize("NFKC").trim()
    && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value);
}
export function parseFamilyCaptureInput(value: unknown): FamilyCaptureInput | null {
  const input = object(value), details = object(input?.record), source = object(input?.source), parent = object(input?.parent);
  if (!input || !exact(input, ["studentId", "parent", "parentEntityId", "record", "source"]) || !text(input.studentId, 160)
    || !details || !exact(details, ["recorded_relationship", "teacher_explicit_quality", "observed_on", "note"])
    || details.recorded_relationship !== null && !text(details.recorded_relationship, 120)
    || !["supportive", "tense", "unknown"].includes(String(details.teacher_explicit_quality)) || !text(details.note, 2000, true)
    || !source || !exact(source, ["source_id", "source_revision", "raw_text", "observed_at", "actor_ref"])
    || !text(source.source_id, 160) || !text(source.source_revision, 160) || !text(source.actor_ref, 160)
    || typeof source.raw_text !== "string" || !source.raw_text.trim() || source.raw_text.length > 4000 || source.raw_text.includes("\u0000")
    || typeof source.observed_at !== "string" || !Number.isFinite(Date.parse(source.observed_at)) || new Date(source.observed_at).toISOString() !== source.observed_at) return null;
  if (details.observed_on !== null && (typeof details.observed_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(details.observed_on)
    || !Number.isFinite(Date.parse(`${details.observed_on}T00:00:00.000Z`)) || new Date(`${details.observed_on}T00:00:00.000Z`).toISOString().slice(0, 10) !== details.observed_on)) return null;
  if (input.parent === null ? !text(input.parentEntityId, 160) || !/^entity_[a-f0-9]{32}$/.test(input.parentEntityId)
    : input.parentEntityId !== null || !parent || !exact(parent, ["external_id", "label"]) || !text(parent.label, 240)
      || !text(parent.external_id, 160) || !/^family-[a-z0-9][a-z0-9_-]{7,119}$/.test(parent.external_id)) return null;
  return input as unknown as FamilyCaptureInput;
}
