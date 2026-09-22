import { EducationIntakeError, type CalendarImportEvent, type EducationIntakeCommand } from "./edupi-education-intake";
import { MANUAL_CALENDAR_ISSUER, stableCalendarEventId, stableOccurrenceCalendarEventId, stableScheduleSourceHash } from "./edupi-schedule-upload";

type RawRecord = Record<string, unknown>;

const CALENDAR_TYPES = new Set(["exam", "activity", "meeting", "holiday", "festival", "teaching", "custom"]);
const CALENDAR_CONFIDENCE = new Set(["confirmed", "teacher_confirmed", "inferred"]);
const OFFSET_TIME = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d[+-](?:(?:0\d|1[0-4]):[0-5]\d)$/;
const TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+/-]{0,99}$/;

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function exactKeys(value: RawRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || value.length > max) throw new EducationIntakeError("invalid_envelope", "导入字段无效。");
  return value.trim() || null;
}

function requiredText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new EducationIntakeError("invalid_envelope", "导入字段无效。");
  return value.trim();
}

function occurrenceInterval(value: unknown): CalendarImportEvent["time_interval"] | undefined {
  if (value === undefined || value === null) return undefined;
  const interval = record(value);
  if (!interval || !exactKeys(interval, ["start", "end", "timeZone"])) throw new EducationIntakeError("invalid_envelope", "日程时间字段无效。");
  const start = requiredText(interval.start, 22);
  const end = requiredText(interval.end, 22);
  const timeZone = requiredText(interval.timeZone, 100);
  if (!OFFSET_TIME.test(start) || !OFFSET_TIME.test(end) || !TIME_ZONE.test(timeZone)) throw new EducationIntakeError("invalid_envelope", "日程时间字段无效。");
  return { start, end, time_zone: timeZone };
}

export function parseCalendarIntakeCommand(body: RawRecord): EducationIntakeCommand {
  if (!exactKeys(body, ["kind", "events"]) || !Array.isArray(body.events) || body.events.length === 0 || body.events.length > 200) {
    throw new EducationIntakeError("invalid_envelope", "校历导入必须包含 1—200 个事件。");
  }
  const events: CalendarImportEvent[] = body.events.map((value) => {
    const item = record(value);
    if (!item || !exactKeys(item, ["eventId", "date", "endDate", "name", "type", "confidence", "notes", "sourceOccurrenceRef", "timeInterval", "location"])) throw new EducationIntakeError("invalid_envelope", "校历事件字段无效。");
    const type = requiredText(item.type, 40);
    const confidence = item.confidence === undefined ? "teacher_confirmed" : requiredText(item.confidence, 40);
    if (!CALENDAR_TYPES.has(type) || !CALENDAR_CONFIDENCE.has(confidence)) throw new EducationIntakeError("invalid_envelope", "校历事件类型无效。");
    const sourceOccurrenceRef = optionalText(item.sourceOccurrenceRef, 160);
    if (item.sourceOccurrenceRef !== undefined && item.sourceOccurrenceRef !== null && !sourceOccurrenceRef) throw new EducationIntakeError("invalid_envelope", "日程身份无效。");
    const timeInterval = occurrenceInterval(item.timeInterval);
    const location = optionalText(item.location, 240);
    if ((timeInterval || location) && !sourceOccurrenceRef) throw new EducationIntakeError("invalid_envelope", "时间和地点必须绑定稳定日程身份。");
    return {
      event_id: typeof item.eventId === "string" && item.eventId.trim() ? requiredText(item.eventId, 160)
        : sourceOccurrenceRef ? stableOccurrenceCalendarEventId(MANUAL_CALENDAR_ISSUER, sourceOccurrenceRef) : stableCalendarEventId(item),
      date: typeof item.date === "string" ? item.date.trim().slice(0, 32) : "",
      end_date: optionalText(item.endDate, 32) ?? null,
      name: requiredText(item.name, 240),
      type: type as CalendarImportEvent["type"],
      confidence: confidence as CalendarImportEvent["confidence"],
      notes: optionalText(item.notes, 1000) ?? null,
      ...(sourceOccurrenceRef ? { source_occurrence_ref: sourceOccurrenceRef } : {}),
      ...(timeInterval ? { time_interval: timeInterval } : {}),
      ...(sourceOccurrenceRef && item.location !== undefined ? { location: location ?? null } : {}),
    };
  });
  const hash = stableScheduleSourceHash(events as unknown as RawRecord[]);
  const token = hash.slice("sha256:".length, "sha256:".length + 24);
  const occurrenceBound = events.some((event) => event.source_occurrence_ref !== undefined);
  return { command_type: "import_calendar", source: { source_id: occurrenceBound ? MANUAL_CALENDAR_ISSUER : `desktop-calendar-${token}`,
    source_kind: "teacher_message", source_hash: hash, evidence_ids: [`calendar-evidence-${token}`] }, events };
}
