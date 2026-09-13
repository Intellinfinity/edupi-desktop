import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { normalizeKernelState } = await createJiti(import.meta.url).import("./edupi-kernel-client.ts");

test("normalizes proactive kernel runs and distinguishes empty from unavailable", () => {
  assert.equal(normalizeKernelState(null).status, "unavailable");
  assert.equal(normalizeKernelState({ projection: { projection_kind: "proactive_work_kernel", updated_at: "1970-01-01T00:00:00.000Z", summary: { running: 0 }, runs: [] } }).status, "empty");
  const state = normalizeKernelState({ projection: { projection_kind: "proactive_work_kernel", updated_at: "2026-09-06T07:31:00.000Z", summary: { running: 1 }, runs: [{ run_id: "run-1", trigger_id: "morning_brief", status: "running", updated_at: "2026-09-06T07:31:00.000Z", result_summary: null }] } });
  assert.deepEqual(state, { status: "ready", updatedAt: "2026-09-06T07:31:00.000Z", running: 1, runs: [{ runId: "run-1", triggerId: "morning_brief", fireKey: null, status: "running", updatedAt: "2026-09-06T07:31:00.000Z", resultSummary: null, errorCode: null, errorMessage: null }] });
});
