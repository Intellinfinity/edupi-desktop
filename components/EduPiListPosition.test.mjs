import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const foreground = await jiti.import("../lib/edupi-foreground.ts");
const { APP_PREF_KEYS } = await jiti.import("../lib/app-prefs.ts");
const source = readFileSync(new URL("./EduPiForeground.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;

function mount(storage, memoryKey = "workspace:todo:all:", writable = true) {
  const compiledModule = { exports: {} };
  const React = { createContext: () => ({}), useContext: () => null, useEffect() {}, useMemo: create => create(), useRef: () => ({ current: null }), useState: create => [typeof create === "function" ? create() : create, () => {}] };
  vm.runInNewContext(compiled, { module: compiledModule, exports: compiledModule.exports, window: {}, require(name) {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "@/lib/edupi-foreground") return foreground;
    if (name === "@/lib/app-prefs") return { APP_PREF_KEYS, getPrefJson: key => storage.has(key) ? JSON.parse(storage.get(key)) : null, trySetPrefJson: (key, value) => { if (!writable) return false; storage.set(key, JSON.stringify(value)); return true; } };
    throw new Error(`Unexpected import ${name}`);
  } });
  const render = key => compiledModule.exports.EduPiPagedRows({ rows: Array.from({ length: 23 }, (_, index) => index), memoryKey: key, renderRow: row => jsx.jsx("p", { children: `条目 ${row}` }, row) });
  return { tree: render(memoryKey), render };
}

function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== "object") return [];
  return [node, ...[].concat(node.props?.children ?? []).flatMap(descendants)];
}

test("complete-list page and scroll survive a fresh component module without mixing filter keys", () => {
  const storage = new Map();
  const first = mount(storage);
  const next = descendants(first.tree).find(row => row.type === "button" && row.props.children === "下一页");
  next.props.onClick();
  assert.equal(storage.has(APP_PREF_KEYS.edupiListPositions), true);
  const restored = mount(storage);
  const rows = descendants(restored.tree).filter(row => row.type === "p").map(row => row.props.children);
  assert.equal(rows[0], "条目 10");
  assert.equal(rows.length, 10);
  const viewport = descendants(restored.tree).find(row => row.props?.className === "edupi-paged-list__rows");
  viewport.props.onScroll({ currentTarget: { scrollTop: 143 } });
  const positions = JSON.parse(storage.get(APP_PREF_KEYS.edupiListPositions));
  assert.deepEqual(positions.find(([key]) => key === "workspace:todo:all:")[1], { page: 1, scroll: 143 });
  assert.equal(descendants(restored.render("workspace:todo:teaching:方程")).find(row => row.type === "p").props.children, "条目 0");
});

test("persisted list positions are validated, bounded and safe when storage is unavailable", () => {
  const stored = Array.from({ length: 90 }, (_, index) => [`list:${index}`, { page: 1, scroll: index }]);
  stored.push(["invalid", { page: -1, scroll: 1 }]);
  const storage = new Map([[APP_PREF_KEYS.edupiListPositions, JSON.stringify(stored)]]);
  const current = mount(storage, "list:89");
  assert.equal(descendants(current.tree).find(row => row.type === "p").props.children, "条目 10");
  descendants(current.tree).find(row => row.props?.className === "edupi-paged-list__rows").props.onScroll({ currentTarget: { scrollTop: 50 } });
  const saved = JSON.parse(storage.get(APP_PREF_KEYS.edupiListPositions));
  assert.equal(saved.length, 80);
  assert.equal(saved.some(([key]) => key === "invalid"), false);
  assert.equal(descendants(mount(new Map([[APP_PREF_KEYS.edupiListPositions, '"wrong shape"']])).tree).find(row => row.type === "p").props.children, "条目 0");
  const unavailable = mount(new Map(), "private-mode", false);
  assert.doesNotThrow(() => descendants(unavailable.tree).find(row => row.type === "button" && row.props.children === "下一页").props.onClick());
});
