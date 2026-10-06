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
  assert.match(workspace, /usePanelDismiss<HTMLElement>\(onClose, docked, Boolean\(kind\)\)/);
  const adaptive = await read("../hooks/usePanelDismiss.ts");
  assert.match(adaptive, /useModalDismiss<T>\(onClose, enabled && !docked\)/);
  for (const source of [chat, materials, calendar]) {
    assert.match(source, /useModalDismiss<HTMLElement>/);
    assert.match(source, /"dialog"/);
    assert.match(source, /data-autofocus/);
  }
});

test("student drawer closes with Escape and restores the invoking control", async () => {
  const students = await read("./EduPiStudentWorkspace.tsx");
  assert.match(students, /useModalDismiss<HTMLElement>/);
  const tasks = await read("./EduPiTaskDetailDrawer.tsx");
  assert.match(tasks, /usePanelDismiss<HTMLElement>\(onClose, docked\)/);
  assert.match(tasks, /docked \? "complementary" : "dialog"/);
  assert.doesNotMatch(tasks, /addEventListener\("keydown"/);
  assert.match(students, /ref=\{studentDrawerRef\}/);
});
