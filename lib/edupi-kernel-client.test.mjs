import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { normalizeKernelState } = await createJiti(import.meta.url).import("./edupi-kernel-client.ts");

test("normalizes proactive kernel runs and distinguishes empty from unavailable", () => {
  assert.equal(normalizeKernelState(null).status, "unavailable");
  assert.equal(normalizeKernelState({ projection: { projection_kind: "proactive_work_kernel", updated_at: "1970-01-01T00:00:00.000Z", summary: { running: 0 }, runs: [] } }).status, "empty");
  const state = normalizeKernelState({ projection: { projection_kind: "proactive_work_kernel", updated_at: "2026-09-06T07:31:00.000Z", summary: { running: 1 }, runs: [{ run_id: "run-1", trigger_id: "morning_brief", status: "running", updated_at: "2026-09-06T07:31:00.000Z", result_summary: null }] } });
  assert.deepEqual(state, { status: "ready", updatedAt: "2026-09-06T07:31:00.000Z", running: 1, runs: [{ runId: "run-1", triggerId: "morning_brief", fireKey: null, status: "running", updatedAt: "2026-09-06T07:31:00.000Z", resultSummary: null, errorCode: null, errorMessage: null, attemptCount: null }] });
});

test("preserves only explicit safe nonnegative Core attempts and keeps unknown attempts null", () => {
  const raw = { run_id: "attempt-run", trigger_id: "g1_prepare_due", status: "running", updated_at: "2026-10-08T00:00:00.000Z" };
  const read = attempt => normalizeKernelState({ projection: { projection_kind: "proactive_work_kernel", runs: [{ ...raw, attempt_count: attempt }] } }).runs[0].attemptCount;
  for (const attempt of [0, 1, 2, 3, Number.MAX_SAFE_INTEGER]) assert.equal(read(attempt), attempt);
  for (const attempt of [undefined, null, -1, 1.5, "2", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}, true]) assert.equal(read(attempt), null);
});
