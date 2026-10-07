import type { CalendarFact, EducationContract, EducationWorkCandidate, EducationWorkCase, TeacherTask } from "./edupi-education-contract";
import type { TaskSessionBinding } from "./edupi-task-sessions";
import type { Reminder } from "./edupi-reminder-store";

export const DEFAULT_FOREGROUND_GRACE_DAYS = 3;
export const FOREGROUND_PAGE_SIZE = 10;
export const EDUCATION_TIME_ZONE = "Asia/Shanghai";

export type ForegroundPolicy = { today: string; graceDays: number; pinnedTaskIds?: readonly string[] };
export type ForegroundContext = {
  tasks?: readonly TeacherTask[];
  calendar?: readonly CalendarFact[];
  taskSessions?: Record<string, TaskSessionBinding>;
  workCases?: readonly EducationWorkCase[];
  workCandidates?: readonly EducationWorkCandidate[];
};

export function dateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

export function shanghaiDate(value: Date | string = new Date()): string | null {
  if (typeof value === "string" && dateOnly(value)) return value;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: EDUCATION_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(parsed);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function transactionDate(value: unknown): string | null {
  const plain = dateOnly(value);
  if (plain) return plain;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    || !dateOnly(value.slice(0, 10))) return null;
  return shanghaiDate(value);
}

export function normalizeGraceDays(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(365, Math.trunc(value))) : DEFAULT_FOREGROUND_GRACE_DAYS;
}

function ordinal(value: string | null | undefined): number | null {
  const date = transactionDate(value);
  return date ? Date.parse(`${date}T00:00:00Z`) / 86_400_000 : null;
}

/** Unknown dates stay visible; age is measured by Shanghai calendar days. */
export function isForegroundDate(value: string | null | undefined, policy: ForegroundPolicy): boolean {
  const day = ordinal(value);
  const today = ordinal(policy.today);
  return day === null || today === null || today - day <= normalizeGraceDays(policy.graceDays);
}

export function calendarReferenceDate(event: CalendarFact): string | null {
  return (event.endsAt ? shanghaiDate(event.endsAt) : null) || dateOnly(event.endDate) || dateOnly(event.date);
}

export function calendarSortDate(event: CalendarFact, today: string): string | null {
  const start = dateOnly(event.date);
  const end = calendarReferenceDate(event);
  return start && end && start <= today && end >= today ? today : end && end < today ? end : start || end;
}

export function taskReferenceDate(task: TeacherTask, context: ForegroundContext = {}): string | null {
  const occurrenceTask = task.trigger === "teaching_before_class" || /calendar|festival|holiday|exam_preparation|activity_preparation|meeting_preparation|teaching_node/.test(task.trigger || "");
  if (occurrenceTask) {
    const source = context.calendar?.find(event => event.id && event.id === task.sourceEventId);
    const actual = (source ? calendarReferenceDate(source) : null) || dateOnly(task.evidence?.source_event_end_date) || dateOnly(task.sourceEventDate);
    // A changed teacher deadline may extend old work. A title-only edit must
    // still preserve a future lesson whose preparation deadline is earlier.
    const deadline = dateOnly(task.dueDate);
    if (task.status === "modified" && deadline && (!actual || deadline > actual)) return deadline;
    return actual || deadline || dateOnly(task.triggerDate);
  }
  return dateOnly(task.dueDate) || dateOnly(task.triggerDate);
}

export function isTaskRunning(task: TeacherTask, context: ForegroundContext = {}): boolean {
  const content = task.contentStatus?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return content === "running" || content === "generating" || content === "queued"
    || Boolean(task.id && context.taskSessions?.[task.id]?.status === "running")
    || Boolean(task.id && context.workCases?.some(work => work.taskId === task.id && (work.currentState === "running" || work.currentState === "queued")));
}

export function isTaskForeground(task: TeacherTask, policy: ForegroundPolicy, context: ForegroundContext = {}): boolean {
  if (task.id && policy.pinnedTaskIds?.includes(task.id) || isTaskRunning(task, context)) return true;
  if (isRecordedTaskDone(task, context)) {
    const completion = taskCompletionTime(task, context);
    return isForegroundDate(completion === null ? null : shanghaiDate(new Date(completion)), policy);
  }
  const candidate = context.workCandidates?.find(item => item.taskId === task.id);
  const rescheduled = transactionDate(candidate?.snoozeUntil);
  return isForegroundDate(rescheduled || taskReferenceDate(task, context), policy);
}

export function isCandidateForeground(candidate: EducationWorkCandidate, policy: ForegroundPolicy, context: ForegroundContext = {}): boolean {
  if (policy.pinnedTaskIds?.includes(candidate.taskId)) return true;
  const task = context.tasks?.find(item => item.id === candidate.taskId);
  if (task && isTaskRunning(task, context)) return true;
  if (["accepted", "modified", "rejected", "suppressed"].includes(candidate.status)) {
    const completion = candidateCompletionTime(candidate, context);
    return isForegroundDate(completion === null ? null : shanghaiDate(new Date(completion)), policy);
  }
  const reference = transactionDate(candidate.snoozeUntil) || (task ? taskReferenceDate(task, context) : null) || transactionDate(candidate.dueAt);
  return isForegroundDate(reference, policy);
}

/** Today first, then nearest dates; on a tie upcoming work precedes past work. */
export function compareForegroundDates(left: string | null, right: string | null, today: string): number {
  const l = ordinal(left);
  const r = ordinal(right);
  const current = ordinal(today);
  if (l === null || r === null) return Number(l === null) - Number(r === null);
  if (current === null) return l - r;
  return Math.abs(l - current) - Math.abs(r - current) || Number(l < current) - Number(r < current) || l - r;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/T/.test(value) || !transactionDate(value)) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

export function reminderReferenceDate(item: Reminder, context: ForegroundContext & Partial<Pick<EducationContract, "continuity">> = {}): string | null {
  const task = context.tasks?.find(row => row.id === item.taskId);
  if (task) return taskReferenceDate(task, context);
  const document = item.kind === "brief" ? context.continuity?.documents.find(row => `document:${row.id}` === item.taskId) : null;
  if (document?.date) return transactionDate(document.date);
  const dailyId = item.kind === "brief" ? item.taskId.match(/^document:daily:(\d{4}-\d{2}-\d{2})$/)?.[1] : null;
  return transactionDate(dailyId) || (item.kind === "due" ? transactionDate(item.identity?.replace(/^due:/, "")) : null);
}

export function isReminderForeground(item: Reminder, policy: ForegroundPolicy, context: ForegroundContext & Partial<Pick<EducationContract, "continuity">> = {}): boolean {
  const rescheduled = transactionDate(item.snoozedUntil);
  if (rescheduled && rescheduled >= policy.today) return true;
  const task = context.tasks?.find(row => row.id === item.taskId);
  if (task) return isTaskForeground(task, policy, context);
  return isForegroundDate(reminderReferenceDate(item, context), policy);
}

export function compareForegroundReminders(left: Reminder, right: Reminder, policy: ForegroundPolicy, context: ForegroundContext & Partial<Pick<EducationContract, "continuity">> = {}, useSnooze = false): number {
  const reference = (item: Reminder) => (useSnooze ? transactionDate(item.snoozedUntil) : null) || reminderReferenceDate(item, context);
  return compareForegroundDates(reference(left), reference(right), policy.today)
    || String(right.createdAt || "").localeCompare(String(left.createdAt || "")) || left.id.localeCompare(right.id);
}

function isRecordedTaskDone(task: TeacherTask, context: ForegroundContext): boolean {
  const review = timestamp(task.reviewedAt);
  const board = timestamp(task.boardUpdatedAt);
  if (task.boardStage && task.boardRevision > 0 && (review === null || board !== null && board >= review)) return task.boardStage === "done";
  if (task.status === "accepted" || task.status === "modified" || task.status === "rejected") return true;
  const candidate = context.workCandidates?.find(item => item.taskId === task.id);
  if (candidate && ["accepted", "modified", "rejected", "suppressed"].includes(candidate.status)) return true;
  return task.boardStage === "done" || context.workCases?.some(work => work.taskId === task.id && work.currentState === "completed") === true;
}

export function taskCompletionTime(task: TeacherTask, context: ForegroundContext = {}): number | null {
  const times = [timestamp(task.evidence?.completed_at), timestamp(task.reviewedAt)];
  const candidate = context.workCandidates?.find(item => item.taskId === task.id);
  if (candidate && ["accepted", "modified", "rejected", "suppressed"].includes(candidate.status)) times.push(timestamp(candidate.teacherReview?.reviewedAt));
  if (task.boardStage === "done" && task.boardRevision > 0) times.push(timestamp(task.boardUpdatedAt));
  const work = context.workCases?.find(item => item.taskId === task.id);
  if (work?.currentState === "completed" || work?.currentState === "accepted" || work?.currentState === "modified") {
    times.push(...work.transitions.filter(transition => transition.state === "accepted" || transition.state === "modified").map(transition => timestamp(transition.occurredAt)));
  }
  const known = times.filter((value): value is number => value !== null);
  return known.length ? Math.max(...known) : null;
}

export function candidateCompletionTime(candidate: EducationWorkCandidate, context: ForegroundContext = {}): number | null {
  const times = [timestamp(candidate.teacherReview.reviewedAt)];
  const task = context.tasks?.find(item => item.id === candidate.taskId);
  if (task && isRecordedTaskDone(task, context)) times.push(taskCompletionTime(task, context));
  const known = times.filter((value): value is number => value !== null);
  return known.length ? Math.max(...known) : null;
}

export function compareCompletionTimes(left: number | null, right: number | null): number {
  if (left === null || right === null) return Number(left === null) - Number(right === null);
  return right - left;
}

// State Council 2026 holiday notice, published 2025-11-04:
// https://www.beijing.gov.cn/fuwu/bmfw/sy/jrts/202511/t20251104_4258838.html
export const OFFICIAL_HOLIDAYS_2026 = [
  ["2026-01-01", "2026-01-03"], ["2026-02-15", "2026-02-23"], ["2026-04-04", "2026-04-06"],
  ["2026-05-01", "2026-05-05"], ["2026-06-19", "2026-06-21"], ["2026-09-25", "2026-09-27"], ["2026-10-01", "2026-10-07"],
] as const;
export const OFFICIAL_MAKEUP_DAYS_2026 = ["2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20", "2026-10-10"];

export function isRegularTeachingDate(date: string, calendar: readonly CalendarFact[] = []): boolean {
  if (OFFICIAL_HOLIDAYS_2026.some(([start, end]) => date >= start && date <= end) || OFFICIAL_MAKEUP_DAYS_2026.includes(date)) return false;
  return !calendar.some(event => event.type === "holiday" && (event.confidence === "confirmed" || event.confidence === "teacher_confirmed")
    && dateOnly(event.date) && date >= event.date! && date <= (dateOnly(event.endDate) || event.date!));
}

export function paginateForeground<T>(rows: readonly T[], requestedPage: number, pageSize = FOREGROUND_PAGE_SIZE): { rows: T[]; page: number; pages: number; total: number } {
  const size = Math.max(1, Math.min(FOREGROUND_PAGE_SIZE, Math.trunc(pageSize) || FOREGROUND_PAGE_SIZE));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.max(0, Math.min(pages - 1, Math.trunc(requestedPage) || 0));
  return { rows: rows.slice(page * size, (page + 1) * size), page, pages, total: rows.length };
}
