import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});

const { EduPiTaskWorkspace } = await jiti.import("./EduPiTaskWorkspace.tsx");
const { isTaskReviewable } = await jiti.import("../lib/edupi-work-case.ts");

const [workspace, sider, taskWorkspace, taskStage, preparationAction, preparationRoute, panel] = await Promise.all([
  readFile(new URL("./EduPiTeachingWorkspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("./EduPiObjectSider.tsx", import.meta.url), "utf8"),
  readFile(new URL("./EduPiTaskWorkspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("./EduPiTaskStage.tsx", import.meta.url), "utf8"),
  readFile(new URL("./EduPiTaskPreparationAction.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/edupi/preparation/route.ts", import.meta.url), "utf8"),
  readFile(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8"),
]);

test("teaching home is driven by Core before-class tasks and work cases", () => {
  assert.match(workspace, /task\.trigger === "teaching_before_class"/);
  assert.match(workspace, /workCase\.kind === "teaching_before_class"/);
  assert.match(workspace, /workCaseForTask\(data, task\.id\)/);
  assert.match(workspace, /本周课前准备/);
  assert.match(workspace, /task\.evidence\.source_summary/);
  assert.match(workspace, /weekPreparationIds\.has\(workCase\.taskId\)/);
  assert.match(workspace, /isTaskReviewable\(task, workCase\)/);
  assert.match(workspace, /teachingPreparationSummary\(task\)/);
  assert.match(sider, /taskCategory\(task\) === "teaching"/);
});

test("teaching task detail uses the same Core work case and distinguishes class date from deadline", () => {
  assert.match(panel, /workCase=\{workCaseForTask\(education, activeTask\.id\)\}/);
  assert.match(taskWorkspace, /workCaseStateLabel\(props\.workCase\.currentState\)/);
  assert.match(taskWorkspace, /`上课 \$\{props\.task\.sourceEventDate\}/);
  assert.match(taskWorkspace, /` · 截止 \$\{props\.task\.dueDate\}`/);
  assert.match(taskWorkspace, /isTaskReviewable\(props\.task, props\.workCase\)/);
  assert.match(taskStage, /disabled=\{!reviewable\}/);
  assert.match(taskStage, /reviewable \? "进入审核" : "等待产物"/);
});

test("next-lesson preparation opens the existing task flow and never fabricates completion", () => {
  assert.match(workspace, /nextTeachingTask \? onTask\(nextTeachingTask\)/);
  assert.match(workspace, /workCaseStateLabel/);
  assert.doesNotMatch(workspace, /setInterval|setTimeout|Math\.random|localStorage/);
});

test("eligible task details can start exact Core preparation without opening chat", () => {
  assert.match(taskWorkspace, /\["teaching_before_class", "calendar_preparation"\]\.includes\(props\.workCase\.kind\)/);
  assert.match(taskStage, /<EduPiTaskPreparationAction taskId=\{task\.id\}/);
  assert.match(preparationAction, /JSON\.stringify\(\{ action: "run", taskId \}\)/);
  assert.match(preparationAction, /window\.dispatchEvent\(new Event\("edupi-preparation-updated"\)\)/);
  assert.match(preparationAction, /onReadyRef\.current\(\)/);
  assert.match(preparationRoute, /item\.taskId === body\.taskId/);
  assert.match(preparationRoute, /startPreparation\(\{ taskId: body\.taskId \}\)/);
});

const task = {
  id: "teaching-task-1",
  title: "第1周 · 数学 · 703 · 第2节课前准备",
  trigger: "teaching_before_class",
  status: "planned",
  contentStatus: "ready",
  sourceEventId: "timetable:slot-1:2026-09-02",
  sourceEventName: "第2节数学",
  sourceEventDate: "2026-09-02",
  dueDate: "2026-09-01",
  deliverables: ["课堂讲义"],
  audience: ["teacher"],
  requiresTeacherReview: true,
  externalSend: false,
  scope: "teacher_internal",
  student: null,
  studentEventType: null,
  materialId: null,
  materialKind: null,
  topic: "一次函数",
  revision: 0,
  reviewedAt: null,
  reviewer: null,
  reviewNote: null,
  reviewHistory: [],
  evidence: { source_summary: "课表：第2节数学" },
  boardStage: null,
  boardRevision: 0,
  boardUpdatedAt: null,
};

const workCase = (artifactIds, artifacts = []) => ({
  id: "work_case_44444444444444444444444444444444",
  kind: "teaching_before_class",
  triggerId: task.sourceEventId,
  taskId: task.id,
  title: task.title,
  currentState: "draft_ready",
  dueDate: task.dueDate,
  executionRevision: 1,
  artifactRevision: artifactIds.length ? 1 : 0,
  transitionRevision: 0,
  sourceIds: [task.sourceEventId],
  artifactIds,
  artifacts,
  transitions: [],
  externalSend: false,
});

function renderTaskWorkspace(boundWorkCase, stage = "review", files = [], workReview = false) {
  return renderToStaticMarkup(React.createElement(EduPiTaskWorkspace, {
    task,
    files,
    workReview,
    workCase: boundWorkCase,
    stage,
    workspace: "/workspace",
    context: null,
    reviewEnabled: true,
    reviewReason: "Core review enabled",
    reviewBusy: null,
    reviewMessage: null,
    agentSession: null,
    taskSessionBusy: false,
    taskSessionError: null,
    onStage() {},
    async onReview() {},
    onOpenAgent() {},
    onOpenFile() {},
  }));
}

test("blocks review navigation and teacher actions until Core and projected artifacts exist", () => {
  const html = renderTaskWorkspace(workCase([]));
  assert.equal(isTaskReviewable(task, workCase([])), false);
  assert.match(html, /data-stage="review"[^>]*disabled/);
  assert.match(html, /等待产物/);
  assert.doesNotMatch(html, /aria-label="教师审核动作"/);
  assert.doesNotMatch(html, />接受<\/button>/);
  assert.match(renderTaskWorkspace(workCase([]), "artifact"), /<button[^>]*disabled[^>]*>等待产物<\/button>/);
});

test("enables review navigation and teacher actions only for a fully evidenced work case", () => {
  const html = renderTaskWorkspace(workCase(["artifact-1"]));
  assert.equal(isTaskReviewable(task, workCase(["artifact-1"])), true);
  assert.doesNotMatch(html, /data-stage="review"[^>]*disabled/);
  assert.match(html, /aria-label="教师审核动作"/);
  assert.match(html, />接受<\/button>/);
});

test("shows direct preparation only on supported Core work cases", () => {
  assert.match(renderTaskWorkspace(workCase([]), "run"), />立即准备<\/button>/);
  assert.doesNotMatch(renderTaskWorkspace({ ...workCase([]), kind: "student_follow_up" }, "run"), />立即准备<\/button>/);
});

test("artifact stage renders each linked file once and excludes other tasks", () => {
  const files = [
    {artifact_id:"a",task_id:task.id,title:"真实教案",relative_path:".edupi/output/a.md",available:true},
    {artifact_id:"b",task_id:task.id,title:"真实学案",relative_path:".edupi/output/b.md",available:false},
    {artifact_id:"c",task_id:"other",title:"其他任务文件",relative_path:".edupi/output/c.md"},
  ];
  const html = renderTaskWorkspace(workCase(["a","b"]),"artifact",files);
  assert.equal((html.match(/>真实教案<\/button>/g)||[]).length,1);
  assert.match(html,/<button[^>]*disabled[^>]*>真实学案<\/button>/);
  assert.doesNotMatch(html,/其他任务文件|本次对话文件/);
  assert.match(renderTaskWorkspace(workCase([]),"artifact"),/暂无可打开的产物/);
});

test("artifact stage opens every Core capability-package file without a generated-artifact fallback", () => {
  const artifacts = [
    { id: "summary", title: "安全教育工作总结", relativePath: ".edupi/output/capability/summary.md" },
    { id: "gaps", title: "材料缺口清单", relativePath: ".edupi/output/capability/gaps.md" },
  ];
  const html = renderTaskWorkspace({ ...workCase(artifacts.map(item => item.id), artifacts), kind: "capability_package" }, "artifact");
  assert.match(html, />安全教育工作总结<\/button>/);
  assert.match(html, />材料缺口清单<\/button>/);
  assert.equal((html.match(/\.edupi\/output\/capability\//g) || []).length, 0, "local paths stay in click handlers rather than visible copy");
});

test("canonical work review only offers supported editing fields", () => {
  const html = renderTaskWorkspace(workCase(["artifact-1"]),"review",[],true);
  assert.match(html,/>接受<\/button>/);
  assert.doesNotMatch(html,/>回滚<\/button>|教学产物<textarea/);
});
