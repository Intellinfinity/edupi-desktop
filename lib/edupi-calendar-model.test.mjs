import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
test("brief calendar links resolve only the referenced object on its date", async () => {
  const { calendarSelectionForSource, calendarSelectionFromLink } = await jiti.import("./edupi-calendar-model.ts");
  const data = { calendar: [{ id: "event:1", name: "教研", date: "2026-09-09" }], tasks: [], timetable: [{ slot_id: "slot:1", subject: "数学", day_of_week: 3, period: 2, class_name: "703" }] };
  assert.equal(calendarSelectionFromLink(data, { kind: "calendar", id: "event:1", date: "2026-09-09" }).title, "教研");
  assert.equal(calendarSelectionFromLink(data, { kind: "timetable", id: "slot:1", date: "2026-09-09" }).sourceId, "slot:1");
  assert.equal(calendarSelectionFromLink(data, { kind: "calendar", id: "missing", date: "2026-09-09" }), null);
  assert.equal(calendarSelectionFromLink(data, { kind: "calendar", id: "event:1", date: "2026-09-10" }), null);
  assert.equal(calendarSelectionFromLink(data, { kind: "calendar", id: "event:1", date: "invalid" }), null);
  assert.deepEqual(calendarSelectionForSource(data, "calendar", "event:1"), { kind: "calendar", sourceId: "event:1", date: "2026-09-09", title: "教研", detail: undefined, sourceLabel: "校历", statusLabel: "待确认" });
  assert.deepEqual(calendarSelectionForSource(data, "timetable", "slot:1"), { kind: "timetable", sourceId: "slot:1", date: null, title: "数学", detail: "周3 · 第 2 节 · 703", sourceLabel: "课程表", statusLabel: "已确认" });
  assert.equal(calendarSelectionForSource(data, "calendar", "missing"), null);
});
const {
  addCalendarMonths,
  createCalendarProjection,
  expandInclusiveDateRange,
  filterTimetableSlots,
  getCalendarEntries,
  getCalendarViewRange,
  getAcademicWeekNumber,
  getMonthGrid,
  isPrimaryTimetableSlot,
  startOfWeek,
} = await jiti.import("./edupi-calendar-model.ts");
const { buildEducationContract } = await jiti.import("./edupi-education-contract.ts");

const data = ({ calendar = [], tasks = [], timetable = [] } = {}) => ({ calendar, tasks, timetable });

test("uses Monday as the first day of the week", () => {
  assert.equal(startOfWeek("2024-05-15"), "2024-05-13");
  assert.deepEqual(getCalendarViewRange("week", "2024-05-15"), { start: "2024-05-13", end: "2024-05-19" });
});

test("handles leap days, month rollover, and a fixed 42-cell month grid", () => {
  assert.equal(addCalendarMonths("2024-01-31", 1), "2024-02-29");
  assert.deepEqual(expandInclusiveDateRange("2024-02-28", "2024-03-01"), ["2024-02-28", "2024-02-29", "2024-03-01"]);
  const academicWeeks = [
    { id: "week-0", date: "2024-01-29", end_date: "2024-02-04", name: "第0周 · 准备开学", source: "teacher", confidence: "teacher_confirmed", preparationStatus: "read_only", notes: null },
    { id: "week-1", date: "2024-02-05", end_date: "2024-02-11", name: "第1周 · 正式教学", source: "teacher", confidence: "teacher_confirmed", preparationStatus: "read_only", notes: null },
  ];
  const grid = getMonthGrid("2024-02-15", academicWeeks);
  assert.equal(grid.length, 42);
  assert.equal(grid[0].date, "2024-01-29");
  assert.equal(grid[34].date, "2024-03-03");
  assert.equal(grid.at(-1)?.date, "2024-03-10");
  assert.equal(grid[0].weekNumber, 0);
  assert.equal(grid[7].weekNumber, 1);
  assert.equal(grid[14].weekNumber, null);
  assert.equal(grid.filter((cell) => cell.isCurrentMonth).length, 29);
});

test("uses only explicit academic week anchors and respects inclusive boundaries", () => {
  const weeks = [
    { id: "week-0", date: "2026-08-24", end_date: "2026-08-30", name: "第0周", source: "teacher", confidence: "confirmed", preparationStatus: "read_only", notes: null },
    { id: "week-1", date: "2026-08-31", end_date: "2026-09-06", name: "第1周", source: "teacher", confidence: "confirmed", preparationStatus: "read_only", notes: null },
  ];
  assert.equal(getAcademicWeekNumber(weeks, "2026-08-24"), 0);
  assert.equal(getAcademicWeekNumber(weeks, "2026-08-30"), 0);
  assert.equal(getAcademicWeekNumber(weeks, "2026-08-31"), 1);
  assert.equal(getAcademicWeekNumber(weeks, "2026-09-07"), null);
  assert.equal(getAcademicWeekNumber([], "2026-08-26"), null);
  assert.equal(getMonthGrid("2026-08-26")[0].weekNumber, null);
});

test("expands multi-day calendar facts inclusively", () => {
  const result = getCalendarEntries(data({
    calendar: [{ id: "term-break", date: "2026-01-30", endDate: "2026-02-02", name: "阶段休息", source: "teacher", confidence: "teacher_confirmed", preparationStatus: "read_only", notes: null }],
  }), { start: "2026-01-30", end: "2026-02-02" });
  assert.deepEqual(result.entries.map((entry) => entry.date), ["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02"]);
  assert.equal(result.entries[0].continuesBefore, false);
  assert.equal(result.entries.at(-1)?.continuesAfter, false);
});

test("recurs timetable slots across the requested week without clock times", () => {
  const result = getCalendarEntries(data({
    timetable: [{ id: "math", day_of_week: 1, period: 2, subject: "数学", class_name: "七年级" }],
  }), { start: "2026-08-24", end: "2026-08-30" });
  assert.deepEqual(result.entries.map((entry) => [entry.date, entry.period, entry.allDay]), [["2026-08-24", 2, false]]);
  assert.equal(result.entries[0].sourceLabel, "课程表");
});

test("filters the timetable grid by subject, class, notes, weekday, and period", () => {
  const slots = [
    { id: "math", day_of_week: 1, period: 2, subject: "数学", class_name: "703", notes: "移项" },
    { id: "english", day_of_week: 2, period: 1, subject: "英语", class_name: "704" },
  ];
  assert.deepEqual(filterTimetableSlots(slots, "数学").map((slot) => slot.id), ["math"]);
  assert.deepEqual(filterTimetableSlots(slots, "703").map((slot) => slot.id), ["math"]);
  assert.deepEqual(filterTimetableSlots(slots, "移项").map((slot) => slot.id), ["math"]);
  assert.equal(filterTimetableSlots(slots, "不存在").length, 0);
  assert.equal(filterTimetableSlots(slots, "").length, 2);
});

test("keeps weekend and extended-period timetable slots outside the primary grid", () => {
  assert.equal(isPrimaryTimetableSlot({ day_of_week: 1, period: 1 }), true);
  assert.equal(isPrimaryTimetableSlot({ day_of_week: 5, period: 10 }), true);
  assert.equal(isPrimaryTimetableSlot({ day_of_week: 6, period: 2 }), false);
  assert.equal(isPrimaryTimetableSlot({ day_of_week: 1, period: 0 }), false);
  assert.equal(isPrimaryTimetableSlot({ day_of_week: 1, period: 11 }), false);
});

test("marks material-recognized timetable slots as pending instead of confirmed", () => {
  const result = getCalendarEntries(data({
    timetable: [{ id: "recognized-math", day_of_week: 1, period: 2, subject: "数学", class_name: "七年级", notes: "材料识别待确认：来自校历图片" }],
  }), { start: "2026-08-24", end: "2026-08-30" });
  assert.equal(result.entries[0].status, "pending");
  assert.equal(result.entries[0].statusLabel, "待确认");
  assert.equal(result.entries[0].sourceLabel, "材料识别");
  assert.equal(result.entries[0].detail, "七年级");
});

test("keeps missing and invalid dates in the pending inbox", () => {
  const result = getCalendarEntries(data({
    calendar: [
      { id: "missing", date: null, endDate: null, name: "日期未定", source: "inferred", confidence: "inferred", preparationStatus: "hold", notes: null },
      { id: "invalid", date: "2026-02-31", endDate: null, name: "无效日期", source: "teacher", confidence: "confirmed", preparationStatus: "read_only", notes: null },
    ],
    tasks: [{ id: "no-date", title: "准备材料", dueDate: null, triggerDate: null, sourceEventDate: null, status: "planned", trigger: "calendar_event_internal", sourceEventName: null, topic: null, student: null }],
  }), { start: "2026-02-01", end: "2026-02-28" });
  assert.equal(result.entries.length, 0);
  assert.deepEqual(result.pending.map((entry) => [entry.title, entry.kind, entry.statusLabel]), [
    ["日期未定", "calendar", "待确认"],
    ["无效日期", "calendar", "待确认"],
    ["准备材料", "task", "待审核"],
  ]);
});

test("keeps Core-held invalid dates out of the calendar grid", () => {
  const contract = buildEducationContract({
    calendar: [
      { id: "invalid-missing-end", date: "2026-09-10", end_date: null, date_status: "invalid", preparation_status: "hold", name: "日期待核对" },
      { id: "invalid-reversed-end", date: "2026-09-10", end_date: "2026-09-09", date_status: "invalid", preparation_status: "hold", name: "结束日期倒序" },
    ],
  });
  const result = getCalendarEntries(data(contract), { start: "2026-09-01", end: "2026-09-30" });

  assert.equal(result.entries.length, 0);
  assert.deepEqual(result.pending.map((entry) => entry.title), ["日期待核对", "结束日期倒序"]);
});

test("cleans task titles with the shared workbench display rules while retaining task metadata", () => {
  const result = getCalendarEntries(data({
    tasks: [
      { id: "internal", title: "第0周 · 准备开学教师内部核对准备", dueDate: "2026-08-24", status: "planned", trigger: "calendar_event_internal", sourceEventName: "第0周", topic: null, student: null },
      { id: "safety", title: "赵六：safety跟进（教师内部）", dueDate: "2026-08-25", status: "accepted", trigger: "student_follow_up", sourceEventName: "赵六学生事件", topic: null, student: "赵六" },
    ],
  }), { start: "2026-08-24", end: "2026-08-25" });
  assert.deepEqual(result.entries.map((entry) => [entry.title, entry.sourceLabel, entry.statusLabel]), [
    ["第0周 · 准备开学", "任务", "待审核"],
    ["赵六：安全事件跟进", "学生跟进", "已接受"],
  ]);
});

test("uses shared execution status labels for task entries in day, week, and month projections", () => {
  const task = (id, contentStatus, boardStage, status = "planned", boardRevision = 0) => ({
    id,
    title: id,
    dueDate: "2026-08-24",
    contentStatus,
    boardStage,
    boardRevision,
    status,
    trigger: "calendar_event_internal",
    sourceEventName: "节点",
    topic: null,
    student: null,
  });
  const tasks = [
    task("failed", "generation_failed", "progress"),
    task("failed-todo", "generation_failed", "todo"),
    task("running", "generating", "progress"),
    task("ready", "draft_ready", "review"),
    task("confirmed", "confirmed", "done", "accepted"),
    task("manual-progress", "generation_failed", "progress", "planned", 2),
    task("manual-review", "generating", "review", "planned", 2),
    task("manual-todo", "draft_ready", "todo", "planned", 2),
  ];
  const expected = [
    ["failed", "failed", "准备失败"],
    ["failed-todo", "failed", "准备失败"],
    ["running", "pending", "正在准备"],
    ["ready", "pending", "待你确认"],
    ["confirmed", "confirmed", "已完成"],
    ["manual-progress", "pending", "进行中"],
    ["manual-review", "pending", "待你确认"],
    ["manual-todo", "pending", "待开始"],
  ];
  for (const view of ["day", "week", "month"]) {
    const projection = createCalendarProjection(data({ tasks }), { view, anchorDate: "2026-08-24" });
    assert.deepEqual(projection.entries.filter((entry) => entry.kind === "task").sort((left, right) => String(left.sourceId).localeCompare(String(right.sourceId))).map((entry) => [entry.sourceId, entry.status, entry.statusLabel]), expected.sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
  }
  const pending = getCalendarEntries(data({ tasks: [{ ...task("pending-failed", "generation_failed", "progress"), dueDate: null }] }), { start: "2026-08-24", end: "2026-08-24" });
  assert.equal(pending.pending[0]?.status, "failed");
  assert.equal(pending.pending[0]?.statusLabel, "准备失败");
});

test("projection keeps month cells and date-indexed entries together", () => {
  const projection = createCalendarProjection(data({
    tasks: [{ id: "task-1", title: "备课", dueDate: "2026-08-26", status: "accepted", trigger: "teaching_adjustment_candidate" }],
  }), { view: "month", anchorDate: "2026-08-26" });
  assert.equal(projection.monthGrid.length, 42);
  assert.equal(projection.entriesByDate["2026-08-26"]?.[0]?.statusLabel, "已接受");
});
