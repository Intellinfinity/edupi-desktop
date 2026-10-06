import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { EduPiTaskDetailDrawer } = await jiti.import("./EduPiTaskDetailDrawer.tsx");
const { buildEducationContract } = await jiti.import("../lib/edupi-education-contract.ts");
const task = buildEducationContract({ tasks: [{ id: "task-a", title: "备课甲", status: "planned", deliverables: ["计划教案", "计划答案"] }] }).tasks[0];
const file = { artifact_id: "file-a", task_id: "task-a", title: "实际教案", relative_path: ".edupi/output/lesson.md", available: true, access: "read_only" };
const render = props => renderToStaticMarkup(createElement(EduPiTaskDetailDrawer, { task, workCase: null, workspace: "/workspace", onClose() {}, onOpenFile() {}, onOpenTask() {}, onOpenAgent() {}, onDelete() {}, ...props }));

test("wide details are complementary and narrow details retain modal semantics", () => {
  const docked = render({ docked: true });
  assert.match(docked, /role="complementary"/);
  assert.doesNotMatch(docked, /aria-modal="true"/);
  assert.match(render({}), /role="dialog" aria-modal="true"/);
});

test("planned deliverables are not counted as files or claimed as execution progress", () => {
  const html = render({});
  assert.match(html, /0 份文件/);
  assert.match(html, /计划交付/);
  assert.match(html, /暂无执行记录/);
  assert.doesNotMatch(html, /edupi-task-artifact-list__item|\d\/4|已完成/);
});

test("details share real file counts, access state and unavailable-index behavior", () => {
  const html = render({ files: [file, file, { ...file, artifact_id: "other", task_id: "task-b", title: "不属于甲" }] });
  assert.match(html, /1 份文件/);
  assert.match(html, /实际教案/);
  assert.match(html, /只读/);
  assert.doesNotMatch(html, /不属于甲/);
  const unavailable = render({ files: [file], artifactsUnavailable: true, unavailable: true });
  assert.match(unavailable, /任务状态暂不可用/);
  assert.match(unavailable, /文件列表暂不可用/);
  assert.doesNotMatch(unavailable, /\d 份文件/);
  assert.match(unavailable, /实际教案/);
});

test("another task's execution cannot appear in the selected task's details", () => {
  const html = render({ workCase: { taskId: "task-b", currentState: "running", transitions: [{ id: "wrong", state: "running", sourceKind: "execution", occurredAt: "2026-10-06T00:00:00Z" }], artifacts: [] } });
  assert.match(html, /暂无执行记录/);
  assert.doesNotMatch(html, /开始准备/);
});

test("the available review action is the sole primary action", () => {
  const html = render({ onReview() {} });
  assert.match(html, /审核草稿/);
  assert.doesNotMatch(html, />继续协作</);
  assert.equal((html.match(/class="is-primary"/g) || []).length, 1);
});
