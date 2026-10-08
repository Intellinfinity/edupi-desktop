import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { validatePrivateModelConfiguration } from "../desktop/core-runtime-model-config.mjs";
const { readRuntimeModelConfiguration } = await createJiti(import.meta.url).import("./edupi-runtime-model-config.ts");

const model = { id: "synthetic", name: "Synthetic", api: "openai-completions", provider: "synthetic", baseUrl: "http://127.0.0.1:43210/v1",
  reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 4096 };
const configuration = () => ({ model: structuredClone(model), apiKey: "synthetic-key", maxTokens: 4096, allowLoopback: true });

test("private configuration validation rejects shape, size, OAuth APIs, extra headers and caller budgets", () => {
  const valid = configuration();
  const copied = validatePrivateModelConfiguration(valid);
  valid.model.baseUrl = "https://other.invalid";
  assert.equal(copied.model.baseUrl, model.baseUrl);
  for (const change of [value => { value.maxCalls = 1000; }, value => { value.timeoutMs = 1; }, value => { value.apiKey = "secret\nheader"; },
    value => { value.model.headers = { Authorization: "secret" }; }, value => { value.model.api = "openai-codex-responses"; },
    value => { value.model.baseUrl = "https://user:secret@example.invalid/v1"; }, value => { value.model.baseUrl += "?key=secret"; },
    value => { value.model.large = "x".repeat(20_000); }, value => { value.allowLoopback = false; }]) {
    const invalid = configuration(); change(invalid);
    assert.throws(() => validatePrivateModelConfiguration(invalid), error => error.code === "model_unavailable" && !error.message.includes("secret"));
  }
  const getter = configuration(); Object.defineProperty(getter, "apiKey", { enumerable: true, get() { throw new Error("must not invoke"); } });
  assert.throws(() => validatePrivateModelConfiguration(getter), { code: "model_unavailable" });
});

test("current configuration is resolved read-only from isolated settings and rejects unsupported auth before resolution", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-model-config-"));
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true, force: true }); });
  let commandResolutions = 0;
  t.mock.method(childProcess, "execSync", () => { commandResolutions++; return Buffer.from("synthetic-intercepted-command-result"); });
  syncBuiltinESMExports();
  const agentDir = path.join(root, "agent"); fs.mkdirSync(agentDir);
  const files = { "settings.json": { defaultProvider: "synthetic", defaultModel: "synthetic" }, "auth.json": { synthetic: { type: "api_key", key: "synthetic-key" } },
    "models.json": { providers: { synthetic: { baseUrl: model.baseUrl, api: model.api, models: [{ ...model, provider: undefined, baseUrl: undefined, api: undefined }] } } } };
  const write = () => { for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(agentDir, name), JSON.stringify(value)); };
  write();
  const before = Object.fromEntries(Object.keys(files).map(name => [name, fs.readFileSync(path.join(agentDir, name), "utf8")]));
  const options = { projectRoot: root, agentDir, signal: new AbortController().signal };
  const selected = await readRuntimeModelConfiguration(options);
  assert.equal(selected.apiKey, "synthetic-key");
  assert.equal(selected.model.id, "synthetic");
  assert.equal(selected.allowLoopback, true);
  assert.deepEqual(Object.fromEntries(Object.keys(files).map(name => [name, fs.readFileSync(path.join(agentDir, name), "utf8")])), before);
  assert.deepEqual(fs.readdirSync(agentDir).sort(), Object.keys(files).sort(), "no auth lock/catalog/session writes");
  for (const credential of [{ type: "oauth", access: "synthetic", refresh: "synthetic", expires: 1 }, { type: "api_key", key: "!touch /should-not-run" }]) {
    files["auth.json"].synthetic = credential; write();
    await assert.rejects(readRuntimeModelConfiguration(options), { code: "model_unavailable" });
  }
  files["auth.json"].synthetic = { type: "api_key", key: "synthetic-key" };
  files["models.json"].providers.synthetic.headers = { "X-Private": "never-drop" }; write();
  await assert.rejects(readRuntimeModelConfiguration(options), { code: "model_unavailable" });
  delete files["models.json"].providers.synthetic.headers;
  files["models.json"].providers.synthetic.apiKey = "!touch /should-not-run"; write();
  await assert.rejects(readRuntimeModelConfiguration(options), { code: "model_unavailable" });
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(readRuntimeModelConfiguration({ ...options, signal: cancelled.signal }), { code: "model_unavailable" });
  assert.equal(commandResolutions, 0);
});

test("the actual SDK consumes only the prevalidated snapshot when models.json changes before its asynchronous load", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-model-config-race-"));
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify({ defaultProvider: "synthetic", defaultModel: "synthetic" }));
  fs.writeFileSync(path.join(root, "auth.json"), JSON.stringify({ synthetic: { type: "api_key", key: "synthetic-key" } }));
  const provider = { baseUrl: model.baseUrl, api: model.api, models: [{ ...model, provider: undefined, baseUrl: undefined, api: undefined }] };
  const file = path.join(root, "models.json"); fs.writeFileSync(file, JSON.stringify({ providers: { synthetic: provider } }));
  let commandResolutions = 0;
  t.mock.method(childProcess, "execSync", () => { commandResolutions++; return Buffer.from("synthetic-intercepted-command-result"); });
  syncBuiltinESMExports();
  const create = ModelRuntime.create;
  t.mock.method(ModelRuntime, "create", async options => {
    fs.writeFileSync(file, JSON.stringify({ providers: { synthetic: { ...provider, headers: { "X-Synthetic": "!synthetic-not-executed" } } } }));
    return create.call(ModelRuntime, options);
  });
  const result = await readRuntimeModelConfiguration({ projectRoot: root, agentDir: root, signal: new AbortController().signal }).catch(error => ({ error: error.code }));
  assert.equal(commandResolutions, 0, "rejecting a resolved header afterwards is too late");
  assert.equal(result.apiKey, "synthetic-key", "the same validated snapshot, not the concurrent replacement, supplies configuration");
});

test("a built-in physical model with an explicit isolated API key stays available without a custom catalog", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-native-model-config-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
    credentials: { async read() {}, async list() { return []; }, async modify() { throw new Error("read only"); }, async delete() { throw new Error("read only"); } },
    modelsStore: { async read() {}, async write() { throw new Error("read only"); }, async delete() { throw new Error("read only"); } } });
  const selected = runtime.getModels("openai").find(item => item.api === "openai-responses");
  assert.ok(selected, "the pinned SDK supplies its own physical catalog offline");
  fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: selected.id }));
  fs.writeFileSync(path.join(root, "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "synthetic-key" } }));
  const result = await readRuntimeModelConfiguration({ projectRoot: root, agentDir: root, signal: new AbortController().signal });
  assert.equal(result.apiKey, "synthetic-key");
  assert.equal(result.model.id, selected.id);
  assert.equal(result.model.provider, "openai");
  assert.deepEqual(fs.readdirSync(root).sort(), ["auth.json", "settings.json"]);
  fs.writeFileSync(path.join(root, "models.json"), JSON.stringify({ providers: { openai: { modelOverrides: { [selected.id]: { name: "Synthetic override", maxTokens: 128 } } } } }));
  await assert.rejects(readRuntimeModelConfiguration({ projectRoot: root, agentDir: root, signal: new AbortController().signal }), { code: "model_unavailable" },
    "a selected override must not be silently discarded and expand the configured token cap");
});

test("the packaged-loop synthetic local provider is a usable isolated G1 configuration", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-packaged-model-config-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agentDir = path.join(root, "agent"); fs.mkdirSync(agentDir);
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "local", defaultModel: "local" }));
  fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
    api: "openai-completions", apiKey: "local-test-placeholder", baseUrl: "http://127.0.0.1:43210/v1",
    models: [{ id: "local", name: "Route1 local test", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048 }],
  } } }));
  const result = await readRuntimeModelConfiguration({ projectRoot: root, agentDir, signal: new AbortController().signal });
  assert.equal(result.model.id, "local");
  assert.equal(result.model.reasoning, false);
});
