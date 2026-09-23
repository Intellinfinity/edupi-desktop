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
