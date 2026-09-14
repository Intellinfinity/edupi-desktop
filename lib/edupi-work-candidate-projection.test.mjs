import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildEducationContractFromWorkspace } = await jiti.import("./edupi-education-contract.ts");

const commands = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate"];
const sourceDate = "2026-09-10";
const workspaceTask = ({ id, title, status, dueDate, revision, reviewedAt, reviewer, reviewNote, evidenceId, sourceEventId = `event-${id}`, sourceEventName = "教师节", sourceEventDate = sourceDate, sourceDateStatus = "explicit" }) => ({
  task_id: id,
  title,
  trigger: "calendar_review",
  status,
  content_status: "not_generated",
  delivery_status: "not_approved",
  source_event_id: sourceEventId,
  source_event_name: sourceEventName,
  source_event_date: sourceEventDate,
  trigger_date: dueDate,
  due_date: dueDate,
  deliverables: ["内部准备清单"],
  audience: ["teacher"],
  requires_teacher_review: true,
  external_send: false,
  scope: "teacher_internal",
  student: null,
  student_event_type: null,
  material_id: null,
  material_kind: null,
  topic: null,
  revision,
  reviewed_at: reviewedAt,
  reviewer,
  review_note: reviewNote,
  review_history: [],
  evidence: {
    rule: "fixture_calendar",
    source_memory: null,
    source_entry_id: evidenceId,
    source_event_type: "festival",
    material_kind: null,
    source_date_status: sourceDateStatus,
    source_summary: "已确认校历节点",
    inference_status: null,
    file_path: null,
    file_sha256: null,
  },
});

const candidate = ({ id, title, summary, status, revision, teacherReview, snoozeUntil = null, suppressionScope = null, nextCycleState = "awaiting_teacher", evidenceId }) => ({
  projection_kind: "work_candidate",
  target: { target_kind: "work_candidate", target_id: id, command_type: "review_work_candidate" },
  revision,
  title,
  summary,
  status,
  source_ids: [id],
  evidence_ids: [evidenceId],
  teacher_review: teacherReview,
  external_send: false,
  reason: "下一节课需要教师准备",
  snooze_until: snoozeUntil,
  suppression_scope: suppressionScope,
  next_cycle_state: nextCycleState,
});

const baseWorkspace = {
  projection_kind: "education_workspace",
  projection_version: "1.1",
  state_hash: "sha256:workspace",
  generated_at: "2026-08-28T04:00:00.000Z",
  scope: "teacher_internal",
  external_send: false,
  requires_teacher_review: true,
  freshness: { state: "current", observed_at: "2026-08-28T04:00:00.000Z", source_hash: "sha256:workspace-source" },
  source_summaries: [],
  students: [],
  timetable: [],
  calendar: [],
  tasks: [],
  continuity: { memories: [], signals: [], insights: [], themes: [], subject_knowledge: [], teaching_priorities: [], family_contacts: [], documents: [], last_dream: null },
};

const basePayload = {
  snapshot_id: "snapshot-work-candidates",
  state_hash: "sha256:work-candidates",
  capabilities: { supported_commands: commands, supported_projections: ["education_workspace"] },
  education_workspace: baseWorkspace,
  observations: [],
  memory_candidates: [],
  memories: [],
  receipts: [],
  review_history: [],
};

function payloadWithCandidates() {
  const value = structuredClone(basePayload);
  const records = [
    { id: "work-pending", title: "待确认准备", status: "pending_review", taskStatus: "planned", dueAt: "2026-09-03", revision: 0, review: { state: "pending_review", reviewer_id: null, reviewed_at: null, note: null, revision: 0 }, evidence: "evidence-pending" },
    { id: "work-held", title: "暂缓准备", status: "held", taskStatus: "hold", dueAt: null, revision: 1, review: { state: "held", reviewer_id: "teacher", reviewed_at: "2026-08-28T04:01:00.000Z", note: "稍后再看", revision: 1 }, evidence: "evidence-held", sourceEventDate: null, sourceEventName: "待确认节点" },
    { id: "work-system-held", title: "待补日期准备", status: "held", taskStatus: "hold", dueAt: null, revision: 0, review: { state: "pending_review", reviewer_id: null, reviewed_at: null, note: null, revision: 0 }, evidence: "evidence-system-held", sourceEventDate: null, sourceEventName: "待确认节点", nextCycleState: "reopened_source_changed" },
    { id: "work-accepted-undated", title: "已接受无日期准备", status: "accepted", taskStatus: "accepted", dueAt: null, revision: 1, review: { state: "accepted", reviewer_id: "teacher", reviewed_at: "2026-08-28T04:01:30.000Z", note: "接受但等待日期", revision: 1 }, evidence: "evidence-accepted-undated", sourceEventDate: null, sourceEventName: "待确认节点" },
    { id: "work-snoozed", title: "暂缓提醒", status: "snoozed", taskStatus: "hold", dueAt: "2026-09-05", revision: 2, review: { state: "held", reviewer_id: "teacher", reviewed_at: "2026-08-28T04:02:00.000Z", note: "下周再看", revision: 2 }, evidence: "evidence-snoozed", snoozeUntil: "2026-09-08", nextCycleState: "snoozed" },
    { id: "work-suppressed", title: "不再提醒", status: "suppressed", taskStatus: "rejected", dueAt: "2026-09-06", revision: 3, review: { state: "rejected", reviewer_id: "teacher", reviewed_at: "2026-08-28T04:03:00.000Z", note: "同一原因暂不提醒", revision: 3 }, evidence: "evidence-suppressed", suppressionScope: "matching_reason", nextCycleState: "suppressed_matching_reason" },
    { id: "work-modified", title: "已调整准备", status: "modified", taskStatus: "modified", dueAt: "2026-09-07", revision: 4, review: { state: "modified", reviewer_id: "teacher", reviewed_at: "2026-08-28T04:04:00.000Z", note: "已调整", revision: 4 }, evidence: "evidence-modified" },
  ];
  value.education_workspace.tasks = records.map((record) => workspaceTask({
    id: record.id,
    title: record.title,
    status: record.taskStatus,
    dueDate: record.dueAt,
    revision: record.revision,
    reviewedAt: record.review.reviewed_at,
    reviewer: record.review.reviewer_id,
    reviewNote: record.review.note,
    evidenceId: record.evidence,
    sourceEventDate: record.sourceEventDate === undefined ? sourceDate : record.sourceEventDate,
    sourceEventName: record.sourceEventName === undefined ? "教师节" : record.sourceEventName,
  }));
  value.review_targets = records.map((record) => candidate({
    id: record.id,
    title: record.title,
    summary: `${record.title}说明`,
    status: record.status,
    dueAt: record.dueAt,
    revision: record.revision,
    teacherReview: record.review,
    evidenceId: record.evidence,
    snoozeUntil: record.snoozeUntil,
    suppressionScope: record.suppressionScope,
    nextCycleState: record.nextCycleState || (record.status === "held" ? "held" : "awaiting_teacher"),
    sourceEventDate: record.sourceEventDate === undefined ? sourceDate : record.sourceEventDate,
    sourceEventName: record.sourceEventName === undefined ? "教师节" : record.sourceEventName,
  }));
  return value;
}

function contract(snapshotPayload = payloadWithCandidates()) {
  return buildEducationContractFromWorkspace(snapshotPayload.education_workspace, {
    workspacePath: "/tmp/edupi-work-candidate-projection",
    snapshotPayload,
    supportedCommands: commands,
  });
}

test("projects work candidates separately with strict task joins and source fidelity", () => {
  const data = contract();
  assert.equal(data.tasks.length, 7);
  assert.equal(data.workCandidates.length, 7);
  assert.equal(data.workCandidateReceipts.length, 0);
  assert.equal(data.workCandidateReviewHistory.length, 0);
  for (const candidateValue of data.workCandidates) {
    const task = data.tasks.find((item) => item.id === candidateValue.taskId);
    assert.ok(task);
    assert.equal(candidateValue.candidateId, candidateValue.taskId);
    assert.equal(candidateValue.snapshotId, "snapshot-work-candidates");
    assert.equal(candidateValue.stateHash, "sha256:work-candidates");
    assert.equal(candidateValue.dueAt, task.dueDate);
    assert.equal(candidateValue.title, task.title);
    assert.equal(candidateValue.sourceIds.length, 1);
    assert.equal(candidateValue.sourceIds[0], candidateValue.candidateId);
    assert.deepEqual(candidateValue.evidenceIds, [task.evidence.source_entry_id]);
    assert.equal(task.sourceEventId, `event-${candidateValue.candidateId}`);
    assert.equal(task.sourceEventName, ["work-held", "work-system-held", "work-accepted-undated"].includes(candidateValue.candidateId) ? "待确认节点" : "教师节");
    assert.equal(task.sourceEventDate, ["work-held", "work-system-held", "work-accepted-undated"].includes(candidateValue.candidateId) ? null : sourceDate);
    assert.deepEqual(task.reviewHistory, []);
    assert.equal(task.externalSend, false);
    assert.equal(candidateValue.externalSend, false);
  }
  assert.equal(data.capabilities.c1Review.enabled, true);
  assert.equal(data.capabilities.teacherContextReview.enabled, true);
  assert.equal(data.capabilities.workCandidateReview.enabled, true);
  assert.deepEqual(data.capabilities.workCandidateReview.commands, ["review_work_candidate"]);
  assert.deepEqual(data.capabilities.workCandidateReview.actions, ["accept", "modify", "reject", "hold", "snooze", "suppress"]);
  assert.equal(JSON.stringify(data).includes("source_semantic_fingerprint"), false);
  assert.equal(JSON.stringify(data).includes("work_behavior"), false);
  assert.equal(JSON.stringify(data).includes("suppression_cycle"), false);
  assert.equal(data.workCandidates.find((item) => item.candidateId === "work-held")?.dueAt, null);
  assert.equal(data.workCandidates.find((item) => item.candidateId === "work-accepted-undated")?.status, "accepted");
  assert.equal(data.workCandidates.find((item) => item.candidateId === "work-accepted-undated")?.dueAt, null);
  assert.equal(data.workCandidates.find((item) => item.candidateId === "work-system-held")?.status, "held");
  assert.equal(data.workCandidates.find((item) => item.candidateId === "work-system-held")?.teacherReview.state, "pending_review");
  assert.equal(data.workCandidates.find((item) => item.candidateId === "work-system-held")?.dueAt, null);
});

test("rejects pending undated work while preserving other collections and capabilities", () => {
  const pendingUndated = payloadWithCandidates();
  pendingUndated.education_workspace.tasks[0].due_date = null;
  pendingUndated.education_workspace.tasks[0].trigger_date = null;
  pendingUndated.education_workspace.tasks[0].source_event_date = null;
  pendingUndated.education_workspace.tasks[0].evidence.source_date_status = "missing";
  const data = contract(pendingUndated);
  assert.deepEqual(data.workCandidates, []);
  assert.equal(data.tasks.length, 7);
  assert.deepEqual(data.observations, []);
  assert.deepEqual(data.memoryCandidates, []);
  assert.deepEqual(data.teacherContextCandidates, []);
  assert.equal(data.capabilities.c1Review.enabled, true);
  assert.equal(data.capabilities.teacherContextReview.enabled, true);
  assert.equal(data.capabilities.workCandidateReview.enabled, true);
});

test("rejects forged system-held combinations while keeping ordinary held review state strict", () => {
  const dueDated = payloadWithCandidates();
  const dueTask = dueDated.education_workspace.tasks.find((task) => task.task_id === "work-system-held");
  dueTask.due_date = "2026-09-03";
  dueTask.trigger_date = "2026-09-03";
  assert.deepEqual(contract(dueDated).workCandidates, []);

  const forgedReview = payloadWithCandidates();
  const forgedTarget = forgedReview.review_targets.find((target) => target.target.target_id === "work-system-held");
  forgedTarget.teacher_review.reviewer_id = "teacher";
  assert.deepEqual(contract(forgedReview).workCandidates, []);
});

test("fails closed for malformed, duplicate, or missing work joins without contaminating C1", () => {
  const valid = payloadWithCandidates();
  valid.review_targets[0].source_ids = ["wrong-source"];
  const malformed = contract(valid);
  assert.deepEqual(malformed.workCandidates, []);
  assert.deepEqual(malformed.memoryCandidates, []);

  const duplicate = payloadWithCandidates();
  duplicate.review_targets.push(structuredClone(duplicate.review_targets[0]));
  assert.deepEqual(contract(duplicate).workCandidates, []);

  const missingJoin = payloadWithCandidates();
  missingJoin.education_workspace.tasks = missingJoin.education_workspace.tasks.filter((task) => task.task_id !== "work-held");
  assert.deepEqual(contract(missingJoin).workCandidates, []);

  const duplicateJoin = payloadWithCandidates();
  duplicateJoin.education_workspace.tasks.push(structuredClone(duplicateJoin.education_workspace.tasks[0]));
  assert.deepEqual(contract(duplicateJoin).workCandidates, []);

  const invalidSnooze = payloadWithCandidates();
  invalidSnooze.review_targets[2].snooze_until = "2026-09-08T09:00:00.000Z";
  assert.deepEqual(contract(invalidSnooze).workCandidates, []);
});

test("separates work receipts and history from C1 and rejects unknown target keys", () => {
  const value = payloadWithCandidates();
  value.receipts = [{
    receipt_id: "work-receipt",
    command_id: "work-command",
    request_id: "work-request",
    command_type: "review_work_candidate",
    target: { target_kind: "work_candidate", target_id: "work-pending", command_type: "review_work_candidate" },
    receipt_phase: "mutation",
    decision: "accept",
    status: "accepted",
    applied_ids: ["work-pending"],
    rejected_ids: [],
    reason_code: null,
    evidence_ids: ["evidence-pending"],
    before_snapshot_id: "snapshot-work-candidates",
    after_snapshot_id: "snapshot-work-after",
    before_state_hash: "sha256:work-candidates",
    after_state_hash: "sha256:work-after",
    teacher_review: { state: "accepted", reviewer_id: "teacher", reviewed_at: "2026-08-28T04:05:00.000Z", note: null, revision: 1 },
    rollback: { available: false, rollback_id: null, expires_at: null },
    external_send: false,
    created_at: "2026-08-28T04:05:00.000Z",
  }, {
    receipt_id: "c1-receipt",
    command_id: "c1-command",
    request_id: "c1-request",
    command_type: "review_observation",
    target: { target_kind: "observation", target_id: "observation-1", command_type: "review_observation" },
    receipt_phase: "mutation",
    decision: "accept",
    status: "accepted",
    applied_ids: [],
    rejected_ids: [],
    reason_code: null,
    evidence_ids: [],
    before_snapshot_id: "snapshot-work-candidates",
    after_snapshot_id: "snapshot-work-after",
    before_state_hash: "sha256:work-candidates",
    after_state_hash: "sha256:work-after",
    teacher_review: { state: "accepted", reviewer_id: "teacher", reviewed_at: "2026-08-28T04:05:00.000Z", note: null, revision: 1 },
    rollback: { available: false, rollback_id: null, expires_at: null },
    external_send: false,
    created_at: "2026-08-28T04:05:00.000Z",
  }];
  value.review_history = [{
    review_id: "work-history",
    command_id: "work-command",
    command_type: "review_work_candidate",
    target: { target_kind: "work_candidate", target_id: "work-pending", command_type: "review_work_candidate" },
    decision: "accept",
    revision: 1,
    status: "accepted",
    evidence_ids: ["evidence-pending"],
    receipt_id: "work-receipt",
    before_snapshot_id: "snapshot-work-candidates",
    after_snapshot_id: "snapshot-work-after",
    before_state_hash: "sha256:work-candidates",
    after_state_hash: "sha256:work-after",
    teacher_review: { state: "accepted", reviewer_id: "teacher", reviewed_at: "2026-08-28T04:05:00.000Z", note: null, revision: 1 },
    rollback: { available: false, rollback_id: null, expires_at: null },
    external_send: false,
    reviewed_at: "2026-08-28T04:05:00.000Z",
  }];
  const data = contract(value);
  assert.equal(data.workCandidateReceipts.length, 1);
  assert.equal(data.receipts.length, 1);
  assert.equal(data.workCandidateReviewHistory.length, 1);
  assert.equal(data.tasks.find(task => task.id === "work-pending").reviewHistory[0].action, "accept");
  assert.equal(data.reviewHistory.length, 0);

  const unknown = payloadWithCandidates();
  unknown.review_targets[0].unexpected = true;
  assert.deepEqual(contract(unknown).workCandidates, []);
});
