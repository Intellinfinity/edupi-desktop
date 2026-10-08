import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const foreground = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../lib/edupi-foreground.ts");
const { notificationSendNeedsReview } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../lib/edupi-reminder-attempt.ts");
function mockRequire(name, react, jsx, query, today = "2026-09-09") {
  if (name === "react") return react;
  if (name.includes("jsx-runtime")) return { jsx, jsxs: jsx };
  if (name === "next/navigation") return { useSearchParams: () => new URLSearchParams(query) };
  if (name === "@/lib/edupi-foreground") return foreground;
  if (name === "@/lib/edupi-reminder-attempt") return { notificationSendNeedsReview };
  if (name === "./EduPiForeground") return { useEduPiForegroundPolicy: () => ({ today, graceDays: 3, pinnedTaskIds: [] }) };
  // Source reads are independent of the reminder boundary being exercised here.
  if (name === "@/lib/edupi-education-client") return { readEduPiWorkspace: async () => ({ data: { tasks: [], calendar: [], workCases: [], workCandidates: [], taskSessions: {}, continuity: { documents: [] } } }) };
  throw new Error(`Unexpected test import: ${name}`);
}

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
  vm.runInNewContext(code, { exports, AbortController, Date, setInterval: () => 1, clearInterval() {}, fetch: () => new Promise(resolve => { finishFetch = resolve; }), require: name => mockRequire(name, react, jsx, "reminders=1") });
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

test("a failed first reminder read never claims there are no reminders", async () => {
  const slots = [], effects = [];
  let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, value => { slots[i].value = typeof value === "function" ? value(slots[i].value) : value; }]; },
    useEffect(callback, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => slots[i].deps[index] !== value)) { slots[i]?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = callback(); }); } },
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL("./EduPiReminderInbox.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, AbortController, Date, setInterval: () => 1, clearInterval() {}, fetch: async () => { throw new Error("offline"); }, require: name => mockRequire(name, react, jsx, "reminders=1") });
  const render = () => { cursor = 0; const tree = exports.EduPiReminderInbox({ onAction: () => true, standalone: true, onClose: () => {} }); while (effects.length) effects.shift()(); return JSON.stringify(tree); };

  render();
  await new Promise(resolve => setImmediate(resolve));
  const failed = render();
  assert.match(failed, /提醒暂不可用/);
  assert.doesNotMatch(failed, /没有待处理提醒|暂无待处理提醒/);
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
  vm.runInNewContext(code, { exports, AbortController, Date, setInterval: () => 1, clearInterval() {}, fetch: async () => { requests++; return { ok: true, json: async () => ({ items: requests === 1 ? [] : [{ id: "reminder", title: "新备课已准备", kind: "ready", taskId: "task", createdAt: "2026-09-09T00:00:00Z", read: false, handled: false, snoozedUntil: null }] }) }; }, require: name => mockRequire(name, react, jsx, "") });
  const render = () => { cursor = 0; tree = exports.EduPiReminderInbox({ onAction: () => true }); while (effects.length) effects.shift()(); return tree; };
  const nodes = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
  render(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  nodes(render()).find(node => node.type === "button" && node.props["aria-expanded"] === false).props.onClick();
  render(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 2);
  assert.ok(JSON.stringify(render()).includes("新备课已准备"));
});

test("opening an uncertain native reminder preserves its unread row and failed rearm keeps the teacher's item", async () => {
  const slots = [], effects = [], posted = [];
  let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, value => { slots[i].value = typeof value === "function" ? value(slots[i].value) : value; }]; },
    useEffect(callback, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => slots[i].deps[index] !== value)) { slots[i]?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = callback(); }); } },
  };
  const today = foreground.shanghaiDate(new Date());
  const item = { id: "synthetic-uncertain", title: "合成课前事项", kind: "due", taskId: "synthetic-task", identity: `due:${today}`,
    createdAt: new Date().toISOString(), read: false, handled: false, withdrawn: false, snoozedUntil: null,
    notificationAttemptedAt: new Date(Date.now() - 121_000).toISOString(), notificationAttemptId: "11111111-1111-4111-8111-111111111111",
    notificationSendState: "unknown" };
  assert.equal(notificationSendNeedsReview(item), true);
  assert.equal(notificationSendNeedsReview(item, Date.parse(item.notificationAttemptedAt) + 119_999), false);
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL("./EduPiReminderInbox.tsx", import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, AbortController, Date, setInterval: () => 1, clearInterval() {},
    fetch: async (_url, options) => {
      if (!options?.method) return { ok: true, json: async () => ({ items: [item] }) };
      posted.push(JSON.parse(options.body));
      return { ok: false, status: 409 };
    }, require: name => mockRequire(name, react, jsx, "reminders=1", today) });
  const render = () => { cursor = 0; const tree = exports.EduPiReminderInbox({ onAction: () => true, standalone: true, onClose: () => {} });
    while (effects.length) effects.shift()(); return tree; };
  const nodes = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
  render(); await new Promise(resolve => setImmediate(resolve));
  let tree = render();
  assert.ok(JSON.stringify(tree).includes(item.title));
  nodes(tree).find(node => node.type === "button" && node.props.className?.includes("edupi-reminder-inbox__row")).props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(posted, [], "viewing an unknown attempt must not race a read write against rearm");
  tree = render();
  const retry = nodes(tree).find(node => node.type === "button" && node.props.children === "再提醒");
  assert.ok(retry, "only an explicit teacher action may rearm the uncertain send");
  retry.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(posted, [{ id: item.id, type: "rearm_notification", attemptId: item.notificationAttemptId,
    attemptedAt: item.notificationAttemptedAt }]);
  assert.ok(JSON.stringify(render()).includes(item.title), "409 must leave the reminder visible");
  assert.ok(JSON.stringify(render()).includes("提醒保存失败"));
  assert.equal(item.read, false);
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
