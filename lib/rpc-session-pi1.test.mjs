import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createHash } from "node:crypto";
import { createJiti } from "jiti";
import ts from "typescript";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url);
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { createRpcResourceLoader, rpcResourceOptions } = await jiti.import("./rpc-resource-loader.ts");
const { normalizeToolCalls } = await jiti.import("./normalize.ts");
const { createEduPiCalendarTools } = await jiti.import("./edupi-calendar-tool.ts");
const { inspectEduPiPromptSession } = await jiti.import("./edupi-prompt-reconciliation.ts");

async function fixture(t, { disabled = false, empty = false, beforeFork, failReplacement = false, customToolFactory = () => [], extraExtensionFactories = [] } = {}) {
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
  const firstId = empty ? null : manager.appendMessage(user("first request"));
  if (!empty) manager.appendMessage(fauxAssistantMessage("first response"));
  const secondId = empty ? null : manager.appendMessage(user("second request"));
  if (!empty) manager.appendMessage(fauxAssistantMessage("second response"));
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
      appendSystemPromptOverride: () => ["Synthetic teacher background"],
      extensionFactories: [(pi) => {
        pi.on("session_start", (event) => { starts.push(event.reason); });
        if (beforeFork) pi.on("session_before_fork", beforeFork);
        pi.on("input", (event) => {
          inputSources.push(event.source);
          return event.text === "handled" ? { action: "handled" } : undefined;
        });
      }, ...extraExtensionFactories],
    };
    const services = await createAgentSessionServices({ cwd: root, agentDir, settingsManager, modelRuntime,
      resourceLoaderOptions: rpcResourceOptions(options, mode) });
    services.resourceLoader = createRpcResourceLoader(services.resourceLoader, options, mode);
    const result = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent,
      model: faux.getModel(), noTools: "builtin", customTools: customToolFactory(root) });
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

test("send-specific Pi persistence saves a new session ID before Core capture without a user message", async t => {
  const f = await fixture(t, { empty: true });
  await assert.rejects(readFile(f.originalFile), { code: "ENOENT" });
  assert.equal(await f.wrapper.send({ type: "persist_session" }), null);
  const reopened = SessionManager.open(f.originalFile);
  assert.equal(reopened.getSessionId(), f.originalId);
  assert.equal(reopened.getEntries().some(item => item.type === "message"), false);
  assert.equal(await f.wrapper.send({ type: "persist_session" }), null);
});

test("one Pi 1 RPC prompt produces one user bubble despite the preceding system declaration", async (t) => {
  const f = await fixture(t);
  const source = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const messageEndCase = source.slice(source.indexOf('case "message_end":'), source.indexOf('case "tool_execution_start":'));
  const body = ts.transpileModule(`switch (event.type) { ${messageEndCase} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const optimistic = { role: "user", content: "synthetic single request", timestamp: 1000 };
  let messages = [optimistic];
  let history;
  const completedRoles = [];
  const context = {
    agentRunningRef: { current: true },
    optimisticUserMessageKeyRef: { current: JSON.stringify({ text: optimistic.content, images: [] }) },
    userMessageKey: message => JSON.stringify({ text: typeof message.content === "string" ? message.content : message.content.filter(block => block.type === "text").map(block => block.text).join("\n"), images: [] }),
    normalizeToolCalls,
    setMessages: update => { messages = update(messages); },
    dispatch() {}, setAgentPhase() {},
  };
  if (source.includes("dispatchMessageHistory")) {
    const { messageHistoryReducer, emptyMessageHistory } = await jiti.import("./agent-message-history.ts");
    history = messageHistoryReducer(emptyMessageHistory(), { type: "optimistic", message: optimistic, requestId: "single-request" });
    context.dispatchMessageHistory = action => { const previous = history; history = messageHistoryReducer(history, action); messages = history.messages; return history !== previous; };
  }
  const consume = new Function("event", ...Object.keys(context), body);
  const settled = new Promise(resolve => f.wrapper.onEvent(event => {
    if (event.type === "message_end") {
      completedRoles.push(event.message.role);
      consume(event, ...Object.values(context));
    }
    if (event.type === "prompt_done") resolve();
  }));
  f.faux.setResponses([fauxAssistantMessage("synthetic response")]);
  await f.wrapper.send({ type: "prompt", message: optimistic.content, clientRequestId: "single-request" });
  await settled;
  const persisted = SessionManager.open(f.originalFile).buildSessionContext().messages;
  assert.equal(persisted.filter(message => message.role === "user" && message.content.some(block => block.type === "text" && block.text === optimistic.content)).length, 1, "the SDK persisted one submission");
  assert.ok(completedRoles.indexOf("system") < completedRoles.indexOf("user"), "Pi 1 emits the tool declaration before the submitted user message");
  assert.equal(messages.filter(message => message.role === "user").length, 1, "the hook must consume the optimistic bubble even when system events precede it");
});

test("RPC request replay executes once while a second intentional same-text submission executes again", async (t) => {
  const f = await fixture(t);
  const message = "synthetic repeated request";
  const delivered = [];
  f.wrapper.onEvent(event => {
    if (event.type === "message_end" && event.message.role === "user") delivered.push(event);
  });
  const awaitCompletion = () => new Promise(resolve => {
    const unsubscribe = f.wrapper.onEvent(event => {
      if (event.type !== "prompt_done") return;
      unsubscribe();
      resolve();
    });
  });
  f.faux.setResponses([fauxAssistantMessage("first response"), fauxAssistantMessage("second response")]);
  const firstDone = awaitCompletion();
  await Promise.all([1, 2].map(() => f.wrapper.send({ type: "prompt", message, clientRequestId: "request-1" })));
  await firstDone;
  await f.wrapper.send({ type: "prompt", message, clientRequestId: "request-1" });
  assert.equal(delivered.length, 1, "concurrent and settled replay of the same request must not execute again");
  const secondDone = awaitCompletion();
  await f.wrapper.send({ type: "prompt", message, clientRequestId: "request-2" });
  await secondDone;
  assert.equal(delivered.length, 2);
  assert.deepEqual(delivered.map(event => event.clientRequestId), ["request-1", "request-2"]);
  const entries = SessionManager.open(f.originalFile).getEntries();
  for (const event of delivered) {
    assert.equal(event.messageId, event.entryId);
    assert.ok(entries.some(entry => entry.type === "message" && entry.id === event.entryId && entry.message.role === "user"), "SSE identity must be the actual persisted entry");
  }
  assert.notEqual(delivered[0].entryId, delivered[1].entryId);
});

test("Core-first Pi dispatch writes a silent request marker before the persisted user entry", async (t) => {
  const f = await fixture(t);
  const requestId = "request-marker-1";
  const command = { type: "prompt", message: "合成教师消息", clientRequestId: requestId };
  const commandHash = `sha256:${createHash("sha256").update(JSON.stringify(command)).digest("hex")}`;
  f.faux.setResponses([fauxAssistantMessage("synthetic response")]);
  f.wrapper.recordEduPiPromptDispatch(requestId, commandHash);
  const settled = new Promise(resolve => {
    const unsubscribe = f.wrapper.onEvent(event => {
      if (event.type !== "prompt_done") return;
      unsubscribe(); resolve();
    });
  });
  await f.wrapper.send(command);
  await settled;
  const entries = SessionManager.open(f.originalFile).getEntries();
  const marker = entries.find(item => item.type === "custom" && item.customType === "edupi_prompt_dispatch_v1");
  const user = entries.find(item => item.type === "message" && item.message.role === "user"
    && item.message.content.some(block => block.type === "text" && block.text === "合成教师消息"));
  assert.deepEqual(marker?.data, { clientRequestId: requestId, commandHash });
  const byId = new Map(entries.map(item => [item.id, item]));
  let parentId = user?.parentId;
  while (parentId && parentId !== marker?.id) parentId = byId.get(parentId)?.parentId;
  assert.equal(parentId, marker?.id, "Pi may insert a system declaration between the marker and user message");
  assert.equal(inspectEduPiPromptSession({ command, clientRequestId: requestId }, f.originalFile), "confirmed");
  await assert.rejects(async () => f.wrapper.recordEduPiPromptDispatch("bad request", commandHash), /edupi_prompt_dispatch_unavailable/);
});

test("ordinary RPC can wait for an actual persisted Pi user entry before acknowledging send", async t => {
  const f = await fixture(t);
  f.faux.setResponses([fauxAssistantMessage("synthetic response")]);
  await f.wrapper.send({ type: "prompt", message: "合成待落盘消息",
    clientRequestId: "persist-request", awaitUserPersistence: true });
  const entries = SessionManager.open(f.originalFile).getEntries();
  assert.equal(entries.filter(item => item.type === "message" && item.message.role === "user"
    && item.message.content.some(block => block.type === "text" && block.text === "合成待落盘消息")).length, 1);
  await assert.rejects(f.wrapper.send({ type: "prompt", message: "合成待落盘消息",
    clientRequestId: "persist-request", awaitUserPersistence: true }), /already submitted/);
});

test("an async Pi preflight failure cannot acknowledge a user entry that was never stored", async t => {
  const f = await fixture(t);
  const before = SessionManager.open(f.originalFile).getEntries().filter(item => item.type === "message" && item.message.role === "user").length;
  f.wrapper.inner.prompt = async () => { throw new Error("synthetic_auth_preflight_failure"); };
  await assert.rejects(f.wrapper.send({ type: "prompt", message: "未落盘",
    clientRequestId: "failed-preflight", awaitUserPersistence: true }), /not durably recorded/);
  assert.equal(SessionManager.open(f.originalFile).getEntries().filter(item => item.type === "message" && item.message.role === "user").length, before);
});

test("queuing a prompt does not clear the active RPC submission's running state or identity", async (t) => {
  const f = await fixture(t);
  let releaseModel, modelStarted;
  const gate = new Promise(resolve => { releaseModel = resolve; });
  const started = new Promise(resolve => { modelStarted = resolve; });
  f.faux.setResponses([
    async () => { modelStarted(); await gate; return fauxAssistantMessage("synthetic first response"); },
    fauxAssistantMessage("synthetic queued response"),
  ]);
  const settled = new Promise(resolve => f.wrapper.onEvent(event => { if (event.type === "prompt_done") resolve(); }));
  await f.wrapper.send({ type: "prompt", message: "synthetic first prompt", clientRequestId: "active-request" });
  await started;
  const queued = new Promise(resolve => f.wrapper.onEvent(event => { if (event.type === "queue_update" && event.followUp?.includes("synthetic queued prompt")) resolve(); }));
  try {
    await f.wrapper.send({ type: "prompt", message: "synthetic queued prompt", streamingBehavior: "followUp" });
    await queued;
    await new Promise(resolve => setImmediate(resolve));
    const state = await f.wrapper.send({ type: "get_state" });
    assert.equal(state.isPromptRunning, true);
    assert.equal(state.clientRequestId, "active-request");
  } finally { releaseModel(); }
  await settled;
});

test("canonical calendar tools override legacy extensions through reload and tool-free intervals", async (t) => {
  let legacyWrites = 0, canonicalWrites = 0;
  const f = await fixture(t, {
    extraExtensionFactories: [pi => pi.registerTool({
      name: "calendar_add", label: "legacy calendar", description: "legacy file writer", parameters: Type.Object({}),
      execute: async () => { legacyWrites++; throw new Error("canonical_schedule_required"); },
    })],
    customToolFactory: root => createEduPiCalendarTools({ projectRoot: root, issue: async command => {
      canonicalWrites++;
      return { receipt: { status: "accepted", receipt_id: "synthetic-receipt" }, data: { education_workspace: { calendar: command.events.map(event => ({
        ...event, state: "confirmed", date_status: "explicit", source_ids: [command.source.source_id], evidence_ids: command.source.evidence_ids,
      })) } } };
    } }),
  });
  for (const stage of ["initial", "reload", "reenable"]) {
    if (stage === "reload") await f.wrapper.inner.reload();
    if (stage === "reenable") {
      await f.wrapper.send({ type: "set_tools", toolNames: [] });
      await f.wrapper.inner.reload();
      assert.deepEqual(f.wrapper.inner.getActiveToolNames(), []);
    }
    await f.wrapper.send({ type: "set_tools", toolNames: ["calendar_add"] });
    const definition = f.wrapper.inner.getAllTools().find(tool => tool.name === "calendar_add");
    assert.match(definition.description, /Core 正式保存/);
    f.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("calendar_add", { date: "2026-10-08", name: "合成会议", type: "meeting" }, { id: `calendar-${stage}` }), { stopReason: "toolUse" }),
      fauxAssistantMessage("synthetic calendar response"),
    ]);
    const settled = new Promise(resolve => {
      const unsubscribe = f.wrapper.onEvent(event => {
        if (event.type !== "prompt_done") return;
        unsubscribe();
        resolve();
      });
    });
    await f.wrapper.send({ type: "prompt", message: `synthetic calendar ${stage}`, clientRequestId: `request-${stage}` });
    await settled;
  }
  assert.equal(canonicalWrites, 3);
  assert.equal(legacyWrites, 0);
});

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

test("enabling tools restores prepared teacher context without restarting the session", async (t) => {
  const f = await fixture(t, { disabled: true });
  assert.deepEqual(f.wrapper.inner.resourceLoader.getAppendSystemPrompt(), []);
  await f.wrapper.send({ type: "set_tools", toolNames: ["read"] });
  assert.deepEqual(f.wrapper.inner.resourceLoader.getAppendSystemPrompt(), ["Synthetic teacher background"]);
  assert.equal(f.wrapper.sessionId, f.originalId);
});
