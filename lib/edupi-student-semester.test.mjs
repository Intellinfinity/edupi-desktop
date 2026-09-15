import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { studentSemesterRange } = await createJiti(import.meta.url).import("./edupi-student-semester.ts");

test("derives the current imported semester from confirmed week rows", () => {
  const range = studentSemesterRange([
    { name: "开学典礼", date: "2026-09-01", endDate: null },
    { name: "第2周 · 保持平常心", date: "2026-09-14", endDate: "2026-09-20" },
    { name: "第1周", date: "2026-09-07", endDate: "2026-09-13" },
    { name: "第21周", date: "2027-01-25", endDate: null },
  ]);
  assert.deepEqual(range, { from: "2026-09-07", to: "2027-01-31" });
});

test("does not guess a semester without valid week boundaries", () => {
  assert.equal(studentSemesterRange([{ name: "第X周", date: "2026-09-07", endDate: null }, { name: "第1周", date: "invalid", endDate: null }]), null);
});
