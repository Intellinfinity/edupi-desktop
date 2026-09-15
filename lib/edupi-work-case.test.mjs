import assert from "node:assert/strict";
import test from "node:test";
import { buildEducationContract } from "./edupi-education-contract.ts";
import { activeLivingWorkCases, isTaskReviewable, taskRequiresWorkCase, taskWorkStatusLabel, todayActiveTasks, workCaseForTask, workCaseStateLabel, workCaseTransitionLabel } from "./edupi-work-case.ts";

function contract(workCases, taskOverrides = {}) {
  return buildEducationContract({
    tasks: [{ id: "task-1", title: "准备开学第一课", status: "planned", source_event_id: "event-1", due_date: "2026-08-31", scope: "teacher_internal", requires_teacher_review: true, external_send: false, ...taskOverrides }],
    snapshotPayload: { work_cases: workCases },
  });
}

const coreCase = {
  work_case_id: "work_case_11111111111111111111111111111111",
  case_kind: "calendar_preparation",
  trigger_id: "event-1",
  task_id: "task-1",
  title: "准备开学第一课",
  current_state: "running",
  due_date: "2026-08-31",
  execution_revision: 2,
  artifact_revision: 1,
  transition_revision: 2,
  source_ids: ["event-1"],
  artifact_ids: [],
  transitions: [
    { transition_id: "transition-1", sequence: 1, state: "queued", occurred_at: "2026-08-30T08:00:00.000Z", source_kind: "execution", source_id: "execution-1", artifact_ids: [], external_send: false },
    { transition_id: "transition-2", sequence: 2, state: "running", occurred_at: "2026-08-30T08:01:00.000Z", source_kind: "execution", source_id: "execution-1", artifact_ids: [], external_send: false },
  ],
  external_send: false,
};

test("projects one strict Core work case onto the matching calendar task", () => {
  const data = contract([coreCase]);
  assert.equal(data.workCases.length, 1);
  assert.deepEqual(data.workCases[0], {
    id: coreCase.work_case_id,
    kind: "calendar_preparation",
    triggerId: "event-1",
    taskId: "task-1",
    title: "准备开学第一课",
    currentState: "running",
    dueDate: "2026-08-31",
    executionRevision: 2,
    artifactRevision: 1,
    transitionRevision: 2,
    sourceIds: ["event-1"],
    artifactIds: [],
    artifacts: [],
    transitions: [
      { id: "transition-1", sequence: 1, state: "queued", occurredAt: "2026-08-30T08:00:00.000Z", sourceKind: "execution", sourceId: "execution-1", artifactIds: [], externalSend: false },
      { id: "transition-2", sequence: 2, state: "running", occurredAt: "2026-08-30T08:01:00.000Z", sourceKind: "execution", sourceId: "execution-1", artifactIds: [], externalSend: false },
    ],
    externalSend: false,
  });
  assert.equal(workCaseForTask(data, "task-1")?.id, coreCase.work_case_id);
  assert.equal(workCaseStateLabel(data.workCases[0].currentState), "正在准备");
  assert.equal(workCaseTransitionLabel(data.workCases[0].transitions[1]), "开始准备");
});

test("fails the complete work-case projection closed on ghosts, duplicates, or broken transition order", () => {
  assert.deepEqual(contract([{ ...coreCase, task_id: "missing-task" }]).workCases, []);
  assert.deepEqual(contract([coreCase, coreCase]).workCases, []);
  assert.deepEqual(contract([{ ...coreCase, transitions: [...coreCase.transitions].reverse() }]).workCases, []);
  assert.deepEqual(contract(undefined).workCases, []);
});

test("keeps a valid case when a separate malformed case is present", () => {
  const malformedTransition = { ...coreCase, work_case_id: "malformed-case", transitions: [{ ...coreCase.transitions[0], unknown: true }] };
  const data = contract([{ ...coreCase, task_id: "missing-task" }, malformedTransition, coreCase]);
  assert.equal(data.workCases.length, 1);
  assert.equal(data.workCases[0].id, coreCase.work_case_id);
});

test("projects capability packages and their complete artifact metadata", () => {
  const title = "安全教育工作总结";
  const triggerId = "safety-case-1";
  const taskId = "capability_task_1";
  const artifacts = [
    { artifact_id: "capability-artifact-summary", key: "summary", title: "安全教育工作总结", type: "markdown", relative_path: ".edupi/output/capability/summary.md", sha256: `sha256:${"a".repeat(64)}`, revision: 2, evidence_ids: ["evidence-1"], external_send: false },
    { artifact_id: "capability-artifact-gaps", key: "gaps", title: "材料缺口清单", type: "markdown", relative_path: ".edupi/output/capability/gaps.md", sha256: `sha256:${"b".repeat(64)}`, revision: 1, evidence_ids: ["evidence-2"], external_send: false },
  ];
  const data = buildEducationContract({
    tasks: [{ id: taskId, title, trigger: "capability_package", status: "planned", content_status: "draft_ready", source_event_id: triggerId, due_date: "2026-09-30", deliverables: artifacts.map(item => item.title), audience: [], requires_teacher_review: true, external_send: false, scope: "teacher_internal", evidence: { source_summary: "学期安全教育记录" } }],
    snapshotPayload: { work_cases: [{ ...coreCase, work_case_id: "capability_work_1", case_kind: "capability_package", trigger_id: triggerId, task_id: taskId, title, current_state: "draft_ready", due_date: "2026-09-30", artifact_revision: 2, transition_revision: 0, source_ids: [triggerId], artifact_ids: artifacts.map(item => item.artifact_id), artifacts, transitions: [] }] },
  });
  assert.equal(data.workCases.length, 1);
  assert.equal(data.workCases[0].kind, "capability_package");
  assert.deepEqual(data.workCases[0].artifacts.map(item => [item.id, item.relativePath]), [
    ["capability-artifact-summary", ".edupi/output/capability/summary.md"],
    ["capability-artifact-gaps", ".edupi/output/capability/gaps.md"],
  ]);
});

test("orders only live Core flow states for the Today strip", () => {
  const data = contract([
    coreCase,
    { ...coreCase, work_case_id: "work_case_22222222222222222222222222222222", current_state: "draft_ready", task_id: "task-1" },
  ]);
  assert.deepEqual(data.workCases, [], "duplicate task identities fail closed before UI ordering");
  assert.deepEqual(activeLivingWorkCases([{ ...contract([coreCase]).workCases[0], currentState: "planned" }, contract([coreCase]).workCases[0]]).map((item) => item.currentState), ["running"]);
});

test("Today includes a reviewed task when a newer board move reopens it", () => {
  const acceptedCase = { ...coreCase, current_state: "accepted", execution_revision: 0, artifact_revision: 0, transition_revision: 0, transitions: [] };
  const data = contract([acceptedCase], {
    status: "accepted",
    reviewed_at: "2026-08-30T08:00:00.000Z",
    board_stage: "progress",
    board_revision: 1,
    board_updated_at: "2026-08-30T09:00:00.000Z",
  });
  assert.deepEqual(todayActiveTasks(data).map(({ task, stateLabel }) => [task.id, stateLabel]), [["task-1", "进行中"]]);
  assert.equal(taskWorkStatusLabel(data.tasks[0], data.workCases[0]), "进行中");
  const running = contract([coreCase]);
  assert.equal(taskWorkStatusLabel(running.tasks[0], running.workCases[0]), "正在准备");
  assert.equal(todayActiveTasks({ ...running, tasks: [{ ...running.tasks[0], title: "教师修订后的任务" }] })[0].title, "教师修订后的任务");
  const manuallyCompleted = contract([{ ...coreCase, current_state: "draft_ready", transitions: [{ ...coreCase.transitions[0], state: "draft_ready" }], transition_revision: 1 }], {
    board_stage: "done",
    board_revision: 1,
    board_updated_at: "2026-08-30T09:00:00.000Z",
  });
  assert.equal(taskWorkStatusLabel(manuallyCompleted.tasks[0], manuallyCompleted.workCases[0]), "已完成");
});

test("Today includes a manually active teacher task without a work case", () => {
  const base = contract([]);
  const manual = { ...base.tasks[0], id: "manual-task", sourceEventId: null, status: "planned", boardStage: "progress", boardRevision: 1, boardUpdatedAt: "2026-08-30T09:00:00.000Z" };
  assert.deepEqual(todayActiveTasks({ ...base, tasks: [manual], workCases: [], workCandidates: [], taskSessions: {} }).map(({ task, workCase, stateLabel }) => [task.id, workCase, stateLabel]), [["manual-task", null, "进行中"]]);
});

test("accepts a teaching-before-class case only when it binds the matching timetable task", () => {
  const teaching = buildEducationContract({
    tasks: [{ id: "teaching-task-1", title: "第1周 · 数学 · 703 · 第2节课前准备", trigger: "teaching_before_class", status: "planned", source_event_id: "timetable:slot-1:2026-08-31", due_date: "2026-08-30", source_event_date: "2026-08-31", scope: "teacher_internal", requires_teacher_review: true, external_send: false }],
    snapshotPayload: { work_cases: [{ ...coreCase, work_case_id: "work_case_33333333333333333333333333333333", case_kind: "teaching_before_class", trigger_id: "timetable:slot-1:2026-08-31", task_id: "teaching-task-1", title: "第1周 · 数学 · 703 · 第2节课前准备", current_state: "planned", due_date: "2026-08-30", execution_revision: 0, artifact_revision: 0, transition_revision: 0, source_ids: ["timetable:slot-1:2026-08-31"], artifact_ids: [], transitions: [] }] },
  });
  assert.equal(teaching.workCases.length, 1);
  assert.equal(teaching.workCases[0].kind, "teaching_before_class");
});

test("fails the complete work-case projection closed when case kind and task trigger are semantically swapped", () => {
  assert.deepEqual(contract([{ ...coreCase, case_kind: "teaching_before_class" }]).workCases, []);
  assert.deepEqual(contract([coreCase], { trigger: "teaching_before_class" }).workCases, []);
});

test("requires Core work cases for producer-eligible tasks but preserves genuine legacy fallback", () => {
  const expectedCoreTask = contract([], { content_status: "ready", deliverables: ["讲义"] }).tasks[0];
  assert.equal(taskRequiresWorkCase(expectedCoreTask), true);
  assert.equal(isTaskReviewable(expectedCoreTask, null), false);

  const legacyTask = buildEducationContract({
    tasks: [{ title: "历史兼容任务", status: "planned", content_status: "ready", deliverables: ["讲义"], audience: ["teacher"], requires_teacher_review: true, external_send: false, scope: "teacher_internal", evidence: { source_summary: "历史来源" } }],
    snapshotPayload: { work_cases: [] },
  }).tasks[0];
  assert.equal(taskRequiresWorkCase(legacyTask), false);
  assert.equal(isTaskReviewable(legacyTask, null), true);
});
