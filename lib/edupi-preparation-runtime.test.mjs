import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function load(host, data, connected = true, pump = async () => {}) {
  const dependencies = {
    resolveEduPiBridgeRoots: () => ({ runtime: {}, dataRoot: { root: "/test" } }),
    ensureEduPiRuntime: async () => host,
    getPendingEduPiRuntime: () => connected ? Promise.resolve(host) : null,
    readEducationContract: async () => data,
    pumpBackgroundJobs: pump,
  };
  const source = fs.readFileSync(new URL("./edupi-preparation-runtime.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: () => dependencies });
  return exports;
}

test("preparation submits only canonical task identity and reads completion back", async () => {
  const calls = [];
  const data = { workCandidates: [{ taskId: "task-1", revision: 3 }], workCases: [] };
  const api = load({ call: async (operation, payload) => {
    calls.push([operation, JSON.parse(JSON.stringify(payload))]);
    return { ok: true, result: operation === "health" ? { queue: { queued: 0, claimed: 0 } } : { status: "accepted" } };
  } }, data);
  assert.equal((await api.startPreparation({ taskId: "task-1" })).state, "running");
  assert.deepEqual(calls[0], ["prepare_task", { task_id: "task-1", expected_revision: 3 }]);
  data.workCases.push({ taskId: "task-1", currentState: "draft_ready", artifactIds: ["file-1"] });
  const result = await api.preparationStatus();
  assert.equal(result.state, "ready");
  assert.equal(result.prepared, 1);
});

test("missing excerpts remain an error rather than a completed preparation", async () => {
  const api = load({ call: async () => ({ ok: false, error_code: "excerpt_unconfirmed" }) }, { workCandidates: [{ taskId: "task-1", revision: 0 }], workCases: [] });
  const result = await api.startPreparation({ taskId: "task-1" });
  assert.equal(result.state, "error");
  assert.equal(result.error, "请先确认材料内容");
  assert.equal(result.prepared, 0);
});

test("explicit preparation retries a failed attempt and does not rerun completed work", async () => {
  for (const state of ["failed", "cancelled", "completed"]) {
    const calls = [];
    const api = load({ call: async (operation, payload) => {
      calls.push([operation, JSON.parse(JSON.stringify(payload))]);
      return { ok: true, result: { event_id: "event-1", attempt: 1, state: operation === "retry_preparation" ? "queued" : state } };
    } }, { workCandidates: [{ taskId: "task-1", revision: 2 }], workCases: [] });
    const result = await api.startPreparation({ taskId: "task-1" });
    if (state === "completed") {
      assert.equal(result.state, "ready");
      assert.equal(calls.length, 1);
    } else {
      assert.equal(result.state, "running");
      assert.deepEqual(calls[1], ["retry_preparation", { event_id: "event-1", expected_attempt: 1 }]);
    }
  }
});

test("task status reads its own persisted work while another task is running", async () => {
  const api = load({ call: async () => ({ ok: true, result: { queue: { queued: 1, claimed: 1 } } }) }, {
    workCandidates: [], workCases: [
      { taskId: "finished", currentState: "draft_ready", artifactIds: ["file"] },
      { taskId: "other", currentState: "running", artifactIds: [] },
    ],
  });
  const result = await api.preparationStatus("finished");
  assert.equal(result.taskId, "finished");
  assert.equal(result.state, "ready");
  assert.equal((await api.preparationStatus("other")).state, "running");
});

test("lost runtime does not leave persisted running work appearing live", async () => {
  const api = load({}, { workCases: [{ taskId: "lost", currentState: "running", artifactIds: [] }] }, false);
  const result = await api.preparationStatus("lost");
  assert.equal(result.state, "error");
  assert.equal(result.error, "备课执行已断开，请重试");
});

test("refreshes a synchronized task revision once without starting other tasks", async () => {
  const data = { workCandidates: [{ taskId: "task-1", revision: 1 }], workCases: [] };
  const calls = [];
  const api = load({ call: async (operation, payload) => {
    calls.push([operation, JSON.parse(JSON.stringify(payload))]);
    if (calls.length === 1) { data.workCandidates[0].revision = 2; return { ok: false, error_code: "stale_revision" }; }
    return { ok: true, result: { state: "queued", event_id: "event", attempt: 0 } };
  } }, data);
  assert.equal((await api.startPreparation({ taskId: "task-1" })).state, "running");
  assert.deepEqual(calls, [["prepare_task", { task_id: "task-1", expected_revision: 1 }], ["prepare_task", { task_id: "task-1", expected_revision: 2 }]]);
});

test("runtime startup immediately scans due Core work and resumes managed background jobs", async () => {
  let pumps = 0;
  const calls = [];
  const api = load({ call: async (operation, payload) => {
    calls.push([operation, payload]);
    return { ok: true, result: operation === "health" ? { queue: { queued: 0, claimed: 0 } } : { tasks: [], failures: [] } };
  } }, { workCases: [] }, true, async () => { pumps++; });
  await api.ensurePreparation();
  assert.equal(pumps, 1);
  assert.deepEqual(calls.map(([operation]) => operation), ["prepare_due", "health"]);
});

test("a public future plan can be prepared before its review candidate exists", async () => {
  const calls = [];
  const api = load({ call: async (operation, payload) => { calls.push([operation, JSON.parse(JSON.stringify(payload))]); return { ok: true, result: { state: "queued", attempt: 0 } }; } }, {
    tasks: [{ id: "future-meeting", revision: 0 }], workCandidates: [], workCases: [{ taskId: "future-meeting", kind: "calendar_preparation" }],
  });
  assert.equal((await api.startPreparation({ taskId: "future-meeting" })).state, "running");
  assert.deepEqual(calls, [["prepare_task", { task_id: "future-meeting", expected_revision: 0 }]]);
});
