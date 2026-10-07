import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const api = await createJiti(import.meta.url).import("./edupi-preparation-execution.ts");
export const fixture = patch => ({ version: 1, root_ref: `sha256:${"a".repeat(64)}`, owner_id: "owner-synthetic", task_id: "task-A", task_revision: 0,
  work_case_id: "case-A", source_revision: `sha256:${"b".repeat(64)}`, source_current: true, execution_id: "execution-A", event_id: "event-A", attempt: 2,
  state: "running", active: true, phase: { profile: "g1_linear_equations_v1", key: "draft", state: "active", started_at: "2026-10-08T00:00:00.000Z" },
  failure_code: null, updated_at: "2026-10-08T00:00:00.000Z", artifact_ids: [], history: [{ sequence: 1, execution_id: "execution-A", attempt: 1,
    state: "failed", occurred_at: "2026-10-07T00:00:00.000Z", failure_code: "model_unavailable", artifact_ids: [] }], history_truncated: false,
  history_inferred: false, actions: { cancel: true, retry: false }, relations: null, steps_total: null, read_only: true, external_send: false, ...patch });
test("bound execution decodes real phase and history without invented progress", () => {
  const value = fixture(), read = api.decodePreparationExecution(value, { taskId: "task-A", revision: 0 });
  assert.deepEqual(read, value); assert.notEqual(read, value);
  assert.equal(api.preparationPhaseLabel(read.phase), "生成草稿"); assert.equal(api.preparationPhaseLabel(null), null);
  const queued = fixture({ state: "queued", active: false, phase: null, execution_id: null, attempt: 0 });
  assert.equal(api.decodePreparationExecution(queued, { taskId: "task-A", revision: 0 }).attempt, 0);
});
test("cross-task owner root revision or noncurrent phase cannot become a valid execution", () => {
  for (const expected of [{ taskId: "task-B", revision: 0 }, { taskId: "task-A", revision: 1 },
    { taskId: "task-A", revision: 0, rootRef: `sha256:${"c".repeat(64)}` }, { taskId: "task-A", revision: 0, ownerId: "other-owner" }]) {
    assert.throws(() => api.decodePreparationExecution(fixture(), expected), error => error.code === "invalid_response");
  }
  for (const patch of [{ active: false }, { source_current: false }, { event_id: null }, { attempt: 0 }, { read_only: false }, { external_send: true },
    { steps_total: 3 }, { relations: [] }, { extra: "private" }, { failure_code: "/private/stack" },
    { phase: { ...fixture().phase, profile: "llm-reported" } }, { phase: { ...fixture().phase, prompt: "private" } },
    { history: [{ ...fixture().history[0], token: "private" }] }, { history: Array(51).fill(fixture().history[0]) }]) {
    assert.throws(() => api.decodePreparationExecution(fixture(patch), { taskId: "task-A", revision: 0 }), error => error.code === "invalid_response");
  }
});
