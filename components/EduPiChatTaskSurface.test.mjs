import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const panel = await readFile(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url);
const { taskPreparedArtifacts } = await jiti.import("../lib/edupi-task-artifacts.ts");
const { workCaseForTask } = await jiti.import("../lib/edupi-work-case.ts");
const compile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const section = (source, start, end) => { const from = source.indexOf(start), to = source.indexOf(end, from); assert.ok(from >= 0 && to > from); return source.slice(from, to); };
const task = id => ({ id, title: id, status: "planned", contentStatus: "not_generated", deliverables: [] });

test("chat metadata follows the saved session binding, never the first selected task", () => {
  const tasks = [task("first"), task("second")], opened = [];
  const education = { workspace: "/workspace", taskSessions: { second: { sessionId: "session-b" } }, generatedArtifacts: [], workCases: [] };
  const code = compile(section(panel, "  const sessionTask =", "  const dockedDetails =") + "\nglobalThis.info = chatTaskInfo;");
  const evaluate = overrides => { const context = { tasks, education, activeAgentSessionId: "session-b", drawer: null, currentAgentTask: null, loadError: null, workCaseForTask, taskPreparedArtifacts, openTaskDetail: (...args) => opened.push(args), ...overrides }; vm.runInNewContext(code, context); return context.info; };
  const info = evaluate({});
  assert.equal(info.task.id, "second");
  info.onOpen();
  assert.equal(opened[0][0], tasks[1]);
  assert.equal(opened[0][1], true);
  assert.equal(evaluate({ activeAgentSessionId: "unbound" }), null);
  assert.equal(evaluate({ drawer: "agent", currentAgentTask: tasks[0] }), null);
  assert.equal(evaluate({ loadError: "unavailable" }).unavailable, true);
});

test("opening task details preserves the chat session while leaving the task execution route", () => {
  let location, view;
  const code = compile(section(panel, "  const updateTaskDetailLocation =", "  useEffect(() => {\n    if (drawer ===") + "\nglobalThis.open = updateTaskDetailLocation;");
  const context = { URLSearchParams, useCallback: fn => fn, searchParams: new URLSearchParams("edupi=1&view=tasks&task=second&session=session-b&stage=run&q=原任务筛选"), queryRef: { current: "原任务筛选" }, setQuery() {}, setActiveView: value => { view = value; }, setInspectorOpen() {}, router: { replace: url => { location = new URL(url, "http://localhost"); } } };
  vm.runInNewContext(code, context);
  context.open("second", true);
  assert.equal(view, "chat");
  assert.equal(location.searchParams.get("session"), "session-b");
  assert.equal(location.searchParams.get("taskDetail"), "second");
  assert.equal(location.searchParams.get("task"), null);
  assert.equal(location.searchParams.get("stage"), null);
  assert.equal(location.searchParams.get("q"), null);
});

test("choosing another chat removes the previous task details route", () => {
  let location;
  const navigation = [];
  const names = ["setPendingEduPiContext", "setPendingTeacherDraft", "setNewSessionCwd", "setSelectedSession", "setBranchTree", "setBranchActiveLeafId", "setSystemPrompt", "setSessionStats", "setContextUsage", "setActiveTopPanel", "setTopMoreOpen", "setInitialSessionRestored"];
  const context = { ...Object.fromEntries(names.map(name => [name, () => {}])), URLSearchParams, Event, window: { dispatchEvent: event => navigation.push(event.type) }, useCallback: fn => fn, branchLeafChangeFnRef: {}, suppressCwdBumpRef: {}, searchParams: new URLSearchParams("edupi=1&view=chat&session=old&taskDetail=first"), router: { replace: url => { location = new URL(url, "http://localhost"); } } };
  vm.runInNewContext(compile(section(shell, "  const handleEducationSelectSession =", "  const handleNewSession =") + "\nglobalThis.select = handleEducationSelectSession;"), context);
  context.select({ id: "new" });
  assert.equal(location.searchParams.get("session"), "new");
  assert.equal(location.searchParams.get("taskDetail"), null);
  assert.deepEqual(navigation, ["edupi-session-navigated"]);
});
