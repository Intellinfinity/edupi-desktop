import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("revision actions carry object facts without prewriting the teacher request", async () => {
  const [memory, materials, students, studentProfilePrompt, panel] = await Promise.all([
    read("./EduPiMemoryDatabase.tsx"),
    read("./EduPiMaterialsWorkspace.tsx"),
    read("./EduPiStudentWorkspace.tsx"),
    read("../lib/edupi-student-profile-prompt.ts"),
    read("./EduPiEducationPanel.tsx"),
  ]);
  for (const source of [memory, materials, students, studentProfilePrompt]) {
    assert.doesNotMatch(source, /appendTeacherInputSlot|在这里输入或口述/);
  }
  assert.match(memory, /当前内容：\$\{memory\.content\}/);
  assert.match(materials, /材料：\$\{selected\.title\}/);
  assert.match(studentProfilePrompt, /学生档案：\$\{input\.name\}/);
  const taskHandoff = panel.slice(panel.indexOf("const activateAgent"), panel.indexOf("const openAgentForTask"));
  assert.match(taskHandoff, /任务 ID：\$\{task\.id\}/);
  assert.doesNotMatch(taskHandoff, /appendTeacherInputSlot|在这里输入或口述/);
  assert.match(memory, /onStartAgent\(prompt, "replace"\)/);
  assert.match(materials, /onStartAgent\(prompt, "replace"\)/);
  assert.match(students, /onStartAgent\(prompt, "replace"\)/);
});

test("the generic student-profile entry leaves the teacher draft untouched", async () => {
  const appShell = await read("./AppShell.tsx");
  const handoff = appShell.slice(appShell.indexOf("const askEduPiToUpdateStudents"), appShell.indexOf("const openQuickEntry"));
  assert.match(handoff, /openEducationView\("chat"\)/);
  assert.match(handoff, /setPendingEduPiContext\(\{ context: createComposerContext\("学生档案更新", "学生档案更新"\), openId: crypto\.randomUUID\(\) \}\)/);
  assert.doesNotMatch(handoff, /replaceText|offerTeacherDraft|resetNewSessionDraft/);
});

test("quick suggestions cannot replace a drafted home command", async () => {
  const workspace = await read("./EduPiWorkspaceViews.tsx");
  const commandCenter = workspace.slice(workspace.indexOf("function CommandCenter"), workspace.indexOf("function SectionHeader"));
  assert.match(commandCenter, /setCommand\(current => current\.trim\(\) \? current : item\.prompt\)/);
  assert.match(commandCenter, /disabled=\{Boolean\(command\.trim\(\)\)\}/);
});

test("task detail handoff closes after activation without a competing route update", async () => {
  const [drawer, panel] = await Promise.all([read("./EduPiTaskDetailDrawer.tsx"), read("./EduPiEducationPanel.tsx")]);
  assert.match(drawer, /onClick=\{\(\) => onOpenAgent\(task\)\}>\{agentBusy \? "正在准备" : "继续让 EduPi 做"\}/);
  const activation = panel.slice(panel.indexOf("const activateAgent"), panel.indexOf("const openAgentForTask"));
  assert.match(activation, /setTaskDetailTask\(null\)/);
  assert.match(activation, /if \(!task\.id \|\| !education\) \{[\s\S]*updateTaskDetailLocation\(null\)/);
  assert.match(panel, /if \(drawer === "file" \|\| drawer === "agent"\) return/);
  assert.match(panel, /agentBusy=\{taskSessionBusy\}/);
  const openDetail = panel.slice(panel.indexOf("const openTaskDetail"), panel.indexOf("const selectQuickEntry"));
  assert.match(openDetail, /setTaskSessionError\(null\)/);
});
