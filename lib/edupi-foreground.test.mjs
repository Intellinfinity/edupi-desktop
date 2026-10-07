import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildEducationContract } = await jiti.import("./edupi-education-contract.ts");
const { projectTaskBoard } = await jiti.import("./edupi-task-board.ts");
const { groupWorkCandidates } = await jiti.import("./edupi-workbench.ts");
const { todayActiveTasks } = await jiti.import("./edupi-work-case.ts");
const { getCalendarEntries } = await jiti.import("./edupi-calendar-model.ts");
const { shanghaiDate, isForegroundDate, paginateForeground, taskReferenceDate, taskCompletionTime, isTaskForeground, isCandidateForeground } = await jiti.import("./edupi-foreground.ts");
const policy = { today: "2026-10-07", graceDays: 3, pinnedTaskIds: [] };
const data = buildEducationContract({ tasks: [
  { id: "old", title: "旧节日", trigger: "festival", due_date: "2026-09-22", source_event_date: "2026-09-27", status: "planned", evidence: {} },
  { id: "boundary", title: "三日前", trigger: "teacher_created", due_date: "2026-10-04", status: "planned", evidence: {} },
  { id: "expired", title: "四日前", trigger: "teacher_created", due_date: "2026-10-03", status: "planned", evidence: {} },
  { id: "future-class", title: "未来课", trigger: "teaching_before_class", due_date: "2026-09-20", source_event_date: "2026-10-08", status: "planned", evidence: {} },
  { id: "unknown", title: "无日期", trigger: "teacher_created", status: "planned", evidence: {} },
  { id: "running", title: "旧运行", trigger: "teacher_created", due_date: "2026-09-20", content_status: "running", status: "planned", evidence: {} },
  { id: "today", title: "当天", trigger: "teacher_created", due_date: "2026-10-07", status: "planned", evidence: {} },
] });

test("all board lanes use actual occurrence dates, three-day grace, pins and running exceptions", () => {
  const columns = projectTaskBoard(data.tasks, {}, [], "", policy);
  const ids = columns.flatMap(column => column.tasks.map(task => task.id));
  assert.equal(ids.includes("old"), false);
  assert.equal(ids.includes("expired"), false);
  for (const id of ["boundary", "future-class", "unknown", "running", "today"]) assert.equal(ids.includes(id), true, id);
  assert.equal(data.tasks.length, 7, "projection must preserve canonical rows");
  assert.equal(projectTaskBoard(data.tasks, {}, [], "", { ...policy, pinnedTaskIds: ["old"] }).flatMap(column => column.tasks).some(task => task.id === "old"), true);
  assert.equal(projectTaskBoard(data.tasks, {}, [], "", { ...policy, graceDays: 4 }).flatMap(column => column.tasks).some(task => task.id === "expired"), true);
});

test("near dates precede older dates and unknown dates stay last", () => {
  assert.deepEqual(projectTaskBoard(data.tasks, {}, [], "", policy)[0].tasks.map(task => task.id), ["today", "future-class", "boundary", "unknown"]);
});

test("done order uses the actual board completion time and never a deadline as completion", () => {
  const tasks = buildEducationContract({ tasks: [
    { id: "unknown", title: "完成时间未知", status: "accepted", due_date: "2099-01-01", evidence: {} },
    { id: "reviewed", title: "已审核", status: "accepted", reviewed_at: "2026-10-06T00:00:00Z", evidence: {} },
    { id: "manual", title: "手动完成", status: "planned", board_stage: "done", board_revision: 1, board_updated_at: "2026-10-07T00:00:00Z", evidence: {} },
  ] }).tasks;
  assert.deepEqual(projectTaskBoard(tasks, {}, [], "", policy)[3].tasks.map(task => task.id), ["manual", "reviewed", "unknown"]);
});

test("candidate and today active projections share expiry and preserve explicit rescheduling", () => {
  const candidates = ["old", "future-class", "unknown"].map(id => ({ candidateId: `candidate-${id}`, taskId: id, title: id, dueAt: id === "unknown" ? null : "2026-09-22", status: "pending_review", snoozeUntil: null, teacherReview: { reviewedAt: null } }));
  const groups = groupWorkCandidates(candidates, policy.today, { ...policy, tasks: data.tasks });
  assert.deepEqual(groups.now.map(candidate => candidate.taskId), ["future-class", "unknown"]);
  assert.equal(groupWorkCandidates([{ ...candidates[0], status: "snoozed", snoozeUntil: "2026-10-09" }], policy.today, { ...policy, tasks: data.tasks }).later.length, 1);
  const activeData = { ...data, workCases: [], workCandidates: [], taskSessions: {
    old: { taskId: "old", sessionId: "past", boundAt: "2026-09-22T00:00:00Z", status: "idle" },
    running: { taskId: "running", sessionId: "live", boundAt: "2026-09-22T00:00:00Z", status: "running" },
  } };
  assert.deepEqual(todayActiveTasks(activeData, policy).map(row => row.task.id), ["running"]);
});

test("list calendar hides expired transactions while explicit history ranges recover them", () => {
  const calendarData = { tasks: data.tasks, calendar: [], timetable: [] };
  const range = { start: "2026-09-01", end: "2026-10-15" };
  assert.equal(getCalendarEntries(calendarData, range, "", policy).entries.some(entry => entry.sourceId === "old"), false);
  assert.equal(getCalendarEntries(calendarData, range).entries.some(entry => entry.sourceId === "old"), true);
  const currentRange = { start: "2026-10-01", end: "2026-10-15" };
  const list = getCalendarEntries(calendarData, currentRange, "", policy);
  assert.equal(list.entries.find(entry => entry.sourceId === "future-class")?.date, "2026-10-08");
  assert.equal(list.entries.some(entry => entry.sourceId === "running"), true, "the current list keeps old running work reachable");
});

test("official holiday dates suppress normal recurrences without deleting explicit teacher occurrences", () => {
  const calendarData = { tasks: [], calendar: [{ id: "makeup", name: "教师确认补课", date: "2026-10-01", endDate: null, source: "teacher", confidence: "teacher_confirmed", preparationStatus: "read_only" }], timetable: [
    { slot_id: "thu", subject: "数学", day_of_week: 4, period: 1 },
    { slot_id: "sat", subject: "周六课程", day_of_week: 6, period: 1 },
    { slot_id: "sun", subject: "周日课程", day_of_week: 7, period: 1 },
  ] };
  const result = getCalendarEntries(calendarData, { start: "2026-09-20", end: "2026-10-10" });
  assert.equal(result.entries.some(entry => entry.kind === "timetable" && entry.date >= "2026-10-01" && entry.date <= "2026-10-07"), false);
  assert.equal(result.entries.some(entry => entry.kind === "timetable" && entry.date >= "2026-09-25" && entry.date <= "2026-09-27"), false);
  assert.equal(result.entries.some(entry => entry.kind === "calendar" && entry.sourceId === "makeup"), true);
  for (const date of ["2026-09-20", "2026-10-10"]) assert.equal(result.entries.some(entry => entry.kind === "timetable" && entry.date === date), false, "makeup weekdays require a confirmed course mapping");
});

test("Shanghai midnight changes the natural-day boundary without using elapsed hours", () => {
  assert.equal(shanghaiDate("2026-10-06T15:59:59Z"), "2026-10-06");
  assert.equal(shanghaiDate("2026-10-06T16:00:00Z"), "2026-10-07");
  assert.equal(isForegroundDate("2026-10-03", { ...policy, today: shanghaiDate("2026-10-06T15:59:59Z") }), true);
  assert.equal(isForegroundDate("2026-10-03", policy), false);
  for (const unknown of [null, "2026-02-31", "", "not a date"]) assert.equal(isForegroundDate(unknown, policy), true);
});

test("source ranges expire from the actual ending date and completion does not borrow a deadline", () => {
  const task = { ...data.tasks[0], sourceEventId: "multi-day" };
  const source = { id: "multi-day", date: "2026-09-01", endDate: "2026-10-09", endsAt: "2026-10-08T17:00:00Z" };
  assert.equal(taskReferenceDate(task, { calendar: [source] }), "2026-10-09");
  assert.equal(taskCompletionTime({ ...task, dueDate: "2099-10-09", reviewedAt: null, evidence: {}, boardStage: "done", boardRevision: 1, boardUpdatedAt: null }), null);
});

test("complete pagination reaches every row and clamps a saved position after records disappear", () => {
  const rows = Array.from({ length: 26 }, (_, index) => index);
  assert.deepEqual([0, 1, 2].flatMap(page => paginateForeground(rows, page).rows), rows);
  assert.equal(paginateForeground(rows, 0).rows.length, 10);
  assert.deepEqual(paginateForeground(rows.slice(0, 12), 2), { rows: [10, 11], page: 1, pages: 2, total: 12 });
});

test("regular lesson entries follow the same three-day limit in a foreground list", () => {
  const source = { calendar: [], tasks: [], timetable: [{ id: "math-mon", day_of_week: 1, period: 2, subject: "数学" }] };
  const range = { start: "2026-09-14", end: "2026-10-19" };
  const foreground = getCalendarEntries(source, range, "", policy).entries;
  assert.equal(foreground.some(entry => entry.date < "2026-10-04"), false);
  assert.equal(foreground.some(entry => entry.date === "2026-10-12"), true);
  assert.equal(getCalendarEntries(source, range).entries.some(entry => entry.date === "2026-09-14"), true, "historical date ranges retain past actual lessons");
});

test("recent true completion keeps an old lesson in the foreground and unknown completion stays an explicit fallback", () => {
  const task = { ...data.tasks[0], id: "old-lesson-done", trigger: "teaching_before_class", sourceEventDate: "2026-09-20", dueDate: "2026-09-19", boardStage: "done", boardRevision: 1, boardUpdatedAt: "2026-10-06T10:00:00Z" };
  assert.equal(isTaskForeground(task, policy), true);
  assert.equal(isTaskForeground({ ...task, boardUpdatedAt: "2026-10-02T10:00:00Z" }, policy), false);
  assert.equal(isTaskForeground({ ...task, boardUpdatedAt: null }, policy), true, "an unknown completion date must not be replaced by an old deadline");
  const newer = { ...task, id: "newer-done", boardUpdatedAt: "2026-10-07T10:00:00Z" };
  assert.deepEqual(projectTaskBoard([task, newer], {}, [], "", policy)[3].tasks.map(row => row.id), ["newer-done", "old-lesson-done"]);
});

test("recorded candidates use real review or completion time instead of an old source date", () => {
  const candidate = { candidateId: "recorded", taskId: "old", title: "旧课已记录", status: "accepted", dueAt: "2026-09-20", snoozeUntil: null, teacherReview: { reviewedAt: "2026-10-06T10:00:00Z" } };
  assert.equal(isCandidateForeground(candidate, policy, { tasks: data.tasks }), true);
  assert.equal(isCandidateForeground({ ...candidate, teacherReview: { reviewedAt: "2026-10-02T10:00:00Z" } }, policy, { tasks: data.tasks }), false);
});

test("ISO candidate deadlines and explicit snoozes are interpreted as Shanghai dates", () => {
  const candidate = { candidateId: "iso", taskId: "old", title: "改期", status: "snoozed", dueAt: "2026-09-20T00:00:00Z", snoozeUntil: "2026-10-07T16:30:00Z", teacherReview: { reviewedAt: null } };
  assert.equal(isCandidateForeground(candidate, policy, { tasks: data.tasks }), true);
  assert.equal(isTaskForeground(data.tasks[0], policy, { workCandidates: [candidate] }), true);
  assert.equal(isCandidateForeground({ ...candidate, taskId: "missing", status: "pending_review", snoozeUntil: null, dueAt: "2026-10-03T16:30:00Z" }, policy), true, "16:30Z is October 4 in Shanghai, exactly within grace");
  assert.equal(isCandidateForeground({ ...candidate, taskId: "missing", status: "pending_review", snoozeUntil: null, dueAt: "2026-10-02T16:30:00Z" }, policy), false);
  assert.equal(isCandidateForeground({ ...candidate, taskId: "missing", status: "pending_review", snoozeUntil: null, dueAt: "2026-02-31T16:30:00Z" }, policy), true, "invalid timestamps remain unclassified");
});
