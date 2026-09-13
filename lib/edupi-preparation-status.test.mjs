import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { isTerminalPreparationRead } = await createJiti(import.meta.url).import("./edupi-preparation-status.ts");

test("only completed or persistent preparation states stop task polling", () => {
  assert.equal(isTerminalPreparationRead({ state: "ready" }), true);
  assert.equal(isTerminalPreparationRead({ state: "error", retryable: false }), true);
  assert.equal(isTerminalPreparationRead({ state: "error", retryable: true }), false);
  assert.equal(isTerminalPreparationRead({ state: "running" }), false);
  assert.equal(isTerminalPreparationRead({ state: "idle" }), false);
});
