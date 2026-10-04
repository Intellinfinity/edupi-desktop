import crypto from "node:crypto";
import type { EduPiProactivityScope } from "./edupi-proactivity-config";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/u;
export const EDUPI_PROACTIVITY_CONVERSATION_ID = "desktop-ambient-canary-v1";
export const EDUPI_STUDENT_FOLLOWUP_CONVERSATION_ID = "desktop-student-followup-canary-v1";
export const EDUPI_PROACTIVITY_DURATION_DAYS = 7;
export const EDUPI_PROACTIVITY_MAX_CALLS = 12;
export const EDUPI_STUDENT_FOLLOWUP_MAX_CALLS = 4;

export type EduPiProactivityGrantBinding = {
  grantId: string;
  endsAt: string;
  spec: {
    scope: { class_id: string; subject: string };
    source_ids: string[];
    starts_at: string;
    ends_at: string;
    budget: { id: string; max_calls: number };
  } & ({ domains: ["teaching_preparation"]; actions: ["prepare", "update"] }
    | { domains: ["student_followup"]; actions: ["update"] });
};

type RawRecord = Record<string, unknown>;
type InternalScope = {
  classId: string;
  className: string | null;
  subject: string;
  slotIds: string[];
  materialIds: string[];
};

export type EduPiProactivityScopeCandidate = {
  classId: string;
  className: string | null;
  subject: string;
  slotCount: number;
  materialCount: number;
  ready: boolean;
};

export class EduPiProactivityControlError extends Error {
  constructor(public readonly code: "proactivity_scope_unavailable" | "proactivity_scope_conflict" | "proactivity_response_invalid") {
    super(code); this.name = "EduPiProactivityControlError";
  }
}

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value.trim() : null;
}

function opaqueSource(kind: "conversation" | "timetable" | "material", value: string): string {
  return `${kind}:${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function internalScopes(workspace: unknown, teacherMaterials: unknown): InternalScope[] {
  const value = record(workspace);
  const slots = Array.isArray(value?.timetable) ? value.timetable : [];
  const materials = Array.isArray(teacherMaterials) ? teacherMaterials : [];
  const groups = new Map<string, InternalScope>();
  for (const raw of slots.slice(0, 500)) {
    const slot = record(raw);
    const slotId = text(slot?.slot_id, 160);
    const classId = text(slot?.class_id, 160);
    const subject = text(slot?.subject, 128);
    if (!slotId || !classId || !subject || !ID.test(slotId) || !ID.test(classId) || slot?.kind !== "class") continue;
    const key = `${classId}\0${subject}`;
    const current = groups.get(key) || { classId, className: text(slot?.class_name, 120), subject, slotIds: [], materialIds: [] };
    if (!current.slotIds.includes(slotId) && current.slotIds.length < 50) current.slotIds.push(slotId);
    groups.set(key, current);
  }
  for (const raw of materials.slice(0, 500)) {
    const material = record(raw);
    const materialId = text(material?.material_id, 160);
    const classId = text(material?.class_id, 160);
    const subject = text(material?.subject, 128);
    if (!materialId || !classId || !subject || !ID.test(materialId) || !ID.test(classId) || material?.available === false) continue;
    const current = groups.get(`${classId}\0${subject}`);
    if (current && !current.materialIds.includes(materialId) && current.materialIds.length < 20) current.materialIds.push(materialId);
  }
  return [...groups.values()].map((item) => ({ ...item, slotIds: item.slotIds.sort(), materialIds: item.materialIds.sort() }))
    .sort((left, right) => `${left.classId}\0${left.subject}`.localeCompare(`${right.classId}\0${right.subject}`));
}

export function buildProactivityScopeCandidates(workspace: unknown, teacherMaterials: unknown): EduPiProactivityScopeCandidate[] {
  return internalScopes(workspace, teacherMaterials).slice(0, 50).map((item) => ({
    classId: item.classId,
    className: item.className,
    subject: item.subject,
    slotCount: item.slotIds.length,
    materialCount: item.materialIds.length,
    ready: item.slotIds.length > 0 && item.materialIds.length > 0,
  }));
}

export function buildStudentFollowupScopeCandidates(workspace: unknown): EduPiProactivityScopeCandidate[] {
  const value = record(workspace);
  const slots = Array.isArray(value?.timetable) ? value.timetable.slice(0, 500).map(record) : [];
  const students = Array.isArray(value?.students) ? value.students.slice(0, 500).map(record) : [];
  return internalScopes(workspace, []).filter((item) => item.subject === "数学").slice(0, 50).map((item) => {
    const matchingSlots = slots.filter((slot) => slot?.kind === "class" && slot.class_id === item.classId && slot.subject === item.subject);
    const classNames = new Set(matchingSlots.map((slot) => text(slot?.class_name, 120)));
    const className = classNames.size === 1 ? [...classNames][0] : null;
    // Only the current Core projection supplies the class mapping. Names and
    // student identities in conversation text remain Core's responsibility.
    const classIds = new Set(slots.filter((slot) => slot?.kind === "class" && slot.class_name === className && slot.subject === item.subject)
      .map((slot) => slot?.class_id));
    return {
      classId: item.classId,
      className: className ?? null,
      subject: item.subject,
      slotCount: item.slotIds.length,
      materialCount: 0,
      ready: Boolean(className && classIds.size === 1 && classIds.has(item.classId)
        && students.some((student) => student?.class_name === className)),
    };
  });
}

export function buildProactivityGrantBinding(
  scope: EduPiProactivityScope,
  workspace: unknown,
  teacherMaterials: unknown,
  now = new Date().toISOString(),
): EduPiProactivityGrantBinding {
  const current = internalScopes(workspace, teacherMaterials).find((item) => item.classId === scope.classId && item.subject === scope.subject);
  if (!current || current.slotIds.length === 0 || current.materialIds.length === 0) {
    throw new EduPiProactivityControlError("proactivity_scope_unavailable");
  }
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== now) throw new EduPiProactivityControlError("proactivity_scope_unavailable");
  const token = crypto.createHash("sha256").update(`${scope.classId}\0${scope.subject}`, "utf8").digest("hex").slice(0, 32);
  const grantId = `desktop_canary_v2_${token}`;
  const startsAt = new Date(instant.getTime() - 60_000).toISOString();
  const endsAt = new Date(instant.getTime() + EDUPI_PROACTIVITY_DURATION_DAYS * 86_400_000).toISOString();
  const sourceIds = [
    opaqueSource("conversation", EDUPI_PROACTIVITY_CONVERSATION_ID),
    ...current.slotIds.map((id) => opaqueSource("timetable", id)),
    ...current.materialIds.map((id) => opaqueSource("material", id)),
  ].sort();
  return {
    grantId,
    endsAt,
    spec: {
      scope: { class_id: scope.classId, subject: scope.subject },
      domains: ["teaching_preparation"],
      actions: ["prepare", "update"],
      source_ids: sourceIds,
      starts_at: startsAt,
      ends_at: endsAt,
      budget: { id: `budget_v2_${token}`, max_calls: EDUPI_PROACTIVITY_MAX_CALLS },
    },
  };
}

export function buildStudentFollowupGrantBinding(
  scope: EduPiProactivityScope,
  workspace: unknown,
  now = new Date().toISOString(),
): EduPiProactivityGrantBinding {
  const current = buildStudentFollowupScopeCandidates(workspace).find((item) => item.classId === scope.classId && item.subject === scope.subject);
  const instant = new Date(now);
  if (!current?.ready || !Number.isFinite(instant.getTime()) || instant.toISOString() !== now) {
    throw new EduPiProactivityControlError("proactivity_scope_unavailable");
  }
  const token = crypto.createHash("sha256").update(`${scope.classId}\0${scope.subject}`, "utf8").digest("hex").slice(0, 32);
  const endsAt = new Date(instant.getTime() + EDUPI_PROACTIVITY_DURATION_DAYS * 86_400_000).toISOString();
  return {
    grantId: `desktop_student_followup_v1_${token}`,
    endsAt,
    spec: {
      scope: { class_id: scope.classId, subject: scope.subject },
      domains: ["student_followup"],
      actions: ["update"],
      source_ids: [opaqueSource("conversation", EDUPI_STUDENT_FOLLOWUP_CONVERSATION_ID)],
      starts_at: new Date(instant.getTime() - 60_000).toISOString(),
      ends_at: endsAt,
      budget: { id: `student_followup_budget_v1_${token}`, max_calls: EDUPI_STUDENT_FOLLOWUP_MAX_CALLS },
    },
  };
}
