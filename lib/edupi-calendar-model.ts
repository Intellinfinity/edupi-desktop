import type { CalendarFact, EducationContract, TeacherTask } from "./edupi-education-contract";
import { taskDisplayTitle, taskPresentation } from "./edupi-workbench";
import { isRecognizedTimetableNote } from "./edupi-recognition-markers";

export type CalendarViewMode = "day" | "week" | "month";
export type CalendarEntryKind = "calendar" | "task" | "timetable";
export type CalendarEntryStatus = "confirmed" | "pending" | "failed";

export type CalendarItemSelection = {
  kind: CalendarEntryKind;
  sourceId: string | null;
  date: string | null;
  title: string;
  detail: string | null;
  sourceLabel: string;
  statusLabel: string;
};

export type CalendarEntry = {
  id: string;
  sourceId: string | null;
  kind: CalendarEntryKind;
  date: string;
  rangeStart: string;
  rangeEnd: string;
  title: string;
  detail: string | null;
  source: string | null;
  sourceLabel: string;
  sourceIcon: string;
  status: CalendarEntryStatus;
  statusLabel: string;
  allDay: boolean;
  period: number | null;
  dayOfWeek: number | null;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

export type CalendarPendingEntry = {
  id: string;
  sourceId: string | null;
  kind: CalendarEntryKind;
  title: string;
  detail: string | null;
  source: string | null;
  sourceLabel: string;
  sourceIcon: string;
  status: "pending" | "failed";
  statusLabel: string;
  rawDate: string | null;
};

export type CalendarMonthCell = {
  date: string;
  day: number;
  isCurrentMonth: boolean;
  weekNumber: number | null;
};

export type CalendarViewRange = {
  start: string;
  end: string;
};

export type CalendarProjection = {
  anchorDate: string;
  view: CalendarViewMode;
  range: CalendarViewRange;
  monthGrid: CalendarMonthCell[];
  entries: CalendarEntry[];
  entriesByDate: Record<string, CalendarEntry[]>;
  pending: CalendarPendingEntry[];
};

type RecordValue = Record<string, unknown>;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAY_NAMES: Record<string, number> = {
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
  sunday: 7,
  sun: 7,
  周一: 1,
  周二: 2,
  周三: 3,
  周四: 4,
  周五: 5,
  周六: 6,
  周日: 7,
};

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function dateParts(date: Date): [number, number, number] {
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
}

function dateKey(date: Date): string {
  const [year, month, day] = dateParts(date);
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
}

function parseDateInput(value: string | Date): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return utcDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = utcDate(year, month, day);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) return null;
  return parsed;
}

function parseUnknownDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = parseDateInput(value.trim());
  return parsed ? dateKey(parsed) : null;
}

function rawDateValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  return String(value);
}

function firstValue(source: RecordValue, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== null && source[key] !== undefined) return source[key];
  }
  return null;
}

function dateField(source: RecordValue, keys: string[]): { date: string | null; raw: string | null; supplied: boolean } {
  const value = firstValue(source, keys);
  const supplied = value !== null && value !== undefined && value !== "";
  return { date: parseUnknownDate(value), raw: rawDateValue(value), supplied };
}

function localToday(): string {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, "0")}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function parseIsoDate(value: unknown): string | null {
  return parseUnknownDate(value);
}

export function addCalendarDays(value: string | Date, amount: number): string {
  const parsed = parseDateInput(value);
  if (!parsed || !Number.isInteger(amount)) return typeof value === "string" ? value : dateKey(parsed || utcDate(1970, 1, 1));
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return dateKey(parsed);
}

export function startOfWeek(value: string | Date): string {
  const parsed = parseDateInput(value);
  if (!parsed) return typeof value === "string" ? value : localToday();
  const sundayFirstDay = parsed.getUTCDay();
  const mondayOffset = sundayFirstDay === 0 ? -6 : 1 - sundayFirstDay;
  return addCalendarDays(dateKey(parsed), mondayOffset);
}

export function endOfWeek(value: string | Date): string {
  return addCalendarDays(startOfWeek(value), 6);
}

export function startOfMonth(value: string | Date): string {
  const parsed = parseDateInput(value);
  if (!parsed) return typeof value === "string" ? value : localToday();
  return dateKey(utcDate(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 1));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addCalendarMonths(value: string | Date, amount: number): string {
  const parsed = parseDateInput(value);
  if (!parsed || !Number.isInteger(amount)) return typeof value === "string" ? value : localToday();
  const originalDay = parsed.getUTCDate();
  const targetMonth = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + amount, 1));
  const day = Math.min(originalDay, daysInMonth(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1));
  return dateKey(utcDate(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, day));
}

export function expandInclusiveDateRange(start: string, end = start): string[] {
  const first = parseDateInput(start);
  const last = parseDateInput(end);
  if (!first || !last || first.getTime() > last.getTime()) return [];
  const dates: string[] = [];
  const cursor = new Date(first.getTime());
  while (cursor.getTime() <= last.getTime()) {
    dates.push(dateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

const ACADEMIC_WEEK_PATTERN = /第\s*(\d+)\s*周/;

/** Return the explicit academic week whose inclusive calendar range contains the date. */
export function getAcademicWeekNumber(events: readonly CalendarFact[], value: string): number | null {
  const date = parseUnknownDate(value);
  if (!date) return null;
  for (const event of events) {
    const match = ACADEMIC_WEEK_PATTERN.exec(event.name);
    if (!match) continue;
    const source = event as unknown as RecordValue;
    const start = dateField(source, ["date"]).date;
    const end = dateField(source, ["endDate", "end_date"]).date || start;
    if (start && end && end >= start && date >= start && date <= end) return Number(match[1]);
  }
  return null;
}

export function getMonthGrid(value: string | Date, calendar: readonly CalendarFact[] = []): CalendarMonthCell[] {
  const parsed = parseDateInput(value);
  if (!parsed) return [];
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth() + 1;
  const first = startOfWeek(startOfMonth(dateKey(parsed)));
  return Array.from({ length: 42 }, (_, index) => {
    const date = addCalendarDays(first, index);
    const cellDate = parseDateInput(date) as Date;
    return {
      date,
      day: cellDate.getUTCDate(),
      isCurrentMonth: cellDate.getUTCFullYear() === year && cellDate.getUTCMonth() + 1 === month,
      weekNumber: getAcademicWeekNumber(calendar, date),
    };
  });
}

export const monthGrid = getMonthGrid;

export function getCalendarViewRange(view: CalendarViewMode, anchorDate: string | Date): CalendarViewRange {
  const anchor = parseDateInput(anchorDate);
  const fallback = localToday();
  const date = anchor ? dateKey(anchor) : fallback;
  if (view === "day") return { start: date, end: date };
  if (view === "week") return { start: startOfWeek(date), end: endOfWeek(date) };
  const grid = getMonthGrid(date);
  return grid.length > 0
    ? { start: grid[0].date, end: grid[grid.length - 1].date }
    : { start: date, end: date };
}

export function shiftCalendarAnchor(view: CalendarViewMode, anchorDate: string, direction: -1 | 1): string {
  if (view === "day") return addCalendarDays(anchorDate, direction);
  if (view === "week") return addCalendarDays(anchorDate, direction * 7);
  return addCalendarMonths(anchorDate, direction);
}

function dateIsBetween(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function intersectingRange(start: string, end: string, range: CalendarViewRange): { start: string; end: string } | null {
  const clippedStart = start > range.start ? start : range.start;
  const clippedEnd = end < range.end ? end : range.end;
  return clippedStart <= clippedEnd ? { start: clippedStart, end: clippedEnd } : null;
}

function statusLabel(status: CalendarEntryStatus): "已确认" | "待确认" | "正在准备" | "准备失败" {
  if (status === "confirmed") return "已确认";
  if (status === "failed") return "准备失败";
  return "待确认";
}

function calendarStatus(event: CalendarFact): CalendarEntryStatus {
  if (event.confidence === "inferred" || event.preparationStatus === "hold") return "pending";
  return event.preparationStatus === "read_only" || event.confidence === "confirmed" || event.confidence === "teacher_confirmed"
    ? "confirmed"
    : "pending";
}

function calendarSource(event: CalendarFact): { sourceLabel: string; sourceIcon: string } {
  if (event.source === "official_school_calendar") return { sourceLabel: "学校校历", sourceIcon: "校" };
  if (event.source === "teacher") return { sourceLabel: "教师", sourceIcon: "师" };
  if (event.source === "inferred") return { sourceLabel: "推断", sourceIcon: "推" };
  return { sourceLabel: event.type || "校历", sourceIcon: "历" };
}

function taskStatus(task: TeacherTask): CalendarEntryStatus {
  const tone = taskPresentation(task).tone;
  if (tone === "danger") return "failed";
  if (tone === "success") return "confirmed";
  return "pending";
}

function taskStatusLabel(task: TeacherTask): string {
  return taskPresentation(task).label;
}

function taskSource(task: TeacherTask): { sourceLabel: string; sourceIcon: string } {
  if (task.trigger === "student_follow_up") return { sourceLabel: "学生跟进", sourceIcon: "生" };
  if (task.trigger === "teaching_adjustment_candidate") return { sourceLabel: "教学", sourceIcon: "教" };
  return { sourceLabel: "任务", sourceIcon: "任" };
}

function timetableStatus(slot: RecordValue): CalendarEntryStatus {
  return isRecognizedTimetableNote(slot.notes) || slot.confidence === "inferred" || slot.status === "hold" || slot.status === "inferred" || slot.preparationStatus === "hold"
    ? "pending"
    : "confirmed";
}

function timetableSource(slot: RecordValue): { sourceLabel: string; sourceIcon: string } {
  if (isRecognizedTimetableNote(slot.notes)) return { sourceLabel: "材料识别", sourceIcon: "识" };
  const kind = text(firstValue(slot, ["kind", "type"]));
  return { sourceLabel: kind ? `课程表 · ${kind}` : "课程表", sourceIcon: "课" };
}

function valueAsNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function timetableDay(value: unknown): number | null {
  const numeric = valueAsNumber(value);
  if (numeric !== null) return numeric >= 1 && numeric <= 7 ? numeric : null;
  const key = text(value)?.toLocaleLowerCase();
  return key ? WEEKDAY_NAMES[key] || null : null;
}

function timetablePeriod(slot: RecordValue): number | null {
  const period = valueAsNumber(firstValue(slot, ["period", "lesson", "period_number"]));
  return period !== null && period >= 0 ? period : null;
}

function weekdayForDate(value: string): number {
  const parsed = parseDateInput(value) as Date;
  const day = parsed.getUTCDay();
  return day === 0 ? 7 : day;
}

function matchesQuery(title: string, detail: string | null, sourceLabel: string, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return `${title} ${detail || ""} ${sourceLabel}`.toLocaleLowerCase().includes(normalizedQuery);
}

export function filterTimetableSlots(slots: Array<Record<string, unknown>>, query: string): Array<Record<string, unknown>> {
  return slots.filter((value) => {
    const slot = record(value);
    const title = text(slot.subject) || "课程";
    const detail = [text(slot.class_name ?? slot.className), text(slot.notes), text(slot.day_of_week ?? slot.dayOfWeek), text(slot.period)].filter(Boolean).join(" ");
    return matchesQuery(title, detail, "课程表", query);
  });
}

export function isPrimaryTimetableSlot(value: Record<string, unknown>): boolean {
  const slot = record(value);
  const day = Number(slot.day_of_week ?? slot.dayOfWeek);
  const period = Number(slot.period);
  return Number.isInteger(day) && day >= 1 && day <= 5 && Number.isInteger(period) && period >= 1 && period <= 10;
}

function makeEntry(input: Omit<CalendarEntry, "statusLabel">): CalendarEntry {
  return { ...input, statusLabel: statusLabel(input.status) };
}

function makePending(input: Omit<CalendarPendingEntry, "status" | "statusLabel">): CalendarPendingEntry {
  return { ...input, status: "pending", statusLabel: "待确认" };
}

function taskDate(task: TeacherTask): { date: string | null; rawDate: string | null } {
  // A task is placed on its due date first; trigger/source dates are only
  // fallbacks when the earlier field is absent, never when it is malformed.
  for (const key of ["dueDate", "triggerDate", "sourceEventDate"] as const) {
    const field = dateField(task as unknown as RecordValue, [key]);
    if (field.supplied) return { date: field.date, rawDate: field.raw };
  }
  return { date: null, rawDate: null };
}

export function getCalendarEntries(
  data: Pick<EducationContract, "calendar" | "tasks" | "timetable">,
  range: CalendarViewRange,
  query = "",
): { entries: CalendarEntry[]; pending: CalendarPendingEntry[] } {
  const entries: CalendarEntry[] = [];
  const pending: CalendarPendingEntry[] = [];
  const addPending = (item: CalendarPendingEntry) => {
    if (matchesQuery(item.title, item.detail, item.sourceLabel, query)) pending.push(item);
  };

  data.calendar.forEach((event, index) => {
    const startField = dateField(event as unknown as RecordValue, ["date"]);
    const source = calendarSource(event);
    const eventId = event.id || `calendar-${index}`;
    if (!startField.date) {
      addPending(makePending({ id: eventId, sourceId: event.id, kind: "calendar", title: event.name, detail: event.notes, source: event.source, ...source, rawDate: startField.raw }));
      return;
    }
    const endField = dateField(event as unknown as RecordValue, ["endDate", "end_date"]);
    const end = endField.date && endField.date >= startField.date ? endField.date : startField.date;
    const clipped = intersectingRange(startField.date, end, range);
    if (!clipped || !matchesQuery(event.name, event.notes, source.sourceLabel, query)) return;
    for (const date of expandInclusiveDateRange(clipped.start, clipped.end)) {
      entries.push(makeEntry({
        id: `${eventId}:${date}`,
        sourceId: event.id,
        kind: "calendar",
        date,
        rangeStart: startField.date,
        rangeEnd: end,
        title: event.name,
        detail: event.notes,
        source: event.source,
        ...source,
        status: calendarStatus(event),
        allDay: true,
        period: null,
        dayOfWeek: null,
        continuesBefore: date > startField.date,
        continuesAfter: date < end,
      }));
    }
  });

  data.tasks.forEach((task, index) => {
    const taskId = task.id || task.sourceEventId || `task-${index}`;
    const dateInfo = taskDate(task);
    const source = taskSource(task);
    const detail = task.sourceEventName || task.topic || task.student;
    if (!dateInfo.date) {
      addPending({ ...makePending({ id: taskId, sourceId: task.id || task.sourceEventId, kind: "task", title: taskDisplayTitle(task), detail, source: task.sourceEventName, ...source, rawDate: dateInfo.rawDate }), status: taskStatus(task) === "failed" ? "failed" : "pending", statusLabel: taskStatusLabel(task) });
      return;
    }
    if (!dateIsBetween(dateInfo.date, range.start, range.end) || !matchesQuery(task.title, detail, source.sourceLabel, query)) return;
    const entry = makeEntry({
      id: `${taskId}:${dateInfo.date}`,
      sourceId: task.id || task.sourceEventId,
      kind: "task",
      date: dateInfo.date,
      rangeStart: dateInfo.date,
      rangeEnd: dateInfo.date,
      title: taskDisplayTitle(task),
      detail,
      source: task.sourceEventName || task.sourceEventId,
      ...source,
      status: taskStatus(task),
      allDay: true,
      period: null,
      dayOfWeek: null,
      continuesBefore: false,
      continuesAfter: false,
    });
    entries.push({ ...entry, statusLabel: taskStatusLabel(task) });
  });

  data.timetable.forEach((value, index) => {
    const slot = record(value);
    const day = timetableDay(firstValue(slot, ["day_of_week", "dayOfWeek", "weekday", "day"]));
    const period = timetablePeriod(slot);
    const source = timetableSource(slot);
    const title = text(firstValue(slot, ["subject", "name", "title"])) || "课程";
    const detail = text(firstValue(slot, ["class_name", "className", "group", "room"])) || text(firstValue(slot, ["kind", "type"]));
    const slotId = text(firstValue(slot, ["id", "slot_id"])) || `timetable-${index}`;
    if (day === null || period === null) {
      addPending(makePending({ id: slotId, sourceId: text(firstValue(slot, ["id", "slot_id"])), kind: "timetable", title, detail, source: source.sourceLabel, ...source, rawDate: null }));
      return;
    }
    if (!matchesQuery(title, detail, source.sourceLabel, query)) return;
    for (const date of expandInclusiveDateRange(range.start, range.end)) {
      if (weekdayForDate(date) !== day) continue;
      entries.push(makeEntry({
        id: `${slotId}:${date}`,
        sourceId: text(firstValue(slot, ["id", "slot_id"])),
        kind: "timetable",
        date,
        rangeStart: date,
        rangeEnd: date,
        title,
        detail,
        source: source.sourceLabel,
        ...source,
        status: timetableStatus(slot),
        allDay: false,
        period,
        dayOfWeek: day,
        continuesBefore: false,
        continuesAfter: false,
      }));
    }
  });

  entries.sort((left, right) => left.date.localeCompare(right.date)
    || Number(right.allDay) - Number(left.allDay)
    || (left.period ?? Number.MAX_SAFE_INTEGER) - (right.period ?? Number.MAX_SAFE_INTEGER)
    || left.title.localeCompare(right.title, "zh-CN"));
  return { entries, pending };
}

export function createCalendarProjection(
  data: Pick<EducationContract, "calendar" | "tasks" | "timetable">,
  options: { view?: CalendarViewMode; anchorDate?: string; query?: string } = {},
): CalendarProjection {
  const view = options.view || "month";
  const anchorDate = parseUnknownDate(options.anchorDate) || localToday();
  const range = getCalendarViewRange(view, anchorDate);
  const projected = getCalendarEntries(data, range, options.query || "");
  const entriesByDate: Record<string, CalendarEntry[]> = {};
  for (const entry of projected.entries) (entriesByDate[entry.date] ||= []).push(entry);
  return {
    anchorDate,
    view,
    range,
    monthGrid: getMonthGrid(anchorDate, data.calendar),
    entries: projected.entries,
    entriesByDate,
    pending: projected.pending,
  };
}

export const buildCalendarModel = createCalendarProjection;

export function calendarSelectionForSource(
  data: Pick<EducationContract, "calendar" | "tasks" | "timetable">,
  kind: "calendar" | "timetable",
  id: string,
): CalendarItemSelection | null {
  if (kind === "calendar") {
    const event = data.calendar.find((item) => item.id === id);
    if (!event) return null;
    const source = calendarSource(event);
    return {
      kind,
      sourceId: id,
      date: dateField(event as unknown as RecordValue, ["date"]).date,
      title: event.name,
      detail: event.notes,
      sourceLabel: source.sourceLabel,
      statusLabel: statusLabel(calendarStatus(event)),
    };
  }
  const slot = data.timetable.map(record).find((item) => text(firstValue(item, ["id", "slot_id"])) === id);
  if (!slot) return null;
  const source = timetableSource(slot);
  const day = timetableDay(firstValue(slot, ["day_of_week", "dayOfWeek", "weekday", "day"]));
  const period = timetablePeriod(slot);
  const className = text(firstValue(slot, ["class_name", "className", "group", "room"]));
  return {
    kind,
    sourceId: id,
    date: null,
    title: text(firstValue(slot, ["subject", "name", "title"])) || "课程",
    detail: [day === null ? null : `周${day}`, period === null ? null : `第 ${period} 节`, className].filter(Boolean).join(" · ") || null,
    sourceLabel: source.sourceLabel,
    statusLabel: statusLabel(timetableStatus(slot)),
  };
}

export function calendarSelectionFromLink(
  data: Pick<EducationContract, "calendar" | "tasks" | "timetable">,
  link: { kind: string | null; id: string | null; date: string | null },
): CalendarItemSelection | null {
  if (!link.id || !parseIsoDate(link.date) || (link.kind !== "calendar" && link.kind !== "timetable")) return null;
  const entry = createCalendarProjection(data, { view: "day", anchorDate: link.date! }).entries.find(item => item.kind === link.kind && item.sourceId === link.id);
  return entry ? { kind: entry.kind, sourceId: entry.sourceId, date: entry.date, title: entry.title, detail: entry.detail, sourceLabel: entry.sourceLabel, statusLabel: entry.statusLabel } : null;
}
