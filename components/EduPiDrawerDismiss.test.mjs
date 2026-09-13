import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

test("workspace, chat, material, and calendar drawers share Escape and focus restoration", async () => {
  const [workspace, chat, materials, calendar] = await Promise.all([
    read("./EduPiWorkspaceDrawer.tsx"),
    read("./EduPiPersistentChatHost.tsx"),
    read("./EduPiMaterialsWorkspace.tsx"),
    read("./EduPiCalendarWorkspace.tsx"),
  ]);
  for (const source of [workspace, chat, materials, calendar]) {
    assert.match(source, /useModalDismiss<HTMLElement>/);
    assert.match(source, /"dialog"/);
    assert.match(source, /data-autofocus/);
  }
});

test("student drawer closes with Escape and restores the invoking control", async () => {
  const students = await read("./EduPiStudentWorkspace.tsx");
  assert.match(students, /useModalDismiss<HTMLElement>/);
  const tasks = await read("./EduPiTaskDetailDrawer.tsx");
  assert.match(tasks, /useModalDismiss<HTMLElement>/);
  assert.doesNotMatch(tasks, /addEventListener\("keydown"/);
  assert.match(students, /ref=\{studentDrawerRef\}/);
});
