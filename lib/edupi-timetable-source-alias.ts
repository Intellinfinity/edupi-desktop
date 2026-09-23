import crypto from "node:crypto";
import { CalendarSourceError, type CoreCalendarSourceRead } from "./edupi-calendar-sources";
import type { TimetableImportSlot } from "./edupi-education-intake";
import { markRecognizedTimetableNote } from "./edupi-recognition-markers";
import type { MaterialStagingDescriptor } from "./edupi-material-staging";

type RecordValue = Record<string, unknown>;
const DOCUMENT_SOURCE = /^(?:document-source-[a-f0-9]{32}|desktop-file-schedule-[a-f0-9]{24})$/u;
const SCHEDULE_EVIDENCE = /^schedule-evidence-[a-f0-9]{32}$/u;

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50
    || value.some((item) => typeof item !== "string" || !item)) return null;
  return [...new Set(value as string[])];
}

function sameSlot(current: RecordValue, incoming: TimetableImportSlot): boolean {
  return current.day_of_week === incoming.day_of_week
    && current.period === incoming.period
    && current.subject === incoming.subject
    && current.class_name === incoming.class_name
    && current.kind === incoming.kind
    && current.notes === markRecognizedTimetableNote(incoming.notes);
}

function selectionRequired(): never {
  throw new CalendarSourceError("calendar_source_selection_required", "课表来源证据已变化，请核对后选择课表来源。");
}

export function projectTimetableSourceOptions(read: Pick<CoreCalendarSourceRead, "snapshot">): Array<{
  sourceId: string; sourceKind: "timetable"; selectionKey: string; label: string; eventCount: number; fingerprint: string;
}> {
  const rows = read.snapshot.payload.education_workspace?.timetable;
  if (!Array.isArray(rows)) {
    throw new CalendarSourceError("invalid_calendar_source_projection", "Core 课表来源投影不可用。");
  }
  const groups = new Map<string, { rows: RecordValue[]; valid: boolean }>();
  for (const value of rows) {
    const row = record(value);
    const sources = stringArray(row?.source_ids);
    const evidence = stringArray(row?.evidence_ids);
    if (!row || !sources) continue;
    for (const sourceId of sources.filter((id) => DOCUMENT_SOURCE.test(id))) {
      const group = groups.get(sourceId) || { rows: [], valid: true };
      group.rows.push(row);
      group.valid &&= sources.length === 1 && Boolean(evidence?.some((id) => SCHEDULE_EVIDENCE.test(id)))
        && typeof row.slot_id === "string";
      groups.set(sourceId, group);
    }
  }
  return [...groups.entries()].filter(([, group]) => group.valid).map(([sourceId, group]) => {
    const ordered = [...group.rows].sort((left, right) => String(left.slot_id).localeCompare(String(right.slot_id)));
    const fingerprint = `sha256:${crypto.createHash("sha256").update(JSON.stringify(ordered.map((row) => ({
      slot_id: row.slot_id, day_of_week: row.day_of_week, period: row.period, subject: row.subject,
      class_name: row.class_name, kind: row.kind, notes: row.notes,
      source_ids: row.source_ids, evidence_ids: row.evidence_ids,
    })))).digest("hex")}`;
    const first = ordered[0];
    const last = ordered.at(-1)!;
    const weekday = ["", "一", "二", "三", "四", "五", "六", "日"];
    const lesson = (row: RecordValue) => `周${weekday[Number(row.day_of_week)] || String(row.day_of_week)}第${String(row.period)}节${String(row.subject || "课程")}`;
    const label = `${String(first.class_name || "固定事务")} · ${lesson(first)}${ordered.length > 1 ? `、${lesson(last)}` : ""} · 来源 ${sourceId.slice(-8)}`;
    return { sourceId, sourceKind: "timetable" as const, selectionKey: `timetable:${sourceId}`,
      label, eventCount: ordered.length, fingerprint };
  }).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

export function resolveSelectedTimetableSource(
  read: Pick<CoreCalendarSourceRead, "snapshot">, sourceId: string, expectedFingerprint: string | null,
  slots: TimetableImportSlot[],
): string {
  const options = projectTimetableSourceOptions(read).filter((option) => option.sourceId === sourceId);
  if (options.length !== 1 || !expectedFingerprint || options[0].fingerprint !== expectedFingerprint) {
    throw new CalendarSourceError("stale_calendar_source", "课表来源已变化，请重新选择。");
  }
  const rows = read.snapshot.payload.education_workspace.timetable as unknown[];
  const anchorCount = (candidateSourceId: string) => {
    const candidateRows = rows.map(record).filter((row): row is RecordValue => {
      const sources = stringArray(row?.source_ids);
      return Boolean(row && sources?.length === 1 && sources[0] === candidateSourceId);
    });
    return slots.filter((slot) => candidateRows.some((row) => row.class_name === slot.class_name
      && row.kind === slot.kind
      && (row.day_of_week === slot.day_of_week && row.period === slot.period || row.subject === slot.subject))).length;
  };
  const selectedCount = anchorCount(sourceId);
  if (selectedCount === 0 || projectTimetableSourceOptions(read).some((option) =>
    option.sourceId !== sourceId && anchorCount(option.sourceId) >= selectedCount)) {
    throw new CalendarSourceError("calendar_source_selection_required", "课表事项与所选来源不对应，请核对课程后重试。");
  }
  return sourceId;
}

/** Recovers a previous logical document source only from current, exact Core evidence. */
export function resolveTimetableSourceAlias(
  descriptor: Pick<MaterialStagingDescriptor, "source_hash">,
  slots: TimetableImportSlot[],
  read: Pick<CoreCalendarSourceRead, "snapshot">,
): string | null {
  if (slots.length === 0) return null;
  const targets = read.snapshot.payload.review_targets;
  const rows = read.snapshot.payload.education_workspace?.timetable;
  if (!Array.isArray(targets) || !Array.isArray(rows)) selectionRequired();

  const sourceHash = descriptor.source_hash;
  const evidenceId = `schedule-evidence-${sourceHash.slice("sha256:".length, "sha256:".length + 32)}`;
  const matchingTargets = targets.map(record).filter((target): target is RecordValue =>
    target?.projection_kind === "timetable_import" && target.source_hash === sourceHash);
  const relatedRows = rows.map(record).filter((row): row is RecordValue =>
    Boolean(row && Array.isArray(row.evidence_ids) && row.evidence_ids.includes(evidenceId)));
  if (matchingTargets.length === 0) {
    if (relatedRows.length > 0) selectionRequired();
    return null;
  }

  const currentMaterial = targets.map(record).some((target) => {
    const identity = record(target?.target);
    return target?.projection_kind === "material_intake" && target.source_hash === sourceHash
      && target.status === "accepted" && target.intake_state === "accepted"
      && identity?.target_kind === "material_intake" && typeof identity.target_id === "string";
  });
  if (!currentMaterial || relatedRows.length !== slots.length) selectionRequired();
  const sourceIds = matchingTargets.map((target) => {
    const sources = stringArray(target.source_ids);
    const evidence = stringArray(target.evidence_ids);
    if (target.status !== "accepted" || target.item_count !== slots.length
      || target.conflict_count !== 0 || target.held_count !== 0
      || !sources || sources.length !== 1 || !DOCUMENT_SOURCE.test(sources[0])
      || !evidence || evidence.length !== 1 || evidence[0] !== evidenceId) selectionRequired();
    return sources[0];
  });
  if (new Set(sourceIds).size !== 1) selectionRequired();

  const remaining = [...relatedRows];
  for (const slot of slots) {
    const matches = remaining.filter((row) => sameSlot(row, slot));
    if (matches.length !== 1) selectionRequired();
    const row = matches[0];
    const rowSources = stringArray(row.source_ids);
    const rowEvidence = stringArray(row.evidence_ids);
    if (!rowSources || rowSources.length !== 1 || rowSources[0] !== sourceIds[0]
      || !rowEvidence || !rowEvidence.includes(evidenceId)) selectionRequired();
    remaining.splice(remaining.indexOf(row), 1);
  }
  return sourceIds[0];
}
