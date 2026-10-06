import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { EduPiRuntimeFlow } = await jiti.import("./EduPiRuntimeFlow.tsx");
const { EduPiTaskRunContext } = await jiti.import("./EduPiTaskRunContext.tsx");
const { buildEducationContract } = await jiti.import("../lib/edupi-education-contract.ts");
const { taskPreparedArtifacts } = await jiti.import("../lib/edupi-task-artifacts.ts");
const workbench = await jiti.import("../lib/edupi-workbench.ts");
const workCaseHelpers = await jiti.import("../lib/edupi-work-case.ts");
const taskBoardHelpers = await jiti.import("../lib/edupi-task-board.ts");

const idle = { running: false, toolRunning: false, compacting: false };
const task = buildEducationContract({ tasks: [{ id: "task-1", title: "合成备课任务", status: "planned", content_status: "draft_ready", deliverables: ["教案", "练习", "答案"] }] }).tasks[0];
const workCase = { id: "case-1", taskId: task.id, currentState: "draft_ready", artifacts: [] };
const runInfo = overrides => ({ sessionId: "session-1", task, workCase, artifacts: [], unavailable: false, artifactsUnavailable: false, onOpen() {}, ...overrides });
const render = (props = {}, value = null) => renderToStaticMarkup(createElement(EduPiTaskRunContext.Provider, { value }, createElement(EduPiRuntimeFlow, { ...idle, ...props })));

test("runtime flow is absent when idle and reflects actual flags", () => {
  assert.equal(render(), "");
  assert.match(render({ running: true }), /处理中/);
  assert.match(render({ toolRunning: true }), />正在执行<\/span>/);
  assert.match(render({ running: true, activeTools: ["read", "write"] }), /title="执行工具：read、write">正在执行<\/span>/);
  assert.equal(render({ activeTools: ["read"] }), "");
  assert.match(render({ compacting: true }), /整理对话/);
});

test("task cards require the current session even while a previous context remains mounted", () => {
  const info = runInfo();
  for (const sessionId of ["session-2", undefined, ""]) {
    assert.equal(render({ sessionId }, info), "");
    const live = render({ sessionId, running: true }, info);
    assert.match(live, /edupi-runtime-flow--generic/);
    assert.match(live, /处理中/);
    assert.doesNotMatch(live, /合成备课任务|edupi-task-run-card|<button/);
  }
  assert.match(render({ sessionId: info.sessionId }, info), /合成备课任务/);
});

test("bound tasks show live activity and return to their real idle state", () => {
  const info = runInfo();
  const props = { sessionId: info.sessionId };
  for (const [flags, label] of [
    [{ running: true }, "正在协作"],
    [{ toolRunning: true }, "正在执行"],
    [{ running: true, activeTools: ["read"] }, "正在执行"],
    [{ running: true, toolRunning: true, compacting: true, activeTools: ["read"] }, "整理对话"],
  ]) {
    const html = render({ ...props, ...flags }, info);
    assert.match(html, /class="edupi-task-run-card edupi-runtime-flow"/);
    assert.ok(html.includes(label));
    assert.doesNotMatch(html, /已接受|已完成|100%|progressbar|aria-valuenow|第\s*\d+\s*步|子代理/);
  }
  const settled = render(props, info);
  assert.match(settled, /class="edupi-task-run-card"/);
  assert.match(settled, /待你确认/);
  assert.doesNotMatch(settled, /edupi-runtime-flow|正在协作|已接受|已完成|%/);
  const completed = render(props, runInfo({ workCase: { ...workCase, currentState: "completed" } }));
  assert.match(completed, /执行完成/);
  assert.doesNotMatch(completed, /已接受|已确认/);
});

test("raw tool names appear only in the current activity tooltip", () => {
  const info = runInfo();
  const props = { sessionId: info.sessionId, activeTools: ["read", "teacher_core_bridge"] };
  const live = render({ ...props, running: true }, info);
  assert.match(live, /class="edupi-task-run-card__status" title="执行工具：read、teacher_core_bridge">正在执行<\/span>/);
  assert.doesNotMatch(live, />[^<]*teacher_core_bridge[^<]*</);
  for (const flags of [{}, { compacting: true }]) {
    const html = render({ ...props, ...flags }, info);
    assert.doesNotMatch(html, /执行工具|teacher_core_bridge/);
  }
});

test("teacher hold and rejection survive stale execution and board snapshots", () => {
  for (const [status, label] of [["hold", "已暂缓"], ["rejected", "已拒绝"]]) {
    const html = render({ sessionId: "session-1" }, runInfo({ task: { ...task, status, boardStage: "done" } }));
    assert.ok(html.includes(label));
    assert.doesNotMatch(html, /待你确认|已准备|已完成/);
  }
  const unrelatedCase = render({ sessionId: "session-1" }, runInfo({ workCase: { ...workCase, taskId: "task-2", currentState: "failed" } }));
  assert.match(unrelatedCase, /待你确认/);
  assert.doesNotMatch(unrelatedCase, /准备失败/);
});

test("unavailable task and file state stays visible and never becomes an empty file count", () => {
  for (const artifacts of [[], [{ id: "file-1", title: "已知文件", path: "/workspace/lesson.md", available: true, readOnly: false }]]) {
    const filesFailed = render({ sessionId: "session-1" }, runInfo({ artifacts, artifactsUnavailable: true }));
    assert.match(filesFailed, /文件列表暂不可用/);
    assert.doesNotMatch(filesFailed, /\d+ 份文件/);
    for (const running of [false, true]) {
      const stateFailed = render({ sessionId: "session-1", running }, runInfo({ artifacts, unavailable: true }));
      assert.match(stateFailed, /任务状态暂不可用/);
      assert.match(stateFailed, /文件列表暂不可用/);
      assert.doesNotMatch(stateFailed, /待你确认|\d+ 份文件/);
      if (running) assert.match(stateFailed, /正在协作/);
    }
  }
});

test("newer teacher board moves supersede historical review and execution state", () => {
  const moved = { ...task, boardRevision: 1, boardUpdatedAt: "2026-10-06T10:00:00Z", reviewedAt: "2026-10-06T09:00:00Z" };
  const reopened = render({ sessionId: "session-1" }, runInfo({ task: { ...moved, status: "accepted", boardStage: "progress" } }));
  assert.match(reopened, /进行中/);
  assert.doesNotMatch(reopened, /已接受|待你确认/);
  const completed = render({ sessionId: "session-1" }, runInfo({ task: { ...moved, boardStage: "done" } }));
  assert.match(completed, /已完成/);
  assert.doesNotMatch(completed, /待你确认/);
  const heldLater = render({ sessionId: "session-1" }, runInfo({ task: { ...moved, status: "hold", boardStage: "done", reviewedAt: "2026-10-06T11:00:00Z" } }));
  assert.match(heldLater, /已暂缓/);
  assert.doesNotMatch(heldLater, /已完成/);
});

test("the count uses deduplicated real file projection rather than expected deliverables", () => {
  const file = { artifact_id: "file-1", task_id: task.id, title: "教案", relative_path: ".edupi/lesson.md", available: true };
  const artifacts = taskPreparedArtifacts(task, workCase, [file, { ...file, artifact_id: "alias" }, { ...file, artifact_id: "file-2", relative_path: ".edupi/answers.md" }, { ...file, task_id: "task-2", relative_path: ".edupi/other.md" }], "/workspace");
  const html = render({ sessionId: "session-1" }, runInfo({ artifacts }));
  assert.match(html, /2 份文件/);
  assert.doesNotMatch(html, /3 份文件/);
  assert.match(render({ sessionId: "session-1" }, runInfo()), /0 份文件/);
});

test("the whole card is one native button and opens details once per mouse or keyboard click", async () => {
  let opens = 0;
  const info = runInfo({ onOpen: () => opens++ });
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const code = ts.transpileModule(await readFile(new URL("./EduPiRuntimeFlow.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (name === "react") return { useContext: context => { assert.equal(context, EduPiTaskRunContext); return info; } };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "./EduPiTaskRunContext") return { EduPiTaskRunContext };
      if (name === "@/lib/edupi-workbench") return workbench;
      if (name === "@/lib/edupi-work-case") return workCaseHelpers;
      if (name === "@/lib/edupi-task-board") return taskBoardHelpers;
      throw new Error(`Unexpected component import: ${name}`);
    },
  });
  const button = exports.EduPiRuntimeFlow({ ...idle, sessionId: info.sessionId });
  assert.equal(button.type, "button");
  assert.equal(button.props.type, "button");
  assert.equal(button.props["aria-haspopup"], undefined, "Details can be a non-modal side panel on wide screens");
  assert.equal(button.props.disabled, undefined);
  assert.equal(button.props.role, undefined);
  assert.equal(button.props.onKeyDown, undefined, "Native Enter/Space activation must not be duplicated");
  button.props.onClick({ detail: 1 });
  button.props.onClick({ detail: 0 });
  assert.equal(opens, 2);
  assert.equal((render({ sessionId: info.sessionId }, info).match(/<button/g) || []).length, 1);
});

test("graph motion is finite and reduced-motion is respected", async () => {
  const css = await readFile(new URL("../app/edupi-motion.css", import.meta.url), "utf8");
  assert.match(css, /ease-out 1/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.edupi-task-run-card:focus-visible\s*\{[^}]*outline: 2px/);
  assert.match(css, /\.edupi-task-run-card\s*\{ transition: none; \}/);
});
