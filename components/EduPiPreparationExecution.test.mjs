import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";
const shared = await createJiti(import.meta.url).import("../lib/edupi-preparation-execution.ts");
const value = taskId => ({ version: 1, root_ref: `sha256:${"a".repeat(64)}`, owner_id: "owner", task_id: taskId, task_revision: 0, work_case_id: "case", source_revision: `sha256:${"b".repeat(64)}`,
  source_current: true, execution_id: "execution", event_id: "event", attempt: 2, state: "running", active: true,
  phase: { profile: "g1_linear_equations_v1", key: "draft", state: "active", started_at: "2026-10-08T00:00:00.000Z" }, failure_code: null, updated_at: null,
  artifact_ids: [], history: [], history_truncated: false, history_inferred: false, actions: { cancel: true, retry: false }, relations: null, steps_total: null, read_only: true, external_send: false });
const tick = () => new Promise(resolve => setImmediate(resolve));
function mount() {
  const slots = [], effects = new Map(), reads = [], controls = [], events = [];
  let cursor = 0, dirty = false, props, tree;
  const hooks = {
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === "function" ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === "function" ? next(slots[i].value) : next; dirty = true; }]; },
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useEffect(callback, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => value !== slots[i].deps[index])) effects.set(i, { callback, deps }); },
  };
  const jsx = (type, props) => ({ type, props }), exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL("./EduPiPreparationExecution.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, AbortController, Event, document: { visibilityState: "visible" }, window: { setInterval: () => 1, clearInterval() {}, dispatchEvent: event => events.push(event.type) },
    require(name) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "@/lib/edupi-preparation-execution") return shared;
      if (name === "@/lib/edupi-preparation-issues") return { preparationIssueDetail: code => code === "model_unavailable" ? "默认模型不可用" : null };
      if (name === "@/lib/edupi-preparation-execution-client") return {
        readPreparationExecution: (taskId, revision, signal) => new Promise((resolve, reject) => reads.push({ taskId, revision, signal, resolve, reject })),
        controlPreparationExecution: (view, action, signal) => new Promise((resolve, reject) => controls.push({ view, action, signal, resolve, reject })),
      };
      throw new Error(`Unexpected component import ${name}`);
    } });
  function render(next = props) {
    props = next;
    do { cursor = 0; dirty = false; tree = exports.EduPiPreparationExecution(props); } while (dirty);
    for (const [i, effect] of effects) { slots[i]?.cleanup?.(); slots[i] = { deps: effect.deps, cleanup: effect.callback() }; }
    effects.clear(); return tree;
  }
  return { render, reads, controls, events, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : []; }
const text = tree => Array.isArray(tree) ? tree.map(text).join(" ") : tree && typeof tree === "object" ? text(tree.props?.children) : tree == null ? "" : String(tree);
const visibleText = tree => Array.isArray(tree) ? tree.map(visibleText).join(" ") : tree && typeof tree === "object"
  ? tree.type === "details" ? "" : visibleText(tree.props?.children) : tree == null ? "" : String(tree);
test("queued retries keep prior failure in history and stop is an accessible square icon", async () => {
  const widget = mount(); widget.render({ taskId: "A", revision: 0 });
  widget.reads[0].resolve({ ...value("A"), state: "queued", active: false, phase: null, failure_code: "model_unavailable",
    history: [{ sequence: 1, execution_id: "execution", attempt: 1, state: "failed", occurred_at: "2026-10-08T00:00:00.000Z",
      failure_code: "model_unavailable", artifact_ids: [] }] });
  await tick(); const tree = widget.render();
  assert.match(visibleText(tree), /已排队/); assert.doesNotMatch(visibleText(tree), /默认模型不可用|执行未确认|停止/);
  const history = nodes(tree).find(node => node.type === "details" && text(node).includes("执行记录"));
  assert.match(text(history), /默认模型不可用/);
  const stop = nodes(tree).find(node => node.type === "button" && node.props["aria-label"] === "停止准备");
  assert.equal(stop.props.title, "停止准备"); assert.equal(text(stop), "");
  assert.match(stop.props.className, /icon-button/); assert.equal(nodes(stop).some(node => node.type === "rect" && node.props.fill === "currentColor"), true);
  widget.unmount();
});
test("technical artifact identifiers are disclosed only as diagnostics", async () => {
  const widget = mount(); widget.render({ taskId: "A", revision: 0 });
  widget.reads[0].resolve({ ...value("A"), state: "draft_ready", active: false, phase: null, actions: { cancel: false, retry: false }, artifact_ids: ["artifact-A"] });
  await tick(); const tree = widget.render(), diagnostic = nodes(tree).find(node => node.type === "details" && text(node).includes("artifact-A"));
  assert.doesNotMatch(visibleText(tree), /artifact-A/); assert.equal(text(nodes(diagnostic).find(node => node.type === "summary")), "诊断");
  assert.match(text(diagnostic), /产物 ID/); widget.unmount();
});
test("the actual component shows only the producer phase and capabilities", async () => {
  const widget = mount(); widget.render({ taskId: "A", revision: 0 });
  widget.reads[0].resolve(value("A")); await tick();
  const tree = widget.render(); assert.match(text(tree), /生成草稿/); assert.match(text(tree), /第 2 次执行/);
  assert.doesNotMatch(text(tree), /暂停|恢复|子代理|\d+\/\d+|%|已完成读取/);
  assert.equal(nodes(tree).some(node => node.type === "button" && node.props["aria-label"] === "停止准备"), true);
  assert.equal(nodes(tree).some(node => node.type === "button" && text(node) === "重试"), false);
  widget.unmount();
});
test("a late read cannot replace another task or its loading state", async () => {
  const widget = mount(); widget.render({ taskId: "A", revision: 0 }); widget.render({ taskId: "B", revision: 0 });
  assert.equal(widget.reads[0].signal.aborted, true);
  widget.reads[0].resolve(value("A")); await tick(); assert.match(text(widget.render()), /正在读取/); assert.doesNotMatch(text(widget.render()), /生成草稿/);
  widget.reads[1].resolve({ ...value("B"), phase: null, active: false, state: "stale", source_current: false, actions: { cancel: false, retry: false } });
  await tick(); const tree = widget.render(); assert.match(text(tree), /旧执行只读/); assert.doesNotMatch(text(tree), /生成草稿|停止|重试/);
  widget.unmount();
});
test("explicit controls submit once and a late completion cannot update the next task", async () => {
  const widget = mount(); let updated = 0;
  widget.render({ taskId: "A", revision: 0, onUpdated: () => updated++ }); widget.reads[0].resolve(value("A")); await tick();
  const button = nodes(widget.render()).find(node => node.type === "button" && node.props["aria-label"] === "停止准备");
  button.props.onClick(); button.props.onClick(); assert.equal(widget.controls.length, 1);
  widget.render({ taskId: "B", revision: 0, onUpdated: () => updated++ }); assert.equal(widget.controls[0].signal.aborted, true);
  widget.controls[0].resolve(); await tick(); assert.equal(updated, 0); assert.match(text(widget.render()), /正在读取/);
  widget.unmount();
});
