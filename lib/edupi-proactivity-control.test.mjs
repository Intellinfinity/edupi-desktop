import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const control = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-proactivity-control.ts");

test("canary scopes require explicit class timetable bindings and current matching materials", () => {
  const workspace = { timetable: [
    { slot_id: "slot-1", class_id: "class-7-1", class_name: "七一班", subject: "数学", kind: "class" },
    { slot_id: "slot-2", class_id: "class-7-1", class_name: "七一班", subject: "数学", kind: "class" },
    { slot_id: "legacy-slot", class_name: "七二班", subject: "数学", kind: "class" },
    { slot_id: "slot-other", class_id: "class-8-1", class_name: "八一班", subject: "数学", kind: "class" },
  ] };
  const materials = [
    { material_id: "material-1", class_id: "class-7-1", subject: "数学", available: true },
    { material_id: "material-missing", class_id: "class-7-1", subject: "数学", available: false },
    { material_id: "material-other", class_id: "class-8-1", subject: "数学", available: true },
  ];
  const scopes = control.buildProactivityScopeCandidates(workspace, materials);
  assert.deepEqual(scopes.map((item) => ({ classId: item.classId, subject: item.subject, ready: item.ready,
    slots: item.slotCount, materials: item.materialCount })), [
    { classId: "class-7-1", subject: "数学", ready: true, slots: 2, materials: 1 },
    { classId: "class-8-1", subject: "数学", ready: true, slots: 1, materials: 1 },
  ]);
  assert.equal(JSON.stringify(scopes).includes("slot-1"), false, "public candidates do not expose source identities");
  const binding = control.buildProactivityGrantBinding({ classId: "class-7-1", subject: "数学" }, workspace, materials,
    "2026-09-23T08:00:00.000Z");
  assert.match(binding.grantId, /^desktop_canary_v2_[a-f0-9]{32}$/u);
  assert.match(binding.spec.budget.id, /^budget_v2_[a-f0-9]{32}$/u);
  assert.equal(binding.spec.domains.join(","), "teaching_preparation");
  assert.deepEqual(binding.spec.actions, ["prepare", "update"]);
  assert.equal(binding.spec.source_ids.length, 4);
  assert.equal(binding.spec.max_calls, undefined);
  assert.equal(binding.spec.budget.max_calls, 12);
  assert.equal(binding.endsAt, "2026-09-30T08:00:00.000Z");
  assert.equal(binding.spec.source_ids.every((id) => /^(?:conversation|material|timetable):[a-f0-9]{64}$/u.test(id)), true);
});

test("a scope without both schedule and material evidence is not activatable", () => {
  const workspace = { timetable: [{ slot_id: "slot-1", class_id: "class-7-1", subject: "数学", kind: "class" }] };
  assert.deepEqual(control.buildProactivityScopeCandidates(workspace, []), [{
    classId: "class-7-1", className: null, subject: "数学", slotCount: 1, materialCount: 0, ready: false,
  }]);
  assert.throws(() => control.buildProactivityGrantBinding({ classId: "class-7-1", subject: "数学" }, workspace, [],
    "2026-09-23T08:00:00.000Z"), (error) => error?.code === "proactivity_scope_unavailable");
});

test("G2 binds only its own conversation and four-call budget to a current math roster scope", () => {
  const scope = { classId: "class-7-1", subject: "数学" };
  const workspace = { timetable: [
    { slot_id: "slot-1", class_id: scope.classId, class_name: "七一班", subject: scope.subject, kind: "class" },
    { slot_id: "slot-english", class_id: scope.classId, class_name: "七一班", subject: "英语", kind: "class" },
    { slot_id: "slot-noncanonical-math", class_id: scope.classId, class_name: "七一班", subject: "math", kind: "class" },
    { slot_id: "slot-without-id", class_name: "七二班", subject: scope.subject, kind: "class" },
  ], students: [{ student_id: "student-1", name: "合成学生", class_name: "七一班" }] };
  assert.deepEqual(control.buildStudentFollowupScopeCandidates(workspace), [{ ...scope, className: "七一班",
    slotCount: 1, materialCount: 0, ready: true }]);
  const binding = control.buildStudentFollowupGrantBinding(scope, workspace, "2026-10-04T00:00:00.000Z");
  assert.deepEqual(binding.spec.domains, ["student_followup"]);
  assert.deepEqual(binding.spec.actions, ["update"]);
  assert.equal(binding.spec.budget.max_calls, 4);
  assert.equal(binding.endsAt, "2026-10-11T00:00:00.000Z");
  assert.equal(control.EDUPI_STUDENT_FOLLOWUP_CONVERSATION_ID, "desktop-student-followup-canary-v1");
  assert.deepEqual(binding.spec.source_ids, [`conversation:${createHash("sha256").update(control.EDUPI_STUDENT_FOLLOWUP_CONVERSATION_ID).digest("hex")}`]);
  const later = control.buildStudentFollowupGrantBinding(scope, workspace, "2026-10-05T00:00:00.000Z");
  assert.equal(later.grantId, binding.grantId);
  assert.equal(later.spec.budget.id, binding.spec.budget.id);
  const g1 = control.buildProactivityGrantBinding(scope, workspace, [
    { material_id: "material-1", class_id: scope.classId, subject: scope.subject },
  ], "2026-10-04T00:00:00.000Z");
  assert.notEqual(binding.grantId, g1.grantId);
  assert.notEqual(binding.spec.budget.id, g1.spec.budget.id);
  assert.doesNotMatch(JSON.stringify(binding), /student-1|合成学生|material-1/);
});

test("G2 scopes reject missing, transferred and ambiguous class mappings without student text parsing", () => {
  const scope = { classId: "class-7-1", subject: "数学" };
  const slot = { slot_id: "slot-1", class_id: scope.classId, class_name: "七一班", subject: scope.subject, kind: "class" };
  const roster = [{ class_name: "七一班" }];
  const cases = [
    { timetable: [slot], students: [] },
    { timetable: [slot], students: [{ class_name: "七二班" }] },
    { timetable: [{ ...slot, class_name: null }], students: roster },
    { timetable: [slot, { ...slot, slot_id: "slot-2", class_id: "class-other" }], students: roster },
    { timetable: [slot, { ...slot, slot_id: "slot-2", class_name: "七二班" }], students: roster },
  ];
  for (const workspace of cases) {
    assert.ok(control.buildStudentFollowupScopeCandidates(workspace).every((item) => !item.ready));
    assert.throws(() => control.buildStudentFollowupGrantBinding(scope, workspace),
      error => error?.code === "proactivity_scope_unavailable");
  }
});
