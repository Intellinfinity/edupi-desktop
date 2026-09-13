import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const form = await createJiti(import.meta.url).import("./edupi-teacher-task-form.ts");

test("validates timetable weekday and derives the automatic deadline", () => {
  const slot = { slot_id: "slot-1", day_of_week: 3 };
  assert.equal(form.timetableSlotId(slot), "slot-1");
  assert.equal(form.lessonDateMatchesSlot("2026-09-16", slot), true);
  assert.equal(form.lessonDateMatchesSlot("2026-09-17", slot), false);
  assert.equal(form.lessonDateMatchesSlot("2026-02-31", slot), false);
  assert.equal(form.dateBefore("2026-09-16"), "2026-09-15");
});

test("validates the complete Core deliverable boundary", () => {
  assert.deepEqual(form.preparationDeliverables("教案\n学案"), { items: ["教案", "学案"], error: null });
  assert.match(form.preparationDeliverables("教案\n教案").error, /不能重复/);
  assert.match(form.preparationDeliverables(Array.from({ length: 21 }, (_, index) => `产物${index}`).join("\n")).error, /最多 20 项/);
  assert.match(form.preparationDeliverables("x".repeat(241)).error, /最多 240 个字/);
});
