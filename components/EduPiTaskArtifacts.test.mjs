import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { EduPiTaskArtifacts } = await jiti.import("./EduPiTaskArtifacts.tsx");
const { EduPiTaskWorkspace } = await jiti.import("./EduPiTaskWorkspace.tsx");
const { buildEducationContract } = await jiti.import("../lib/edupi-education-contract.ts");
const artifact = { id: "file-1", title: "课堂教案", path: "/workspace/.edupi/output/lesson.md", available: true, readOnly: false };

function elements(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap(child => elements(child, type));
  if (!tree || typeof tree !== "object") return [];
  return [...(tree.type === type ? [tree] : []), ...elements(tree.props?.children, type)];
}
const markup = props => renderToStaticMarkup(createElement(EduPiTaskArtifacts, { onOpenFile() {}, ...props }));

test("native file buttons open the exact path once for mouse and keyboard-style clicks", () => {
  const opened = [];
  const [button] = elements(EduPiTaskArtifacts({ artifacts: [artifact], onOpenFile: path => opened.push(path) }), "button");
  assert.equal(button.props.type, "button");
  assert.equal(button.props.disabled, false);
  assert.equal(button.props.role, undefined);
  assert.equal(button.props.onKeyDown, undefined, "Enter and Space use the native button click without a duplicate key handler");
  button.props.onClick({ detail: 1 });
  button.props.onClick({ detail: 0 });
  assert.deepEqual(opened, [artifact.path, artifact.path]);
});

test("unavailable files cannot open while read-only files remain readable", () => {
  const opened = [];
  const buttons = elements(EduPiTaskArtifacts({ artifacts: [{ ...artifact, available: false }, { ...artifact, id: "read-only", path: "/workspace/read-only.pdf", readOnly: true }], onOpenFile: path => opened.push(path) }), "button");
  assert.equal(buttons[0].props.disabled, true);
  buttons[0].props.onClick({ detail: 0 });
  assert.deepEqual(opened, []);
  assert.equal(buttons[1].props.disabled, false);
  buttons[1].props.onClick({ detail: 0 });
  assert.deepEqual(opened, ["/workspace/read-only.pdf"]);
});

test("file rows show only known format, revision and access metadata", () => {
  const html = markup({ artifacts: [{ ...artifact, readOnly: true, revision: 2, available: false }] });
  for (const text of ["课堂教案", ">MD<", "版本 2", "只读", "文件不可用"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /已确认|候选|Office|<img|缩略图/);
  assert.doesNotMatch(markup({ artifacts: [artifact] }), /版本|只读|文件不可用/);
});

test("an unavailable index is distinct from an empty list and keeps known files visible", () => {
  assert.match(markup({ artifacts: [] }), /暂无已生成文件/);
  const unavailable = markup({ artifacts: [], unavailable: true });
  assert.match(unavailable, /role="status"[^>]*>文件列表暂不可用/);
  assert.doesNotMatch(unavailable, /暂无已生成文件/);
  const partial = markup({ artifacts: [artifact], unavailable: true });
  assert.match(partial, /课堂教案/);
  assert.match(partial, /文件列表暂不可用/);
});

test("the task workspace renders a real file count and passes index failures through", () => {
  const task = buildEducationContract({ tasks: [{ id: "task-1", title: "准备课堂", status: "planned", content_status: "draft_ready", deliverables: ["教案", "练习", "答案"] }] }).tasks[0];
  const file = { artifact_id: "file-1", task_id: "task-1", title: "课堂教案", relative_path: ".edupi/output/lesson.md", access: "read_only", available: true };
  const props = { task, workCase: null, files: [file, { ...file, artifact_id: "other", task_id: "task-2", relative_path: "other.md" }], stage: "artifact", workspace: "/workspace", context: null, reviewEnabled: true, reviewReason: "", reviewBusy: null, reviewMessage: null, agentSession: null, taskSessionBusy: false, taskSessionError: null, onStage() {}, onReview: async () => {}, onOpenAgent() {}, onOpenFile() {} };
  const html = renderToStaticMarkup(createElement(EduPiTaskWorkspace, props));
  assert.match(html, /1 份文件/);
  assert.match(html, /课堂教案/);
  assert.match(html, /只读/);
  assert.doesNotMatch(html, /3 份文件|other\.md/);
  const unavailable = renderToStaticMarkup(createElement(EduPiTaskWorkspace, { ...props, files: [], artifactsUnavailable: true }));
  assert.match(unavailable, /文件列表暂不可用/);
  assert.doesNotMatch(unavailable, /0 份文件|暂无已生成文件/);
  const missingIndex = renderToStaticMarkup(createElement(EduPiTaskWorkspace, { ...props, files: undefined }));
  assert.match(missingIndex, /文件列表暂不可用/);
});
