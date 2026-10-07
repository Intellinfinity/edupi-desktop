import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const api = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-preparation-execution-client.ts");
const value = { version: 1, root_ref: `sha256:${"a".repeat(64)}`, owner_id: "owner-A", task_id: "task-A", task_revision: 0, work_case_id: "case-A",
  source_revision: `sha256:${"b".repeat(64)}`, source_current: true, execution_id: "execution-A", event_id: "event-A", attempt: 2, state: "running",
  active: true, phase: { profile: "g1_linear_equations_v1", key: "draft", state: "active", started_at: "2026-10-08T00:00:00.000Z" }, failure_code: null,
  updated_at: null, artifact_ids: [], history: [], history_truncated: false, history_inferred: false, actions: { cancel: true, retry: false },
  relations: null, steps_total: null, read_only: true, external_send: false };
const headers = async initial => new Headers(initial);
test("reads use only the explicit task revision and cancellation signal", async () => {
  const calls = [], controller = new AbortController();
  const got = await api.readPreparationExecution("task-A", 0, controller.signal, async (url, init) => {
    calls.push({ url, init }); return Response.json({ ok: true, result: value, externalSend: false });
  }, headers);
  assert.equal(got.phase.key, "draft"); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/edupi/tasks/task-A/execution?revision=0");
  assert.equal(calls[0].init.method, "GET"); assert.equal(calls[0].init.signal, controller.signal);
});
test("only captured Core action capabilities can submit existing cancel or retry", async () => {
  let calls = 0;
  const fetcher = async (_url, init) => {
    calls++; assert.deepEqual(JSON.parse(init.body), { action: "cancel", eventId: "event-A", attempt: 2, revision: 0, sourceRevision: value.source_revision });
    return Response.json({ ok: true, result: { event_id: "event-A", state: "cancelled" }, externalSend: false });
  };
  await api.controlPreparationExecution(value, "cancel", undefined, fetcher, headers);
  await assert.rejects(api.controlPreparationExecution(value, "retry", undefined, fetcher, headers), error => error.code === "permission_denied");
  assert.equal(calls, 1);
});
test("unsupported or malformed reads remain unavailable and never trigger a preparation write", async () => {
  let calls = 0;
  const fetcher = async (_url, init) => { calls++; assert.equal(init.method, "GET"); return Response.json({ ok: false, errorCode: "unsupported_operation", externalSend: false }, { status: 503 }); };
  await assert.rejects(api.readPreparationExecution("task-A", 0, undefined, fetcher, headers), error => error.code === "unsupported_operation");
  assert.equal(calls, 1);
  await assert.rejects(api.readPreparationExecution("task-A", 0, undefined, async () => Response.json({ ok: true, result: { ...value, task_id: "task-B" }, externalSend: false }), headers), error => error.code === "invalid_response");
});
