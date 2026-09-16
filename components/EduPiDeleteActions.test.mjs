import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("every directly editable teacher object exposes the shared Core delete action", async () => {
  const [panel, calendar, memories, students, tasks, materials, views] = await Promise.all([
    read("./EduPiEducationPanel.tsx"),
    read("./EduPiCalendarWorkspace.tsx"),
    read("./EduPiMemoryDatabase.tsx"),
    read("./EduPiStudentWorkspace.tsx"),
    read("./EduPiTaskDetailDrawer.tsx"),
    read("./EduPiMaterialsWorkspace.tsx"),
    read("./EduPiWorkspaceViews.tsx"),
  ]);

  assert.match(panel, /deleteEducationEntity/);
  assert.match(panel, /deleteEntity/);
  assert.match(panel, /onDeleteEntity=\{deleteEntity\}/);
  assert.match(views, /onDeleteEntity/);

  assert.match(calendar, /onDeleteEntity/);
  assert.match(calendar, /"删除"/);
  assert.match(calendar, /selection\.kind, selection\.sourceId/);

  assert.match(memories, /onDeleteEntity/);
  assert.match(memories, /onDeleteEntity\("memory", memory\.id, memory\.content\)/);
  assert.match(memories, /"删除"/);
  assert.match(memories, /setPage\(\(current\) => Math\.min\(current, Math\.max\(0, pages - 1\)\)\)/);

  assert.match(students, /onDeleteEntity/);
  assert.match(students, /onDeleteEntity\("student", selectedStudentId \|\| selectedName, label\)/);
  assert.match(students, /删除学生档案/);

  assert.match(tasks, /onDelete/);
  assert.match(tasks, /onDelete\(task\)/);
  assert.match(tasks, /正在删除任务/);
  assert.match(tasks, /删除任务/);

  assert.match(materials, /onDeleteEntity/);
  assert.match(materials, /onDeleteEntity\("material", selected\.id, selected\.title\)/);
  assert.match(materials, /删除材料/);
});

test("delete controls require an explicit named confirmation and show progress", async () => {
  const [panel, calendar, students] = await Promise.all([read("./EduPiEducationPanel.tsx"), read("./EduPiCalendarWorkspace.tsx"), read("./EduPiStudentWorkspace.tsx")]);
  const confirmation = await read("./EduPiDeleteConfirmation.tsx");
  assert.match(confirmation, /role="alertdialog"/);
  assert.match(confirmation, /删除“\{label\}”？/);
  assert.match(confirmation, /onResolve\(false\)/);
  assert.match(confirmation, /onResolve\(true\)/);
  assert.match(panel, /Promise<boolean>/);
  assert.match(panel, /if \(!confirmed\) return false/);
  assert.match(panel, /return true/);
  assert.match(calendar, /const deleted = await onDeleteEntity/);
  assert.match(calendar, /if \(deleted\) closeDetail\(\)/);
  assert.match(students, /const deleted = await onDeleteEntity/);
  assert.match(students, /if \(!deleted\) return/);
  assert.match(panel, /setDeleteBusy/);
  assert.match(panel, /删除中/);
  assert.match(panel, /commitEducationSnapshot\(result\.data\)/);
  assert.match(panel, /setTimeout\(\(\) => setMaterialStagingMessage\(null\)/);
  assert.match(panel, /STATUS_MESSAGE_MS = 4_000/);
});
