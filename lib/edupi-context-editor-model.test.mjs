import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  TEACHER_CONTEXT_FIELDS,
  buildContextPatch,
  buildTeacherContextPrompt,
  contextStatusLabel,
  contextValuesFromSnapshot,
  matchesTeacherContextRefresh,
  verifyTeacherContextReview,
} = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./edupi-context-editor-model.ts");

const current = {
  name: "李老师",
  role: "班主任",
  subject: "数学",
  grade: "七年级",
  class_name: "七年级二班",
};
const candidate = {
  contextId: "context-1",
  snapshotId: "snapshot-1",
  stateHash: "sha256:before",
  revision: 2,
  title: "教师背景信息",
  canonicalSummary: "当前教师背景：name=李老师；role=班主任；subject=数学；grade=七年级；class_name=七年级二班",
  proposalSummary: "name=王老师；role=班主任；subject=科学；grade=七年级；class_name=七年级二班",
  currentValues: current,
  proposedValues: { ...current, name: "王老师", subject: "科学" },
  fieldKeys: ["class_name", "grade", "name", "role", "subject"],
  sourceIds: ["source-1"],
  evidenceIds: ["evidence-1"],
  conflictIds: [],
  status: "pending_review",
  teacherReview: { state: "pending_review", reviewerId: null, reviewedAt: null, note: null, revision: 2 },
  externalSend: false,
};

test("keeps the property sheet to the frozen five context fields", () => {
  assert.deepEqual(TEACHER_CONTEXT_FIELDS.map((field) => field.key), ["name", "role", "subject", "grade", "class_name"]);
  assert.deepEqual(TEACHER_CONTEXT_FIELDS.map((field) => field.label), ["称呼", "身份", "学科", "年级", "班级"]);
});

test("builds only nonempty changed context fields and rejects richer keys", () => {
  assert.deepEqual(buildContextPatch({ ...candidate.proposedValues, name: "赵老师", subject: "", class_name: "七年级三班" }, candidate.proposedValues), {
    name: "赵老师",
    class_name: "七年级三班",
  });
  assert.equal(buildContextPatch(candidate.proposedValues, candidate.proposedValues), null);
  assert.throws(() => buildContextPatch({ ...candidate.proposedValues, school: "不应出现" }, candidate.proposedValues));
  assert.throws(() => buildContextPatch({ name: "x".repeat(121) }, {}));
});

test("builds a facts-only page reference for the teacher's own request", () => {
  const prompt = buildTeacherContextPrompt(current);
  assert.match(prompt, /^教师上下文草稿\n/);
  assert.match(prompt, /称呼：李老师/);
  assert.match(prompt, /班级：七年级二班/);
  assert.doesNotMatch(prompt, /请根据|生成|写入|偏好|preferences|学校|学生|人数|未设置/);
  assert.doesNotMatch(prompt, /\n\n/);
  const partial = buildTeacherContextPrompt({ name: "李老师", subject: "", grade: "" });
  assert.equal(partial, "教师上下文草稿\n称呼：李老师");
  assert.throws(() => buildTeacherContextPrompt({ name: "" }));
});

test("maps review states to concise status copy and read-only capability", () => {
  assert.equal(contextStatusLabel(candidate, { enabled: true }), "待确认");
  assert.equal(contextStatusLabel({ ...candidate, status: "held", teacherReview: { ...candidate.teacherReview, state: "held" } }, { enabled: true }), "已暂缓");
  assert.equal(contextStatusLabel({ ...candidate, status: "accepted", teacherReview: { ...candidate.teacherReview, state: "accepted" } }, { enabled: true }), "已生效");
  assert.equal(contextStatusLabel({ ...candidate, status: "rejected", teacherReview: { ...candidate.teacherReview, state: "rejected" } }, { enabled: false }), "已拒绝 · 只读");
  assert.equal(contextStatusLabel(null, { enabled: true }, {}), "未设置");
  assert.equal(contextStatusLabel(null, { enabled: false }, current), "已生效 · 只读");
  assert.equal(contextStatusLabel(null, null, {}), "未设置 · 只读");
  assert.equal(contextStatusLabel({ ...candidate, status: "pending_review", teacherReview: { ...candidate.teacherReview, state: "not_required" } }, { enabled: true }, current), "待确认");
});

test("uses only the conservative five-field snapshot fallback when a proposal is absent", () => {
  const values = contextValuesFromSnapshot({
    name: "李老师",
    subject: "数学",
    grade: "七年级",
    school: "不应进入上下文表",
    roles: ["subject_teacher"],
    classes: ["七年级二班"],
    classCount: 2,
    studentCount: 50,
    painPoint: "不应进入上下文表",
  });
  assert.deepEqual(values, { name: "李老师", role: "任课教师", subject: "数学", grade: "七年级", class_name: "七年级二班" });
});

test("trusts only a receipt-bound refreshed teacher-context candidate", () => {
  const response = {
    receipt: {
      receipt_id: "receipt-1",
      command_id: "command-1",
      request_id: "request-1",
      command_type: "review_teacher_context",
      target: { target_kind: "teacher_context", target_id: "context-1", command_type: "review_teacher_context" },
      decision: "modify",
      status: "modified",
      before_snapshot_id: "snapshot-1",
      after_snapshot_id: "snapshot-2",
      before_state_hash: "sha256:before",
      after_state_hash: "sha256:after",
      evidence_ids: ["evidence-1"],
      external_send: false,
    },
    data: {
      teacherContextCandidates: [{ ...candidate, snapshotId: "snapshot-2", stateHash: "sha256:after", status: "modified", teacherReview: { ...candidate.teacherReview, state: "modified" } }],
    },
  };
  assert.equal(verifyTeacherContextReview(response, { targetId: "context-1", expectedSnapshotId: "snapshot-1", expectedStateHash: "sha256:before", decision: "modify" }).ok, true);
  assert.equal(verifyTeacherContextReview({ ...response, receipt: { ...response.receipt, status: "accepted" } }, { targetId: "context-1", expectedSnapshotId: "snapshot-1", decision: "modify" }).ok, false);
  assert.equal(verifyTeacherContextReview({ ...response, receipt: { ...response.receipt, external_send: true } }, { targetId: "context-1", expectedSnapshotId: "snapshot-1", decision: "modify" }).ok, false);
  assert.equal(verifyTeacherContextReview({ ...response, data: { teacherContextCandidates: [{ ...response.data.teacherContextCandidates[0], status: "accepted" }] } }, { targetId: "context-1", expectedSnapshotId: "snapshot-1", decision: "modify" }).ok, false);
});

test("matches only the exact awaited refresh and invalidates missing or competing candidates", () => {
  const expected = { targetId: "context-1", afterSnapshotId: "snapshot-2", afterStateHash: "sha256:after" };
  const refreshed = {
    teacherContextCandidates: [{ ...candidate, snapshotId: "snapshot-2", stateHash: "sha256:after" }],
  };
  assert.equal(matchesTeacherContextRefresh(refreshed, expected), true);
  assert.equal(matchesTeacherContextRefresh({ teacherContextCandidates: [{ ...refreshed.teacherContextCandidates[0], snapshotId: "snapshot-other" }] }, expected), false);
  assert.equal(matchesTeacherContextRefresh({ teacherContextCandidates: [refreshed.teacherContextCandidates[0], { ...refreshed.teacherContextCandidates[0] }] }, expected), false);
  assert.equal(matchesTeacherContextRefresh({ teacherContextCandidates: [] }, expected), false);
});
