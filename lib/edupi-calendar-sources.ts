import crypto from "node:crypto";
import { readEduPiEducationSnapshot, type EduPiBridgeRoots } from "./edupi-core-snapshot";

const SOURCE_ID = /^calendar-source-[a-f0-9]{32}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

type RawRecord = Record<string, unknown>;

export class CalendarSourceError extends Error {
  constructor(public readonly code: "invalid_calendar_source_projection" | "calendar_source_not_found" | "stale_calendar_source" | "calendar_source_selection_required", message: string) {
    super(message);
    this.name = "CalendarSourceError";
  }
}

export type CoreCalendarOccurrence = {
  sourceOccurrenceRef: string;
  eventId: string;
  contentFingerprint: string;
  content: RawRecord;
  evidenceIds: string[];
};

export type CoreCalendarSource = {
  sourceId: string;
  label: string;
  eventCount: number;
  fingerprint: string;
  occurrences: CoreCalendarOccurrence[];
};

export type CoreCalendarSourceRead = {
  sources: CoreCalendarSource[];
  snapshot: { payload: RawRecord & { education_workspace: RawRecord }; roots: EduPiBridgeRoots };
};

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim() : null;
}

function eventContent(value: RawRecord): RawRecord {
  return {
    date: value.date ?? null,
    end_date: value.end_date ?? null,
    name: value.name ?? null,
    type: value.type ?? null,
    confidence: value.confidence ?? null,
    notes: value.notes ?? null,
    time_interval: value.time_interval ?? null,
    location: value.location ?? null,
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  const source = value as RawRecord;
  return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonical(source[key])]));
}

function hash(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex")}`;
}

export function calendarOccurrenceContentFingerprint(value: RawRecord): string {
  return hash(eventContent(value));
}

export function calendarSourceFingerprintForOccurrences(
  occurrences: Array<{ sourceOccurrenceRef: string; eventId: string; content: RawRecord }>,
): string {
  return hash([...occurrences].sort((left, right) => left.sourceOccurrenceRef.localeCompare(right.sourceOccurrenceRef)).map((occurrence) => ({
    source_occurrence_ref: occurrence.sourceOccurrenceRef,
    event_id: occurrence.eventId,
    content: occurrence.content,
  })));
}

export function projectCoreCalendarSources(events: unknown[]): CoreCalendarSource[] {
  if (!Array.isArray(events) || events.length > 5_000) throw new CalendarSourceError("invalid_calendar_source_projection", "Core 日历来源投影无效。");
  const groups = new Map<string, Array<{ raw: RawRecord; occurrence: CoreCalendarOccurrence }>>();
  for (const value of events) {
    const event = record(value);
    if (!event || !Object.hasOwn(event, "source_occurrence_ref")) continue;
    if (!Array.isArray(event.source_ids) || event.source_ids.length === 0 || event.source_ids.length > 50) {
      throw new CalendarSourceError("invalid_calendar_source_projection", "Core 日历来源身份无效。");
    }
    const rawSourceIds = event.source_ids.map((item) => text(item, 160));
    if (rawSourceIds.some((item) => item === null)
      || rawSourceIds.some((item) => item!.startsWith("calendar-source-") && !SOURCE_ID.test(item!))) {
      throw new CalendarSourceError("invalid_calendar_source_projection", "Core 日历来源身份无效。");
    }
    const uniqueSourceIds = [...new Set(rawSourceIds as string[])];
    const sourceIds = uniqueSourceIds.filter((item) => SOURCE_ID.test(item));
    if (sourceIds.length === 0) continue;
    if (sourceIds.length !== 1 || uniqueSourceIds.length !== 1) {
      throw new CalendarSourceError("invalid_calendar_source_projection", "Core 日历来源身份不唯一。");
    }
    const ref = text(event.source_occurrence_ref, 160);
    const eventId = text(event.event_id, 160);
    const evidenceIds = Array.isArray(event.evidence_ids)
      ? [...new Set(event.evidence_ids.map((item) => text(item, 160)).filter((item): item is string => Boolean(item)))]
      : [];
    if (!ref || !eventId) throw new CalendarSourceError("invalid_calendar_source_projection", "Core 日历来源身份无效。");
    const content = eventContent(event);
    const occurrence = { sourceOccurrenceRef: ref, eventId, contentFingerprint: hash(content), content, evidenceIds };
    const rows = groups.get(sourceIds[0]) || [];
    rows.push({ raw: event, occurrence });
    groups.set(sourceIds[0], rows);
  }
  return [...groups.entries()].map(([sourceId, rows]) => {
    rows.sort((left, right) => left.occurrence.sourceOccurrenceRef.localeCompare(right.occurrence.sourceOccurrenceRef));
    if (new Set(rows.map((item) => item.occurrence.sourceOccurrenceRef)).size !== rows.length
      || new Set(rows.map((item) => item.occurrence.eventId)).size !== rows.length) {
      throw new CalendarSourceError("invalid_calendar_source_projection", "Core 日历来源包含重复事项。");
    }
    const firstName = rows.map((item) => text(item.raw.name, 240)).find(Boolean) || "已导入日历";
    const fingerprint = calendarSourceFingerprintForOccurrences(rows.map((item) => item.occurrence));
    if (!SHA256.test(fingerprint)) throw new CalendarSourceError("invalid_calendar_source_projection", "Core 日历来源指纹无效。");
    return {
      sourceId,
      label: rows.length > 1 ? `${firstName} 等 ${rows.length} 项` : firstName,
      eventCount: rows.length,
      fingerprint,
      occurrences: rows.map((item) => item.occurrence),
    };
  }).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

export function calendarSourceSelectionCandidates(
  sources: CoreCalendarSource[],
  events: Array<RawRecord & { source_occurrence_ref?: string }>,
): CoreCalendarSource[] {
  const refs = new Set(events.flatMap((event) => typeof event.source_occurrence_ref === "string" ? [event.source_occurrence_ref] : []));
  const content = new Set(events.map(calendarOccurrenceContentFingerprint));
  return sources.filter((source) => source.occurrences.some((occurrence) => refs.has(occurrence.sourceOccurrenceRef) || content.has(occurrence.contentFingerprint)));
}

export async function readCoreCalendarSources(signal?: AbortSignal): Promise<CoreCalendarSourceRead> {
  const snapshot = await readEduPiEducationSnapshot({ scheduleOccurrenceVersion: "1.2", signal });
  if (!snapshot.occurrenceProjection) throw new CalendarSourceError("invalid_calendar_source_projection", "Core 日历来源投影不可用。");
  return {
    sources: projectCoreCalendarSources(snapshot.occurrenceProjection.events),
    snapshot: { payload: snapshot.payload, roots: { runtime: snapshot.runtime, dataRoot: snapshot.dataRoot } },
  };
}
