import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

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
