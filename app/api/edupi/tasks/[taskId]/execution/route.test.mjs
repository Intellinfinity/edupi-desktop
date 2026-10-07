import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true }), require = createRequire(import.meta.url);
const shared = await jiti.import("../../../../../../lib/edupi-preparation-execution.ts");
const native = await jiti.import("../../../../../../lib/desktop-api-auth.ts");
const security = await jiti.import("../../../../../../lib/request-security.ts");
const bounded = await jiti.import("../../../../../../lib/bounded-form-data.ts");
const compiled = ts.transpileModule(fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const hash = char => `sha256:${char.repeat(64)}`;
const token = "synthetic-preparation-token-1234567890", url = "http://localhost:30373/api/edupi/tasks/task-A/execution";
const headers = { host: "localhost:30373", origin: "http://localhost:30373", "x-pi-desktop-token": token };
const routeContext = { params: Promise.resolve({ taskId: "task-A" }) };
function fixture() {
  const calls = [], state = { pending: true, supported: true, sourceCurrent: true, cancel: true, eventId: "event-A", attempt: 1 };
  const read = () => ({ version: 1, root_ref: hash("a"), owner_id: "owner-A", task_id: "task-A", task_revision: 0, work_case_id: "case-A", source_revision: hash("b"),
    source_current: state.sourceCurrent, execution_id: "execution-A", event_id: state.eventId, attempt: state.attempt, state: state.sourceCurrent ? "running" : "stale",
    active: state.sourceCurrent, phase: state.sourceCurrent ? { profile: "g1_linear_equations_v1", key: "draft", state: "active", started_at: "2026-10-08T00:00:00.000Z" } : null,
    failure_code: null, updated_at: null, artifact_ids: [], history: [], history_truncated: false, history_inferred: false,
    actions: { cancel: state.cancel && state.sourceCurrent, retry: false }, relations: null, steps_total: null, read_only: true, external_send: false });
  const host = { call: async operation => { calls.push([operation]); assert.equal(operation, "health"); return { ok: true, result: { data_root_fingerprint: hash("a"), capabilities: { supported_operations: state.supported ? ["preparation_execution_read"] : ["health"] } } }; },
    callOwnerControl: async (operation, payload) => {
      calls.push([operation, payload]);
      if (operation === "owner_read") return { ok: true, result: { root_ref: hash("a"), owner: { id: "owner-A" } } };
      if (operation === "preparation_execution_read") {
        assert.equal(payload.root_ref, hash("a")); assert.equal(payload.expected_owner_id, "owner-A");
        assert.equal(payload.task_id, "task-A"); assert.equal(payload.expected_task_revision, 0);
        return { ok: true, result: read() };
      }
      assert.equal(operation, "cancel_preparation"); return { ok: true, result: { event_id: state.eventId, state: "cancelled" } };
    } };
  const modules = { "@/lib/desktop-api-auth": native, "@/lib/request-security": security, "@/lib/bounded-form-data": bounded,
    "@/lib/edupi-preparation-execution": shared, "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ dataRoot: { root: "/synthetic-only" } }) },
    "@/lib/edupi-runtime-supervisor": { getPendingEduPiRuntime: () => state.pending ? Promise.resolve(host) : null } };
  const exportedModule = { exports: {} }; new Function("require", "module", "exports", compiled)(name => modules[name] || require(name), exportedModule, exportedModule.exports);
  return { ...exportedModule.exports, calls, state };
}
async function authorized(work) {
  const previous = process.env.PI_DESKTOP_API_TOKEN; process.env.PI_DESKTOP_API_TOKEN = token;
  try { await work(); } finally { if (previous === undefined) delete process.env.PI_DESKTOP_API_TOKEN; else process.env.PI_DESKTOP_API_TOKEN = previous; }
}
const get = () => new Request(`${url}?revision=0`, { headers });
const capture = patch => ({ action: "cancel", eventId: "event-A", attempt: 1, revision: 0, sourceRevision: hash("b"), ...patch });
const post = body => new Request(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
test("execution read keeps native origin and exact caller identity gates before any Core access", () => authorized(async () => {
  const api = fixture();
  assert.equal((await api.GET(new Request(`${url}?revision=0`, { headers: { host: "localhost:30373" } }), routeContext)).status, 403);
  assert.equal((await api.GET(new Request(`${url}?revision=0&root_ref=${hash("c")}`, { headers }), routeContext)).status, 400);
  assert.equal(api.calls.length, 0);
  assert.equal((await api.POST(post(capture({ expected_owner_id: "forged" })), routeContext)).status, 400);
  assert.equal(api.calls.length, 0);
}));
test("GET reads only existing runtime and owner bound projection without prepare sync bootstrap or model work", () => authorized(async () => {
  const api = fixture(), response = await api.GET(get(), routeContext);
  assert.equal(response.status, 200); assert.equal((await response.json()).result.phase.key, "draft");
  assert.deepEqual(api.calls.map(call => call[0]), ["health", "owner_read", "preparation_execution_read"]);
  api.state.pending = false;
  assert.equal((await api.GET(get(), routeContext)).status, 503); assert.equal(api.calls.length, 3);
}));
test("old Core capability absence is explicit unavailable rather than fabricated idle or a new activation", () => authorized(async () => {
  const api = fixture(); api.state.supported = false;
  const response = await api.GET(get(), routeContext);
  assert.equal(response.status, 503); assert.equal((await response.json()).errorCode, "unsupported_operation");
  assert.deepEqual(api.calls.map(call => call[0]), ["health"]);
}));
test("explicit controls require fresh same event attempt source and current Core capability", () => authorized(async () => {
  const api = fixture();
  for (const body of [capture({ action: "pause" }), capture({ action: "resume" }), capture({ root_ref: hash("c") })]) assert.equal((await api.POST(post(body), routeContext)).status, 400);
  assert.equal(api.calls.length, 0);
  api.state.attempt = 2;
  assert.equal((await api.POST(post(capture()), routeContext)).status, 409);
  assert.equal(api.calls.some(call => call[0] === "cancel_preparation"), false);
  api.state.attempt = 1; api.state.cancel = false;
  assert.equal((await api.POST(post(capture()), routeContext)).status, 409);
  api.state.cancel = true; api.state.sourceCurrent = false;
  assert.equal((await api.POST(post(capture()), routeContext)).status, 409);
  assert.equal(api.calls.some(call => call[0] === "cancel_preparation"), false);
  api.state.sourceCurrent = true;
  assert.equal((await api.POST(post(capture()), routeContext)).status, 200);
  assert.deepEqual(api.calls.at(-1), ["cancel_preparation", { event_id: "event-A" }]);
}));

test("source-paired actual Core daemon read cancel and worker reap use the production Desktop route", { skip: !process.env.EDUPI_PREPARATION_TEST_CORE, timeout: 25000 }, () => authorized(async () => {
  const coreRoot = fs.realpathSync(process.env.EDUPI_PREPARATION_TEST_CORE);
  const { createG1TeachingRehearsalRoot, createG1TeachingRehearsalTokens, createG1TeachingLoopbackProvider, launchG1TeachingRehearsal } = await import(pathToFileURL(path.join(coreRoot, "scripts/g1_teaching_rehearsal_support.mjs")).href);
  const client = await jiti.import("../../../../../../lib/edupi-preparation-execution-client.ts");
  const directory = createG1TeachingRehearsalRoot({ prefix: "edupi-desktop-execution-pair-" }), tokens = createG1TeachingRehearsalTokens();
  const provider = await createG1TeachingLoopbackProvider({ onRequest(record) { if (record.phase === "plan") record.reply(); } });
  let host;
  const waitFor = async predicate => { const until = Date.now() + 15000; while (Date.now() < until) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error("paired execution wait timed out"); };
  try {
    host = await launchG1TeachingRehearsal({ root: directory, ...tokens, options: { baseUrl: provider.baseUrl, leaseMs: 300000 } });
    const calls = [], facade = { call: (operation, payload) => { calls.push(operation); return host.rpc("call", { operation, payload }); },
      callOwnerControl: (operation, payload) => { calls.push(operation); return host.rpc("call", { operation, payload }); } };
    const modules = { "@/lib/desktop-api-auth": native, "@/lib/request-security": security, "@/lib/bounded-form-data": bounded,
      "@/lib/edupi-preparation-execution": shared, "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ dataRoot: { root: directory } }) },
      "@/lib/edupi-runtime-supervisor": { getPendingEduPiRuntime: () => Promise.resolve(facade) } };
    const exportedModule = { exports: {} }; new Function("require", "module", "exports", compiled)(name => modules[name] || require(name), exportedModule, exportedModule.exports);
    const context = { params: Promise.resolve({ taskId: "durable-task-a" }) };
    const nativeHeaders = async initial => new Headers({ ...headers, ...Object.fromEntries(new Headers(initial || {})) });
    const fetcher = async (relative, init) => {
      const request = new Request(new URL(relative, "http://localhost:30373"), init);
      return init.method === "POST" ? exportedModule.exports.POST(request, context) : exportedModule.exports.GET(request, context);
    };
    const initial = await client.readPreparationExecution("durable-task-a", 0, undefined, fetcher, nativeHeaders);
    assert.equal(initial.state, "idle"); assert.equal(provider.requests.length, 0);
    assert.deepEqual(calls, ["health", "owner_read", "preparation_execution_read"]);
    await host.rpc("prepare"); await waitFor(() => provider.requests.some(record => record.phase === "draft"));
    const current = await client.readPreparationExecution("durable-task-a", 0, undefined, fetcher, nativeHeaders);
    assert.equal(current.phase.key, "draft"); assert.equal(current.active, true); assert.equal(current.attempt, 1);
    assert.equal(current.owner_id, host.initial.owner.id); assert.equal(current.root_ref, host.initial.owner.root_ref);
    const worker = host.workerPids.at(-1);
    await client.controlPreparationExecution(current, "cancel", undefined, fetcher, nativeHeaders);
    await waitFor(() => { try { process.kill(worker, 0); return false; } catch (error) { return error.code === "ESRCH" && provider.requests.at(-1).closed; } });
    const cancelled = await client.readPreparationExecution("durable-task-a", 0, undefined, fetcher, nativeHeaders);
    assert.equal(cancelled.state, "cancelled"); assert.equal(cancelled.active, false); assert.equal(cancelled.phase, null); assert.equal(cancelled.actions.retry, true);
    assert.equal(provider.requests.length, 2); assert.equal(calls.filter(operation => operation === "cancel_preparation").length, 1);
    assert.equal(calls.includes("prepare_task"), false, "only the teacher's separate explicit fixture prepare starts model work");
  } finally {
    if (host) { try { await host.close(); } catch { host.process.kill("SIGKILL"); await host.exited; } }
    await provider.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
}));
