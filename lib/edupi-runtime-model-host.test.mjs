import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";
import { EventEmitter } from "node:events";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
const { createRuntimeModelHost, attachRuntimeModelHost } = await createJiti(import.meta.url).import("./edupi-runtime-model-host.ts");

test("G2 uses a separate bounded prompt path without exposing credentials", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-g2-model-unit-"));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  fs.writeFileSync(path.join(root, "scripts/core_runtime_model_adapter.mjs"), 'export function buildG1LiveRequest(){throw new Error("G2 must not use G1 leases")}');
  fs.writeFileSync(path.join(root, "scripts/core_runtime_isolated_model.mjs"), `
    let calls = 0;
    export const callCount = () => calls;
    export function createIsolatedG1ModelRunner(config) {
      if(config.apiKey !== 'synthetic-key' || config.maxCalls !== 1 || config.timeoutMs > 120000) throw new Error('unbounded config');
      return async ({prompt,signal}) => { if(signal.aborted) throw new Error('cancelled'); calls++; return {output:prompt}; };
    }
  `);
  t.mock.method(SettingsManager, "create", () => ({getDefaultProvider:()=>"test", getDefaultModel:()=>"test"}));
  t.mock.method(ModelRuntime, "create", async () => ({getModel:()=>({id:"test",provider:"test",baseUrl:"https://example.invalid/v1",maxTokens:100}),
    getAuth:async()=>({auth:{apiKey:"synthetic-key"}}), getCompatibilityRequestConfig:()=>({}), isUsingOAuth:()=>false}));
  const host = createRuntimeModelHost({coreRoot:root,projectRoot:root,agentDir:root});
  const request = {model_kind:"student_followup",prompt:"Synthetic Core prompt",deadline_at:new Date(Date.now()+60000).toISOString()};
  try {
    assert.deepEqual(await host.run(request, {signal:new AbortController().signal}), {output:request.prompt});
    await assert.rejects(host.run({...request,baseUrl:"https://other.invalid"},{signal:new AbortController().signal}), {code:"invalid_model_request"});
    await assert.rejects(host.run({...request,deadline_at:"invalid"},{signal:new AbortController().signal}), {code:"invalid_model_request"});
    const {callCount} = await import(path.join(root,"scripts/core_runtime_isolated_model.mjs"));
    assert.equal(callCount(),1);
  } finally { await host.close(); }
});

test("configured model host runs isolated localhost SDK and cancellation reaps its connection", { skip: !process.env.EDUPI_CORE_ROOT }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-model-host-"));
  let hang = false, calls = 0, received, onRequest, onHangClosed;
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    calls++; received = JSON.parse(raw);
    if (hang) res.once("close", () => onHangClosed?.());
    onRequest?.();
    assert.equal(req.headers.authorization, "Bearer isolated-test-credential");
    if (hang) return;
    const output = JSON.stringify({ artifacts: [{ title: "Outline", content: "Use the supplied cube material.", source_ids: ["material"] }] });
    const chunk = (delta, finish_reason) => `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(chunk({ role: "assistant", content: output }, null)); res.write(chunk({}, "stop")); res.end("data: [DONE]\n\n");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const agentDir = path.join(root, "agent"); fs.mkdirSync(agentDir);
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "local", defaultModel: "local" }));
  fs.writeFileSync(path.join(agentDir, "auth.json"), JSON.stringify({ local: { type: "api_key", key: "isolated-test-credential" } }));
  const config = { providers: { local: { baseUrl: `http://localhost:${server.address().port}/v1`, api: "openai-completions", models: [{ id: "local", name: "local", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 128 }] } } };
  fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify(config));
  const host = createRuntimeModelHost({ coreRoot: process.env.EDUPI_CORE_ROOT, projectRoot: root, agentDir });
  try {
    const core = name => import(pathToFileURL(path.join(process.env.EDUPI_CORE_ROOT, "scripts", name)).href);
    const { buildHarnessLeaseRequest } = await core("core_runtime_harness.mjs");
    const { buildG1LiveRequest } = await core("core_runtime_model_adapter.mjs");
    const hash = text => `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
    const request = () => buildG1LiveRequest({ lease: buildHarnessLeaseRequest({ lease_id: "lease", work_case_id: "work", execution_fingerprint: hash("execution"), attempt: 1, claim_token_hash: hash("claim"), fencing_generation: 1, source_revision: "revision", deadline_at: new Date(Date.now() + 20000).toISOString(), input: { work_case_id: "work", task_id: "task", title: "Cube", summary: "Synthetic", reason: "confirmed", due_at: "2026-09-08", source_semantic_fingerprint: hash("source"), source_revision: "revision", deliverables: ["Outline"] } }), materials: [{ source_id: "material", revision: "revision", content: "Cube material", sha256: hash("Cube material") }] });
    const result = await host.run(request(), { signal: new AbortController().signal });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.capability_version, "g1-live-v1");
    assert.equal(result.output.artifacts[0].source_ids[0], "material");
    assert.equal(JSON.stringify(result).includes("isolated-test-credential"), false);
    assert.equal(received.tools, undefined);
    assert.equal(fs.existsSync(path.join(agentDir, "sessions")), false);
    await assert.rejects(host.run({ ...request(), baseUrl: "http://untrusted.example/v1" }, { signal: new AbortController().signal }), { code: "invalid_lease" });
    assert.equal(calls, 1, "request payload cannot select or override the configured endpoint");
    hang = true;
    const hangClosed = new Promise(resolve => { onHangClosed = resolve; });
    const cancel = new AbortController(); onRequest = () => cancel.abort();
    assert.equal((await host.run(request(), { signal: cancel.signal })).error_code, "cancelled");
    await hangClosed;
    config.providers.local.headers = { "X-Unsupported": "do-not-drop" };
    fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify(config));
    assert.equal((await host.run(request(), { signal: new AbortController().signal })).error_code, "model_unavailable");
    assert.equal(calls, 2);
  } finally { await host.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
});

test("parent broker only accepts model messages and cancels pending work on disconnect", async () => {
  const child = new EventEmitter(); child.connected = true;
  const sent = []; child.send = (value, callback) => { sent.push(value); callback?.(); };
  let signal, closeCount = 0;
  const broker = attachRuntimeModelHost(child, { run: (_request, options) => { signal = options.signal; return new Promise(resolve => signal.addEventListener("abort", () => resolve({ ok: false, error_code: "cancelled" }))); }, close: async () => { closeCount++; } });
  child.emit("message", { type: "runtime-ready", id: "unrelated", request: {} });
  assert.equal(signal, undefined);
  child.emit("message", { type: "model-run", id: "run-1", request: {} });
  assert.equal(signal.aborted, false);
  child.connected = false; child.emit("disconnect");
  await broker.close();
  assert.equal(signal.aborted, true);
  assert.equal(closeCount, 1);
  assert.deepEqual(sent, []);
});

test("parent private config broker rejects caller overrides and replay and cancels pending configuration", async () => {
  const child = new EventEmitter(); child.connected = true;
  const sent = []; child.send = (value, callback) => { sent.push(value); callback?.(); };
  let calls = 0, signal, resolveConfiguration;
  const config = { model: { id: "test", name: "test", provider: "test", api: "openai-completions", baseUrl: "https://example.invalid/v1", reasoning: false,
    input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 4096 }, apiKey: "synthetic-key", maxTokens: 4096, allowLoopback: false };
  const host = { run: async () => ({}), configuration: options => { calls++; signal = options.signal; return new Promise(resolve => { resolveConfiguration = resolve; }); }, close: async () => {} };
  const broker = attachRuntimeModelHost(child, host);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  try {
    child.emit("message", { type: "model-config-request", id: "invalid", model: { baseUrl: "https://caller.invalid" } });
    child.emit("message", { type: "model-config-request", id: "x".repeat(101) });
    assert.equal(calls, 0);
    child.emit("message", { type: "model-config-request", id: "config-1" });
    assert.equal(calls, 1);
    child.emit("message", { type: "model-config-request", id: "config-1" });
    assert.equal(calls, 1);
    resolveConfiguration(config); await flush();
    assert.deepEqual(sent, [{ type: "model-config-result", id: "config-1", configuration: config }]);
    child.emit("message", { type: "model-config-request", id: "config-1" }); await flush();
    assert.equal(calls, 1, "a completed request ID cannot fetch credentials again");
    child.emit("message", { type: "model-config-request", id: "cancel-1" });
    child.emit("message", { type: "model-config-cancel", id: "cancel-1" });
    assert.equal(signal.aborted, true);
    resolveConfiguration(config); await flush();
    assert.equal(sent.filter(value => value.type === "model-config-result").length, 1);
    child.emit("message", { type: "model-config-request", id: "disconnect-1" });
    child.connected = false; child.emit("disconnect");
    assert.equal(signal.aborted, true);
    resolveConfiguration(config); await flush();
  } finally { await broker.close(); }
});

test("loopback URL validation keeps IPv6 localhost eligible for the isolated host", async () => {
  const source = fs.readFileSync(new URL("./edupi-runtime-model-host.ts", import.meta.url), "utf8");
  assert.match(source, /\["localhost", "127\.0\.0\.1", "::1", "\[::1\]"\]/);
});
