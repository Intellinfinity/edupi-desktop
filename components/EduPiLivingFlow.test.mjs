import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [board, today, drawer, panel, css] = await Promise.all([
  readFile(new URL("./EduPiWorkspaceBoard.tsx", import.meta.url), "utf8"),
  readFile(new URL("./EduPiTodayWork.tsx", import.meta.url), "utf8"),
  readFile(new URL("./EduPiTaskDetailDrawer.tsx", import.meta.url), "utf8"),
  readFile(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/edupi-workbench.css", import.meta.url), "utf8"),
]);

test("Today, workspace cards, and the shared drawer consume Core work cases", () => {
  assert.match(today, /todayActiveTasks\(data\)/);
  assert.match(today, /taskById\.get\(candidate\.taskId\)/);
  assert.match(board, /workCaseForTask\(data, task\.id\)/);
  assert.match(drawer, /workCase: EducationWorkCase \| null/);
  assert.match(drawer, /workCase\.transitions/);
  assert.match(panel, /workCaseForTask\(education, taskDetail\.id\)/);
});

test("motion belongs only to live Core states and respects reduced-motion", () => {
  assert.match(css, /\.edupi-flow-state\.is-running/);
  assert.match(css, /\.edupi-flow-state\.is-queued/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(today + board + drawer, /setInterval|setTimeout|Math\.random/);
});
