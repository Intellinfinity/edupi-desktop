import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createJiti } from "jiti";
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url);
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { createRpcResourceLoader, rpcResourceOptions } = await jiti.import("./rpc-resource-loader.ts");

async function fixture(t, { disabled = false, beforeFork, failReplacement = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "edupi-pi1-session-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  await mkdir(agentDir);
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
  });
  const faux = fauxProvider({ provider: "desktop-unit", models: [{ id: "test", reasoning: false }] });
  modelRuntime.registerNativeProvider(faux.provider);
  const mode = { disabled };
  const starts = [];
  const inputSources = [];
  const manager = SessionManager.create(root, join(root, "sessions"));
  const originalId = manager.getSessionId();
  const user = (text) => ({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
  const firstId = manager.appendMessage(user("first request"));
  manager.appendMessage(fauxAssistantMessage("first response"));
  const secondId = manager.appendMessage(user("second request"));
  manager.appendMessage(fauxAssistantMessage("second response"));
  const originalFile = manager.getSessionFile();
  const probe = join(root, "extension.js");
  await writeFile(probe, `import { appendFileSync } from 'node:fs'; export default () => appendFileSync(${JSON.stringify(join(root, "loaded"))}, 'loaded');`);
  await writeFile(join(root, "AGENTS.md"), "PRIVATE PROJECT CONTEXT");
  const factory = async ({ sessionManager, sessionStartEvent }) => {
    if (failReplacement && sessionStartEvent) throw new Error("replacement failed");
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" });
    settingsManager.setProjectTrusted(true);
    const options = {
      cwd: root, agentDir, settingsManager,
      additionalExtensionPaths: [probe],
      extensionFactories: [(pi) => {
        pi.on("session_start", (event) => { starts.push(event.reason); });
        if (beforeFork) pi.on("session_before_fork", beforeFork);
        pi.on("input", (event) => {
          inputSources.push(event.source);
          return event.text === "handled" ? { action: "handled" } : undefined;
        });
      }],
    };
    const services = await createAgentSessionServices({ cwd: root, agentDir, settingsManager, modelRuntime,
      resourceLoaderOptions: rpcResourceOptions(options, mode) });
    services.resourceLoader = createRpcResourceLoader(services.resourceLoader, options, mode);
    const result = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent,
      model: faux.getModel(), noTools: "builtin" });
    result.session.setActiveToolsByName([]);
    return { ...result, services, diagnostics: services.diagnostics };
  };
  const runtime = await createAgentSessionRuntime(factory, { cwd: root, agentDir, sessionManager: manager });
  const wrapper = new AgentSessionWrapper(runtime.session, runtime, mode);
  wrapper.setForceEmptySystemPrompt(disabled);
  wrapper.start();
  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();
  t.after(() => wrapper.shutdown());
  return { root, runtime, wrapper, faux, starts, inputSources, originalId, originalFile, firstId, secondId };
}

test("Pi 1 fork preserves the before-user boundary and removes the old wrapper", async (t) => {
  const f = await fixture(t);
  let removed;
  f.wrapper.onDestroy(() => { removed = f.originalId; });
  const result = await f.wrapper.send({ type: "fork", entryId: f.secondId });
  assert.equal(result.cancelled, false);
  assert.notEqual(result.newSessionId, f.originalId);
  assert.equal(f.wrapper.isAlive(), false);
  assert.equal(removed, f.originalId);
  assert.ok(f.starts.includes("fork"));
  const reopened = SessionManager.open(f.runtime.session.sessionFile);
  assert.equal(reopened.getSessionId(), result.newSessionId);
  assert.equal(reopened.getHeader().parentSession, f.originalFile);
  const users = reopened.buildSessionContext().messages.filter(message => message.role === "user");
  assert.deepEqual(users.map(message => message.content[0].text), ["first request"]);
  const original = SessionManager.open(f.originalFile).buildSessionContext().messages;
  assert.equal(original.filter(message => message.role === "user").length, 2);
});

test("Pi 1 fork cancellation keeps the original session alive", async (t) => {
  const f = await fixture(t, { beforeFork: () => ({ cancel: true }) });
  const result = await f.wrapper.send({ type: "fork", entryId: f.secondId });
  assert.equal(result.cancelled, true);
  assert.equal(f.wrapper.sessionId, f.originalId);
  assert.equal(f.wrapper.isAlive(), true);
});

test("fork before the first user message persists the returned new identity", async (t) => {
  const f = await fixture(t);
  const result = await f.wrapper.send({ type: "fork", entryId: f.firstId });
  const reopened = SessionManager.open(f.runtime.session.sessionFile);
  assert.equal(reopened.getSessionId(), result.newSessionId);
  assert.equal(reopened.getHeader().parentSession, f.originalFile);
  assert.deepEqual(reopened.buildSessionContext().messages, []);
});

test("a failed runtime replacement never leaves a disposed wrapper registered", async (t) => {
  const f = await fixture(t, { failReplacement: true });
  let removed = false;
  f.wrapper.onDestroy(() => { removed = true; });
  await assert.rejects(f.wrapper.send({ type: "fork", entryId: f.secondId }), /replacement failed/);
  assert.equal(removed, true);
  assert.equal(f.wrapper.isAlive(), false);
});

test("a failed fork flush removes the old registry identity after replacement", async (t) => {
  const f = await fixture(t);
  let removed = false;
  f.wrapper.onDestroy(() => { removed = true; });
  f.wrapper.ensureSessionPersisted = () => { throw new Error("disk write failed"); };
  await assert.rejects(f.wrapper.send({ type: "fork", entryId: f.firstId }), /disk write failed/);
  assert.notEqual(f.wrapper.sessionId, f.originalId);
  assert.equal(removed, true);
  assert.equal(f.wrapper.isAlive(), false);
});

test("tool-free sessions omit project resources and retain an empty prompt after reload", async (t) => {
  const f = await fixture(t, { disabled: true });
  const session = f.runtime.session;
  await assert.rejects(readFile(join(f.root, "loaded")), { code: "ENOENT" });
  assert.deepEqual(session.resourceLoader.getAgentsFiles().agentsFiles, []);
  assert.equal(session.resourceLoader.getExtensions().extensions.length, 1);
  const contexts = [];
  f.faux.setResponses([1, 2].map(() => (context) => {
    contexts.push(context);
    return fauxAssistantMessage("response");
  }));
  await session.prompt("first prompt");
  await session.reload();
  await session.prompt("after reload");
  assert.equal(contexts.length, 2);
  for (const context of contexts) {
    const system = context.messages.filter(message => message.role === "system");
    assert.equal(system.flatMap(message => message.content).map(block => typeof block === "string" ? block : block.text ?? "").join(""), "");
  }
  assert.deepEqual(session.getActiveToolNames(), []);
  await assert.rejects(readFile(join(f.root, "loaded")), { code: "ENOENT" });
  await f.wrapper.send({ type: "set_tools", toolNames: ["read"] });
  assert.ok(session.getActiveToolNames().includes("read"));
  assert.deepEqual(session.resourceLoader.getExtensions().errors, []);
  const enabledLoads = await readFile(join(f.root, "loaded"), "utf8");
  await f.wrapper.send({ type: "set_tools", toolNames: [] });
  await session.reload();
  assert.equal(await readFile(join(f.root, "loaded"), "utf8"), enabledLoads);
  assert.deepEqual(session.getActiveToolNames(), []);
  assert.deepEqual(session.resourceLoader.getAgentsFiles().agentsFiles, []);
});

test("steering and follow-up preserve Pi 1 disposition and RPC input source", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.wrapper.send({ type: "steer", message: "handled" }), { disposition: "handled" });
  assert.equal(f.wrapper.inner.pendingMessageCount, 0);
  assert.deepEqual(await f.wrapper.send({ type: "follow_up", message: "later" }), { disposition: "queued" });
  assert.deepEqual(f.wrapper.inner.getFollowUpMessages(), ["later"]);
  assert.deepEqual(f.inputSources, ["rpc", "rpc"]);
  await f.wrapper.send({ type: "set_thinking_level", level: "xhigh" });
  assert.equal(f.wrapper.inner.thinkingLevel, "off");
});

test("reload uses changed extension code both normally and after a tool-free interval", async (t) => {
  const f = await fixture(t);
  const source = join(f.root, "extension.js");
  const marker = join(f.root, "extension-version");
  const replace = (version) => writeFile(source, `import { writeFileSync } from 'node:fs'; export default () => writeFileSync(${JSON.stringify(marker)}, '${version}');`);
  await replace("v2");
  await f.wrapper.inner.reload();
  assert.equal(await readFile(marker, "utf8"), "v2");
  await f.wrapper.send({ type: "set_tools", toolNames: [] });
  await replace("v3");
  await f.wrapper.inner.reload();
  assert.equal(await readFile(marker, "utf8"), "v2");
  await f.wrapper.send({ type: "set_tools", toolNames: ["read"] });
  assert.equal(await readFile(marker, "utf8"), "v3");
});
