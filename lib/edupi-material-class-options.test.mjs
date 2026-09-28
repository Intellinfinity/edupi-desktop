import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { materialClassOptions, hasUnboundSameNameClass } = await createJiti(import.meta.url).import("./edupi-material-class-options.ts");

test("materials use canonical IDs for same-name classes and do not duplicate the legacy label", () => {
  const options = materialClassOptions([
    { class_id: "class-7-1", class_name: "七一班" },
    { class_id: "class-7-2", class_name: "七一班" },
  ], ["七一班", "八一班"]);
  assert.deepEqual(options, [
    { value: "class-7-1", label: "七一班 · class-7-1" },
    { value: "class-7-2", label: "七一班 · class-7-2" },
    { value: "八一班", label: "八一班" },
  ]);
  assert.equal(options.some(option => option.value === "七一班"), false);
  assert.equal(hasUnboundSameNameClass([
    { class_id: "class-7-1", class_name: "七一班" },
    { class_name: "七一班" },
  ]), true);
  assert.equal(hasUnboundSameNameClass([{ class_id: "class-7-1", class_name: "七一班" }]), false);
});
