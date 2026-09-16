"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { EducationContract, EducationEntityDeleteKind, TeacherTask } from "@/lib/edupi-education-contract";
import { visibleTimetableNote } from "@/lib/edupi-recognition-markers";
import { taskDisplayTitle } from "@/lib/edupi-workbench";
import {
  addCalendarDays,
  createCalendarProjection,
  filterTimetableSlots,
  getCalendarViewRange,
  parseIsoDate,
  shiftCalendarAnchor,
  type CalendarEntry,
  type CalendarItemSelection,
  type CalendarPendingEntry,
  type CalendarProjection,
  type CalendarViewMode,
} from "@/lib/edupi-calendar-model";
import { EduPiTimetableGrid } from "./EduPiTimetableGrid";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import { intakeOperationHistory } from "@/lib/edupi-operation-history";
import { EduPiOperationHistory } from "./EduPiOperationHistory";
import { EduPiIconButton } from "./EduPiActionIcon";

type Props = {
  data: EducationContract;
  query: string;
  onUpload: () => void;
  intakeBusy: boolean;
  selection: CalendarItemSelection | null;
  onSelect: (selection: CalendarItemSelection | null) => void;
  onTaskDetail: (task: TeacherTask) => void;
  onImportCalendar: (event: { eventId: string | null; date: string; endDate: string | null; name: string; type: string; notes: string | null }) => Promise<void>;
  onImportTimetable: (slot: { slotId: string | null; dayOfWeek: number; period: number; subject: string; className: string | null; kind: "class" | "routine"; notes: string | null }) => Promise<void>;
  onDeleteEntity: (kind: EducationEntityDeleteKind, id: string, label: string) => Promise<boolean>;
};

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const VIEW_LABELS: Array<{ mode: CalendarViewMode; label: string; shortcut: string }> = [
  { mode: "day", label: "日", shortcut: "1" },
  { mode: "week", label: "周", shortcut: "2" },
  { mode: "month", label: "月", shortcut: "3" },
];
type CalendarContentMode = "summary" | "calendar" | "timetable";
const CONTENT_LABELS: Array<{ mode: CalendarContentMode; label: string }> = [
  { mode: "summary", label: "汇总" },
  { mode: "calendar", label: "校历" },
  { mode: "timetable", label: "课程表" },
];

function filterProjection(projection: CalendarProjection, contentMode: CalendarContentMode): CalendarProjection {
  if (contentMode === "summary") return projection;
  const entries = projection.entries.filter((entry) => entry.kind === contentMode);
  const entriesByDate = Object.fromEntries(Object.entries(projection.entriesByDate).map(([date, items]) => [date, items.filter((entry) => entry.kind === contentMode)]));
  return {
    ...projection,
    entries,
    entriesByDate,
    pending: projection.pending.filter((entry) => entry.kind === contentMode),
  };
}

function localIsoDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateParts(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function weekdayIndex(value: string): number {
  const { year, month, day } = dateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  const sundayFirstDay = date.getUTCDay();
  return sundayFirstDay === 0 ? 6 : sundayFirstDay - 1;
}

function readableDate(value: string, weekday = true): string {
  const { year, month, day } = dateParts(value);
  return `${year}年${month}月${day}日${weekday ? ` 星期${WEEKDAY_LABELS[weekdayIndex(value)]}` : ""}`;
}

function periodTitle(view: CalendarViewMode, anchorDate: string): string {
  const range = getCalendarViewRange(view, anchorDate);
  if (view === "day") return readableDate(range.start);
  if (view === "month") {
    const { year, month } = dateParts(anchorDate);
    return `${year}年${month}月`;
  }
  const start = dateParts(range.start);
  const end = dateParts(range.end);
  const startLabel = `${start.year}年${start.month}月${start.day}日`;
  const endLabel = start.year === end.year && start.month === end.month
    ? `${end.day}日`
    : start.year === end.year
      ? `${end.month}月${end.day}日`
      : `${end.year}年${end.month}月${end.day}日`;
  return `${startLabel} — ${endLabel}`;
}

function entryClass(entry: CalendarEntry): string {
  return `edupi-calendar-entry edupi-calendar-entry--${entry.kind} edupi-calendar-entry--${entry.status}${entry.continuesBefore ? " is-continuation-before" : ""}${entry.continuesAfter ? " is-continuation-after" : ""}`;
}

function selectionForEntry(entry: CalendarEntry | CalendarPendingEntry): CalendarItemSelection {
  return {
    kind: entry.kind,
    sourceId: entry.sourceId,
    date: "date" in entry ? entry.date : null,
    title: entry.title,
    detail: entry.detail,
    sourceLabel: entry.sourceLabel,
    statusLabel: entry.statusLabel,
  };
}

function taskDateForCalendar(task: TeacherTask): string | null {
  return task.dueDate || task.triggerDate || task.sourceEventDate;
}

function taskForCalendarEntry(tasks: TeacherTask[], entry: CalendarEntry | CalendarPendingEntry): TeacherTask | null {
  if (entry.kind !== "task") return null;
  if (entry.sourceId) {
    const byId = tasks.find((task) => task.id === entry.sourceId || task.sourceEventId === entry.sourceId);
    if (byId) return byId;
  }
  const entryDate = "date" in entry ? entry.date : null;
  return tasks.find((task) => taskDisplayTitle(task) === entry.title
    && (entryDate === null || taskDateForCalendar(task) === entryDate)
    && (!entry.detail || task.sourceEventName === entry.detail || task.topic === entry.detail || task.student === entry.detail)) || null;
}

function CalendarEntryLine({ entry, compact = false, continued = false, selected = false, onSelect, onTaskDetail }: { entry: CalendarEntry; compact?: boolean; continued?: boolean; selected?: boolean; onSelect: (selection: CalendarItemSelection) => void; onTaskDetail: (entry: CalendarEntry) => void }) {
  const title = entry.kind === "timetable" ? `第 ${entry.period ?? "-"} 节 · ${entry.title}` : entry.title;
  return (
    <button type="button" className={`${entryClass(entry)}${compact ? " is-compact" : ""}${continued ? " is-continued" : ""}${selected ? " is-selected" : ""}`} title={`${title} · ${entry.sourceLabel} · ${entry.statusLabel}`} onClick={() => entry.kind === "task" ? onTaskDetail(entry) : onSelect({ kind: entry.kind, sourceId: entry.sourceId, date: entry.date, title: entry.title, detail: entry.detail, sourceLabel: entry.sourceLabel, statusLabel: entry.statusLabel })} aria-label={`查看${title}详情`} aria-pressed={selected}>
      <span className="edupi-calendar-entry__source" aria-hidden="true">{entry.sourceIcon}</span>
      <span className="edupi-calendar-entry__body">
        <strong>{title}</strong>
        {!compact && entry.detail ? <small>{entry.detail}</small> : null}
      </span>
      <span className="edupi-calendar-entry__source-label">{entry.sourceLabel}</span>
      <em>{entry.statusLabel}</em>
    </button>
  );
}

function entrySelected(entry: CalendarEntry, selection: CalendarItemSelection | null): boolean {
  return Boolean(selection && selection.kind === entry.kind && selection.sourceId === entry.sourceId && (selection.date === null || selection.date === entry.date));
}

function MonthView({ projection, anchorDate, selection, onSelectDate, onSelect, onTaskDetail }: { projection: ReturnType<typeof createCalendarProjection>; anchorDate: string; selection: CalendarItemSelection | null; onSelectDate: (date: string) => void; onSelect: (selection: CalendarItemSelection) => void; onTaskDetail: (entry: CalendarEntry) => void }) {
  return (
    <section className="edupi-calendar-month" aria-label="月视图">
      <div className="edupi-calendar-weekdays" aria-hidden="true">{WEEKDAY_LABELS.map((label) => <span key={label}>周{label}</span>)}</div>
      <div className="edupi-calendar-month-grid" role="grid" aria-label="月日程网格">
        {projection.monthGrid.map((cell) => {
          const entries = projection.entriesByDate[cell.date] || [];
          const visibleEntries = entries.slice(0, 3);
          return (
            <div className={`edupi-calendar-month-cell${cell.isCurrentMonth ? "" : " is-outside"}${cell.date === anchorDate ? " is-selected" : ""}`} key={cell.date} role="gridcell" aria-label={`${readableDate(cell.date, false)}${cell.weekNumber === null ? "" : `，第${cell.weekNumber}周`}，${entries.length} 项日程`}>
              {weekdayIndex(cell.date) === 0 && cell.weekNumber !== null ? <span className="edupi-calendar-month-cell__week">第{cell.weekNumber}周</span> : null}
              <button type="button" className="edupi-calendar-month-cell__date" onClick={() => onSelectDate(cell.date)} aria-label={`查看 ${readableDate(cell.date)}`} aria-current={cell.date === localIsoDate() ? "date" : undefined}>{cell.day}</button>
              <div className="edupi-calendar-month-cell__entries">
                {visibleEntries.map((entry) => <CalendarEntryLine compact={entry.kind !== "task"} continued={entry.continuesBefore && weekdayIndex(cell.date) !== 0} key={entry.id} entry={entry} selected={entrySelected(entry, selection)} onSelect={onSelect} onTaskDetail={onTaskDetail} />)}
                {entries.length > visibleEntries.length ? <span className="edupi-calendar-more">+{entries.length - visibleEntries.length}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WeekView({ projection, selection, onSelectDate, onSelect, onTaskDetail }: { projection: ReturnType<typeof createCalendarProjection>; selection: CalendarItemSelection | null; onSelectDate: (date: string) => void; onSelect: (selection: CalendarItemSelection) => void; onTaskDetail: (entry: CalendarEntry) => void }) {
  const dates = Array.from({ length: 7 }, (_, index) => addCalendarDays(projection.range.start, index));
  return (
    <section className="edupi-calendar-week" aria-label="周视图">
      <div className="edupi-calendar-week-grid" role="grid" aria-label="周一至周日日程">
        {dates.map((date) => {
          const entries = projection.entriesByDate[date] || [];
          const allDayEntries = entries.filter((entry) => entry.allDay);
          const timetableEntries = entries.filter((entry) => !entry.allDay);
          const parts = dateParts(date);
          return (
            <div className="edupi-calendar-week-column" key={date} role="gridcell" aria-label={`${readableDate(date)}，${entries.length} 项日程`}>
              <header>
                <button type="button" onClick={() => onSelectDate(date)} aria-label={`查看 ${readableDate(date)}`} aria-current={date === localIsoDate() ? "date" : undefined}><span>周{WEEKDAY_LABELS[weekdayIndex(date)]}</span><strong>{parts.day}</strong></button>
                <small>{entries.length ? `${entries.length} 项` : "空"}</small>
              </header>
              <div className="edupi-calendar-week-column__all-day" aria-label={`${readableDate(date, false)}全天事项`}>
                {allDayEntries.map((entry) => <CalendarEntryLine key={entry.id} entry={entry} selected={entrySelected(entry, selection)} onSelect={onSelect} onTaskDetail={onTaskDetail} />)}
              </div>
              <div className="edupi-calendar-week-column__lessons" aria-label={`${readableDate(date, false)}课程表`}>
                {timetableEntries.map((entry) => <CalendarEntryLine key={entry.id} entry={entry} selected={entrySelected(entry, selection)} onSelect={onSelect} onTaskDetail={onTaskDetail} />)}
              </div>
              {entries.length === 0 ? <div className="edupi-calendar-empty-cell">暂无安排</div> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DayView({ projection, selection, onSelect, onTaskDetail }: { projection: ReturnType<typeof createCalendarProjection>; selection: CalendarItemSelection | null; onSelect: (selection: CalendarItemSelection) => void; onTaskDetail: (entry: CalendarEntry) => void }) {
  const entries = projection.entriesByDate[projection.range.start] || [];
  const allDayEntries = entries.filter((entry) => entry.allDay);
  const timetableEntries = entries.filter((entry) => !entry.allDay);
  return (
    <section className="edupi-calendar-day" aria-label="日视图">
      <div className="edupi-calendar-day__summary"><strong>{readableDate(projection.range.start)}</strong><span>{entries.length ? `${entries.length} 项安排` : "暂无安排"}</span></div>
      <div className="edupi-calendar-day__agenda">
        <section aria-labelledby="edupi-calendar-day-all-day"><h2 id="edupi-calendar-day-all-day">全天事项</h2>{allDayEntries.length ? allDayEntries.map((entry) => <CalendarEntryLine key={entry.id} entry={entry} selected={entrySelected(entry, selection)} onSelect={onSelect} onTaskDetail={onTaskDetail} />) : <p>暂无校历或任务</p>}</section>
        <section aria-labelledby="edupi-calendar-day-lessons"><h2 id="edupi-calendar-day-lessons">课程表</h2>{timetableEntries.length ? timetableEntries.map((entry) => <CalendarEntryLine key={entry.id} entry={entry} selected={entrySelected(entry, selection)} onSelect={onSelect} onTaskDetail={onTaskDetail} />) : <p>暂无课程安排</p>}</section>
      </div>
    </section>
  );
}

function PendingInbox({ projection, selection, onSelect, onTaskDetail }: { projection: ReturnType<typeof createCalendarProjection>; selection: CalendarItemSelection | null; onSelect: (selection: CalendarItemSelection) => void; onTaskDetail: (entry: CalendarPendingEntry) => void }) {
  if (projection.pending.length === 0) return null;
  return (
    <section className="edupi-calendar-pending" aria-labelledby="edupi-calendar-pending-title">
      <header><div><span>待确认</span><h2 id="edupi-calendar-pending-title">日期待确认</h2></div><small>{projection.pending.length} 项</small></header>
      <div className="edupi-calendar-pending__list">{projection.pending.map((entry) => { const selected = Boolean(selection && selection.kind === entry.kind && selection.sourceId === entry.sourceId); return <button type="button" className={`edupi-calendar-pending__row${entry.status === "failed" ? " is-failed" : ""}${selected ? " is-selected" : ""}`} key={`${entry.kind}:${entry.id}`} onClick={() => entry.kind === "task" ? onTaskDetail(entry) : onSelect(selectionForEntry(entry))} aria-pressed={selected}><span className="edupi-calendar-entry__source" aria-hidden="true">{entry.sourceIcon}</span><span><strong>{entry.title}</strong>{entry.detail ? <small>{entry.detail}</small> : null}</span><span>{entry.sourceLabel}</span><em>{entry.statusLabel}</em></button>; })}</div>
    </section>
  );
}

function rawRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rawText(value: unknown): string | null {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean).join("、") || null;
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const calendarTypeLabels: Record<string, string> = { exam: "考试", activity: "活动", meeting: "会议", holiday: "假期", festival: "节日", teaching: "教学节点", custom: "日程" };
type NonTaskCalendarSelection = Omit<CalendarItemSelection, "kind"> & { kind: "calendar" | "timetable" };

function isNonTaskSelection(selection: CalendarItemSelection): selection is NonTaskCalendarSelection {
  return selection.kind === "calendar" || selection.kind === "timetable";
}

function CalendarDetailDrawer({ data, selection, onClose, onEdit, onDelete, deleteBusy = false, editor }: { data: EducationContract; selection: NonTaskCalendarSelection; onClose: () => void; onEdit?: () => void; onDelete?: () => void; deleteBusy?: boolean; editor?: ReactNode }) {
  const drawerRef = useModalDismiss<HTMLElement>(onClose);
  const rows: Array<{ label: string; value: string }> = [];
  let title = selection.title;
  const history = selection.sourceId ? intakeOperationHistory(data, selection.kind === "calendar" ? "import_calendar" : "import_timetable", selection.sourceId) : [];
  if (selection.kind === "calendar") {
    const item = data.calendar.find((event) => event.id === selection.sourceId || (!event.id && event.name === selection.title && event.date === selection.date));
    title = item?.name || title;
    for (const [label, value] of [
      ["日期", item?.date || selection.date],
      ["结束", item?.endDate],
      ["类型", item?.type ? calendarTypeLabels[item.type] || item.type : null],
      ["来源", selection.sourceLabel],
      ["状态", selection.statusLabel],
      ["备注", item?.notes || selection.detail],
    ] as Array<[string, unknown]>) { const text = rawText(value); if (text) rows.push({ label, value: text }); }
  } else if (selection.kind === "timetable") {
    const item = data.timetable.map(rawRecord).find((slot) => rawText(slot.slot_id ?? slot.id) === selection.sourceId) || {};
    title = rawText(item.subject) || title;
    const day = rawText(item.day_of_week ?? item.dayOfWeek);
    for (const [label, value] of [
      ["星期", day ? `周${WEEKDAY_LABELS[Math.max(0, Number(day) - 1)] || day}` : null],
      ["节次", rawText(item.period)],
      ["科目 / 事务", rawText(item.subject) || selection.title],
      ["班级", rawText(item.class_name ?? item.className)],
      ["类型", item.kind === "routine" ? "固定事务" : "课程"],
      ["备注", visibleTimetableNote(item.notes) || selection.detail],
    ] as Array<[string, unknown]>) { const text = rawText(value); if (text) rows.push({ label, value: text }); }
  }
  return <aside ref={drawerRef} className="edupi-calendar-detail" role="dialog" aria-modal="true" aria-label={`${title}详情`}><header><div><span>{selection.kind === "calendar" ? "校历节点" : "课程安排"}</span><h2>{title}</h2></div><div className="edupi-calendar-detail__actions">{onEdit && !editor ? <EduPiIconButton type="button" icon="edit" label="编辑" className="is-edit" onClick={onEdit}/> : null}{onDelete && !editor ? <EduPiIconButton type="button" icon="delete" label={deleteBusy ? "正在删除" : "删除"} className="is-delete" busy={deleteBusy} disabled={deleteBusy} onClick={onDelete}/> : null}<EduPiIconButton type="button" icon="close" label="关闭详情" data-autofocus onClick={onClose}/></div></header>{editor ? <div className="edupi-calendar-detail__editor">{editor}</div> : <><dl>{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl><EduPiOperationHistory rows={history} /></>}</aside>;
}

function IntakeComposer({ mode, anchorDate, calendarEvent, timetableSlot, busy, embedded = false, onClose, onImportCalendar, onImportTimetable }: {
  mode: "calendar" | "timetable";
  anchorDate: string;
  calendarEvent?: EducationContract["calendar"][number] | null;
  timetableSlot?: Record<string, unknown> | null;
  busy: boolean;
  embedded?: boolean;
  onClose: () => void;
  onImportCalendar: Props["onImportCalendar"];
  onImportTimetable: Props["onImportTimetable"];
}) {
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      if (mode === "calendar") {
        await onImportCalendar({
          eventId: calendarEvent?.id || null,
          date: String(form.get("date") || ""),
          endDate: String(form.get("endDate") || "") || null,
          name: String(form.get("name") || ""),
          type: String(form.get("type") || "custom"),
          notes: String(form.get("notes") || "") || null,
        });
      } else {
        await onImportTimetable({
          slotId: rawText(timetableSlot?.slot_id ?? timetableSlot?.id),
          dayOfWeek: Number(form.get("dayOfWeek")),
          period: Number(form.get("period")),
          subject: String(form.get("subject") || ""),
          className: String(form.get("className") || "") || null,
          kind: form.get("kind") === "routine" ? "routine" : "class",
          notes: String(form.get("notes") || "") || null,
        });
      }
      onClose();
    } catch {
      setError("接入失败，请检查后重试");
    }
  };
  const editingCalendar = mode === "calendar" && Boolean(calendarEvent?.id);
  const editingTimetable = mode === "timetable" && Boolean(rawText(timetableSlot?.slot_id ?? timetableSlot?.id));
  const title = mode === "calendar" ? editingCalendar ? "编辑日程" : "新建日程" : editingTimetable ? "编辑课表" : "添加课表";
  return <section className={`edupi-calendar-intake${embedded ? " is-embedded" : ""}`} aria-label={title}>{!embedded ? <header><strong>{title}</strong><button type="button" onClick={onClose} aria-label="关闭">×</button></header> : null}<form onSubmit={(event) => void submit(event)}>{mode === "calendar" ? <>
    <label><span>名称</span><input name="name" required maxLength={240} autoFocus placeholder="如：期中考试" defaultValue={calendarEvent?.name || ""} /></label>
    <label><span>开始</span><input name="date" type="date" required defaultValue={calendarEvent?.date || anchorDate} /></label>
    <label><span>结束</span><input name="endDate" type="date" defaultValue={calendarEvent?.endDate || ""} /></label>
    <label><span>类型</span><select name="type" defaultValue={calendarEvent?.type || "custom"}><option value="custom">日程</option><option value="teaching">教学节点</option><option value="exam">考试</option><option value="meeting">会议</option><option value="activity">活动</option><option value="holiday">假期</option><option value="festival">节日</option></select></label>
  </> : <>
    <label><span>星期</span><select name="dayOfWeek" defaultValue={rawText(timetableSlot?.day_of_week ?? timetableSlot?.dayOfWeek) || weekdayIndex(anchorDate) + 1}>{WEEKDAY_LABELS.map((label, index) => <option key={label} value={index + 1}>周{label}</option>)}</select></label>
    <label><span>节次</span><input name="period" type="number" min={0} max={64} required defaultValue={rawText(timetableSlot?.period) || 1} /></label>
    <label><span>科目 / 事务</span><input name="subject" required maxLength={120} placeholder="如：数学" defaultValue={rawText(timetableSlot?.subject) || ""} /></label>
    <label><span>班级</span><input name="className" maxLength={120} placeholder="可不填" defaultValue={rawText(timetableSlot?.class_name ?? timetableSlot?.className) || ""} /></label>
    <label><span>类型</span><select name="kind" defaultValue={timetableSlot?.kind === "routine" ? "routine" : "class"}><option value="class">课程</option><option value="routine">固定事务</option></select></label>
  </>}<label className="is-wide"><span>备注</span><textarea name="notes" rows={3} maxLength={1000} placeholder="可不填" defaultValue={mode === "calendar" ? calendarEvent?.notes || "" : visibleTimetableNote(timetableSlot?.notes) || ""} /></label><footer>{error ? <span role="alert">{error}</span> : <span /> }<button type="button" onClick={onClose}>取消</button><button type="submit" className="is-primary" disabled={busy}>{busy ? "保存中…" : editingCalendar || editingTimetable ? "保存更改" : "写入 EduPi"}</button></footer></form></section>;
}

export function EduPiCalendarWorkspace({ data, query, onUpload, intakeBusy, selection, onSelect, onTaskDetail, onImportCalendar, onImportTimetable, onDeleteEntity }: Props) {
  const [view, setView] = useState<CalendarViewMode>("month");
  const [contentMode, setContentMode] = useState<CalendarContentMode>("summary");
  const [anchorDate, setAnchorDate] = useState(localIsoDate);
  const [composer, setComposer] = useState<"calendar" | "timetable" | null>(null);
  const [editingCalendarId, setEditingCalendarId] = useState<string | null>(null);
  const [editingTimetableId, setEditingTimetableId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  useEffect(() => {
    const requestedDate = parseIsoDate(new URLSearchParams(window.location.search).get("date"));
    if (requestedDate) setAnchorDate(requestedDate);
  }, []);
  useEffect(() => {
    if (selection?.date) setAnchorDate(selection.date);
  }, [selection?.date]);
  const projection = useMemo(() => filterProjection(createCalendarProjection(data, { view, anchorDate, query }), contentMode), [anchorDate, contentMode, data, query, view]);
  const filteredTimetable = useMemo(() => filterTimetableSlots(data.timetable, query), [data.timetable, query]);
  const editingCalendarEvent = editingCalendarId
    ? data.calendar.find((event) => event.id === editingCalendarId) || null
    : null;
  const editingTimetableSlot = editingTimetableId
    ? data.timetable.map(rawRecord).find((slot) => rawText(slot.slot_id ?? slot.id) === editingTimetableId) || null
    : null;
  const openTaskDetail = (entry: CalendarEntry | CalendarPendingEntry) => {
    const task = taskForCalendarEntry(data.tasks, entry);
    if (task) onTaskDetail(task);
    else onSelect(selectionForEntry(entry));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (event.key.toLocaleLowerCase() === "t") {
        event.preventDefault();
        setAnchorDate(localIsoDate());
      } else if (event.key === "1" || event.key === "2" || event.key === "3") {
        event.preventDefault();
        setView(event.key === "1" ? "day" : event.key === "2" ? "week" : "month");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const changePeriod = (direction: -1 | 1) => setAnchorDate(shiftCalendarAnchor(view, anchorDate, direction));
  const selectDate = (date: string) => {
    setAnchorDate(date);
    setView("day");
  };
  const itemCount = projection.entries.length + projection.pending.length;
  const closeComposer = () => {
    setComposer(null);
    setEditingCalendarId(null);
    setEditingTimetableId(null);
  };
  const editSelectedCalendar = () => {
    if (!selection || selection.kind !== "calendar" || !selection.sourceId) return;
    const event = data.calendar.find((item) => item.id === selection.sourceId);
    if (!event) return;
    setEditingCalendarId(event.id || null);
    setEditingTimetableId(null);
    if (event.date) setAnchorDate(event.date);
    setComposer(null);
  };
  const editSelectedTimetable = () => {
    if (!selection || selection.kind !== "timetable" || !selection.sourceId) return;
    const slot = data.timetable.map(rawRecord).find((item) => rawText(item.slot_id ?? item.id) === selection.sourceId);
    if (!slot) return;
    setEditingTimetableId(selection.sourceId);
    setEditingCalendarId(null);
    setComposer(null);
  };
  const closeDetail = () => {
    setEditingCalendarId(null);
    setEditingTimetableId(null);
    onSelect(null);
  };
  const deleteSelected = async () => {
    if (!selection || !isNonTaskSelection(selection) || !selection.sourceId || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const deleted = await onDeleteEntity(selection.kind, selection.sourceId, selection.title);
      if (deleted) closeDetail();
    } catch {
      // The parent workspace owns the visible error message.
    } finally {
      setDeleteBusy(false);
    }
  };
  const canDeleteSelection = Boolean(selection && isNonTaskSelection(selection) && selection.sourceId
    && data.capabilities.entityDelete.enabled && data.capabilities.entityDelete.targetKinds.includes(selection.kind));
  const calendarWriteReady = data.capabilities.calendar.enabled;
  const timetableWriteReady = data.capabilities.timetable.enabled;
  const writeReason = !calendarWriteReady || !timetableWriteReady
    ? [!calendarWriteReady ? data.capabilities.calendar.reason : null, !timetableWriteReady ? data.capabilities.timetable.reason : null].filter(Boolean).join("；")
    : null;
  const drawerEditor = editingCalendarId && editingCalendarEvent && calendarWriteReady
    ? <IntakeComposer key={`calendar:${editingCalendarId}`} embedded mode="calendar" anchorDate={anchorDate} calendarEvent={editingCalendarEvent} busy={intakeBusy} onClose={() => setEditingCalendarId(null)} onImportCalendar={onImportCalendar} onImportTimetable={onImportTimetable} />
    : editingTimetableId && editingTimetableSlot && timetableWriteReady
      ? <IntakeComposer key={`timetable:${editingTimetableId}`} embedded mode="timetable" anchorDate={anchorDate} timetableSlot={editingTimetableSlot} busy={intakeBusy} onClose={() => setEditingTimetableId(null)} onImportCalendar={onImportCalendar} onImportTimetable={onImportTimetable} />
      : null;

  return (
    <main className="edupi-module-workspace edupi-calendar-workspace">
      <header className="edupi-calendar-heading">
        <div><span>行事历</span><h1>日程</h1><p>校历、课程表与教师任务 · {itemCount} 项</p></div>
        <div className="edupi-calendar-heading__actions"><button type="button" disabled={!calendarWriteReady} title={!calendarWriteReady ? data.capabilities.calendar.reason : undefined} onClick={() => { if (composer === "calendar" && !editingCalendarId) closeComposer(); else { setEditingCalendarId(null); setEditingTimetableId(null); setComposer("calendar"); } }}>新建日程</button><button type="button" disabled={!timetableWriteReady} title={!timetableWriteReady ? data.capabilities.timetable.reason : undefined} onClick={() => { if (composer === "timetable" && !editingTimetableId) closeComposer(); else { setEditingCalendarId(null); setEditingTimetableId(null); setComposer("timetable"); } }}>添加课表</button><button type="button" className="is-primary" onClick={onUpload}>上传文件</button></div>
      </header>
      {writeReason ? <p className="edupi-calendar-capability-note" role="status">{writeReason}</p> : null}
      {composer ? <IntakeComposer key={`${composer}:${editingCalendarId || editingTimetableId || "new"}`} mode={composer} anchorDate={anchorDate} calendarEvent={composer === "calendar" ? editingCalendarEvent : null} timetableSlot={composer === "timetable" ? editingTimetableSlot : null} busy={intakeBusy} onClose={closeComposer} onImportCalendar={onImportCalendar} onImportTimetable={onImportTimetable} /> : null}
      <div className="edupi-calendar-content-segment" role="group" aria-label="切换日程内容">{CONTENT_LABELS.map((item) => <button type="button" key={item.mode} className={contentMode === item.mode ? "is-active" : ""} onClick={() => { setContentMode(item.mode); setEditingCalendarId(null); setEditingTimetableId(null); onSelect(null); }} aria-pressed={contentMode === item.mode}>{item.label}</button>)}</div>
      {contentMode === "timetable" ? <EduPiTimetableGrid slots={filteredTimetable} onSelect={onSelect} /> : <>
      <div className="edupi-calendar-toolbar" role="toolbar" aria-label="日程工具栏">
        <button type="button" className="edupi-calendar-today" onClick={() => setAnchorDate(localIsoDate())}>今天</button>
        <div className="edupi-calendar-period-nav"><button type="button" onClick={() => changePeriod(-1)} aria-label="上一时段">‹</button><button type="button" onClick={() => changePeriod(1)} aria-label="下一时段">›</button></div>
        <strong className="edupi-calendar-period-title" aria-live="polite">{periodTitle(view, anchorDate)}</strong>
        <div className="edupi-calendar-view-segment" role="group" aria-label="切换日程视图">{VIEW_LABELS.map((item) => <button type="button" key={item.mode} className={view === item.mode ? "is-active" : ""} onClick={() => setView(item.mode)} aria-pressed={view === item.mode}>{item.label}<kbd>{item.shortcut}</kbd></button>)}</div>
      </div>
      {view === "month" ? <MonthView projection={projection} anchorDate={anchorDate} selection={selection} onSelectDate={selectDate} onSelect={onSelect} onTaskDetail={openTaskDetail} /> : null}
      {view === "week" ? <WeekView projection={projection} selection={selection} onSelectDate={selectDate} onSelect={onSelect} onTaskDetail={openTaskDetail} /> : null}
      {view === "day" ? <DayView projection={projection} selection={selection} onSelect={onSelect} onTaskDetail={openTaskDetail} /> : null}
      <PendingInbox projection={projection} selection={selection} onSelect={onSelect} onTaskDetail={openTaskDetail} />
      </>}
      {query ? <p className="edupi-calendar-query-note" role="status">正在筛选：{query}{projection.entries.length === 0 && projection.pending.length === 0 ? " · 没有匹配项" : ""}</p> : null}
      {selection && isNonTaskSelection(selection) ? <CalendarDetailDrawer data={data} selection={selection} onClose={closeDetail} editor={drawerEditor} onEdit={selection.kind === "calendar" && calendarWriteReady && data.calendar.some((event) => event.id === selection.sourceId) ? editSelectedCalendar : selection.kind === "timetable" && timetableWriteReady && data.timetable.map(rawRecord).some((slot) => rawText(slot.slot_id ?? slot.id) === selection.sourceId) ? editSelectedTimetable : undefined} onDelete={canDeleteSelection ? () => void deleteSelected() : undefined} deleteBusy={deleteBusy} /> : null}
    </main>
  );
}
