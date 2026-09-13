import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { projectCoreRuntimeHealth } = await createJiti(import.meta.url).import("./edupi-runtime-health.ts");
const commit = "a".repeat(40);
const manifestHash = `sha256:${"b".repeat(64)}`;
const health = (overrides = {}) => ({
  ok: true,
  operation: "health",
  result: {
    lifecycle: "ready",
    core_commit: commit,
    component_manifest_hash: manifestHash,
    queue: { total: 0, queued: 0, claimed: 0, completed: 0, failed: 0, cancelled: 0 },
    capabilities: { internal_timer: "active", g1_processor: "active", g3_processor: "activation_pending" },
    scheduler: { kind: "core_runtime_g1_live_processor", timer_active: true, interval_ms: 300000, last_timer_check_at: null, next_timer_check_at: "2026-09-14T00:05:00.000Z", timer_error_code: null },
    ...overrides,
  },
});

test("reports ready only when the live Core timer is actually active", () => {
  const projected = projectCoreRuntimeHealth(health(), commit, manifestHash);
  assert.equal(projected.status, "ready");
  assert.equal(projected.reason, null);
  assert.equal(projected.scheduler.interval_ms, 300000);
});

test("reports inactive and failed timers as degraded", () => {
  const inactive = projectCoreRuntimeHealth(health({ scheduler: null }), commit, manifestHash);
  assert.equal(inactive.status, "degraded");
  assert.equal(inactive.reason, "课程准备自动检查未启动");
  const failed = projectCoreRuntimeHealth(health({ scheduler: { ...health().result.scheduler, timer_error_code: "preparation_failed" } }), commit, manifestHash);
  assert.equal(failed.status, "degraded");
  assert.match(failed.reason, /preparation_failed/);
});

test("preserves draining state and rejects a mismatched runtime identity", () => {
  assert.equal(projectCoreRuntimeHealth(health({ lifecycle: "draining" }), commit, manifestHash).status, "draining");
  assert.throws(() => projectCoreRuntimeHealth(health({ core_commit: "c".repeat(40) }), commit, manifestHash), /invalid/);
  assert.throws(() => projectCoreRuntimeHealth(health({ component_manifest_hash: `sha256:${"c".repeat(64)}` }), commit, manifestHash), /invalid/);
});
