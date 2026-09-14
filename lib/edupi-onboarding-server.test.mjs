import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { readTeacherContext, projectTeacherContextSnapshot } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./edupi-onboarding-server.ts");
const coreRoot = process.env.EDUPI_CORE_ROOT;
const dataRoot = process.env.EDUPI_DATA_ROOT;

test("projects teacher context and checklist counts from the real Core snapshot", { skip: !coreRoot || !dataRoot }, async () => {
  const context = await readTeacherContext();
  assert.equal(context.name, "吴老师");
  assert.equal(context.subject, "数学");
  assert.equal(context.grade, "七年级");
  assert.deepEqual(context.roles, ["homeroom_teacher", "subject_teacher"]);
  assert.equal(context.classCount, 1);
  assert.equal(context.studentCount, 50);
  assert.equal(context.checklist.find((item) => item.id === "calendar")?.status, "complete");
  assert.equal(context.checklist.find((item) => item.id === "timetable")?.status, "next");
  assert.equal(context.checklist.find((item) => item.id === "roster")?.status, "complete");
  assert.equal(context.checklist.find((item) => item.id === "material")?.status, "complete");
  assert.equal(context.configured, true);
  assert.equal(context.editable, false);
  assert.equal(context.editReason, "通过教师复核提案修改");
  assert.equal(context.memoryDirectory, ".edupi/memory");
});

test("uses canonical context values while a partial proposal is pending", async () => {
  const payload = {
    snapshot_id: "snapshot-onboarding",
    state_hash: "sha256:onboarding",
    capabilities: {
      supported_commands: ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate"],
      supported_projections: ["education_workspace"],
    },
    education_workspace: {
      calendar: [],
      timetable: [],
      students: [],
      source_summaries: [],
      continuity: { memories: [], signals: [], insights: [], themes: [], subject_knowledge: [], teaching_priorities: [], family_contacts: [], documents: [], last_dream: null },
    },
  };
  payload.review_targets = [{
    projection_kind: "teacher_context",
    target: { target_kind: "teacher_context", target_id: "context-onboarding", command_type: "review_teacher_context" },
    revision: 1,
    title: "教师背景信息",
    summary: "当前教师背景：name=李老师；role=初中数学教师；subject=数学；grade=七年级；class_name=七年级二班",
    status: "pending_review",
    source_ids: ["teacher-context-source"],
    evidence_ids: ["teacher-context-evidence"],
    teacher_review: { state: "pending_review", reviewer_id: null, reviewed_at: null, note: null, revision: 1 },
    external_send: false,
    field_keys: ["class_name", "grade", "name", "role", "subject"],
    value_summary: "name=王老师；role=初中数学教师；subject=科学；grade=七年级；class_name=八年级一班",
    conflict_ids: ["conflict-subject"],
  }];
  const context = projectTeacherContextSnapshot({ workspace: payload.education_workspace, payload, dataRoot: { root: "/tmp/edupi-onboarding" } });
  assert.equal(context.name, "李老师");
  assert.equal(context.subject, "数学");
  assert.equal(context.grade, "七年级");
  assert.deepEqual(context.roles, ["subject_teacher"]);
  assert.deepEqual(context.classes, ["七年级二班"]);
  assert.equal(context.classCount, null);
  assert.equal(context.studentCount, null);
  assert.equal(context.configured, true);
});

test("does not fall back when the validated Core snapshot is unavailable", { skip: !coreRoot }, async () => {
  const previous = process.env.EDUPI_DATA_ROOT;
  process.env.EDUPI_DATA_ROOT = "/definitely/missing/edupi-data";
  try {
    await assert.rejects(readTeacherContext(), /Core|snapshot|不可用/i);
  } finally {
    if (previous === undefined) delete process.env.EDUPI_DATA_ROOT;
    else process.env.EDUPI_DATA_ROOT = previous;
  }
});

test("onboarding server has no direct .edupi file access or writer", async () => {
  const source = await readFile(new URL("./edupi-onboarding-server.ts", import.meta.url), "utf8");
  assert.match(source, /readEduPiEducationSnapshot/);
  assert.doesNotMatch(source, /readFile|writeFile|copyFile|rename|mkdir|preferences\.json|calendar\.json|timetable\.json|student_profiles\.json|teaching\.json|homedir|EDUPI_(?:PROJECT_ROOT|WORKSPACE|MEMORY_DIR)/);
});
