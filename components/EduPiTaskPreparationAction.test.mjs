import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Execute the component and handlers with deterministic hook scheduling and
// deferred transport. Browser layout and React DOM behavior remain UI checks.
function mount(initialState = "idle") {
  const slots = [], effects = new Map(), requests = [], notifications = [];
  let cursor = 0, dirty = false, props, tree;
  const hooks = {
    useState(initial) { const index = cursor++; slots[index] ??= { value: initial }; return [slots[index].value, value => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; dirty = true; }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useEffect(callback, dependencies) { const index = cursor++; const previous = slots[index]; if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) effects.set(index, { callback, dependencies }); },
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL("./EduPiTaskPreparationAction.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name === "react" ? hooks : { jsx, jsxs: jsx }, Event, window: { dispatchEvent: event => notifications.push(event.type), setInterval: () => 1, clearInterval() {} }, fetch: (url, options = {}) => options.method ? new Promise((resolve, reject) => requests.push({ body: JSON.parse(options.body), resolve, reject })) : Promise.resolve(response(new URL(url, "http://localhost").searchParams.get("taskId"), initialState)) });
  function render(next = props) {
    props = next;
    do { dirty = false; cursor = 0; tree = exports.EduPiTaskPreparationAction(props); } while (dirty);
    for (const [index, effect] of effects) { slots[index]?.cleanup?.(); slots[index] = { dependencies: effect.dependencies, cleanup: effect.callback() }; }
    effects.clear();
    return tree.props.children[0];
  }
  return { render, requests, notifications, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (taskId, state = "ready") => ({ ok: true, json: async () => ({ taskId, state, prepared: 1, error: null }) });

test("an initially ready task refreshes its artifacts and stays completed", async () => {
  const component = mount("ready"); let ready = 0;
  component.render({ taskId: "A", onReady: () => ready++ });
  await tick();
  const button = component.render();
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.children, "已准备");
  assert.equal(ready, 1);
  assert.deepEqual(component.notifications, ["edupi-preparation-updated"]);
  component.unmount();
});

test("a late start response cannot replace the current task or clear its pending state", async () => {
  for (const staleOutcome of ["success", "failure"]) {
    const component = mount(); let readyA = 0, readyB = 0;
    component.render({ taskId: "A", onReady: () => readyA++ }).props.onClick();
    assert.equal(component.render().props.disabled, true);
    const b = component.render({ taskId: "B", onReady: () => readyB++ });
    assert.equal(b.props.disabled, false);
    b.props.onClick();
    if (staleOutcome === "success") component.requests[0].resolve(response("A")); else component.requests[0].reject(new Error("stale failure"));
    await tick();
    assert.equal(component.render().props.disabled, true, "A finally must not clear B starting");
    assert.equal(readyA + readyB, 0);
    component.requests[1].resolve(response("B")); await tick();
    assert.equal(component.render().props.disabled, true);
    assert.equal(component.render().props.children, "已准备");
    assert.equal(readyA, 0); assert.equal(readyB, 1);
    assert.deepEqual(component.notifications, ["edupi-preparation-updated"]);
    component.unmount();
  }
});

test("switching back to the same task and unmounting both invalidate earlier requests", async () => {
  const component = mount(); let ready = 0;
  const props = { taskId: "A", onReady: () => ready++ };
  component.render(props).props.onClick();
  component.render({ ...props, taskId: "B" });
  component.render(props);
  component.requests[0].resolve(response("A")); await tick();
  assert.equal(ready, 0);
  component.render().props.onClick();
  component.unmount();
  component.requests[1].resolve(response("A")); await tick();
  assert.equal(ready, 0);
  assert.deepEqual(component.notifications, []);
});
