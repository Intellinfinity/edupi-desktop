import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
const rpcManagerSource = await readFile(new URL("../lib/rpc-manager.ts", import.meta.url), "utf8");

test("task-update tool completion refreshes the workspace once using the matched call id", () => {
  const cases = source.slice(source.indexOf('case "tool_execution_start"'), source.indexOf('case "queue_update"'));
  const compiled = ts.transpileModule(`switch (event.type) { ${cases} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const handle = new Function("event", "educationToolCallsRef", "setAgentPhase", "onEducationImportCompleted", compiled);
  const tracked = { current: new Map() };
  const refreshed = [];
  let phase = null;
  const emit = event => handle(event, tracked, update => { phase = update(phase); }, name => refreshed.push(name));
  emit({ type: "tool_execution_start", toolCallId: "task-update-1", toolName: "edupi_update_task" });
  emit({ type: "tool_execution_start", toolCallId: "read-1", toolName: "read" });
  assert.deepEqual(refreshed, []);
  emit({ type: "tool_execution_end", toolCallId: "read-1" });
  assert.deepEqual(refreshed, []);
  emit({ type: "tool_execution_end", toolCallId: "task-update-1" });
  emit({ type: "tool_execution_end", toolCallId: "task-update-1" });
  assert.deepEqual(refreshed, ["edupi_update_task"]);
  assert.equal(tracked.current.size, 0);
});

test("keeps the session event stream open through the idle grace window", () => {
  const finishSource = source.slice(
    source.indexOf("const finishPromptWithoutStream"),
    source.indexOf("const waitForPromptSettlement"),
  );
  const graceSource = source.slice(
    source.indexOf("const scheduleEventStreamClose"),
    source.indexOf("const finishPromptWithoutStream"),
  );
  const agentEndSource = source.slice(
    source.indexOf('case "agent_end"'),
    source.indexOf('case "agent_settled"'),
  );
  const agentStartSource = source.slice(
    source.indexOf('case "agent_start"'),
    source.indexOf('case "agent_end"'),
  );
  const agentSettledSource = source.slice(
    source.indexOf('case "agent_settled"'),
    source.indexOf('case "prompt_done"'),
  );
  const promptDoneSource = source.slice(
    source.indexOf('case "prompt_done"'),
    source.indexOf('case "prompt_error"'),
  );
  const sendSource = source.slice(
    source.indexOf("  const handleSend = useCallback"),
    source.indexOf("  const executeBash = useCallback"),
  );

  assert.match(source, /const EVENT_STREAM_IDLE_GRACE_MS = 30_000/);
  assert.match(graceSource, /setTimeout\(\(\) => void checkServerIdle\(\), EVENT_STREAM_IDLE_GRACE_MS\)/);
  assert.match(graceSource, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}`\)/);
  assert.match(graceSource, /closeEvents\(\)/);
  assert.match(finishSource, /scheduleEventStreamClose\(sid\)/);
  assert.doesNotMatch(finishSource, /closeEvents\(\)/);
  assert.doesNotMatch(agentEndSource, /closeEvents\(\)/);
  assert.match(agentStartSource, /cancelEventStreamGrace\(\)/);
  assert.match(agentSettledSource, /scheduleEventStreamClose\(sid\)/);
  assert.match(agentSettledSource, /onAgentEnd\?\.\(\)/);
  assert.match(promptDoneSource, /notifyPromptStage\(runId\)/);
  assert.match(promptDoneSource, /scheduleEventStreamClose\(sid\)/);
  assert.match(sendSource, /if \(promptRequestStarted && sentSessionId\) \{[\s\S]*?waitForPromptSettlement/);
  assert.match(sendSource, /if \(promptRequestStarted && sentSessionId\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?closeEvents\(\)/);
  assert.match(sendSource, /chatInputRef\?\.current\?\.replaceMessage\(userMsg, true\)/);
  assert.match(sendSource, /sendGeneration !== sessionGenerationRef\.current[\s\S]*restoreFailedMessageDraft\(originDraftKey, userMsg, \{/);
  assert.doesNotMatch(sendSource, /if \(e instanceof EventStreamConnectionError\)/);
});

test("queue recall stages a durable backup before clearing and never writes into another session", () => {
  const recallSource = source.slice(source.indexOf("const handleRecallQueue"), source.indexOf("const handleThinkingLevelChange"));
  assert.match(recallSource, /recallQueueWithBackup\(/);
  assert.match(recallSource, /queueRecallInFlightRef\.current\.has\(sid\)/);
  assert.match(recallSource, /stage: \(messages, recoveryId\) => chatInputRef\?\.current\?\.stageQueuedMessages\(sid, messages, recoveryId\)/);
  assert.match(recallSource, /isCurrent: \(\) => sessionIdRef\.current === sid/);
  assert.match(recallSource, /finalizeCurrent: \(previous, messages, recoveryId\) => chatInputRef\?\.current\?\.finalizeQueuedMessages\(sid, previous, messages, recoveryId\)/);
  assert.match(recallSource, /completeStagedQueueRecovery\(sid, previous, messages, recoveryId\)/);
  assert.match(source, /const acknowledgeRecoveredQueue[\s\S]*ack_queue_recovery/);
});

test("reuses an open event stream and hides an empty agent phase", () => {
  const ensureSource = source.slice(
    source.indexOf("const ensureEventsConnected"),
    source.indexOf("const respondToExtensionUi"),
  );

  assert.match(ensureSource, /eventSourceSessionIdRef\.current === sid/);
  assert.match(ensureSource, /current\.readyState === EventSource\.OPEN/);
  assert.match(ensureSource, /attempt\?\.source === current && attempt\.pending/);
  assert.match(chatWindowSource, /agentRunning && !streamState\.streamingMessage && agentPhase/);
  assert.match(chatWindowSource, /return null;/);
});

test("plays the enabled sound once for each extension dialog", () => {
  assert.match(chatWindowSource, /soundedExtensionDialogIdRef = useRef<string \| null>\(null\)/);
  assert.match(
    chatWindowSource,
    /soundedExtensionDialogIdRef\.current === extensionDialog\.id/,
  );
  assert.match(chatWindowSource, /soundedExtensionDialogIdRef\.current = extensionDialog\.id/);
  assert.match(chatWindowSource, /playDoneSoundRef\.current\(\)/);
});

test("assembles Pi 0.84 deltas and reseeds the stream after reconnects", () => {
  const updateSource = source.slice(
    source.indexOf('case "message_update"'),
    source.indexOf('case "message_end"'),
  );
  const reconcileSource = source.slice(
    source.indexOf("const reconcileAgentState"),
    source.indexOf("// Recovery net for missed SSE events"),
  );

  assert.match(updateSource, /applyAssistantMessageEvent\(/);
  assert.match(updateSource, /streamingMessageRef\.current/);
  assert.match(updateSource, /event\.assistantMessageEvent as ClientAssistantMessageEvent/);
  assert.match(updateSource, /Compatibility with pre-0\.84 servers/);
  assert.match(reconcileSource, /seedStreamingSnapshot\(state\.streamingMessage\)/);
  assert.match(rpcManagerSource, /streamingMessage: this\.inner\.agent\.state\?\.streamingMessage/);
});

test("keeps live following cancellable when the user scrolls away from the tail", () => {
  const streamUpdateSource = source.slice(
    source.indexOf('case "message_start"'),
    source.indexOf('case "message_end"'),
  );
  const scrollHandlerSource = source.slice(
    source.indexOf("const handleScrollPositionChange"),
    source.indexOf("// Load session on mount"),
  );

  assert.match(source, /const liveFollowFrameRef = useRef<number \| null>\(null\)/);
  assert.match(streamUpdateSource, /liveFollowFrameRef\.current === null/);
  assert.match(streamUpdateSource, /requestAnimationFrame\(\(\) => \{[\s\S]*?liveFollowFrameRef\.current = null;[\s\S]*?if \(isNearBottomRef\.current\) scrollToBottom\("auto"\)/);
  assert.match(scrollHandlerSource, /cancelAnimationFrame\(liveFollowFrameRef\.current\)/);
});

test("keeps a newly sent user message at the top while its response starts", () => {
  const streamUpdateSource = source.slice(
    source.indexOf('case "message_start"'),
    source.indexOf('case "message_end"'),
  );
  const userScrollSource = source.slice(
    source.indexOf("const scrollUserMsgToTop"),
    source.indexOf("const markUserScrollIntent"),
  );
  const scrollEffectSource = source.slice(
    source.indexOf("useLayoutEffect(() => {\n    if (messages.length > 0)"),
    source.indexOf("// Load model list"),
  );

  assert.match(streamUpdateSource, /!pendingScrollToUserRef\.current && isNearBottomRef\.current/);
  assert.match(source, /const \[promptAnchorActive, setPromptAnchorActive\] = useState\(false\)/);
  assert.match(source, /pendingScrollToUserRef\.current = true;\s*setPromptAnchorActive\(true\)/);
  assert.match(userScrollSource, /const targetTop = Math\.min\(Math\.max\(0, elAbsTop - 16\), maxScrollTop\)/);
  assert.match(userScrollSource, /cancelAnimationFrame\(liveFollowFrameRef\.current\)/);
  assert.match(userScrollSource, /isNearBottomRef\.current = targetTop >= maxScrollTop - SCROLL_BOTTOM_THRESHOLD/);
  assert.match(userScrollSource, /container\.scrollTo\(\{ top: targetTop, behavior: "smooth" \}\)/);
  assert.match(scrollEffectSource, /pendingScrollToUserRef\.current = false;[\s\S]*?scrollUserMsgToTop\(\)/);
  assert.match(chatWindowSource, /const maxScrollTopWithoutAnchor = Math\.max\([\s\S]*?container\.scrollHeight - promptAnchorSpacerHeightRef\.current - container\.clientHeight/);
  assert.match(chatWindowSource, /const nextPromptAnchorSpacerHeight = Math\.max\([\s\S]*?Math\.ceil\(targetTop - maxScrollTopWithoutAnchor\)/);
  assert.match(chatWindowSource, /<div aria-hidden="true" style=\{\{ height: promptAnchorSpacerHeight \}\} \/>/);
});

test("sizes the message tail from the rendered bottom composer", () => {
  assert.match(chatWindowSource, /const bottomComposerRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(chatWindowSource, /useLayoutEffect\(\(\) => \{/);
  assert.match(chatWindowSource, /new ResizeObserver\(updateBottomComposerHeight\)/);
  assert.match(chatWindowSource, /bottomComposerScrollFrameRef = useRef<number \| null>\(null\)/);
  assert.match(chatWindowSource, /distanceFromBottom <= Math\.abs\(nextHeight - previousHeight\) \+ 1/);
  assert.match(chatWindowSource, /scrollToBottom\("auto"\)/);
  assert.match(chatWindowSource, /<div ref=\{bottomComposerRef\} className="absolute inset-x-0 bottom-0 z-20">/);
  assert.match(chatWindowSource, /height: bottomComposerHeight/);
});

test("tracks education import tools by call id and refreshes only once on completion", () => {
  const startSource = source.slice(
    source.indexOf('case "tool_execution_start"'),
    source.indexOf('case "tool_execution_end"'),
  );
  const endSource = source.slice(
    source.indexOf('case "tool_execution_end"'),
    source.indexOf('case "queue_update"'),
  );
  const resetSource = source.slice(
    source.indexOf("if (sessionIdentity !== appliedIdentity)"),
    source.indexOf("const currentModel ="),
  );
  const unmountSource = source.slice(
    source.indexOf("// Close SSE / invalidate in-flight work"),
    source.indexOf("// Load (or reset) when the parent switches sessions"),
  );

  assert.match(source, /onEducationImportCompleted\?: \(toolName: EducationImportToolName\) => void/);
  assert.match(source, /const educationToolCallsRef = useRef<Map<string, string>>\(new Map\(\)\)/);
  assert.match(startSource, /educationToolCallsRef\.current\.set\(id, name\)/);
  assert.match(endSource, /const name = educationToolCallsRef\.current\.get\(id\)/);
  assert.match(endSource, /educationToolCallsRef\.current\.delete\(id\)/);
  assert.match(endSource, /if \(name === "calendar_import" \|\| name === "timetable_import" \|\| name === "edupi_create_task" \|\| name === "edupi_update_task"\) \{[\s\S]*?onEducationImportCompleted\?\.\(name\)/);
  assert.match(resetSource, /educationToolCallsRef\.current\.clear\(\)/);
  assert.match(unmountSource, /educationToolCallsRef\.current\.clear\(\)/);
  assert.match(chatWindowSource, /onEducationImportCompleted\?: \(toolName: EducationImportToolName\) => void/);
  assert.match(chatWindowSource, /onEducationImportCompleted, onEduPiAction/);
});
