import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const panel = await readFile(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url);
const workbench = await jiti.import("../lib/edupi-workbench.ts");
const { isTaskReviewable, workCaseForTask } = await jiti.import("../lib/edupi-work-case.ts");
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const section = (source, first, next) => {
  const start = source.indexOf(first), end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `Missing component section: ${first}`);
  return source.slice(start, end);
};
const forkCode = compile(section(shell, "  const handleSessionForked = useCallback", "  const handleInitialRestoreDone = useCallback")
  + "\nglobalThis.handlers = { handleSessionForked, handleEducationSessionForked };");
const bindingCode = compile("(() => {\n"
  + section(panel, "  const activeTask = useMemo", "  const activeWorkReview")
  + section(panel, "  useEffect(() => {\n    if (!pendingTaskBinding", "  useEffect(() => {\n    if (!pendingAgentPrompt")
  + "\nreturn activeTask;\n})()");

function forkRoute(query, education = true) {
  let location, selected = { id: "parent-b", cwd: "/synthetic-workspace" };
  const hydrated = [];
  const context = {
    URLSearchParams, searchParams: new URLSearchParams(query), useCallback: callback => callback,
    setPendingEduPiContext() {}, setPendingTeacherDraft() {}, setRefreshKey() {}, setNewSessionCwd() {},
    setSelectedSession: update => { selected = update(selected); },
    hydrateSelectedSession: id => hydrated.push(id),
    router: { replace: url => { location = new URL(url, "http://localhost"); } },
  };
  vm.runInNewContext(forkCode, context);
  context.handlers[education ? "handleEducationSessionForked" : "handleSessionForked"]("child-b");
  assert.equal(selected.id, "child-b");
  assert.deepEqual(hydrated, ["child-b"]);
  return location.searchParams;
}

const taskA = { id: "synthetic-task-a", title: "合成任务甲", status: "planned" };
const taskB = { id: "synthetic-task-b", title: "合成任务乙", status: "planned" };

// Executes the production selection and binding effects with React-style commits.
// Fetch only updates synthetic in-memory records; this is not installed-app evidence.
function bindingHarness(overrides = {}) {
  const requests = [], errors = [], effects = [], pendingEffects = [];
  let cursor, dirty = true, activeTask;
  const state = {
    activeView: "tasks", routeView: "tasks", drawer: "agent", agentTask: taskB,
    requestedTaskKey: taskB.id, selectedTaskKey: taskB.id,
    activeAgentSessionId: "child-b", pendingTaskBinding: null,
    education: { tasks: [taskA, taskB], workCases: [], taskSessions: {
      [taskA.id]: { sessionId: "parent-a" }, [taskB.id]: { sessionId: "parent-b" },
    } },
    ...overrides,
  };
  const stored = structuredClone(state.education);
  const update = values => { Object.assign(state, values); dirty = true; };
  const hooks = {
    useMemo: factory => factory(),
    useEffect(callback, deps) {
      const index = cursor++;
      if (!effects[index] || deps.some((value, i) => !Object.is(value, effects[index].deps[i]))) {
        pendingEffects.push({ index, callback, deps });
      }
    },
    setPendingTaskBinding: value => update({ pendingTaskBinding: value }),
    setTaskSessionBusy() {}, setTaskSessionError: error => errors.push(error),
    commitEducationSnapshot: education => update({ education }),
    fetch: async (url, options) => {
      const taskId = decodeURIComponent(url.split("/").at(-2));
      const body = JSON.parse(options.body);
      requests.push({ taskId, method: options.method, sessionId: body.sessionId });
      stored.taskSessions[taskId] = { sessionId: body.sessionId };
      return { ok: true, json: async () => ({ data: structuredClone(stored) }) };
    },
  };
  const render = () => {
    let renders = 0;
    do {
      assert.ok(renders++ < 10, "Task binding effects did not settle");
      dirty = false; cursor = 0;
      activeTask = vm.runInNewContext(bindingCode, {
        ...workbench, isTaskReviewable, workCaseForTask, ...state, ...hooks,
        tasks: state.education.tasks, AbortController, DOMException,
      });
      const pending = pendingEffects.splice(0);
      for (const { index } of pending) effects[index]?.cleanup?.();
      for (const { index, callback, deps } of pending) effects[index] = { deps, cleanup: callback() };
    } while (dirty);
  };
  return {
    requests, errors, stored, update, render,
    get activeTask() { return activeTask; },
    async settle() { render(); await new Promise(resolve => setImmediate(resolve)); render(); },
  };
}

for (const view of ["tasks", "review"]) {
  test(`${view} fork retains the explicit task and binds only that task to the child`, async () => {
    const stage = view === "review" ? "review" : "run";
    const params = forkRoute(`edupi=1&module=tasks&view=${view}&task=${taskB.id}&stage=${stage}&session=parent-b`);
    assert.equal(params.get("task"), taskB.id);
    assert.equal(params.get("module"), "tasks");
    assert.equal(params.get("view"), view);
    assert.equal(params.get("stage"), stage);
    assert.equal(params.get("session"), "child-b");
    const component = bindingHarness({ activeView: view, routeView: view, requestedTaskKey: params.get("task"), selectedTaskKey: params.get("task") });
    await component.settle();
    assert.equal(component.activeTask.id, taskB.id);
    assert.deepEqual(component.requests, [{ taskId: taskB.id, method: "PUT", sessionId: "child-b" }]);
    assert.equal(component.stored.taskSessions[taskA.id].sessionId, "parent-a");
    assert.equal(component.stored.taskSessions[taskB.id].sessionId, "child-b");
    await component.settle();
    assert.equal(component.requests.length, 1, "A refreshed binding must not be written again");
    assert.deepEqual(component.errors, []);
  });
}

test("ordinary and reminder chat forks clear task and reminder route context", () => {
  for (const [query, education] of [
    ["session=parent-b&task=stale-task&reminders=1", false],
    ["edupi=1&module=home&view=chat&session=parent-b", true],
    [`edupi=1&module=home&view=chat&task=${taskB.id}&session=parent-b&reminders=1`, true],
  ]) {
    const params = forkRoute(query, education);
    assert.equal(params.get("session"), "child-b");
    assert.equal(params.get("task"), null);
    assert.equal(params.get("reminders"), null);
  }
});

test("a task view without an explicit task does not invent one on fork", () => {
  const params = forkRoute("edupi=1&module=tasks&view=tasks&stage=run&session=parent-b");
  assert.equal(params.get("task"), null);
});

for (const [name, overrides] of [
  ["missing task route", { requestedTaskKey: null, selectedTaskKey: null }],
  ["unknown task route", { requestedTaskKey: "missing-task", selectedTaskKey: "missing-task" }],
  ["another selected task", { requestedTaskKey: taskA.id, selectedTaskKey: taskA.id }],
  ["generic agent drawer", { agentTask: null }],
  ["closed drawer", { drawer: null }],
  ["file drawer", { drawer: "file" }],
  ["chat route before the view state catches up", { routeView: "chat" }],
]) {
  test(`${name} cannot rebind either task`, async () => {
    const component = bindingHarness(overrides);
    await component.settle();
    assert.deepEqual(component.requests, []);
    assert.equal(component.stored.taskSessions[taskA.id].sessionId, "parent-a");
    assert.equal(component.stored.taskSessions[taskB.id].sessionId, "parent-b");
  });
}

test("the drawer's explicit task wins while the display selection catches up", async () => {
  const component = bindingHarness({ selectedTaskKey: null });
  await component.settle();
  assert.equal(component.activeTask.id, taskA.id, "The presentation may still show its fallback");
  assert.deepEqual(component.requests, [{ taskId: taskB.id, method: "PUT", sessionId: "child-b" }]);
  assert.equal(component.stored.taskSessions[taskA.id].sessionId, "parent-a");
});

test("opening a new task session still binds after its first session is created", async () => {
  const component = bindingHarness({
    activeAgentSessionId: "unrelated-chat",
    pendingTaskBinding: { taskId: taskB.id, previousSessionId: "unrelated-chat" },
    education: { tasks: [taskA, taskB], taskSessions: { [taskA.id]: { sessionId: "parent-a" } } },
  });
  await component.settle();
  assert.deepEqual(component.requests, []);
  component.update({ activeAgentSessionId: "new-task-session" });
  await component.settle();
  assert.deepEqual(component.requests, [{ taskId: taskB.id, method: "PUT", sessionId: "new-task-session" }]);
  assert.equal(component.stored.taskSessions[taskA.id].sessionId, "parent-a");
  assert.equal(component.stored.taskSessions[taskB.id].sessionId, "new-task-session");
});
