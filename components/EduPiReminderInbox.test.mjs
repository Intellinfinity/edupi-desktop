import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

test("standalone reminders wait for the first fetch before showing an empty state", async () => {
  const slots = [], effects = [];
  let cursor = 0, finishFetch;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, value => { slots[i].value = typeof value === "function" ? value(slots[i].value) : value; }]; },
    useEffect(callback, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => slots[i].deps[index] !== value)) { slots[i]?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = callback(); }); } },
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL("./EduPiReminderInbox.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, AbortController, Date, setInterval: () => 1, clearInterval() {}, fetch: () => new Promise(resolve => { finishFetch = resolve; }), require: name => name === "react" ? react : name.includes("jsx-runtime") ? { jsx, jsxs: jsx } : { useSearchParams: () => new URLSearchParams("reminders=1") } });
  const render = () => { cursor = 0; const tree = exports.EduPiReminderInbox({ onAction: () => true, standalone: true, onClose: () => {} }); while (effects.length) effects.shift()(); return JSON.stringify(tree); };

  const before = render();
  assert.match(before, /正在读取提醒/);
  assert.doesNotMatch(before, /没有待处理提醒|暂无待处理提醒/);

  finishFetch({ ok: true, json: async () => ({ items: [] }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(render(), /没有待处理提醒/);
  const settled = render();
  assert.match(settled, /没有待处理提醒/);
  assert.doesNotMatch(settled, /正在读取提醒/);
});

test("opening reminders reads newly available items without waiting for polling", async () => {
  const slots = [], effects = [];
  let cursor = 0, requests = 0, tree;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, value => { slots[i].value = typeof value === "function" ? value(slots[i].value) : value; }]; },
    useEffect(callback, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => slots[i].deps[index] !== value)) { slots[i]?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = callback(); }); } },
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL("./EduPiReminderInbox.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, AbortController, Date, setInterval: () => 1, clearInterval() {}, fetch: async () => { requests++; return { ok: true, json: async () => ({ items: requests === 1 ? [] : [{ id: "reminder", title: "新备课已准备", kind: "ready", taskId: "task", createdAt: "2026-09-09T00:00:00Z", read: false, handled: false, snoozedUntil: null }] }) }; }, require: name => name === "react" ? react : name.includes("jsx-runtime") ? { jsx, jsxs: jsx } : { useSearchParams: () => new URLSearchParams() } });
  const render = () => { cursor = 0; tree = exports.EduPiReminderInbox({ onAction: () => true }); while (effects.length) effects.shift()(); return tree; };
  const nodes = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
  render(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  nodes(render()).find(node => node.type === "button" && node.props["aria-expanded"] === false).props.onClick();
  render(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 2);
  assert.ok(JSON.stringify(render()).includes("新备课已准备"));
});

test("notification dismissal is not presented as completing the Core task", () => {
  const source = fs.readFileSync(new URL("./EduPiReminderInbox.tsx", import.meta.url), "utf8");
  assert.match(source, /从提醒中移除/);
  assert.match(source, /只从提醒列表移除，不修改任务/);
  assert.match(source, /"dismiss"/);
  assert.doesNotMatch(source, />已处理<\/button>/);
});

test("standalone reminders use a full-width master-detail workbench", () => {
  const source = fs.readFileSync(new URL("./EduPiReminderInbox.tsx", import.meta.url), "utf8");
  const panel = fs.readFileSync(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../app/edupi-workbench.css", import.meta.url), "utf8");

  assert.match(panel, /showingReminders \? " is-reminders"/);
  assert.match(css, /\.edupi-teacher-body\.is-chat\.is-reminders\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(source, /className="edupi-reminder-inbox__workbench"/);
  assert.match(source, /aria-label="提醒状态"/);
  assert.match(source, /aria-pressed=\{filter === option\.value\}/);
  assert.match(source, /aria-label="提醒详情"/);
  assert.match(source, />继续聊<\/button>/);
  assert.match(css, /\.edupi-reminder-inbox__workbench\s*\{[^}]*grid-template-columns:\s*minmax\(300px, 36%\) minmax\(0, 1fr\)/s);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.edupi-reminder-inbox__workbench\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});
