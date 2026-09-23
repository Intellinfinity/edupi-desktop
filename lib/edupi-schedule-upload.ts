import crypto from "node:crypto";

type RawRecord = Record<string, unknown>;

export const MANUAL_CALENDAR_ISSUER = "desktop-calendar-manual-v1";

function normalizedScheduleText(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase() : "";
}

function stableScheduleToken(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex").slice(0, 32);
}

function canonicalScheduleValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalScheduleValue);
  if (!value || typeof value !== "object") return typeof value === "string" ? normalizedScheduleText(value) : value;
  return Object.fromEntries(Object.keys(value as RawRecord).sort().map((key) => [key, canonicalScheduleValue((value as RawRecord)[key])]));
}

function canonicalScheduleList(values: readonly RawRecord[]): RawRecord[] {
  return values.map((value) => canonicalScheduleValue(value) as RawRecord).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function stableCalendarEventId(value: { date?: unknown; endDate?: unknown; name?: unknown; type?: unknown }): string {
  return `calendar-event-${stableScheduleToken({
    date: normalizedScheduleText(value.date),
    end_date: normalizedScheduleText(value.endDate),
    name: normalizedScheduleText(value.name),
    type: normalizedScheduleText(value.type),
  })}`;
}

export function stableOccurrenceCalendarEventId(issuer: unknown, sourceOccurrenceRef: unknown): string {
  const normalizedIssuer = typeof issuer === "string" ? issuer.normalize("NFKC").trim() : "";
  const normalizedRef = typeof sourceOccurrenceRef === "string" ? sourceOccurrenceRef.normalize("NFKC").trim() : "";
  if (!normalizedIssuer || !normalizedRef) throw new Error("Occurrence identity is unavailable");
  return `calendar-occurrence-${stableScheduleToken({ issuer: normalizedIssuer, source_occurrence_ref: normalizedRef })}`;
}

export function stableFileScheduleIssuer(originalName: unknown, sourceHash?: unknown): string {
  const normalizedName = normalizedScheduleText(originalName);
  if (!normalizedName) throw new Error("Schedule file identity is unavailable");
  const normalizedHash = typeof sourceHash === "string" && /^sha256:[a-f0-9]{64}$/u.test(sourceHash) ? sourceHash : null;
  const identity = normalizedHash ? { source_hash: normalizedHash } : { original_name: normalizedName };
  return `desktop-file-schedule-${stableScheduleToken(identity).slice(0, 24)}`;
}

export function stableRecognizedCalendarEventId(value: { date?: unknown; endDate?: unknown; name?: unknown; type?: unknown; notes?: unknown }): string {
  return `${stableCalendarEventId(value)}-${stableScheduleToken({ notes: normalizedScheduleText(value.notes) }).slice(0, 16)}`;
}

export function stableTimetableSlotId(value: { dayOfWeek?: unknown; period?: unknown; subject?: unknown; className?: unknown; kind?: unknown }): string {
  return `timetable-slot-${stableScheduleToken({
    day_of_week: value.dayOfWeek,
    period: value.period,
    subject: normalizedScheduleText(value.subject),
    class_name: normalizedScheduleText(value.className),
    kind: normalizedScheduleText(value.kind),
  })}`;
}

export function stableRecognizedTimetableSlotId(value: { dayOfWeek?: unknown; period?: unknown; subject?: unknown; className?: unknown; kind?: unknown; notes?: unknown }): string {
  return `${stableTimetableSlotId(value)}-${stableScheduleToken({ notes: normalizedScheduleText(value.notes) }).slice(0, 16)}`;
}

export function stableScheduleSourceHash(values: readonly RawRecord[]): string {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonicalScheduleList(values)), "utf8").digest("hex")}`;
}
