import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("ChatInput exposes replacement without touching attached images", async () => {
  const source = await read("./ChatInput.tsx");

  assert.match(source, /replaceText: \(text: string\) => void/);
  assert.match(source, /replaceText\(text: string\) \{[\s\S]*?setValue\(text\);[\s\S]*?setSelectionRange\(text\.length, text\.length\)/);
  assert.doesNotMatch(source.slice(source.indexOf("replaceText(text: string) {"), source.indexOf("replaceMessage(message: UserMessage,")), /setAttachedImages/);
});

test("EduPi handoffs offer a page reference without replacing teacher text", async () => {
  const appShell = await read("./AppShell.tsx");
  const panel = await read("./EduPiEducationPanel.tsx");
  const chat = await read("./ChatWindow.tsx");

  assert.match(appShell, /onReplaceAgentPrompt=\{\(prompt\) => setPendingEduPiContext\(\{ context: createComposerContext\(prompt\), openId: crypto\.randomUUID\(\) \}\)\}/);
  assert.match(appShell, /onPrepareAgentPrompt=\{\(prompt\) => setPendingEduPiContext\(\{ context: createComposerContext\(prompt\), openId: crypto\.randomUUID\(\) \}\)\}/);
  assert.doesNotMatch(appShell, /onReplaceAgentPrompt=\{\(prompt\) => chatInputRef\.current\?\.replaceText/);
  assert.match(chat, /!\(session\?\.id \|\| newSessionCwd\)/);
  assert.match(chat, /offerContext\(educationContext\)/);
  assert.match(chat, /offerTeacherDraft\(teacherDraftText\)/);
  const session = await read("../hooks/useAgentSession.ts");
  assert.match(session, /replaceMessage\(userMsg, true\)/);
  const selectSession = appShell.slice(appShell.indexOf("const handleEducationSelectSession"), appShell.indexOf("const handleNewSession"));
  assert.match(selectSession, /setPendingEduPiContext\(null\)/);
  assert.match(selectSession, /setPendingTeacherDraft\(null\)/);
  const changeCwd = appShell.slice(appShell.indexOf("const handleCwdChange"), appShell.indexOf("const handleSelectSession"));
  assert.match(changeCwd, /previousCwd !== cwd[\s\S]*setPendingEduPiContext\(null\)/);
  assert.match(panel, /onReplaceAgentPrompt: \(prompt: string\) => void/);
  assert.match(panel, /type AgentPromptMode = "insert" \| "replace" \| "teacher" \| "teacher-main"/);
  assert.match(panel, /onStartAgent=\{\(prompt, mode\) => startAgent\(prompt, mode\)\}/);

  const contextHandoff = panel.slice(panel.indexOf("onAgentRequest={(prompt) => {"), panel.indexOf("</EduPiContextEditor>"));
  assert.match(contextHandoff, /setContextOpen\(false\)/);
  assert.match(contextHandoff, /startAgent\(prompt, "teacher-main"\)/);
  assert.doesNotMatch(contextHandoff, /selectView\("chat"\)/);
  assert.doesNotMatch(contextHandoff, /setPendingAgentPromptMode/);
  assert.match(panel, /drawer !== "agent" \|\| \(activeView !== "tasks" && activeView !== "review"\)/);

  const startAgent = panel.slice(panel.indexOf("const startAgent"), panel.indexOf("useEffect", panel.indexOf("const startAgent")));
  const replaceBranchStart = startAgent.indexOf('if (mode === "replace" || mode === "teacher-main")');
  assert.notEqual(replaceBranchStart, -1);
  const replaceBranch = startAgent.slice(replaceBranchStart, startAgent.indexOf("setDrawer(\"agent\")", replaceBranchStart));
  assert.match(replaceBranch, /selectView\("chat"\)/);
  assert.match(replaceBranch, /return/);
  assert.doesNotMatch(replaceBranch, /setDrawer/);

  const taskActivation = panel.slice(panel.indexOf("const activateAgent"), panel.indexOf("const openAgentForTask"));
  assert.match(taskActivation, /setPendingAgentPromptMode\("replace"\)/);
  assert.match(taskActivation, /setPendingAgentPrompt\(prompt\)/);
  const uploadHandoff = panel.slice(panel.indexOf("const openUpload"), panel.indexOf("const openFile"));
  assert.doesNotMatch(uploadHandoff, /"replace"/);

  assert.match(panel, /const mode = pendingAgentPromptMode/);
  assert.match(panel, /if \(mode === "replace"\)/);
  assert.doesNotMatch(replaceBranch, /setDrawer\("agent"\)/);
  assert.match(panel, /onReplaceAgentPrompt\(pendingAgentPrompt\)/);
  assert.match(panel, /onPrepareTeacherDraft\(pendingAgentPrompt\)/);
});

test("task activation carries cancellation through the panel and AppShell", async () => {
  const appShell = await read("./AppShell.tsx");
  const panel = await read("./EduPiEducationPanel.tsx");

  assert.match(panel, /signal: AbortSignal/);
  assert.match(panel, /createActivationRequestTracker/);
  assert.match(panel, /activationRequestsRef/);
  assert.match(panel, /const request = activationRequestsRef\.current\.begin\(\)/);
  assert.match(panel, /signal: request\.signal/);
  assert.match(panel, /activationRequestsRef\.current\.isCurrent\(request\)/);
  assert.match(panel, /cancelActivation/);
  const viewSelection = panel.slice(panel.indexOf("const selectView"), panel.indexOf("const selectTask"));
  assert.match(viewSelection, /const stage[\s\S]*cancelActivation\(\)/);
  assert.doesNotMatch(viewSelection, /if \(view !== "tasks"/);
  const stageSelection = panel.slice(panel.indexOf("const selectStage"), panel.indexOf("const toggleInspector"));
  assert.match(stageSelection, /cancelActivation\(\)/);
  assert.match(panel, /closeDrawer[\s\S]*cancelActivation/);
  assert.match(panel, /useEffect\(\(\) => \(\) => cancelActivation\(\), \[cancelActivation\]\)/);

  assert.match(appShell, /signal: AbortSignal/);
  assert.match(appShell, /educationActivationRequestIdRef/);
  assert.match(appShell, /signal\s*\}\)/);
  assert.match(appShell, /requestId[\s\S]*signal\.aborted/);
  assert.match(appShell, /requestId[\s\S]*router\.replace/);
});
