import assert from "node:assert/strict";
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
  assert.match(binding.grantId, /^desktop_canary_[a-f0-9]{32}$/u);
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
