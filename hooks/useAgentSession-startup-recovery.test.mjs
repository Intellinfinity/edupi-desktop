import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const draftSource = await readFile(new URL("../lib/draft-store.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url);
const composer = await jiti.import("../lib/edupi-composer-context.ts");
const { emptyMessageHistory, messageHistoryReducer } = await jiti.import("../lib/agent-message-history.ts");
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const noop = () => {};
const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));

function draftHarness() {
  const persisted = new Map();
  let writable = true;
  function coldStore() {
    const exports = {};
    vm.runInNewContext(compile(draftSource), {
      exports, window: {}, setTimeout: () => 1, clearTimeout: noop,
      require: name => name === "@/lib/edupi-composer-context" ? composer : {
        APP_PREF_KEYS: { chatDrafts: "pi-chat-drafts-v1" },
        getPrefJson: key => persisted.has(key) ? JSON.parse(persisted.get(key)) : null,
        trySetPrefJson: (key, value) => {
          if (!writable) return false;
          persisted.set(key, JSON.stringify(value));
          return true;
        },
      },
    });
    return exports;
  }
  const store = coldStore();
  return { store, cold: key => plain(coldStore().getDraft(key)), writable: value => { writable = value; } };
}

function startupHarness({ input = true, acceptRestore = false, promptError = null, creationGate = null, modelGate = null,
  armGate = null, armStatus = "armed", promptGate = null, initialSid = null, selectedModel = null } = {}) {
  const drafts = draftHarness();
  const draftKey = "new:/synthetic/startup";
  const timers = new Map(), sources = [], commands = [], notices = [], promoted = [], recoveries = [], settlements = [], events = [], armed = [], sequence = [];
  let timerId = 0, creates = 0, active = false, history = emptyMessageHistory();
  class FakeEventSource {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;
    readyState = FakeEventSource.CONNECTING;
    constructor(url) { this.url = url; sources.push(this); }
    close() { this.readyState = FakeEventSource.CLOSED; }
    connected() { this.readyState = FakeEventSource.OPEN; this.onmessage?.({ data: JSON.stringify({ type: "connected" }) }); }
    fatal() { this.readyState = FakeEventSource.CLOSED; this.onerror?.(); }
  }
  const context = {
    useCallback: callback => callback, EventSource: FakeEventSource,
    setTimeout: (callback, ms) => { timers.set(++timerId, { callback, ms }); return timerId; },
    clearTimeout: id => timers.delete(id),
    console: { error: noop },
    sessionIdentity: draftKey, isNew: true, newSessionCwd: "/synthetic/startup", newSessionModel: selectedModel, session: null,
    sessionIdRef: { current: initialSid }, sessionGenerationRef: { current: 0 },
    ensuringNewSessionRef: { current: null }, newSessionPromotedRef: { current: false },
    newSessionModelOverrideRef: { current: null }, thinkingLevelOverrideRef: { current: null },
    toolPresetRef: { current: "none" }, permissionModeRef: { current: "none" }, getToolNamesForPreset: () => [],
    setPendingModel: noop, setNewSessionDefaultModel: noop, setThinkingLevel: noop,
    fetch: async url => { assert.equal(url, "/api/agent/new"); creates++; if (creationGate) await creationGate; return { ok: true, json: async () => ({ sessionId: "created-session" }) }; },
    sendAgentCommand: async (sid, command) => { commands.push({ sid, ...command }); if (command.type === "prompt") sequence.push("pi-prompt");
      if (command.type === "set_model" && modelGate) await modelGate;
      if (command.type === "prompt" && promptGate) await promptGate;
      if (command.type === "prompt" && promptError) throw promptError; },
    onSessionCreated: row => promoted.push(row),
    promptRunIdRef: { current: 0 }, promptRequestIdRef: { current: null },
    agentRunningRef: { current: false }, rpcPromptPendingRef: { current: false }, bashRunningRef: { current: false },
    executeBashRef: { current: null }, setLoading: noop, setAgentRunning: value => { active = value; }, setAgentPhase: noop,
    dispatch: noop, dispatchMessageHistory: action => { history = messageHistoryReducer(history, action); },
    pendingScrollToUserRef: { current: false }, setPromptAnchorActive: noop, completionScrollAllowedRef: { current: false },
    eventStreamGraceGenerationRef: { current: 0 }, eventStreamGraceActiveRef: { current: false }, eventStreamGraceTimerRef: { current: null },
    eventSourceRef: { current: null }, eventSourceSessionIdRef: { current: null }, eventConnectionAttemptRef: { current: null },
    handleAgentEventRef: { current: event => events.push(event) }, waitForPromptSettlement: (sid, runId) => settlements.push({ sid, runId }),
    proactivityNoticeAtRef: { current: 0 }, captureEduPiAmbientMessage: async () => ({ status: "unavailable" }),
    armEduPiAmbientMessage: async identity => { sequence.push("ambient-arm"); armed.push(identity); if (armGate) await armGate; return { status: armStatus }; },
    cancelEduPiAmbientArm: async () => { sequence.push("ambient-cancel"); }, setAmbientPending: noop,
    addNotice: notice => notices.push(notice), restoreFailedMessageDraft: drafts.store.restoreFailedMessageDraft,
    chatInputRef: { current: input ? {
      preserveContextForSession: noop,
      replaceMessage: message => { recoveries.push({ type: "replace", message: plain(message), durableBeforeRestore: drafts.cold(draftKey) }); return acceptRestore; },
      refreshPendingFailedMessages: key => recoveries.push({ type: "pending", key, messages: plain(drafts.store.getDraft(key)?.pendingFailedMessages) }),
    } : null },
  };
  const constants = source.slice(source.indexOf("const EVENT_STREAM_CONNECT_TIMEOUT_MS"), source.indexOf("const MAX_NOTICES"));
  const connectionError = source.slice(source.indexOf("class EventStreamConnectionError"), source.indexOf("function createNoticeId"));
  const creation = source.slice(source.indexOf("  const promoteNewSession = useCallback"), source.indexOf("  const loadSlashCommands = useCallback"));
  const connection = source.slice(source.indexOf("  const cancelEventStreamGrace = useCallback"), source.indexOf("  const respondToExtensionUi = useCallback"));
  const sending = source.slice(source.indexOf("  const handleSend = useCallback"), source.indexOf("  const executeBash = useCallback"));
  const api = new Function(...Object.keys(context), compile(`${constants}\n${connectionError}\n${creation}\n${connection}\n${sending}\nreturn { handleSend, ensureEventsConnected };`))(...Object.values(context));
  return { ...drafts, context, draftKey, sources, commands, notices, promoted, recoveries, settlements, events, armed, sequence,
    send: api.handleSend, state: () => ({ creates, active, history }),
    expire: async ms => { const timer = [...timers.entries()].find(([, timer]) => timer.ms === ms); assert.ok(timer, `expected ${ms}ms deadline`); timers.delete(timer[0]); timer[1].callback(); await flush(); },
    timerDelays: () => [...timers.values()].map(timer => timer.ms),
  };
}

test("Pi response loss happens after a durable ambient identity is armed", async () => {
  const f = startupHarness({ initialSid: "created-session", promptError: new Error("synthetic_reply_lost_after_pi_commit") });
  const sending = f.send("合成课前准备请求");
  await flush();
  f.sources[0].connected();
  await sending;
  assert.deepEqual(f.sequence.slice(0, 2), ["ambient-arm", "pi-prompt"]);
  assert.equal(f.armed.length, 1);
  assert.equal(f.armed[0].sessionId, "created-session");
  assert.match(f.armed[0].messageId, /^prompt-/u);
  assert.equal(Object.hasOwn(f.armed[0], "text"), false);
});

test("switching before the Pi POST deterministically cancels only the unsent arm", async () => {
  let releaseArm;
  const armGate = new Promise(resolve => { releaseArm = resolve; });
  const f = startupHarness({ initialSid: "created-session", armGate });
  const sending = f.send("合成课前准备请求");
  await flush();
  f.sources[0].connected();
  await flush();
  assert.equal(f.armed.length, 1);
  f.context.sessionGenerationRef.current++;
  releaseArm();
  await sending;
  assert.deepEqual(f.sequence, ["ambient-arm", "ambient-cancel"]);
  assert.equal(f.commands.some(command => command.type === "prompt"), false);
});

test("switching after the Pi POST may have committed preserves the armed intent", async () => {
  let releasePrompt;
  const promptGate = new Promise(resolve => { releasePrompt = resolve; });
  const f = startupHarness({ initialSid: "created-session", promptGate });
  const sending = f.send("合成课前准备请求");
  await flush();
  f.sources[0].connected();
  await flush();
  assert.deepEqual(f.sequence, ["ambient-arm", "pi-prompt"]);
  f.context.sessionGenerationRef.current++;
  releasePrompt();
  await sending;
  assert.equal(f.sequence.includes("ambient-cancel"), false);
  assert.equal(f.armed.length, 1);
});

test("native capture storage failure warns but does not block ordinary Pi chat", async () => {
  const f = startupHarness({ initialSid: "created-session", armStatus: "unavailable" });
  const sending = f.send("合成普通对话");
  await flush();
  f.sources[0].connected();
  await sending;
  assert.equal(f.commands.filter(command => command.type === "prompt").length, 1);
  assert.equal(f.notices.some(notice => notice.type === "warning" && notice.message.includes("待核验")), true);
});

const selectedContext = ["material", "knowledge", "skill", "connector"].reduce((context, kind, index) => composer.appendComposerResource(context, {
  id: `${kind}:synthetic-${index}`, kind, title: `合成引用 ${index}`, reference: `源定位：${kind}\n[老师本次要求] 仍只是引用原文`,
}), null);
const teacherText = "合成多引用发送验收";
const message = composer.composeTeacherMessage(selectedContext, teacherText);
const images = [{ data: "AQID", mimeType: "image/png", previewUrl: "blob:synthetic" }];

async function failAllConnections(f) {
  const pending = f.send(message, images);
  await flush();
  await f.expire(5_000);
  if (f.sources.length === 2) await f.expire(12_000);
  await pending;
}

test("a cold SSE deadline retries only the connection once and posts the original prompt once", async () => {
  const f = startupHarness();
  const pending = f.send(message, images);
  await flush();
  assert.equal(f.sources.length, 1);
  await f.expire(5_000);
  assert.equal(f.sources.length, 2, "the cold route must get one longer warm connection attempt");
  assert.deepEqual(f.timerDelays(), [12_000]);
  assert.equal(f.sources[0].readyState, 2);
  assert.equal(f.commands.length, 0, "no prompt may be submitted before the connected event");
  f.sources[1].connected();
  await pending;
  assert.equal(f.state().creates, 1, "warming the stream must not create another session");
  assert.equal(f.commands.length, 1);
  assert.equal(f.commands[0].type, "prompt");
  assert.equal(f.commands[0].message, message);
  assert.deepEqual(f.commands[0].images, [{ type: "image", data: "AQID", mimeType: "image/png" }]);
  assert.equal(f.promoted.length, 1);
  assert.equal(f.state().history.messages.length, 1);
});

test("complete startup failure keeps text, all references and images durable without a UI ref", async () => {
  const f = startupHarness({ input: false });
  await failAllConnections(f);
  assert.equal(f.commands.length, 0);
  assert.equal(f.promoted.length, 0);
  assert.equal(f.state().active, false);
  const recovered = f.cold(f.draftKey);
  assert.deepEqual(recovered?.pendingFailedMessages?.[0], { value: teacherText, context: selectedContext, images: [{ data: "AQID", mimeType: "image/png" }] });
  assert.equal(f.cold("other-session"), null);
  assert.equal(f.sources.length, 2);
  assert.equal(f.sources.every(source => source.readyState === 2), true);
});

test("startup failure never replaces the newer draft and displays the independent failed-message backup", async () => {
  const f = startupHarness();
  const pending = f.send(message, images);
  await flush();
  const newerContext = composer.appendComposerResource(null, { id: "knowledge:newer", kind: "knowledge", title: "新引用", reference: "另一个要求的引用" });
  const newer = { value: "等待时新写的要求", context: newerContext, images: [{ data: "BAUG", mimeType: "image/jpeg" }] };
  f.store.setDraft(f.draftKey, newer);
  f.store.flushDraftNow(f.draftKey);
  await f.expire(5_000);
  if (f.sources.length === 2) await f.expire(12_000);
  await pending;
  const cold = f.cold(f.draftKey);
  assert.deepEqual({ value: cold?.value, context: cold?.context, images: cold?.images }, newer);
  assert.equal(cold?.pendingFailedMessages?.length, 1);
  assert.deepEqual(cold.pendingFailedMessages[0].context, selectedContext);
  assert.deepEqual(cold.pendingFailedMessages[0].images, [{ data: "AQID", mimeType: "image/png" }]);
  assert.equal(f.recoveries[0]?.durableBeforeRestore?.pendingFailedMessages?.[0]?.value, teacherText);
  assert.equal(f.recoveries.at(-1)?.type, "pending");
  assert.equal(f.commands.length, 0);
});

test("restoring an empty input happens only after a durable failed-message backup", async () => {
  const f = startupHarness({ acceptRestore: true });
  await failAllConnections(f);
  const replacement = f.recoveries.find(item => item.type === "replace");
  assert.equal(replacement?.durableBeforeRestore?.pendingFailedMessages?.[0]?.value, teacherText);
  assert.deepEqual(replacement.durableBeforeRestore.pendingFailedMessages[0].context, selectedContext);
  assert.equal(f.recoveries.filter(item => item.type === "pending").length, 0, "accepted restoration does not also offer a duplicate pending item");
});

test("fatal startup refusal has only two connection attempts and never schedules a third background retry", async () => {
  const f = startupHarness();
  const pending = f.send(message, images);
  await flush();
  f.sources[0].fatal();
  await flush();
  assert.equal(f.sources.length, 2);
  f.sources[1].fatal();
  await pending;
  assert.equal(f.sources.length, 2);
  assert.deepEqual(f.timerDelays(), []);
  assert.equal(f.commands.length, 0);
});

test("switching sessions during the first connection deadline cannot retry or submit the old message", async () => {
  const f = startupHarness();
  const pending = f.send(message, images);
  await flush();
  f.context.sessionIdRef.current = "other-session";
  f.context.sessionGenerationRef.current++;
  await f.expire(5_000);
  await pending;
  assert.equal(f.sources.length, 1);
  assert.equal(f.commands.length, 0);
  assert.equal(f.cold(f.draftKey)?.pendingFailedMessages?.[0]?.value, teacherText);
  assert.equal(f.cold("other-session"), null);
});

test("a held new-session creation cannot overwrite a switched session or clear its newer creation promise", async () => {
  let release;
  const f = startupHarness({ creationGate: new Promise(resolve => { release = resolve; }) });
  const pending = f.send(message, images);
  await flush();
  f.context.sessionIdRef.current = "other-session";
  f.context.sessionGenerationRef.current++;
  f.context.promptRunIdRef.current++;
  const newerCreation = Promise.resolve("other-session");
  f.context.ensuringNewSessionRef.current = newerCreation;
  release();
  await flush();
  f.sources.at(-1)?.connected();
  await pending;
  assert.equal(f.context.sessionIdRef.current, "other-session");
  assert.equal(f.context.ensuringNewSessionRef.current, newerCreation);
  assert.equal(f.sources.length, 0);
  assert.equal(f.commands.filter(command => command.type === "prompt").length, 0);
  assert.equal(f.promoted.length, 0);
  assert.equal(f.cold(f.draftKey)?.pendingFailedMessages?.[0]?.value, teacherText);
  assert.deepEqual(f.cold(f.draftKey).pendingFailedMessages[0].context, selectedContext);
  assert.equal(f.cold("other-session"), null);
});

test("a held model preference cannot recapture a newer generation after an A-to-B-to-A switch", async () => {
  let release;
  const f = startupHarness({ initialSid: "created-session", selectedModel: { provider: "synthetic", modelId: "fake" }, modelGate: new Promise(resolve => { release = resolve; }) });
  const pending = f.send(message, images);
  await flush();
  f.context.sessionIdRef.current = "other-session";
  f.context.sessionGenerationRef.current += 2;
  f.context.promptRunIdRef.current++;
  f.context.sessionIdRef.current = "created-session";
  release();
  await flush();
  f.sources.at(-1)?.connected();
  await pending;
  assert.equal(f.commands.filter(command => command.type === "set_model").length, 1);
  assert.equal(f.commands.filter(command => command.type === "prompt").length, 0);
  assert.equal(f.sources.length, 0);
  assert.equal(f.promoted.length, 0);
  assert.equal(f.cold(f.draftKey)?.pendingFailedMessages?.[0]?.value, teacherText);
});

test("a switch in the microtask after SSE verification cannot submit or promote the old request", async () => {
  const f = startupHarness();
  const pending = f.send(message, images);
  await flush();
  f.sources[0].connected();
  queueMicrotask(() => {
    f.context.sessionIdRef.current = "other-session";
    f.context.sessionGenerationRef.current++;
    f.context.promptRunIdRef.current++;
  });
  await pending;
  assert.equal(f.commands.filter(command => command.type === "prompt").length, 0);
  assert.equal(f.promoted.length, 0);
  assert.equal(f.context.sessionIdRef.current, "other-session");
  assert.equal(f.cold(f.draftKey)?.pendingFailedMessages?.[0]?.value, teacherText);
});

test("an invalidated startup run cannot warm-connect or overwrite a newer run in the same session", async () => {
  const f = startupHarness();
  const pending = f.send(message, images);
  await flush();
  const originalRequest = f.context.promptRequestIdRef.current;
  f.context.promptRunIdRef.current++;
  f.context.promptRequestIdRef.current = "newer-local-request";
  f.context.dispatchMessageHistory({ type: "optimistic", requestId: "newer-local-request", message: { role: "user", content: "新的独立提交" } });
  await f.expire(5_000);
  if (f.sources.length === 2) await f.expire(12_000);
  await pending;
  assert.equal(f.sources.length, 1);
  assert.equal(f.commands.length, 0);
  assert.equal(f.context.promptRequestIdRef.current, "newer-local-request");
  assert.equal(f.state().active, true, "the old failure must not settle the newer run");
  assert.equal(f.state().history.messages.at(-1).content, "新的独立提交");
  assert.notEqual(f.context.promptRequestIdRef.current, originalRequest);
  assert.equal(f.cold(f.draftKey)?.pendingFailedMessages?.[0]?.value, teacherText);
});

test("an ambiguous prompt response is never reposted or labeled as safely unsent", async () => {
  const f = startupHarness({ promptError: new Error("synthetic lost POST response") });
  const pending = f.send(message, images);
  await flush();
  await f.expire(5_000);
  f.sources.at(-1).connected();
  await pending;
  await f.send(message, images);
  assert.equal(f.commands.filter(command => command.type === "prompt").length, 1);
  assert.equal(f.sources.length, 2);
  assert.equal(f.state().active, true);
  assert.equal(f.state().history.messages.length, 1);
  assert.equal(f.cold(f.draftKey), null, "a possibly accepted POST must not offer an automatic resend draft");
  assert.equal(f.settlements.length, 1);
});

test("late packets from a replaced SSE connection are ignored without affecting the warm stream", async () => {
  const f = startupHarness();
  const pending = f.send(message, images);
  await flush();
  await f.expire(5_000);
  f.sources[1].connected();
  await pending;
  f.sources[0].onmessage({ data: JSON.stringify({ type: "agent_start", clientRequestId: "abandoned-connection" }) });
  assert.deepEqual(f.events, [{ type: "connected" }]);
  assert.equal(f.context.eventSourceRef.current, f.sources[1]);
  assert.equal(f.state().active, true);
});

test("an intentional same-text submission after settlement gets a fresh request while reusing the connected stream", async () => {
  const f = startupHarness();
  const first = f.send(message, images);
  await flush();
  f.sources[0].connected();
  await first;
  f.context.agentRunningRef.current = false;
  f.context.rpcPromptPendingRef.current = false;
  await f.send(message, images);
  assert.equal(f.sources.length, 1);
  assert.equal(f.state().creates, 1);
  assert.equal(f.commands.length, 2);
  assert.equal(f.commands[0].message, f.commands[1].message);
  assert.notEqual(f.commands[0].clientRequestId, f.commands[1].clientRequestId);
  assert.equal(f.state().history.messages.length, 2, "same text must not be deduplicated across intentional sends");
});

test("a storage refusal is reported as unsaved and keeps the failed message available in memory", async () => {
  const f = startupHarness();
  f.writable(false);
  await failAllConnections(f);
  assert.equal(f.cold(f.draftKey), null);
  assert.equal(f.store.getDraft(f.draftKey)?.pendingFailedMessages?.[0]?.value, teacherText);
  assert.ok(f.notices.some(notice => /未能.*保存|未能持久保存/.test(notice.message)));
  assert.equal(f.recoveries.at(-1)?.messages?.[0]?.value, teacherText);
  assert.equal(f.commands.length, 0);
});
