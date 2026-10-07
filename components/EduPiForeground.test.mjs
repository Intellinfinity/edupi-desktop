import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const { buildEducationContract } = await jiti.import("../lib/edupi-education-contract.ts");
const { EduPiForegroundContext, EduPiPagedRows } = await jiti.import("./EduPiForeground.tsx");
const { EduPiWorkspaceBoard } = await jiti.import("./EduPiWorkspaceBoard.tsx");
const { DashboardView } = await jiti.import("./EduPiWorkspaceViews.tsx");
const { EduPiTodayWork } = await jiti.import("./EduPiTodayWork.tsx");
const { EduPiTeachingWorkspace } = await jiti.import("./EduPiTeachingWorkspace.tsx");
const { EduPiObjectSider } = await jiti.import("./EduPiObjectSider.tsx");
const { EduPiReviewBoard } = await jiti.import("./EduPiReviewBoard.tsx");
const { EduPiCalendarWorkspace } = await jiti.import("./EduPiCalendarWorkspace.tsx");
const { isProactiveReminderForeground, isProactiveRunForeground } = await jiti.import("./EduPiProactiveHub.tsx");
const policy = { today: "2026-10-07", graceDays: 3, pinnedTaskIds: [], onPinTask() {} };
const render = element => renderToStaticMarkup(React.createElement(EduPiForegroundContext.Provider, { value: policy }, element));
const callbacks = { onTaskDetail() {}, onCreateTask() {}, onMoveTask() {}, onObject() {}, onEducation() {}, onNavigate() {}, onUpload() {}, onOpenContext() {}, onOpenFile() {}, onStartAgent() {}, onCalendarSelection() {} };

test("board previews ten per lane and routes history to a separate paginated page", () => {
  const data = buildEducationContract({ tasks: Array.from({ length: 14 }, (_, index) => ({ id: `row-${index}`, title: `近期记录 ${index}`, status: "planned", due_date: "2026-10-08", evidence: {} })) });
  data.tasks.push({ ...data.tasks[0], id: "old", title: "过期记录", dueDate: "2026-09-01" });
  const board = render(React.createElement(EduPiWorkspaceBoard, { data, query: "", ...callbacks }));
  assert.equal((board.match(/class="edupi-task-board-card"/g) || []).length, 10);
  assert.match(board, /查看更多/);
  assert.doesNotMatch(board, /过期记录/);
  const history = render(React.createElement(EduPiWorkspaceBoard, { data, query: "过期记录", selectedObjectId: "workspace:list:history", ...callbacks }));
  assert.match(history, /任务历史/);
  assert.match(history, /过期记录/);
  assert.match(history, /保留显示/);
  assert.match(history, /aria-label="列表分页"/);
});

test("done cards show the actual candidate completion date and omit only the generic source caption", () => {
  const data = buildEducationContract({ tasks: [
    { id: "reviewed", title: "旧课次今天完成", trigger: "teaching_before_class", source_event_date: "2026-09-20", due_date: "2026-09-19", status: "planned", evidence: {} },
    { id: "generic", title: "合成通用事务", due_date: "2026-10-07", status: "planned", evidence: {} },
    { id: "named", title: "合成班级事务", topic: "七三班数学", due_date: "2026-10-07", status: "planned", evidence: {} },
  ] });
  data.workCandidates = [{ candidateId: "reviewed-candidate", taskId: "reviewed", status: "accepted", teacherReview: { reviewedAt: "2026-10-06T12:30:00+08:00" } }];
  const html = render(React.createElement(EduPiWorkspaceBoard, { data, query: "", ...callbacks }));
  assert.match(html, /旧课次今天完成/);
  assert.match(html, /<time>2026-10-06<\/time>/);
  assert.doesNotMatch(html, /完成时间待确认|class="edupi-task-board-card__source">教师内部/);
  assert.match(html, /class="edupi-task-board-card__source">七三班数学/);
});

test("stale briefs have only a historical entry and the today page has three work sections", () => {
  const data = buildEducationContract({});
  data.continuity.documents = [{ id: "old", kind: "daily", title: "历史简报", date: "2026-09-27", path: ".edupi/output/daily/2026-09-27.md", excerpt: "不得显示的旧简报正文" }];
  const props = { data, context: null, kernelState: { status: "empty", running: 0, runs: [] }, runningAgentCount: 0, selectedObjectId: null, ...callbacks };
  const html = render(React.createElement(DashboardView, props));
  assert.match(html, /今天还没有生成简报/);
  assert.match(html, /简报历史/);
  assert.doesNotMatch(html, /不得显示的旧简报正文|edupi-command-center|值得留意/);
  for (const title of ["简报", "接下来", "工作判断"]) assert.match(html, new RegExp(title));
  const historical = render(React.createElement(DashboardView, { ...props, selectedObjectId: "today:briefs" }));
  assert.match(historical, /历史简报/);
  assert.match(historical, /2026-09-27/);
  data.continuity.documents.push({ ...data.continuity.documents[0], id: "today", date: "2026-10-07", path: ".edupi/output/daily/2026-10-07.md", excerpt: "今天的简报正文" });
  assert.match(render(React.createElement(DashboardView, props)), /今天的简报正文/);
});

test("old holiday candidates appear only in history and retain teacher rescheduling controls", () => {
  const data = buildEducationContract({ tasks: [{ id: "holiday", title: "旧节日任务", trigger: "festival", source_event_date: "2026-09-27", due_date: "2026-09-25", status: "planned", evidence: {} }] });
  data.workCandidates = [{ candidateId: "holiday-candidate", taskId: "holiday", title: "旧节日任务", status: "pending_review", dueAt: "2026-09-25", snoozeUntil: null, sourceIds: [], evidenceIds: [], reason: "节日临近", teacherReview: { reviewedAt: null }, summary: "旧节日正文", nextCycleState: "awaiting_teacher" }];
  const html = render(React.createElement(EduPiTodayWork, { data, ...callbacks }));
  assert.doesNotMatch(html, /旧节日正文/);
  assert.match(html, /旧节日工作还需要吗/);
  const history = render(React.createElement(EduPiTodayWork, { data, selectedObjectId: "today:list:history", ...callbacks }));
  assert.match(history, /旧节日任务/);
  assert.match(history, /保留显示/);
});

test("old holiday work asks once even without a Core candidate and dismissal only changes display preference", () => {
  const data = buildEducationContract({ tasks: [{ id: "legacy-holiday", title: "合成旧节日准备", trigger: "festival", source_event_date: "2026-09-27", due_date: "2026-09-25", status: "planned", evidence: {} }] });
  const value = { ...policy, dismissedStaleTaskIds: [], onDismissStaleTasks() {} };
  const element = React.createElement(EduPiTodayWork, { data, ...callbacks });
  const html = renderToStaticMarkup(React.createElement(EduPiForegroundContext.Provider, { value }, element));
  assert.match(html, /旧节日工作还需要吗/);
  assert.match(html, /先收起/);
  const dismissed = renderToStaticMarkup(React.createElement(EduPiForegroundContext.Provider, { value: { ...value, dismissedStaleTaskIds: ["legacy-holiday"] } }, element));
  assert.doesNotMatch(dismissed, /旧节日工作还需要吗/);
  assert.equal(data.tasks[0].status, "planned");
  assert.equal(data.tasks.length, 1);
});

test("proactive rows share task expiry, preserve executing runs, and do not expire undated tasks by creation time", () => {
  const data = buildEducationContract({ tasks: [{ id: "old", title: "旧任务", trigger: "teacher_created", due_date: "2026-09-01", evidence: {} }, { id: "unknown", title: "无日期", trigger: "teacher_created", evidence: {} }] });
  const reminder = { taskId: "old", kind: "due", identity: "due:2026-09-01", createdAt: "2026-10-07T00:00:00Z" };
  assert.equal(isProactiveReminderForeground(reminder, policy, data), false);
  assert.equal(isProactiveReminderForeground({ ...reminder, taskId: "unknown" }, policy, data), true);
  const run = { fireKey: "old:1", status: "failed", updatedAt: "2026-10-07T00:00:00Z" };
  assert.equal(isProactiveRunForeground(run, policy, data), false);
  assert.equal(isProactiveRunForeground({ ...run, status: "running" }, policy, data), true);
});

test("a complete list renders ten rows with enabled navigation to the rest", () => {
  const html = render(React.createElement(EduPiPagedRows, { rows: Array.from({ length: 21 }, (_, index) => index), memoryKey: "synthetic-test", renderRow: index => React.createElement("p", { key: index }, `条目 ${index}`) }));
  assert.match(html, /21 项 · 1 \/ 3 页/);
  assert.doesNotMatch(html, /条目 20/);
  assert.match(html, />下一页</);
});

test("this week's teaching grid projects actual lessons across the national holiday", () => {
  const data = buildEducationContract({ timetable: [1, 2, 3, 4, 5].map(day => ({ id: `slot-${day}`, subject: `合成周${day}课程`, day_of_week: day, period: 2, class_name: "703" })) });
  const html = render(React.createElement(EduPiTeachingWorkspace, { data, context: null, query: "", selectedObjectId: "teaching:home", ...callbacks, onTask() {}, onDeleteEntity() {} }));
  assert.match(html, /2026-10-08/);
  for (const day of [1, 2, 3]) assert.doesNotMatch(html, new RegExp(`合成周${day}课程`));
  for (const day of [4, 5]) assert.match(html, new RegExp(`合成周${day}课程`));
});

test("teaching task history and an explicit date range restore from their list route", () => {
  const data = buildEducationContract({ tasks: [
    { id: "old-lesson", title: "可搜索历史课次", trigger: "teaching_before_class", source_event_date: "2026-09-20", due_date: "2026-09-19", status: "planned", evidence: {} },
    { id: "future-lesson", title: "未来源课次", trigger: "teaching_before_class", source_event_date: "2026-10-08", due_date: "2026-10-07", status: "planned", evidence: {} },
  ] });
  const props = { data, context: null, query: "", ...callbacks, onTask() {}, onDeleteEntity() {} };
  const history = render(React.createElement(EduPiTeachingWorkspace, { ...props, selectedObjectId: "teaching:tasks:history" }));
  assert.match(history, /可搜索历史课次/);
  assert.match(history, /未来源课次/);
  const range = render(React.createElement(EduPiTeachingWorkspace, { ...props, selectedObjectId: "teaching:tasks:2026-09-20:2026-09-20:history" }));
  assert.match(range, /可搜索历史课次/);
  assert.doesNotMatch(range, /未来源课次/);
  assert.match(range, /2026-09-20 至 2026-09-20/);
  assert.equal(data.tasks.length, 2);
});

test("sidebars count the same foreground tasks and keep expired calendar facts out of default rows", () => {
  const data = buildEducationContract({ tasks: Array.from({ length: 15 }, (_, index) => ({ id: `current-${index}`, title: `合成备课 ${index}`, due_date: "2026-10-08", status: "planned", evidence: {} })), calendar: [{ id: "old-event", name: "过期侧栏校历", date: "2026-09-01", source: "teacher", confidence: "teacher_confirmed" }] });
  data.tasks.push({ ...data.tasks[0], id: "old", title: "过期侧栏备课", dueDate: "2026-09-01" });
  const props = { data, query: "", context: null, memoryScopes: null, teachingSkills: { teacherGrowth: [], skills: [] }, selectedObjectId: null, selectedTaskKey: null, selectedStudentId: null, onQuery() {}, onStudent() {}, onTask() {}, onCollapse() {}, ...callbacks };
  const teaching = render(React.createElement(EduPiObjectSider, { ...props, view: "teaching" }));
  assert.match(teaching, /备课任务<\/strong><span>15<\/span>/);
  const calendar = render(React.createElement(EduPiObjectSider, { ...props, view: "calendar" }));
  assert.doesNotMatch(calendar, /过期侧栏校历/);
  const tasks = render(React.createElement(EduPiObjectSider, { ...props, view: "tasks" }));
  assert.doesNotMatch(tasks, /过期侧栏备课/);
  assert.match(tasks, /查看更多/);
  assert.equal((tasks.match(/class="edupi-object-row"/g) || []).length, 10);
});

test("review board applies transaction expiry without expiring stored teacher observations", () => {
  const data = buildEducationContract({ tasks: [
    { id: "old", title: "过期审核任务", due_date: "2026-09-01", status: "planned", content_status: "draft_ready", deliverables: ["合成草稿"], evidence: {} },
    { id: "current", title: "当天审核任务", due_date: "2026-10-07", status: "planned", content_status: "draft_ready", deliverables: ["合成草稿"], evidence: {} },
  ] });
  data.observations = Array.from({ length: 13 }, (_, index) => ({ observationId: `observation-${index}`, text: `合成长存观察 ${index}`, teacherReview: { state: "pending_review" }, evidenceIds: [] }));
  const html = render(React.createElement(EduPiReviewBoard, { data, query: "", reviewer: "synthetic", onTask() {}, onReviewTarget() {}, ...callbacks }));
  assert.doesNotMatch(html, /过期审核任务/);
  assert.match(html, /当天审核任务/);
  assert.match(html, /合成长存观察 0/);
  assert.doesNotMatch(html, /合成长存观察 12/);
  assert.match(html, /查看更多/);
  const full = render(React.createElement(EduPiReviewBoard, { data, query: "", reviewer: "synthetic", selectedObjectId: "review:list:observations", onTask() {}, onReviewTarget() {}, ...callbacks }));
  assert.match(full, /13 项 · 1 \/ 2 页/);
  assert.match(full, /← 待我确认/);
});

test("calendar source lists can browse all future facts and explicitly recover old facts", () => {
  const data = buildEducationContract({ calendar: Array.from({ length: 13 }, (_, index) => ({ id: `future-${index}`, name: `未来源事项 ${index}`, date: `2099-01-${String(index + 1).padStart(2, "0")}`, source: "teacher", confidence: "teacher_confirmed" })) });
  data.calendar.push({ ...data.calendar[0], id: "old-source", name: "可找回旧源事项", date: "2026-09-01", endDate: null });
  const props = { data, query: "", intakeBusy: false, selection: null, onSelect() {}, onImportCalendar() {}, onImportTimetable() {}, onDeleteEntity() {}, ...callbacks };
  const foreground = render(React.createElement(EduPiCalendarWorkspace, { ...props, selectedObjectId: "calendar:list:events" }));
  assert.match(foreground, /13 项 · 1 \/ 2 页/);
  assert.match(foreground, /未来源事项 0/);
  assert.doesNotMatch(foreground, /可找回旧源事项/);
  const history = render(React.createElement(EduPiCalendarWorkspace, { ...props, selectedObjectId: "calendar:history" }));
  assert.match(history, /可找回旧源事项/);
  assert.match(history, /校历历史/);
});
