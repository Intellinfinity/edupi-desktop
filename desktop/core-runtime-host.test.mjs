import assert from "node:assert/strict";
import { fork, execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import { classifyCoreRuntimeStartupError, createParentModelExecutor, startCoreRuntimeHost } from "./core-runtime-host.mjs";

test("runtime startup errors expose only bounded operational categories", () => {
  assert.equal(classifyCoreRuntimeStartupError({ code: "database_unavailable", message: "/private/teacher/data" }), "runtime_database_unavailable");
  assert.equal(classifyCoreRuntimeStartupError({ code: "invalid_state" }), "runtime_state_invalid");
  assert.equal(classifyCoreRuntimeStartupError({ code: "writer_admission_unavailable" }), "runtime_writer_unavailable");
  assert.equal(classifyCoreRuntimeStartupError({ code: "layout_mismatch" }), "runtime_root_invalid");
  assert.equal(classifyCoreRuntimeStartupError({ code: "writer_admission_root_mismatch" }), "runtime_root_invalid");
  assert.equal(classifyCoreRuntimeStartupError({ code: "unexpected_private_detail" }), "runtime_unavailable");
  assert.equal(classifyCoreRuntimeStartupError(null), "runtime_unavailable");
});

test("runtime host child reports a classified startup failure without private details", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-runtime-host-error-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(root, "scripts/core_runtime_daemon.mjs"), `
    export async function createCoreRuntimeDaemon() {
      throw Object.assign(new Error("private teacher path: ${root}"), { code: "database_unavailable" });
    }
  `);
  const child = fork(fileURLToPath(new URL("./core-runtime-host.mjs", import.meta.url)), [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  const message = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("runtime host did not report startup failure")), 5_000);
    child.once("message", (value) => { clearTimeout(timer); resolve(value); });
  });
  child.send({ type: "runtime-start", coreRoot: root, options: { dataRoot: root, token: "private-token", supervisorSessionId: "private-session", coreCommit: "a".repeat(40), componentManifestHash: `sha256:${"b".repeat(64)}`, port: 0 } });
  assert.deepEqual(await message, { type: "runtime-error", code: "runtime_database_unavailable" });
  assert.equal(await exited, 1);
});

test("private model IPC correlates results, forwards cancellation and rejects on disconnect", async () => {
  const channel = new EventEmitter(); channel.connected = true;
  const sent = []; channel.send = (value, callback) => { sent.push(value); callback?.(); };
  const host = createParentModelExecutor(channel);
  const controller = new AbortController();
  const request = { deadline_at: new Date(Date.now() + 20000).toISOString(), input: { title: "Synthetic" } };
  const running = host.run(request, { signal: controller.signal });
  const id = sent[0].id;
  assert.deepEqual(sent[0], { type: "model-run", id, request });
  controller.abort();
  assert.deepEqual(sent[1], { type: "model-cancel", id });
  channel.emit("message", { type: "unrelated", id, result: "ignored" });
  channel.emit("message", { type: "model-result", id: "wrong", result: "ignored" });
  channel.emit("message", { type: "model-result", id, result: { ok: false, error_code: "cancelled" } });
  assert.deepEqual(await running, { ok: false, error_code: "cancelled" });
  const disconnected = host.run(request, { signal: new AbortController().signal });
  channel.connected = false; channel.emit("disconnect");
  await assert.rejects(disconnected, { code: "model_unavailable" });
  host.close();
});

test("runtime host leaves G1 Live off without an exact scoped grant and forwards an explicit one", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-runtime-host-ambient-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(root, "scripts/core_runtime_daemon.mjs"), `
    let received = null;
    export async function createCoreRuntimeDaemon(options) {
      received = options;
      return { async close() {} };
    }
    export function lastOptions() { return received; }
  `);
  fs.writeFileSync(path.join(root, "scripts/core_runtime_isolated_model.mjs"), `
    const runners = new WeakSet();
    export function createIsolatedG1ModelRunner(config) {
      if (config.maxCalls !== 12 || config.timeoutMs !== 300000) throw new Error('unbounded runner');
      const runner = async () => ({}); runner.waitForIdle = async () => {}; runners.add(runner); return runner;
    }
    export const isIsolatedG1ModelRunner = value => runners.has(value);
  `);
  const channel = new EventEmitter();
  channel.connected = true;
  const messages = [];
  channel.send = value => { messages.push(value); if (value.type === "model-config-request") queueMicrotask(() => channel.emit("message", { type: "model-config-result", id: value.id, configuration: syntheticConfiguration() })); };
  const options = { dataRoot: root, token: "token", supervisorSessionId: "session", coreCommit: "a".repeat(40), componentManifestHash: `sha256:${"b".repeat(64)}`, port: 0, ambientPlanning: true };
  const host = await startCoreRuntimeHost({
    coreRoot: root,
    options,
  }, channel);
  const { lastOptions } = await import(path.join(root, "scripts/core_runtime_daemon.mjs"));
  assert.equal(lastOptions().ambientPlanning, true);
  assert.equal(lastOptions().g1Live, undefined);
  assert.equal(lastOptions().g3Live, undefined);
  assert.deepEqual(messages, [], "scope-off must not read credentials or create a model runner");
  await host.close();

  const scope = { classId: "class-7-1", subject: "数学", grantId: "desktop_canary_class_7_math" };
  const scoped = await startCoreRuntimeHost({ coreRoot: root,
    options: { ...options, ownerControlToken: "owner-control-test", g1Scope: scope } }, channel);
  assert.deepEqual(lastOptions().g1Live.scope, { classId: scope.classId, subject: scope.subject });
  assert.equal(lastOptions().g1Live.grantId, scope.grantId);
  assert.equal(lastOptions().g1Live.durableTeachingPreparation, undefined);
  const { isIsolatedG1ModelRunner } = await import(path.join(root, "scripts/core_runtime_isolated_model.mjs"));
  assert.equal(isIsolatedG1ModelRunner(lastOptions().g1Live.modelRunner), true);
  assert.equal(lastOptions().g1Live.hostExecutor, undefined);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "model-config-request");
  assert.equal(lastOptions().g3Live, undefined);
  await scoped.close();
  const exactBindings = [{ domain: "calendar_administration", grantId: "calendar-grant-1",
    scope: { class_id: "class-7-1", subject: "administration" } }];
  const g3 = await startCoreRuntimeHost({ coreRoot: root, options: { ...options,
    ownerControlToken: "owner-control-test", g3AllowedBindings: exactBindings } }, channel);
  assert.deepEqual(lastOptions().g3Live, { allowedBindings: exactBindings });
  assert.equal(lastOptions().g1Live, undefined);
  assert.equal(messages.length, 1, "G3 startup cannot request a private model configuration");
  await g3.close();
  for (const invalidBindings of [[], [{ domain: "calendar_administration", grantId: "calendar-grant-1" }],
    [exactBindings[0], exactBindings[0]], [{ ...exactBindings[0], domain: "safety_privacy" }]]) {
    await assert.rejects(startCoreRuntimeHost({ coreRoot: root,
      options: { ...options, ownerControlToken: "owner-control-test", g3AllowedBindings: invalidBindings } }, channel),
    /Invalid runtime bootstrap/);
  }
  await assert.rejects(startCoreRuntimeHost({ coreRoot: root, options: { ...options,
    g3AllowedBindings: exactBindings } }, channel), /Invalid runtime bootstrap/);
  for (const domains of [[], ["calendar_administration"], ["calendar_administration", "lesson_reflection"],
    ["calendar_administration", "calendar_administration"], ["safety_privacy"]]) {
    await assert.rejects(startCoreRuntimeHost({ coreRoot: root,
      options: { ...options, ownerControlToken: "owner-control-test", g3AllowedDomains: domains } }, channel),
    /Invalid runtime bootstrap/, "a domain-only fence cannot authorize a second active grant in the same domain");
  }
  await assert.rejects(startCoreRuntimeHost({ coreRoot: root,
    options: { ...options, g3AllowedDomains: ["calendar_administration"] } }, channel), /Invalid runtime bootstrap/);
  await assert.rejects(startCoreRuntimeHost({ coreRoot: root,
    options: { ...options, ambientPlanning: false, ownerControlToken: "owner-control-test",
      g3AllowedDomains: ["calendar_administration"] } }, channel), /Invalid runtime bootstrap/);
  for (const field of ["durableTeachingPreparation", "durableCalendarAdministration", "g1Live", "g3Live"]) {
    await assert.rejects(startCoreRuntimeHost({ coreRoot: root, options: { ...options, [field]: {} } }, channel), /Invalid runtime bootstrap/);
  }
  await assert.rejects(startCoreRuntimeHost({ coreRoot: root,
    options: { ...options, ambientPlanning: false, g1Scope: scope } }, channel), /Invalid runtime bootstrap/);
});

function syntheticConfiguration() {
  return { model: { id: "synthetic", name: "Synthetic", provider: "synthetic", api: "openai-completions", baseUrl: "https://example.invalid/v1",
    reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 4096 },
    apiKey: "synthetic-not-a-secret", maxTokens: 4096, allowLoopback: false };
}

test("private configuration IPC correlates one bounded response and rejects overrides, duplicates, timeout and cancellation", async () => {
  const channel = new EventEmitter(); channel.connected = true;
  const sent = []; channel.send = (value, callback) => { sent.push(value); callback?.(); };
  const host = createParentModelExecutor(channel, { configurationTimeoutMs: 15 });
  assert.equal(typeof host.configuration, "function");
  try {
    const first = host.configuration({ signal: new AbortController().signal });
    assert.deepEqual(Object.keys(sent[0]).sort(), ["id", "type"]);
    channel.emit("message", { type: "model-config-result", id: "unknown", configuration: syntheticConfiguration() });
    channel.emit("message", { type: "model-result", id: sent[0].id, result: syntheticConfiguration() });
    channel.emit("message", { type: "model-config-result", id: sent[0].id, configuration: syntheticConfiguration() });
    assert.deepEqual(await first, syntheticConfiguration());
    channel.emit("message", { type: "model-config-result", id: sent[0].id, configuration: { bad: true } });
    const override = host.configuration({ signal: new AbortController().signal });
    channel.emit("message", { type: "model-config-result", id: sent.at(-1).id, configuration: { ...syntheticConfiguration(), maxCalls: 1000 } });
    await assert.rejects(override, { code: "model_unavailable" });
    const oversized = host.configuration({ signal: new AbortController().signal });
    const config = syntheticConfiguration(); config.model.extra = "x".repeat(40_000);
    channel.emit("message", { type: "model-config-result", id: sent.at(-1).id, configuration: config });
    await assert.rejects(oversized, { code: "model_unavailable" });
    const abort = new AbortController();
    const cancelled = host.configuration({ signal: abort.signal });
    abort.abort();
    await assert.rejects(cancelled, { code: "model_unavailable" });
    assert.equal(sent.at(-1).type, "model-config-cancel");
    await assert.rejects(host.configuration({ signal: new AbortController().signal }), { code: "model_unavailable" });
    assert.equal(sent.at(-1).type, "model-config-cancel");
    const disconnected = host.configuration({ signal: new AbortController().signal });
    channel.connected = false; channel.emit("disconnect");
    await assert.rejects(disconnected, { code: "model_unavailable" });
  } finally { host.close(); }
});

test("unavailable G1 configuration leaves the daemon readable and never falls back to a host executor", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-g1-config-pending-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  fs.writeFileSync(path.join(root, "scripts/core_runtime_daemon.mjs"), `
    export async function createCoreRuntimeDaemon(options) {
      if (options.g1Live || options.g3Live) throw new Error('generation must stay off');
      return { readable: true, ownerControlAvailable: Boolean(options.ownerControlToken), async close() {} };
    }
  `);
  const channel = new EventEmitter(); channel.connected = true;
  const sent = []; channel.send = value => { sent.push(value); queueMicrotask(() => channel.emit("message", { type: "model-config-error", id: value.id, code: "model_unavailable" })); };
  const host = await startCoreRuntimeHost({ coreRoot: root, options: { dataRoot: root, token: "test", supervisorSessionId: "test", coreCommit: "a".repeat(40),
    componentManifestHash: `sha256:${"b".repeat(64)}`, port: 0, ambientPlanning: true, ownerControlToken: "owner-test",
    g1Scope: { classId: "class-1", subject: "数学", grantId: "g1-test" } } }, channel);
  assert.equal(host.daemon.readable, true);
  assert.equal(host.daemon.ownerControlAvailable, true);
  assert.deepEqual(sent.map(item => item.type), ["model-config-request"]);
  await host.close();
});

test("G2 bootstrap uses the Core factory and a bounded private model envelope", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-g2-host-unit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  fs.writeFileSync(path.join(root, "scripts/core_runtime_daemon.mjs"), `
    let received;
    export async function createCoreRuntimeDaemon(options) { received = options; return { async close() {} }; }
    export function lastOptions() { return received; }
  `);
  fs.writeFileSync(path.join(root, "scripts/student_followup_model_adapter.mjs"), `
    export function createStudentFollowUpModelAdapter({runModel}) {
      return { branded: true, run: (_input, options) => runModel({prompt:'Core-built synthetic prompt', signal:options.signal}) };
    }
  `);
  const channel = new EventEmitter(); channel.connected = true;
  const sent = []; channel.send = (value, callback) => { sent.push(value); callback?.(); };
  const options = { dataRoot: root, token: "test", supervisorSessionId: "test", coreCommit: "a".repeat(40),
    componentManifestHash: `sha256:${"b".repeat(64)}`, port: 0, ambientPlanning: true, ownerControlToken: "owner-test",
    g2Scope: { classId: "class-1", subject: "数学", grantId: "g2-test" } };
  const host = await startCoreRuntimeHost({coreRoot:root, options}, channel);
  const {lastOptions} = await import(path.join(root, "scripts/core_runtime_daemon.mjs"));
  try {
    assert.equal(lastOptions().g1Live, undefined);
    assert.equal(lastOptions().g2Live.modelAdapter.branded, true);
    const running = lastOptions().g2Live.modelAdapter.run({}, {signal:new AbortController().signal});
    const request = sent[0].request;
    assert.equal(request.model_kind, "student_followup");
    assert.equal(request.prompt, "Core-built synthetic prompt");
    assert.ok(Date.parse(request.deadline_at) > Date.now());
    channel.emit("message", {type:"model-result", id:sent[0].id, result:{output:"synthetic result"}});
    assert.deepEqual(await running, {output:"synthetic result"});
  } finally { await host.close(); }
  await assert.rejects(startCoreRuntimeHost({coreRoot:root, options:{...options, ownerControlToken:undefined}}, channel), /Invalid runtime bootstrap/);
});

test("real Core host uses private configuration for default Durable math, preserves reserves on restart and reaps on disconnect", { skip: !process.env.EDUPI_CORE_ROOT, timeout: 60_000 }, async () => {
  const coreRoot = fs.realpathSync(process.env.EDUPI_CORE_ROOT);
  const coreCommit = execFileSync("git", ["-C", coreRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const from = name => import(pathToFileURL(path.join(coreRoot, "scripts", name)).href);
  const { createG1TeachingRehearsalRoot, createG1TeachingRehearsalTokens, createG1TeachingLoopbackProvider, launchG1TeachingRehearsal } = await from("g1_teaching_rehearsal_support.mjs");
  const protocol = await from("core_runtime_protocol.mjs");
  const { prepareCoreRuntimeRoot } = await from("core_runtime_root.mjs");
  const { createRuntimeModelHost, attachRuntimeModelHost } = await createJiti(import.meta.url).import("../lib/edupi-runtime-model-host.ts");
  const root = createG1TeachingRehearsalRoot({ prefix: "edupi-desktop-durable-host-" });
  const tokens = createG1TeachingRehearsalTokens();
  let hold = false, current, seed;
  const provider = await createG1TeachingLoopbackProvider({ onRequest(record) { if (!hold || record.phase === "plan") record.reply(); } });
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (predicate, label) => {
    const deadline = Date.now() + 20_000;
    while (!predicate()) { if (Date.now() >= deadline) throw new Error(label); await pause(25); }
  };
  const bounded = async (promise, label, ms = 20_000) => {
    let timer;
    try { return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]); }
    finally { clearTimeout(timer); }
  };
  const snapshot = async (classId = "durable-703") => {
    seed = await launchG1TeachingRehearsal({ root, ...tokens, options: { disabled: true, baseUrl: provider.baseUrl, budget: 6, classId } });
    const value = await seed.rpc("snapshot"); await seed.close(); seed = null; return value;
  };
  let requestId = 0;
  async function launch(agentDir, scope = { classId: "durable-703", subject: "math", grantId: "durable-g1-grant" }) {
    const child = fork(fileURLToPath(new URL("./core-runtime-host.mjs", import.meta.url)), [], {
      execArgv: ["--disable-warning=ExperimentalWarning"], stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { PATH: process.env.PATH, LANG: "C.UTF-8", TZ: "Asia/Shanghai", EDUPI_PROJECT_ROOT: root, EDUPI_DATA_ROOT: root,
        EDUPI_HOME: path.join(root, ".edupi"), EDUPI_MEMORY_DIR: path.join(root, ".edupi/memory"),
        EDUPI_OUTPUT_DIR: path.join(root, ".edupi/output"), EDUPI_LOCK_DIR: path.join(root, ".edupi/locks") },
    });
    const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
    const broker = attachRuntimeModelHost(child, createRuntimeModelHost({ coreRoot, projectRoot: root, agentDir }));
    const ready = new Promise((resolve, reject) => child.on("message", value => {
      if (value.type === "runtime-ready") resolve(value);
      if (value.type === "runtime-error") reject(new Error(value.code));
    }));
    child.send({ type: "runtime-start", coreRoot, options: { dataRoot: root, token: tokens.token, ownerControlToken: tokens.ownerToken,
      supervisorSessionId: "desktop-durable-test", coreCommit, componentManifestHash: protocol.CORE_RUNTIME_SCHEMA_HASH,
      port: 0, ambientPlanning: true, g1Scope: scope } });
    let metadata;
    try { metadata = await bounded(ready, "private Core host startup"); }
    catch (error) { child.kill("SIGKILL"); await exited; await broker.close(); throw error; }
    const call = async (operation, payload) => {
      const response = await fetch(metadata.endpoint, { method: "POST", signal: AbortSignal.timeout(5000),
        headers: { "content-type": "application/json", authorization: `Bearer ${tokens.token}`, "x-edupi-owner-control": tokens.ownerToken },
        body: JSON.stringify({ protocol: protocol.CORE_RUNTIME_PROTOCOL, protocol_version: protocol.CORE_RUNTIME_PROTOCOL_VERSION,
          schema_hash: protocol.CORE_RUNTIME_SCHEMA_HASH, request_id: `desktop-durable-${++requestId}`, operation, payload }) });
      return response.json();
    };
    return { child, metadata, call, exited, async close(disconnect = false) {
      if (child.connected) { if (disconnect) child.disconnect(); else child.send({ type: "runtime-stop" }); }
      try { assert.equal((await bounded(exited, "Core host reaped", 8000)).code, 0); }
      finally { child.kill("SIGKILL"); await exited; await broker.close(); }
    } };
  }
  try {
    const initial = await snapshot();
    const agentDir = path.join(root, "agent"); fs.mkdirSync(agentDir);
    current = await launch(agentDir);
    assert.equal(current.metadata.coreCommit, coreCommit);
    assert.equal((await current.call("health", null)).ok, true, "missing credentials must preserve Core reads");
    assert.equal(provider.requests.length, 0);
    await current.close(); current = null;
    fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "synthetic", defaultModel: "synthetic" }));
    fs.writeFileSync(path.join(agentDir, "auth.json"), JSON.stringify({ synthetic: { type: "api_key", key: "synthetic-not-a-real-key" } }));
    fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: { synthetic: { baseUrl: provider.baseUrl, api: "openai-completions",
      models: [{ id: "synthetic", name: "Synthetic", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 4096 }] } } }));
    const runtimeDirectory = prepareCoreRuntimeRoot(root).runtimeDirectory;
    const executions = () => {
      try { return JSON.parse(fs.readFileSync(path.join(root, ".edupi/output/calendar_work_execution_state.json"), "utf8")).executions; }
      catch (error) { if (error.code === "ENOENT") return []; throw error; }
    };
    current = await launch(agentDir);
    assert.equal(JSON.stringify(current.metadata).includes("synthetic-not-a-real-key"), false);
    const started = await current.call("prepare_task", { task_id: "durable-task-a", expected_revision: initial.candidates.find(item => item.task_id === "durable-task-a").revision });
    assert.equal(started.ok, true);
    await until(() => executions().some(item => item.task_id === "durable-task-a" && item.status === "draft_ready"), "default Durable completion");
    assert.deepEqual(provider.requests.map(item => item.phase), ["plan", "draft"]);
    assert.equal(executions().find(item => item.task_id === "durable-task-a").artifacts.length, 4);
    assert.equal(fs.existsSync(path.join(runtimeDirectory, "teaching-preparation-durable-v1.sqlite")), true);
    const denied = await current.call("model-config-request", { baseUrl: "https://caller.invalid", maxCalls: 999 });
    assert.notEqual(denied.ok, true);
    assert.equal(JSON.stringify(denied).includes("synthetic-not-a-real-key"), false);
    await current.close(); current = null;
    const completed = await snapshot();
    assert.equal(completed.budget[0].used_calls, 2);
    assert.equal(completed.grants.find(item => item.id === "durable-g1-grant").budget.max_calls, 6);
    current = await launch(agentDir);
    const replayed = await current.call("prepare_task", { task_id: "durable-task-a", expected_revision: completed.candidates.find(item => item.task_id === "durable-task-a").revision });
    assert.equal(replayed.ok, true);
    assert.equal(replayed.result.replayed, true);
    assert.equal(provider.requests.length, 2, "fresh runner cannot reset completed work or Core's signed reserves");
    hold = true;
    const runningB = await current.call("prepare_task", { task_id: "durable-task-b", expected_revision: completed.candidates.find(item => item.task_id === "durable-task-b").revision });
    assert.equal(runningB.ok, true);
    await until(() => provider.requests.length >= 4, "held worker draft");
    const cancelled = provider.requests.at(-1);
    assert.equal((await current.call("cancel_preparation", { event_id: runningB.result.event_id })).ok, true);
    assert.equal(cancelled.closed, true, "teacher cancellation must reap the real Core model worker before returning");
    await current.close(); current = null;
    const anotherScope = await snapshot("durable-704");
    current = await launch(agentDir, { classId: "durable-704", subject: "math", grantId: "durable-g1-other" });
    assert.equal((await current.call("prepare_task", { task_id: "durable-task-c", expected_revision: anotherScope.candidates.find(item => item.task_id === "durable-task-c").revision })).ok, true);
    await until(() => provider.requests.length >= 6, "another scoped worker draft");
    const held = provider.requests.at(-1);
    await current.close(true); current = null;
    assert.equal(held.closed, true, "disconnect must close the real provider socket before the 300s model deadline");
    const closed = await snapshot();
    assert.equal(closed.budget.find(item => item.grant_id === "durable-g1-grant").used_calls, 4, "cancelled attempts remain reserved across restart");
    assert.equal(closed.budget.find(item => item.grant_id === "durable-g1-other").used_calls, 2, "disconnected attempts remain reserved under their exact grant");
    assert.deepEqual(provider.errors, []);
    assert.equal(fs.existsSync(path.join(agentDir, "sessions")), false);
  } finally {
    if (current) try { await current.close(); } catch { current.child.kill("SIGKILL"); }
    if (seed) try { await seed.close(); } catch { seed.process.kill("SIGKILL"); await seed.exited; }
    await provider.close(); fs.rmSync(root, { recursive: true, force: true });
  }
});
