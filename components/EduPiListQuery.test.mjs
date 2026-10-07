import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const source = readFileSync(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url);
const workbench = await jiti.import("../lib/edupi-workbench.ts");
const navigation = await jiti.import("../lib/edupi-domain-navigation.ts");
const { calendarSelectionLink } = await jiti.import("../lib/edupi-calendar-model.ts");
const compile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function section(first, next) {
  const start = source.indexOf(first), end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `Missing production section: ${first}`);
  return source.slice(start, end);
}

function harness() {
  const urls = [];
  const context = {
    ...workbench, ...navigation, calendarSelectionLink, URLSearchParams, useCallback: callback => callback,
    searchParams: new URLSearchParams("edupi=1&module=tasks&view=workspace&item=workspace:list:todo&task=original&taskDetail=original&calendarKind=calendar&calendarItem=source-original&date=2026-09-27&q=原筛选"),
    activeView: "workspace", activeStage: "brief", activeTask: undefined, inspectorOpen: false, selectedStudentId: null, selectedObjectId: "workspace:list:todo", calendarSelection: null,
    query: "原筛选", queryRef: { current: "原筛选" },
    router: { replace: url => urls.push(new URL(url, "http://localhost")) },
    setQuery: value => { context.query = value; },
    cancelActivation() {}, setDrawer() {}, setFileReturnTaskKey() {}, setTaskDetailTask() {}, setAgentTask() {}, setPendingTaskBinding() {}, setCalendarSelection() {}, setReviewMode() {}, setSelectedC1Target() {}, setActiveView() {}, setSelectedObjectId() {}, setSelectedStudentId() {}, setActiveStage() {},
  };
  const code = section("  const updateLocation = useCallback", "  const updateTaskDetailLocation = useCallback")
    + section("  const updateTaskDetailLocation = useCallback", "  useEffect(() => {\n    if (drawer ===")
    + section("  const selectView = useCallback", "  const selectCalendarItem = useCallback")
    + "\nglobalThis.handlers = { updateLocation, updateTaskDetailLocation, selectView, updateQuery: typeof updateQuery === 'function' ? updateQuery : null };";
  vm.runInNewContext(compile(code), context);
  return { context, urls, ...context.handlers };
}

test("list query initializes from the encoded local URL on refresh", () => {
  const context = { searchParams: new URLSearchParams("q=%E6%96%B9%E7%A8%8B+%2B+%E5%9B%BE%E5%83%8F"), useState: value => [typeof value === "function" ? value() : value, () => {}], useRef: value => ({ current: value }) };
  vm.runInNewContext(compile(section("  const [query, setQuery]", "  const [inspectorOpen") + "\nglobalThis.restoredQuery = query;"), context);
  assert.equal(context.restoredQuery, "方程 + 图像");
});

test("typing changes only the local list query while preserving object, task and source parameters", () => {
  const state = harness();
  assert.equal(typeof state.updateQuery, "function");
  state.updateQuery("分数 & 小数");
  const params = state.urls.at(-1).searchParams;
  assert.equal(params.get("q"), "分数 & 小数");
  for (const [key, value] of [["item", "workspace:list:todo"], ["task", "original"], ["taskDetail", "original"], ["calendarKind", "calendar"], ["calendarItem", "source-original"], ["date", "2026-09-27"]]) assert.equal(params.get(key), value);
  assert.equal(state.urls.at(-1).origin, "http://localhost");
});

test("a stale URL cannot replace the newest query during More, history or detail return", () => {
  const state = harness();
  state.context.query = "最新筛选";
  state.context.queryRef.current = "最新筛选";
  state.updateLocation("workspace", undefined, undefined, false, null, "workspace:list:history");
  assert.equal(state.urls.at(-1).searchParams.get("q"), "最新筛选");
  state.updateTaskDetailLocation(null);
  assert.equal(state.urls.at(-1).searchParams.get("q"), "最新筛选");
});

test("same-view list navigation retains its filter and a module change explicitly clears it", () => {
  const state = harness();
  state.selectView("workspace", "workspace:list:done");
  assert.equal(state.context.query, "原筛选");
  assert.equal(state.urls.at(-1).searchParams.get("q"), "原筛选");
  state.selectView("calendar", "calendar:list:events");
  assert.equal(state.context.query, "");
  assert.equal(state.urls.at(-1).searchParams.has("q"), false);
  assert.equal(state.urls.at(-1).searchParams.get("item"), "calendar:list:events");
});
