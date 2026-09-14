import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createJiti } from "jiti";
import { buildEducationContract } from "../lib/edupi-education-contract.ts";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});

const [{ EduPiReviewBoard }, { EduPiInspector }, { EduPiTaskWorkspace }, { isTaskReviewable, taskRequiresWorkCase }] = await Promise.all([
  jiti.import("./EduPiReviewBoard.tsx"),
  jiti.import("./EduPiInspector.tsx"),
  jiti.import("./EduPiTaskWorkspace.tsx"),
  jiti.import("../lib/edupi-work-case.ts"),
]);

const task = {
  id: "review-gate-task",
  title: "审核门禁测试任务",
  trigger: "teaching_before_class",
  status: "planned",
  contentStatus: "ready",
  deliveryStatus: null,
  sourceEventId: "timetable:review-gate",
  sourceEventName: "审核门禁课",
  sourceEventDate: "2026-09-02",
  triggerDate: null,
  dueDate: "2026-09-01",
  deliverables: ["审核门禁讲义"],
  audience: ["teacher"],
  requiresTeacherReview: true,
  externalSend: false,
  scope: "teacher_internal",
  student: null,
  studentEventType: null,
  materialId: null,
  materialKind: null,
  topic: "审核门禁",
  revision: 0,
  reviewedAt: null,
  reviewer: null,
  reviewNote: null,
  reviewHistory: [],
  evidence: { source_summary: "课表：审核门禁课" },
  boardStage: null,
  boardRevision: 0,
  boardUpdatedAt: null,
};

function workCase(artifactIds) {
  return {
    id: "work_case_review_gate",
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
    transitions: [],
    externalSend: false,
  };
}

function dataFor(boundWorkCase) {
  return {
    tasks: [task],
    workCases: [boundWorkCase],
    observations: [],
    memoryCandidates: [],
    taskSessions: {},
    capabilities: { taskReview: { enabled: true, reason: "Core review enabled" } },
  };
}

function renderBoard(boundWorkCase) {
  return renderBoardData(dataFor(boundWorkCase));
}

function renderBoardData(data) {
  return renderToStaticMarkup(React.createElement(EduPiReviewBoard, {
    data,
    query: "",
    onTask() {},
    onReviewTarget() {},
  }));
}

function renderInspector(boundWorkCase) {
  return renderInspectorData(dataFor(boundWorkCase));
}

function renderInspectorData(data) {
  return renderToStaticMarkup(React.createElement(EduPiInspector, {
    open: true,
    data,
    task: data.tasks[0],
    onClose() {},
    onOpenAgent() {},
    onStage() {},
  }));
}

function renderTaskWorkspaceData(data) {
  const taskValue = data.tasks[0];
  const boundWorkCase = data.workCases.find((candidate) => candidate.taskId === taskValue.id) ?? null;
  return renderToStaticMarkup(React.createElement(EduPiTaskWorkspace, {
    task: taskValue,
    workCase: boundWorkCase,
    stage: "review",
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

test("review board excludes a task whose Core work case has no artifacts", () => {
  const html = renderBoard(workCase([]));
  assert.equal(isTaskReviewable(task, workCase([])), false);
  assert.match(html, />0<\/em>/);
  assert.doesNotMatch(html, /审核门禁测试任务/);
  assert.match(html, /暂无任务/);
});

test("review board includes a task with Core and projected artifacts", () => {
  const html = renderBoard(workCase(["artifact-1"]));
  assert.equal(isTaskReviewable(task, workCase(["artifact-1"])), true);
  assert.match(html, /审核门禁测试任务/);
  assert.match(html, />1<\/em>/);
});

test("Inspector disables review entry but keeps collaboration available without artifacts", () => {
  const html = renderInspector(workCase([]));
  assert.match(html, />等待产物<\/button>/);
  assert.match(html, /disabled/);
  assert.doesNotMatch(html, />进入审核<\/button>/);
  assert.match(html, />打开协作<\/button>/);
});

test("Inspector enables review entry when Core and projected artifacts exist", () => {
  const html = renderInspector(workCase(["artifact-1"]));
  assert.match(html, />进入审核<\/button>/);
  assert.doesNotMatch(html, />等待产物<\/button>/);
});

function rawTask(trigger) {
  return {
    id: task.id,
    title: task.title,
    trigger,
    status: "planned",
    content_status: "ready",
    source_event_id: task.sourceEventId,
    due_date: task.dueDate,
    deliverables: task.deliverables,
    audience: ["teacher"],
    requires_teacher_review: true,
    external_send: false,
    scope: "teacher_internal",
    evidence: task.evidence,
  };
}

function rawWorkCase(caseKind) {
  return {
    work_case_id: "work_case_review_gate_mismatch",
    case_kind: caseKind,
    trigger_id: task.sourceEventId,
    task_id: task.id,
    title: task.title,
    current_state: "draft_ready",
    due_date: task.dueDate,
    execution_revision: 1,
    artifact_revision: 1,
    transition_revision: 0,
    source_ids: [task.sourceEventId],
    artifact_ids: ["artifact-1"],
    transitions: [],
    external_send: false,
  };
}

test("fails expected Core cases closed through both semantic mismatch directions", () => {
  const mismatches = [
    ["teaching_before_class", "calendar_event_internal"],
    ["calendar_preparation", "teaching_before_class"],
  ];
  for (const [caseKind, trigger] of mismatches) {
    const data = buildEducationContract({
      tasks: [rawTask(trigger)],
      snapshotPayload: { work_cases: [rawWorkCase(caseKind)] },
    });
    const normalizedTask = data.tasks[0];
    assert.deepEqual(data.workCases, []);
    assert.equal(taskRequiresWorkCase(normalizedTask), true);
    assert.equal(isTaskReviewable(normalizedTask, null), false);
    assert.doesNotMatch(renderBoardData(data), /审核门禁测试任务/);
    assert.match(renderTaskWorkspaceData(data), /data-stage="review"[^>]*disabled/);
    assert.doesNotMatch(renderTaskWorkspaceData(data), /aria-label="教师审核动作"/);
    assert.match(renderInspectorData(data), />等待产物<\/button>/);
  }
});

test("keeps projected-artifact review compatibility for a genuine legacy task", () => {
  const data = buildEducationContract({
    tasks: [{
      title: "历史兼容任务",
      status: "planned",
      content_status: "ready",
      deliverables: ["历史讲义"],
      audience: ["teacher"],
      requires_teacher_review: true,
      external_send: false,
      scope: "teacher_internal",
      evidence: { source_summary: "历史来源" },
    }],
    snapshotPayload: { work_cases: [] },
  });
  const legacyTask = data.tasks[0];
  assert.equal(taskRequiresWorkCase(legacyTask), false);
  assert.equal(isTaskReviewable(legacyTask, null), true);
  assert.match(renderBoardData(data), /历史兼容任务/);
  assert.doesNotMatch(renderTaskWorkspaceData(data), /data-stage="review"[^>]*disabled/);
  assert.match(renderInspectorData(data), />进入审核<\/button>/);
});

test("sidebar and panel review surfaces consume the shared reviewability predicate", async () => {
  const [sider, panel] = await Promise.all([
    readFile(new URL("./EduPiObjectSider.tsx", import.meta.url), "utf8"),
    readFile(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(sider, /const pendingReview = pending\.filter\(\(task\) => isTaskReviewable\(task, workCaseForTask\(data, task\.id\)\)\)/);
  assert.match(sider, /CategoryRow label="审核看板" count=\{pendingReview\.length \+ pendingC1\.length \+ pendingFacts\.length\}/);
  assert.match(sider, /GroupTitle count=\{pendingReview\.length\}>任务审核/);
  assert.match(sider, /taskRows\(pendingReview, "review"\)/);
  assert.match(panel, /const reviewable = \(task: TeacherTask\) => isTaskActionable\(task\) && isTaskReviewable\(task, education \? workCaseForTask\(education, task\.id\) : null\)/);
  assert.match(panel, /const pendingCount = tasks\.filter\(\(task\) => isTaskActionable\(task\) && isTaskReviewable\(task, education \? workCaseForTask\(education, task\.id\) : null\)\)\.length/);
});

test("Inspector guards review stage selection with the same predicate", async () => {
  const inspector = await readFile(new URL("./EduPiInspector.tsx", import.meta.url), "utf8");
  assert.match(inspector, /const reviewable = task \? isTaskReviewable\(task, workCaseForTask\(data, task\.id\)\) : false/);
  assert.match(inspector, /if \(!reviewable\) return;/);
});
