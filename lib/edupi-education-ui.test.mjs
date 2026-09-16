import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const ui = await createJiti(import.meta.url).import("./edupi-education-ui.ts");

test("recognizes only supported education modules", () => {
  assert.deepEqual([...ui.EDUCATION_MODULES], ["home", "context", "students", "calendar", "materials", "tasks"]);
  for (const value of ui.EDUCATION_MODULES) assert.equal(ui.isEducationModule(value), true, value);
  for (const value of [null, "", "review", "../materials", 1]) assert.equal(ui.isEducationModule(value), false, String(value));
});
