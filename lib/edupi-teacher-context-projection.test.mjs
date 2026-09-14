import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildEducationContractFromWorkspace } = await jiti.import("./edupi-education-contract.ts");
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
const baseFixture = {
  payload: {
    snapshot_id: "snapshot-projection",
    state_hash: "sha256:projection",
    capabilities: { supported_commands: [], supported_projections: [] },
    education_workspace: baseWorkspace,
    observations: [],
    memory_candidates: [],
    memories: [],
    receipts: [],
    review_history: [],
  },
};

function workspace() {
  return structuredClone(baseFixture.payload.education_workspace);
}

function payload(overrides = {}) {
  const value = structuredClone(baseFixture.payload);
  value.capabilities.supported_commands = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate"];
  value.capabilities.supported_projections = ["education_workspace"];
  value.review_targets = [{
    projection_kind: "teacher_context",
    target: { target_kind: "teacher_context", target_id: "context-projection", command_type: "review_teacher_context" },
    revision: 2,
    title: "教师背景信息",
    summary: "当前教师背景：name=李老师；role=教师；subject=数学；grade=七年级；class_name=七年级二班",
    status: "pending_review",
    source_ids: ["source-context"],
    evidence_ids: ["evidence-context"],
    teacher_review: { state: "pending_review", reviewer_id: null, reviewed_at: null, note: null, revision: 2 },
    external_send: false,
    field_keys: ["class_name", "grade", "name", "role", "subject"],
    value_summary: "name=王老师；role=教师；subject=科学；grade=七年级；class_name=七年级二班",
    conflict_ids: ["conflict-subject"],
  }, {
    projection_kind: "observation",
    target: { target_kind: "observation", target_id: "observation-c1", command_type: "review_observation" },
    revision: 0,
    title: "C1观察",
    summary: "C1观察",
    status: "pending_review",
    source_ids: ["source-c1"],
    evidence_ids: ["evidence-c1"],
    teacher_review: { state: "pending_review", reviewer_id: null, reviewed_at: null, note: null, revision: 0 },
    external_send: false,
    collection_ref: "observation-c1",
  }];
  value.snapshot_id = "snapshot-projection";
  value.state_hash = "sha256:projection";
  return { ...value, ...overrides };
}

function contract(snapshotPayload = payload()) {
  return buildEducationContractFromWorkspace(workspace(), {
    workspacePath: "/tmp/edupi-context-projection",
    snapshotPayload,
    supportedCommands: ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate"],
  });
}

test("projects teacher context separately from C1 arrays and parses canonical/proposed values strictly", () => {
  const data = contract();
  assert.equal(data.observations.length, 0);
  assert.equal(data.teacherContextCandidates.length, 1);
  const candidate = data.teacherContextCandidates[0];
  assert.equal(candidate.contextId, "context-projection");
  assert.equal(candidate.snapshotId, "snapshot-projection");
  assert.equal(candidate.stateHash, "sha256:projection");
  assert.deepEqual(candidate.currentValues, { name: "李老师", role: "教师", subject: "数学", grade: "七年级", class_name: "七年级二班" });
  assert.deepEqual(candidate.proposedValues, { name: "王老师", role: "教师", subject: "科学", grade: "七年级", class_name: "七年级二班" });
  assert.deepEqual(candidate.fieldKeys, ["class_name", "grade", "name", "role", "subject"]);
  assert.deepEqual(candidate.sourceIds, ["source-context"]);
  assert.deepEqual(candidate.evidenceIds, ["evidence-context"]);
  assert.deepEqual(candidate.conflictIds, ["conflict-subject"]);
  assert.equal(data.teacherContextReceipts.length, 0);
  assert.equal(data.teacherContextReviewHistory.length, 0);
  assert.equal(data.capabilities.c1Review.enabled, true);
  assert.deepEqual(data.capabilities.c1Review.commands, ["review_observation", "review_memory_candidate"]);
  assert.equal(data.capabilities.teacherContextReview.enabled, true);
  assert.deepEqual(data.capabilities.teacherContextReview.commands, ["review_teacher_context"]);
});

test("keeps malformed context target semantics out without contaminating C1", () => {
  const malformed = payload({ review_targets: [{
    projection_kind: "teacher_context",
    target: { target_kind: "teacher_context", target_id: "bad-context", command_type: "review_teacher_context" },
    revision: 0,
    title: "错误",
    summary: "当前教师背景：name=李老师；name=重复",
    status: "pending_review",
    source_ids: ["source-context"],
    evidence_ids: ["evidence-context"],
    teacher_review: { state: "pending_review", reviewer_id: null, reviewed_at: null, note: null, revision: 0 },
    external_send: false,
    field_keys: ["name"],
    value_summary: "name=李老师",
    conflict_ids: [],
  }, {
    projection_kind: "observation",
    target: { target_kind: "observation", target_id: "observation-c1", command_type: "review_observation" },
    revision: 0,
    title: "C1观察",
    summary: "C1观察",
    status: "pending_review",
    source_ids: ["source-c1"],
    evidence_ids: ["evidence-c1"],
    teacher_review: { state: "pending_review", reviewer_id: null, reviewed_at: null, note: null, revision: 0 },
    external_send: false,
    collection_ref: "observation-c1",
  }] });
  const data = contract(malformed);
  assert.deepEqual(data.teacherContextCandidates, []);
  assert.equal(data.observations.length, 0, "the malformed context must not become a C1 observation");
});
