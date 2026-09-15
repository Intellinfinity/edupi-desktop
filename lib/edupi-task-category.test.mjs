import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const category = await createJiti(import.meta.url).import("./edupi-task-category.ts");

test("classifies each task into one stable teacher-facing category", () => {
  assert.equal(category.taskCategory({ trigger: "teaching_adjustment_candidate", materialId: "m1" }), "teaching");
  assert.equal(category.taskCategory({ trigger: "student_follow_up", student: "赵六" }), "student");
  assert.equal(category.taskCategory({ trigger: "calendar_event_internal" }), "calendar");
  assert.equal(category.taskCategory({ trigger: "festival" }), "activity");
  assert.equal(category.taskCategory({ trigger: "material_intake", materialId: "m2" }), "material");
  assert.equal(category.taskCategory({ trigger: "manual" }), "other");
  assert.equal(category.taskCategory({ trigger: "teaching_before_class" }), "teaching");
  assert.equal(category.taskCategory({ trigger: "teaching_node_preparation" }), "teaching");
  assert.equal(category.taskCategory({ trigger: "calendar_event_preparation" }), "calendar");
  assert.equal(category.taskCategory({ trigger: "holiday_preparation" }), "calendar");
  assert.equal(category.taskCategory({ trigger: "monthly_class_activity" }), "activity");
  assert.equal(category.taskCategory({ trigger: "manual", title: "703班认识几何体备课" }), "teaching");
});

test("groups tasks without duplicates and preserves input order inside each category", () => {
  const tasks = [
    { id: "a", trigger: "festival" },
    { id: "b", trigger: "student_follow_up" },
    { id: "c", trigger: "festival" },
  ];
  const groups = category.groupTasksByCategory(tasks);
  assert.deepEqual(groups.activity.map((task) => task.id), ["a", "c"]);
  assert.deepEqual(groups.student.map((task) => task.id), ["b"]);
  assert.equal(Object.values(groups).flat().length, tasks.length);
});

test("uses one task search contract across category, source, topic, and dates", () => {
  const task = { trigger: "teaching_node_preparation", title: "第2周准备", topic: "一元一次方程", sourceEventName: "学校教学周", dueDate: "2026-09-15" };
  for (const query of ["教学准备", "一元一次方程", "学校教学周", "2026-09-15"]) assert.equal(category.matchesTaskQuery(task, query), true);
  assert.equal(category.matchesTaskQuery(task, "学生跟进"), false);
});
