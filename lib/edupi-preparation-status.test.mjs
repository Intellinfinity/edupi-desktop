import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { isTerminalPreparationRead, workspaceHasReadyPreparation } = await createJiti(import.meta.url).import("./edupi-preparation-status.ts");

test("only completed or persistent preparation states stop task polling", () => {
  assert.equal(isTerminalPreparationRead({ state: "ready" }), true);
  assert.equal(isTerminalPreparationRead({ state: "error", retryable: false }), true);
  assert.equal(isTerminalPreparationRead({ state: "error", retryable: true }), false);
  assert.equal(isTerminalPreparationRead({ state: "running" }), false);
  assert.equal(isTerminalPreparationRead({ state: "idle" }), false);
});

test("requires an authoritative ready work case before a ready poll can stop", () => {
  assert.equal(workspaceHasReadyPreparation({ workCases: [{ taskId: "task-1", currentState: "running", artifactIds: [] }] }, "task-1"), false);
  assert.equal(workspaceHasReadyPreparation({ workCases: [{ taskId: "task-1", currentState: "draft_ready", artifactIds: ["artifact-1"] }] }, "task-1"), true);
  assert.equal(workspaceHasReadyPreparation({ workCases: [{ taskId: "other", currentState: "draft_ready", artifactIds: ["artifact-1"] }] }, "task-1"), false);
});
