import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url);
const { emptyMessageHistory, messageHistoryReducer } = await jiti.import("../lib/agent-message-history.ts");
const { normalizeToolCalls } = await jiti.import("../lib/normalize.ts");
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const evaluate = (code, context) => new Function(...Object.keys(context), compile(code))(...Object.values(context));
const noop = () => {};
const user = text => ({ role: "user", content: text, timestamp: 1000 });

function eventHarness() {
  let history = messageHistoryReducer(emptyMessageHistory(), { type: "optimistic", message: user("new prompt"), requestId: "new-request" });
  let streamResets = 0;
  const context = {
    useCallback: callback => callback,
    handleAgentEventRef: { current: null },
    completedPromptRequestIdsRef: { current: new Set() }, verifyPeerPrompt: noop,
    sessionIdRef: { current: "session-a" }, rpcPromptPendingRef: { current: true },
    promptRequestIdRef: { current: "new-request" }, agentRunningRef: { current: true },
    normalizeToolCalls,
    dispatchMessageHistory: action => { const previous = history; history = messageHistoryReducer(history, action); return history !== previous; },
    addNotice: noop, cancelEventStreamGrace: noop, dispatch: action => { if (action.type === "reset") streamResets++; }, handleExtensionUiRequest: noop,
    loadSession: noop, notifyPromptStage: noop, onAgentEnd: noop, onEducationImportCompleted: noop,
    scheduleEventStreamClose: noop, scrollToBottom: noop, seedStreamingSnapshot: noop, settleUiStage: noop,
    setAgentPhase: noop,
  };
  const body = source.slice(source.indexOf("  const handleAgentEvent = useCallback"), source.indexOf("  const handleSend = useCallback"));
  const handle = evaluate(`${body}\nreturn handleAgentEvent;`, context);
  return { handle, history: () => history, resets: () => streamResets, context };
}

test("late events from an older submission cannot modify the next run", () => {
  const f = eventHarness();
  const before = f.history();
  for (const event of [
    { type: "agent_start" },
    { type: "message_start", message: { role: "assistant" } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "old" } },
    { type: "message_end", message: user("new prompt"), entryId: "old-user" },
    { type: "prompt_done" },
  ]) f.handle({ ...event, clientRequestId: "old-request" });
  assert.equal(f.history(), before);
  f.handle({ type: "message_end", message: user("new prompt"), entryId: "new-user", clientRequestId: "new-request" });
  f.handle({ type: "message_end", message: user("new prompt"), entryId: "new-user", clientRequestId: "new-request" });
  assert.equal(f.history().messages.length, 1);
  assert.deepEqual(f.history().entryIds, ["new-user"]);
  assert.equal(f.resets(), 1, "a replay must not clear a newer assistant stream");
});

test("new-session promotion preserves the live message identities and request", () => {
  const f = eventHarness();
  const before = f.history();
  let appliedIdentity = "new:/synthetic/project";
  const body = source.slice(source.indexOf("  if (sessionIdentity !== appliedIdentity)"), source.indexOf("  const currentModel ="));
  evaluate(body, {
    sessionIdentity: "created-session", appliedIdentity,
    sessionIdRef: { current: "created-session" },
    setAppliedIdentity: identity => { appliedIdentity = identity; },
    dispatchMessageHistory: () => assert.fail("promotion must not reset live history"),
  });
  assert.equal(appliedIdentity, "created-session");
  assert.equal(f.history(), before);
  f.handle({ type: "message_end", message: user("new prompt"), entryId: "created-user", clientRequestId: "new-request" });
  assert.equal(f.history().messages.length, 1);
  assert.deepEqual(f.history().entryIds, ["created-user"]);
});

test("a delayed session reload cannot replace a new prompt, later delivery or A-to-B-to-A generation", async () => {
  for (const supersededBy of ["prompt", "generation", "delivery"]) {
    let resolveRead;
    const delayed = new Promise(resolve => { resolveRead = resolve; });
    const state = { updates: [] };
    const context = {
      useCallback: callback => callback,
      sessionIdRef: { current: "session-a" }, sessionGenerationRef: { current: 0 },
      promptRunIdRef: { current: 1 }, contextLoadIdRef: { current: 0 },
      messageHistoryRef: { current: { messageIds: ["old-user"] } },
      fetchWithRetry: async () => delayed,
      dispatchMessageHistory: action => { state.updates.push(action); },
      setLoading: noop, setData: noop, setActiveLeafId: noop, setCurrentModelOverride: noop, setError: noop, setThinkingLevel: noop,
    };
    const body = source.slice(source.indexOf("  const loadSession = useCallback"), source.indexOf("  /** Re-run the initial session load"));
    const load = evaluate(`${body}\nreturn loadSession;`, context);
    const pending = load("session-a");
    if (supersededBy === "generation") context.sessionGenerationRef.current += 2;
    else if (supersededBy === "prompt") context.promptRunIdRef.current += 1;
    else context.messageHistoryRef.current.messageIds.push("late-delivery");
    resolveRead({ ok: true, status: 200, json: async () => ({ context: { messages: [user("old prompt")], entryIds: ["old-user"] } }) });
    await pending;
    assert.deepEqual(state.updates, [], "the superseded read must not write any history");
  }
});

test("a settlement snapshot can recover the full history when a late delivery is already included", async () => {
  let resolveRead;
  const delayed = new Promise(resolve => { resolveRead = resolve; });
  const updates = [];
  const context = {
    useCallback: callback => callback, sessionIdRef: { current: "session-a" }, sessionGenerationRef: { current: 0 },
    promptRunIdRef: { current: 1 }, contextLoadIdRef: { current: 0 }, messageHistoryRef: { current: { messageIds: ["user-1"] } },
    fetchWithRetry: async () => delayed, dispatchMessageHistory: action => updates.push(action),
    setLoading: noop, setData: noop, setActiveLeafId: noop, setCurrentModelOverride: noop, setError: noop, setThinkingLevel: noop,
  };
  const body = source.slice(source.indexOf("  const loadSession = useCallback"), source.indexOf("  /** Re-run the initial session load"));
  const load = evaluate(`${body}\nreturn loadSession;`, context);
  const pending = load("session-a");
  context.messageHistoryRef.current.messageIds.push("assistant-1");
  resolveRead({ ok: true, status: 200, json: async () => ({ context: { messages: [user("prompt"), { role: "assistant", content: [] }], entryIds: ["user-1", "assistant-1"] } }) });
  await pending;
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].entryIds, ["user-1", "assistant-1"]);
});

function lifecycleHarness() {
  let history = messageHistoryReducer(emptyMessageHistory(), { type: "optimistic", message: user("own prompt"), requestId: "own-A" });
  let loading = false, active = true, reads = 0, probes = 0, completions = 0, closes = 0;
  let canonical = { messages: [], entryIds: [] };
  let server = { running: true, state: { isStreaming: true, isPromptRunning: true, clientRequestId: "own-A" } };
  let probeGate, probeFailure;
  const timers = [];
  const context = {
    useCallback: callback => callback, handleAgentEventRef: { current: null },
    sessionIdRef: { current: "same-session" }, sessionGenerationRef: { current: 0 }, promptRunIdRef: { current: 1 }, contextLoadIdRef: { current: 0 },
    promptRequestIdRef: { current: "own-A" }, completedPromptRequestIdsRef: { current: new Set() }, peerRequestProbeIdRef: { current: 0 },
    agentRunningRef: { current: true }, sdkAgentActiveRef: { current: true }, rpcPromptPendingRef: { current: true }, notifiedPromptRunIdRef: { current: -1 },
    eventStreamGraceGenerationRef: { current: 0 }, eventStreamGraceActiveRef: { current: false }, eventStreamGraceTimerRef: { current: null },
    messageHistoryRef: { current: history }, normalizeToolCalls,
    dispatchMessageHistory: action => { const before = history; history = messageHistoryReducer(history, action); context.messageHistoryRef.current = history; return before !== history; },
    fetchWithRetry: async () => { reads++; const data = structuredClone(canonical); return { ok: true, status: 200, json: async () => ({ leafId: "leaf", context: data }) }; },
    fetchJsonWithDeadline: async () => { probes++; if (probeGate) await probeGate; if (probeFailure) throw probeFailure; return { response: { ok: true }, body: structuredClone(server) }; },
    fetch: async () => ({ ok: true, json: async () => structuredClone(server) }),
    setLoading: value => { loading = value; }, setAgentRunning: value => { active = value; },
    setData: noop, setActiveLeafId: noop, setCurrentModelOverride: noop, setError: noop, setThinkingLevel: noop,
    setAgentPhase: noop, setRetryInfo: noop, setIsCompacting: noop, setContextUsage: noop, setSystemPrompt: noop,
    setExtensionStatuses: noop, setExtensionWidgets: noop, setQueuedMessages: noop,
    normalizeQueuedMessages: value => value ?? { steering: [], followUp: [] },
    addNotice: noop, cancelEventStreamGrace: () => { context.eventStreamGraceGenerationRef.current++; context.eventStreamGraceActiveRef.current = false; }, dispatch: noop, handleExtensionUiRequest: noop,
    onAgentEnd: () => { completions++; }, onEducationImportCompleted: noop, closeEvents: () => { closes++; },
    EVENT_STREAM_IDLE_GRACE_MS: 30_000, PROMPT_SETTLE_POLL_MS: 100,
    setTimeout: callback => { timers.push(callback); return timers.length; },
    scrollToBottom: noop, seedStreamingSnapshot: () => false, waitForPromptSettlement: noop,
  };
  const load = source.slice(source.indexOf("  const loadSession = useCallback"), source.indexOf("  /** Re-run the initial session load"));
  const retireStart = source.indexOf("  const retirePromptRequest = useCallback");
  const settleStart = source.indexOf("  const settleUiStage = useCallback");
  const lifecycle = source.slice(retireStart === -1 ? settleStart : retireStart, source.indexOf("  const finishPromptWithoutStream = useCallback"));
  const peerStart = source.indexOf("  const verifyPeerPrompt = useCallback");
  const handlerStart = source.indexOf("  const handleAgentEvent = useCallback");
  const handler = source.slice(peerStart === -1 ? handlerStart : peerStart, source.indexOf("  const handleSend = useCallback"));
  const api = evaluate(`${load}\n${lifecycle}\n${handler}\nreturn { handleAgentEvent, loadSession };`, context);
  const emit = (type, requestId, fields = {}) => api.handleAgentEvent({ type, clientRequestId: requestId, ...fields });
  return { context, emit, load: api.loadSession, state: () => ({ history, loading, active, reads, probes, completions, closes }),
    canonical: value => { canonical = value; }, server: value => { server = value; }, gate: value => { probeGate = value; },
    failProbe: value => { probeFailure = value; }, fireGrace: async () => { timers.at(-1)?.(); await new Promise(resolve => setImmediate(resolve)); },
    flush: () => new Promise(resolve => setImmediate(resolve)) };
}

async function finishOwnRequest(f) {
  const first = user("own prompt"), answer = { role: "assistant", content: [{ type: "text", text: "own answer" }] };
  f.canonical({ messages: [first, answer], entryIds: ["own-user", "own-answer"] });
  f.emit("message_end", "own-A", { message: first, entryId: "own-user" });
  f.emit("message_end", "own-A", { message: answer, entryId: "own-answer" });
  f.emit("agent_settled", "own-A");
  f.emit("prompt_done", "own-A");
  await f.flush();
  assert.equal(f.state().active, false);
}

test("a second window's verified request is shown and settles during the same-session SSE grace", async () => {
  const f = lifecycleHarness();
  await finishOwnRequest(f);
  const peerUser = user("peer prompt"), peerAnswer = { role: "assistant", content: [{ type: "text", text: "peer answer" }] };
  f.server({ running: true, state: { isStreaming: true, isPromptRunning: true, clientRequestId: "peer-B" } });
  f.emit("agent_start", "peer-B");
  await f.flush();
  assert.equal(f.state().active, true, "the idle viewer must adopt a server-confirmed peer request");
  f.emit("message_end", "peer-B", { message: peerUser, entryId: "peer-user" });
  f.emit("message_end", "peer-B", { message: peerAnswer, entryId: "peer-answer" });
  f.canonical({ messages: [user("own prompt"), { role: "assistant", content: [] }, peerUser, peerAnswer], entryIds: ["own-user", "own-answer", "peer-user", "peer-answer"] });
  f.emit("agent_settled", "peer-B");
  f.emit("prompt_done", "peer-B");
  await f.flush();
  assert.equal(f.state().active, false);
  assert.deepEqual(f.state().history.entryIds, ["own-user", "own-answer", "peer-user", "peer-answer"]);
});

test("a short peer request that finishes before verification is recovered from canonical history", async () => {
  const f = lifecycleHarness();
  await finishOwnRequest(f);
  const before = f.state().reads;
  f.server({ running: true, state: { isStreaming: false, isPromptRunning: false, clientRequestId: null } });
  f.canonical({ messages: [user("own prompt"), user("fast peer"), { role: "assistant", content: [{ type: "text", text: "fast answer" }] }], entryIds: ["own-user", "fast-user", "fast-answer"] });
  f.emit("agent_start", "fast-B");
  f.emit("message_end", "fast-B", { message: user("fast peer"), entryId: "fast-user" });
  f.emit("prompt_done", "fast-B");
  await f.flush();
  assert.ok(f.state().reads > before, "the fast peer's completed history must reload even with no active server request");
  assert.equal(f.state().active, false);
  assert.deepEqual(f.state().history.entryIds, ["own-user", "fast-user", "fast-answer"]);
});

test("settled request replay cannot reopen the stream or alter history and probes", async () => {
  const f = lifecycleHarness();
  await finishOwnRequest(f);
  const before = f.state();
  f.emit("agent_start", "own-A");
  f.emit("message_end", "own-A", { message: user("own prompt"), entryId: "own-user" });
  f.emit("message_end", "own-A", { message: { role: "assistant", content: [] }, entryId: "own-answer" });
  f.emit("agent_settled", "own-A");
  f.emit("prompt_done", "own-A");
  await f.flush();
  assert.deepEqual(f.state(), before);
});

test("a pending peer verification cannot adopt over a newer local send or consume its optimistic row", async () => {
  const f = lifecycleHarness();
  await finishOwnRequest(f);
  let release;
  f.gate(new Promise(resolve => { release = resolve; }));
  f.server({ running: true, state: { isStreaming: true, isPromptRunning: true, clientRequestId: "peer-B" } });
  f.emit("agent_start", "peer-B");
  await f.flush();
  const beforeReads = f.state().reads;
  f.context.promptRunIdRef.current++;
  f.context.promptRequestIdRef.current = "local-C";
  f.context.rpcPromptPendingRef.current = true;
  f.context.agentRunningRef.current = true;
  f.context.setAgentRunning(true);
  f.context.dispatchMessageHistory({ type: "optimistic", requestId: "local-C", message: user("new local prompt") });
  const beforeHistory = f.state().history;
  release();
  await f.flush();
  assert.equal(f.context.promptRequestIdRef.current, "local-C");
  assert.equal(f.state().history, beforeHistory);
  assert.equal(f.state().reads, beforeReads);
  f.emit("message_end", "peer-B", { message: user("new local prompt"), entryId: "wrong-peer-user" });
  assert.equal(f.state().history, beforeHistory);
  f.emit("message_end", "local-C", { message: user("new local prompt"), entryId: "local-user" });
  assert.equal(f.state().history.messages.at(-1).content, "new local prompt");
  assert.equal(f.state().history.entryIds.at(-1), "local-user");
});

test("failed peer verification is recovered by the canonical read before idle grace closes", async () => {
  const f = lifecycleHarness();
  await finishOwnRequest(f);
  f.failProbe(new Error("synthetic state probe unavailable"));
  f.emit("agent_start", "fast-failed-probe");
  await f.flush();
  f.server({ running: true, state: { isStreaming: false, isPromptRunning: false, clientRequestId: null } });
  f.canonical({ messages: [user("own prompt"), user("fast peer"), { role: "assistant", content: [] }], entryIds: ["own-user", "late-peer-user", "late-peer-answer"] });
  await f.fireGrace();
  assert.equal(f.state().active, false);
  assert.equal(f.context.promptRequestIdRef.current, "own-A", "failed verification must not authorize adopting the peer ID");
  assert.deepEqual(f.state().history.entryIds, ["own-user", "late-peer-user", "late-peer-answer"]);
  assert.equal(f.state().closes, 1);
});

test("grace recovery of a busy peer request starts a distinct completion stage and reads its question", async () => {
  const f = lifecycleHarness();
  await finishOwnRequest(f);
  assert.equal(f.state().completions, 1);
  const previousRun = f.context.promptRunIdRef.current;
  f.failProbe(new Error("synthetic state probe unavailable"));
  f.emit("agent_start", "peer-B");
  await f.flush();
  const peerUser = user("peer prompt"), peerAnswer = { role: "assistant", content: [] };
  f.server({ running: true, state: { isStreaming: true, isPromptRunning: true, clientRequestId: "peer-B" } });
  f.canonical({ messages: [user("own prompt"), peerUser], entryIds: ["own-user", "peer-user"] });
  await f.fireGrace();
  assert.equal(f.context.promptRequestIdRef.current, "peer-B");
  assert.equal(f.context.promptRunIdRef.current, previousRun + 1);
  assert.equal(f.state().active, true);
  assert.deepEqual(f.state().history.entryIds, ["own-user", "peer-user"]);
  f.canonical({ messages: [user("own prompt"), peerUser, peerAnswer], entryIds: ["own-user", "peer-user", "peer-answer"] });
  f.emit("agent_settled", "peer-B");
  f.emit("prompt_done", "peer-B");
  await f.flush();
  assert.equal(f.state().active, false);
  assert.equal(f.state().completions, 2, "the recovered peer must not reuse the already-notified local run");
});

test("a superseded cold load and a successful settlement read cannot leave loading stuck", async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let loading = false, calls = 0;
  const context = {
    useCallback: callback => callback, sessionIdRef: { current: "session-a" }, sessionGenerationRef: { current: 0 },
    promptRunIdRef: { current: 1 }, contextLoadIdRef: { current: 0 }, messageHistoryRef: { current: { messageIds: [] } },
    fetchWithRetry: async () => ++calls === 1 ? held : { ok: true, status: 200, json: async () => ({ context: { messages: [user("new prompt")], entryIds: ["new-user"] } }) },
    dispatchMessageHistory: noop, setLoading: value => { loading = value; },
    setData: noop, setActiveLeafId: noop, setCurrentModelOverride: noop, setError: noop, setThinkingLevel: noop,
  };
  const loadSource = source.slice(source.indexOf("  const loadSession = useCallback"), source.indexOf("  /** Re-run the initial session load"));
  const load = evaluate(`${loadSource}\nreturn loadSession;`, context);
  const initial = load("session-a", true);
  context.promptRunIdRef.current += 1;
  release({ ok: true, status: 200, json: async () => ({ context: { messages: [], entryIds: [] } }) });
  await initial;
  await load("session-a");
  assert.equal(loading, false, "the current successful read must clear the superseded loading stage");
});

test("a late cold read from the prior session cannot clear the new session's loading state", async () => {
  let releaseA, releaseB;
  const readA = new Promise(resolve => { releaseA = resolve; });
  const readB = new Promise(resolve => { releaseB = resolve; });
  let loading = false;
  const updates = [];
  const context = {
    useCallback: callback => callback, sessionIdRef: { current: "session-a" }, sessionGenerationRef: { current: 0 },
    promptRunIdRef: { current: 1 }, contextLoadIdRef: { current: 0 }, messageHistoryRef: { current: { messageIds: [] } },
    fetchWithRetry: async url => url.includes("session-a") ? readA : readB,
    dispatchMessageHistory: action => updates.push(action), setLoading: value => { loading = value; },
    setData: noop, setActiveLeafId: noop, setCurrentModelOverride: noop, setError: noop, setThinkingLevel: noop,
  };
  const loadSource = source.slice(source.indexOf("  const loadSession = useCallback"), source.indexOf("  /** Re-run the initial session load"));
  const load = evaluate(`${loadSource}\nreturn loadSession;`, context);
  const initialA = load("session-a", true);
  context.sessionIdRef.current = "session-b";
  context.sessionGenerationRef.current++;
  const initialB = load("session-b", true);
  releaseA({ ok: true, status: 200, json: async () => ({ context: { messages: [user("A private draft")], entryIds: ["a-user"] } }) });
  await initialA;
  assert.equal(loading, true);
  assert.deepEqual(updates, []);
  releaseB({ ok: true, status: 200, json: async () => ({ context: { messages: [user("B own message")], entryIds: ["b-user"] } }) });
  await initialB;
  assert.equal(loading, false);
  assert.deepEqual(updates[0].entryIds, ["b-user"]);
});
