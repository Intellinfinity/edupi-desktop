import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildEducationContract } = await jiti.import("./edupi-education-contract.ts");
const {
  moduleFromView,
  isTaskActionable,
  isUserFacingMemory,
  groupEducationInsights,
  taskAgentSteps,
  taskArtifacts,
  confirmedTaskArtifacts,
  taskArtifactFile,
  taskChecklist,
  taskContentReady,
  taskContentStatusLabel,
  taskDisplayTitle,
  taskEvidenceRows,
  taskSourceLabel,
  taskSourceFile,
  taskPresentation,
  taskStatusLabel,
  taskStatusTone,
  taskTypeLabel,
  groupWorkCandidates,
  workCandidateReasonLabel,
  viewFromModule,
} = await jiti.import("./edupi-workbench.ts");

const candidate = buildEducationContract({
  workspace: "/tmp/edupi",
  tasks: [{
    id: "task-candidate",
    title: "错因归类与下一课调整",
    trigger: "teaching_adjustment_candidate",
    status: "planned",
    content_status: "not_generated",
    delivery_status: "not_approved",
    source_event_id: "material-1",
    source_event_name: "七年级作业",
    source_event_date: "2026-08-20",
    due_date: "2026-08-24",
    deliverables: ["错因核对清单", "下一课调整候选"],
    audience: ["teacher"],
    requires_teacher_review: true,
    external_send: false,
    scope: "teacher_internal",
    revision: 0,
    evidence: {
      source_memory: "teaching.json",
      source_entry_id: "material-1",
      source_date_status: "explicit",
      source_summary: "移项变号错误需要教师核对",
      inference_status: "candidate_only",
    },
  }],
}).tasks[0];

test("maps teacher navigation to the existing education modules", () => {
  assert.equal(moduleFromView("chat"), "home");
  assert.equal(moduleFromView("workspace"), "tasks");
  assert.equal(viewFromModule("tasks"), "tasks");
  assert.equal(viewFromModule("materials"), "materials");
  assert.equal(moduleFromView("teaching"), "tasks");
  assert.equal(moduleFromView("homeroom"), "students");
  assert.equal(moduleFromView("memory"), "home");
  assert.equal(moduleFromView("insights"), "home");
  assert.equal(moduleFromView("growth"), "home");
  assert.equal(moduleFromView("artifacts"), "home");
  assert.equal(moduleFromView("review"), "tasks");
});

test("uses the same teacher-facing task categories in every surface", () => {
  assert.equal(taskTypeLabel({ ...candidate, trigger: "teaching_node_preparation", title: "周计划准备" }), "教学准备");
  assert.equal(taskTypeLabel({ ...candidate, trigger: "calendar_event_preparation", title: "寒假准备" }), "校历节点");
  assert.equal(taskTypeLabel({ ...candidate, trigger: "monthly_class_activity", title: "班级活动" }), "活动安排");
  assert.equal(taskTypeLabel({ ...candidate, trigger: "teacher_created", title: "参加培训", topic: null }), "教师任务");
});

test("projects the task record into evidence, execution, artifacts, and checklist", () => {
  assert.equal(taskStatusLabel(candidate), "待审核");
  assert.deepEqual(taskAgentSteps(candidate).map((step) => step.state), ["done", "done", "active", "queued"]);
  assert.equal(taskArtifacts(candidate).length, 0);
  assert.equal(taskSourceFile(candidate, "/tmp/edupi"), "/tmp/edupi/.edupi/memory/teaching.json");
  assert.equal(taskEvidenceRows(candidate).some((row) => row.label === "引用片段"), true);
  assert.equal(taskChecklist(candidate).every((item) => item.state === "pass"), true);
});

test("surfaces unsafe task flags instead of treating color as the only signal", () => {
  const unsafe = { ...candidate, externalSend: true, requiresTeacherReview: false, audience: ["parent"] };
  const checklist = taskChecklist(unsafe);
  assert.equal(checklist.find((item) => item.id === "review")?.state, "attention");
  assert.equal(checklist.find((item) => item.id === "external")?.state, "attention");
});

test("confirmed task artifacts retain state without inventing artifact revision", () => {
  const confirmed = { ...candidate, status: "modified", contentStatus: "confirmed", revision: 3 };
  assert.equal(taskStatusLabel(confirmed), "修改后接受");
  assert.equal(taskContentReady(confirmed), true);
  assert.equal(taskAgentSteps(confirmed).at(-1)?.title, "教师审核");
  assert.deepEqual(taskArtifacts(confirmed).map((artifact) => artifact.state), ["confirmed", "confirmed"]);
  assert.equal("revision" in taskArtifacts(confirmed)[0], false);
  assert.equal(confirmedTaskArtifacts([confirmed]).length, 2);
  assert.equal(confirmedTaskArtifacts([confirmed], "核对清单").length, 1);
  assert.equal(confirmedTaskArtifacts([candidate]).length, 0);
});

test("an explicit completed board stage is visible in the shared task header", () => {
  const completed = { ...candidate, boardStage: "done" };
  assert.equal(taskStatusLabel(completed), "已完成");
  assert.equal(taskStatusTone(completed), "success");
});

test("centralizes cross-surface task presentation precedence", () => {
  const done = { ...candidate, contentStatus: "draft_ready", boardStage: "done", boardRevision: 0 };
  const manualProgress = { ...candidate, contentStatus: "generation_failed", boardStage: "progress", boardRevision: 2 };
  const manualReview = { ...candidate, contentStatus: "generating", boardStage: "review", boardRevision: 2 };
  const manualTodo = { ...candidate, contentStatus: "draft_ready", boardStage: "todo", boardRevision: 2 };
  const failedTodo = { ...candidate, contentStatus: "generation_failed", boardStage: "todo", boardRevision: 0 };
  const accepted = { ...candidate, status: "accepted", boardStage: null, boardRevision: 0, contentStatus: null };
  const pending = { ...candidate, status: "planned", boardStage: null, boardRevision: 0, contentStatus: null };
  assert.deepEqual(taskPresentation(done), { label: "已完成", tone: "success" });
  assert.deepEqual(taskPresentation({ ...done, status: "rejected" }), { label: "已拒绝", tone: "danger" });
  assert.deepEqual(taskPresentation(manualProgress), { label: "进行中", tone: "warning" });
  assert.deepEqual(taskPresentation(manualReview), { label: "待你确认", tone: "warning" });
  assert.deepEqual(taskPresentation(manualTodo), { label: "待开始", tone: "warning" });
  assert.deepEqual(taskPresentation(failedTodo), { label: "准备失败", tone: "danger" });
  assert.deepEqual(taskPresentation(accepted), { label: "已接受", tone: "success" });
  assert.deepEqual(taskPresentation({...accepted,contentStatus:"draft_ready",boardStage:"review"}), {label:"已接受",tone:"success"});
  assert.deepEqual(taskPresentation(pending), { label: "待审核", tone: "warning" });
});

test("maps C9 execution states to teacher-facing status labels and steps", () => {
  const generating = { ...candidate, contentStatus: "generating", boardStage: "progress", deliverables: [] };
  const ready = { ...candidate, contentStatus: "draft_ready", boardStage: "review", deliverables: [] };
  const failed = { ...candidate, contentStatus: "generation_failed", boardStage: "progress", deliverables: [] };
  const failedTodo = { ...candidate, contentStatus: "generation_failed", boardStage: "todo" };
  assert.equal(taskContentStatusLabel(generating), "正在准备");
  assert.equal(taskStatusLabel(generating), "正在准备");
  assert.equal(taskStatusTone(generating), "warning");
  assert.equal(taskStatusLabel(ready), "待你确认");
  assert.deepEqual(taskAgentSteps(ready).map((step) => step.state), ["done", "done", "done", "active"]);
  assert.equal(taskStatusLabel(failed), "准备失败");
  assert.equal(taskContentStatusLabel(failedTodo), "准备失败");
  assert.equal(taskStatusTone(failed), "danger");
  assert.notEqual(taskAgentSteps(failed)[2]?.state, "active");
  assert.equal(taskAgentSteps(failed)[2]?.detail, "准备失败，可继续让 EduPi 做");
  assert.deepEqual(taskArtifacts(failed), []);
  const legacy = { ...candidate, contentStatus: "candidate_only" };
  assert.equal(taskContentReady(legacy), true);
  assert.equal(taskArtifacts(legacy).length, 2);
});

test("resolves the first available artifact file reference without changing the task", () => {
  const withArtifact = { ...candidate, contentStatus: "candidate_only", evidence: { ...candidate.evidence, artifact_file_path: ".edupi/output/lesson-plan.md", artifact_file_sha256: "a".repeat(64) } };
  assert.equal(taskContentReady(withArtifact), true);
  assert.deepEqual(taskArtifactFile(withArtifact, "/tmp/edupi"), { path: "/tmp/edupi/.edupi/output/lesson-plan.md", hash: "a".repeat(64) });
  assert.equal(taskArtifactFile(candidate, "/tmp/edupi"), null);
  assert.equal(taskArtifactFile({ ...candidate, evidence: { file_path: ".edupi/output/lesson-plan.md" } }, "/tmp/edupi"), null);
  const readyGeneric = { ...candidate, contentStatus: "draft_ready", evidence: { file_path: ".edupi/output/lesson-plan.md", file_sha256: "b".repeat(64) } };
  assert.deepEqual(taskArtifactFile(readyGeneric, "/tmp/edupi"), { path: "/tmp/edupi/.edupi/output/lesson-plan.md", hash: "b".repeat(64) });
  assert.equal(taskArtifactFile({ ...readyGeneric, contentStatus: "candidate_only" }, "/tmp/edupi"), null);
  assert.equal(taskArtifactFile({ ...readyGeneric, contentStatus: "confirmed" }, "/tmp/edupi"), null);
  assert.equal(taskArtifactFile({ ...withArtifact, contentStatus: "generation_failed" }, "/tmp/edupi"), null);
  assert.equal(taskArtifactFile({ ...readyGeneric, contentStatus: "generation_failed" }, "/tmp/edupi"), null);
});

test("keeps evidence rows teacher-facing and drops paths, hashes, ids, and unknown keys", () => {
  const rows = taskEvidenceRows({ ...candidate, evidence: {
    source_memory: ".edupi/memory/teaching.json",
    source_entry_id: "entry-1",
    source_event_type: "calendar_event_internal",
    source_summary: "移项变号错误需要教师核对",
    inference_status: "candidate_only",
    artifact_path: ".edupi/output/lesson-plan.md",
    artifact_hash: "a".repeat(64),
    unknown_internal_value: "should-not-render",
  } });
  assert.deepEqual(rows.map((row) => row.label), ["记录类型", "引用片段", "推断状态"]);
  assert.deepEqual(rows.map((row) => row.value), ["校历内部准备", "移项变号错误需要教师核对", "候选"]);
  assert.equal(rows.some((row) => /path|hash|id|unknown/i.test(`${row.label} ${row.value}`)), false);
  assert.deepEqual(taskEvidenceRows({ ...candidate, evidence: { source_event_type: "timetable_class", source_date_status: "explicit", inference_status: "confirmed" } }), [
    { label: "记录类型", value: "课表课次" },
    { label: "日期状态", value: "日期明确" },
    { label: "推断状态", value: "已确认" },
  ]);
  assert.deepEqual(taskEvidenceRows({ ...candidate, evidence: { source_event_type: "teaching" } }), [{ label: "记录类型", value: "教学安排" }]);
});

test("does not expose raw source identifiers as the task source label", () => {
  assert.equal(taskSourceLabel({ ...candidate, sourceEventName: null, topic: null, student: null, materialId: "material-1", sourceEventId: "event-1" }), "来源待核对");
});

test("does not invent an artifact when the safe store has no deliverable", () => {
  assert.deepEqual(taskArtifacts({ ...candidate, deliverables: [], contentStatus: "not_generated" }), []);
});

test("teacher-internal scope is shown as state rather than repeated in every task title", () => {
  assert.equal(taskDisplayTitle({ ...candidate, title: "材料证据：教学调整候选（教师内部）" }), "材料证据：教学调整候选");
  assert.equal(taskDisplayTitle({ ...candidate, title: "赵六：安全跟进 (教师内部)" }), "赵六：安全跟进");
  assert.equal(taskDisplayTitle({ ...candidate, title: "第0周 · 准备开学教师内部核对准备" }), "第0周 · 准备开学");
  assert.equal(taskDisplayTitle({ ...candidate, title: "赵六：safety跟进（教师内部）" }), "赵六：安全事件跟进");
});

test("only exposes work whose activation date has arrived as actionable", () => {
  const today = new Date(2026, 7, 24);
  assert.equal(isTaskActionable({ ...candidate, triggerDate: "2026-08-24", dueDate: "2026-08-24" }, today), true);
  assert.equal(isTaskActionable({ ...candidate, triggerDate: "2026-08-31", dueDate: "2026-08-31" }, today), false);
  assert.equal(isTaskActionable({ ...candidate, status: "accepted", triggerDate: "2026-08-20" }, today), false);
  assert.equal(isTaskActionable({ ...candidate, boardStage: "done", triggerDate: "2026-08-20" }, today), false);
});

test("groups Today work candidates by lifecycle with deterministic ordering", () => {
  const review = (reviewedAt) => ({ state: "accepted", reviewerId: "teacher", reviewedAt, note: null, revision: 1 });
  const candidate = (candidateId, status, dueAt, snoozeUntil, reviewedAt) => ({
    candidateId,
    taskId: candidateId,
    snapshotId: "snapshot",
    stateHash: "sha256:state",
    revision: 1,
    title: candidateId,
    summary: candidateId,
    dueAt,
    reason: "fixture",
    sourceIds: [candidateId],
    evidenceIds: [`evidence-${candidateId}`],
    status,
    snoozeUntil,
    suppressionScope: null,
    nextCycleState: "awaiting_teacher",
    teacherReview: review(reviewedAt),
    externalSend: false,
  });
  const groups = groupWorkCandidates([
    candidate("done-old", "rejected", "2026-08-01", null, "2026-08-20T08:00:00.000Z"),
    candidate("later-due", "held", "2026-09-04", null, null),
    candidate("now-late", "pending_review", "2026-09-03", null, null),
    candidate("done-new", "modified", "2026-08-02", null, "2026-08-22T08:00:00.000Z"),
    candidate("later-snooze", "snoozed", "2026-09-02", "2026-09-01", null),
    candidate("now-early", "pending_review", "2026-09-01", null, null),
    candidate("done-suppressed", "suppressed", null, null, "2026-08-21T08:00:00.000Z"),
  ]);
  assert.deepEqual(groups.now.map((item) => item.candidateId), ["now-early", "now-late"]);
  assert.deepEqual(groups.later.map((item) => item.candidateId), ["later-snooze", "later-due"]);
  assert.deepEqual(groups.done.map((item) => item.candidateId), ["done-new", "done-suppressed", "done-old"]);
});

test("hides only the known planner rule/source token from Today reason copy", () => {
  assert.equal(workCandidateReasonLabel("校历节奏规则 fixture_calendar 触发；来源 calendar-1。"), "校历节点临近");
  assert.equal(workCandidateReasonLabel("前缀：校历节奏规则 weekly_homeroom 触发；来源 slot-1。"), "校历节点临近");
  assert.equal(workCandidateReasonLabel("课表课次 timetable:teacher_timetable_703_mon_2:2026-09-07 提前 1 天进入教师内部准备。"), "临近上课时间");
  assert.equal(workCandidateReasonLabel("教师说明：请先核对这项准备。"), "教师说明：请先核对这项准备。");
});

test("keeps reminder delivery logs out of the teacher-facing memory surface", () => {
  const memory = { id: "m1", category: "semester", content: "EduPi 主动提醒老师：准备开学", student: null, tags: ["主动提醒", "EduPi已说"], count: 1, createdAt: null, updatedAt: null, state: "active" };
  assert.equal(isUserFacingMemory(memory), false);
  assert.equal(isUserFacingMemory({ ...memory, content: "九月开始教授七年级数学", tags: ["七年级"] }), true);
});

test("clusters repeated insight records into teacher-readable themes", () => {
  const base = { evidenceIds: ["m1"], confidence: 0.8, status: "surfaced", createdAt: "2026-08-24T10:00:00.000Z", surfacedAt: null };
  const groups = groupEducationInsights([
    { ...base, id: "i1", content: "安全事件处理完成后仍被重复提醒" },
    { ...base, id: "i2", content: "摔伤送医事项应在完成后停止提醒", createdAt: "2026-08-23T10:00:00.000Z" },
    { ...base, id: "i3", content: "工作总结截止前保留协助能力" },
  ]);
  assert.deepEqual(groups.map((item) => [item.topic, item.relatedCount]), [["安全闭环", 2], ["工作节奏", 1]]);
});

test("projects EduPi long-term memory, insights, learning themes, and professional records", () => {
  const contract = buildEducationContract({
    memoryStores: {
      semester: { entries: [{ id: "mem-1", content: "九月开始七年级数学教学", tags: ["七年级", "数学"], count: 2, created_at: "2026-08-20T10:00:00.000Z" }] },
      class: { entries: [{ id: "mem-2", content: "某学生需要继续观察移项概念", student: "某学生", superseded_by: "mem-3" }] },
      teaching: { entries: [{ id: "mem-3", content: "用等式天平解释移项更有效", updated_at: "2026-08-23T10:00:00.000Z" }] },
    },
    subconscious: {
      signals: [{ id: "signal-1", content: "周五下午状态可能波动", related: ["周五"], strength: 2, last_seen: "2026-08-23T12:00:00.000Z" }],
      insights: [{ id: "insight-1", content: "完成状态应立即终止重复提醒", evidence: ["mem-1"], confidence: 0.85, status: "surfaced", created_at: "2026-08-23T15:00:00.000Z" }],
      themes: { "提醒去重": { count: 5, status: "pending_review", skill_candidate: true, evidence_ids: ["mem-1"], last_dream: "2026-08-23T15:00:00.000Z" } },
      last_dream: "2026-08-23T15:00:00.000Z",
    },
    subjectKnowledge: {
      数学: {
        一元一次方程: { mastery: 0.5, common_errors: [{ desc: "移项变号", count: 3, students: ["某学生"] }], struggling_students: ["某学生"], prerequisites: ["等式性质"], updated_at: "2026-08-23T10:00:00.000Z" },
      },
    },
    parentProfiles: {
      "某学生家长": { student: "某学生", name: "某学生家长", relationship: "母亲", communication_style: ["平和"], history: [{ date: "2026-08-22", topic: "学习近况", outcome: "继续观察" }] },
    },
    documents: [{ id: "weekly-1", kind: "weekly", title: "本周沉淀", date: "2026-08-23", path: ".edupi/output/weekly/2026-W34.md", excerpt: "本周课堂观察与下周调整。" }],
  });

  assert.deepEqual(contract.continuity.memories.map((item) => item.category), ["semester", "class", "teaching"]);
  assert.equal(contract.continuity.memories.find((item) => item.id === "mem-2")?.state, "superseded");
  assert.equal(contract.continuity.signals[0]?.strength, 2);
  assert.equal(contract.continuity.insights[0]?.evidenceIds.length, 1);
  assert.equal(contract.continuity.themes[0]?.reviewState, "pending_review");
  assert.equal(contract.continuity.subjectKnowledge[0]?.commonErrors[0]?.description, "移项变号");
  assert.equal(contract.continuity.familyContacts[0]?.lastContactAt, "2026-08-22");
  assert.equal(contract.continuity.documents[0]?.path, ".edupi/output/weekly/2026-W34.md");
  assert.equal(contract.continuity.lastDreamAt, "2026-08-23T15:00:00.000Z");
});
