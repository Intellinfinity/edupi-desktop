import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";

const root = realpathSync(mkdtempSync(join(tmpdir(), "edupi-session-tools-")));
const agentDir = join(root, "agent");
const project = join(root, "project");
const core = join(root, "empty-core");
const marker = join(root, "extension-loaded");
for (const directory of [project, join(agentDir, "extensions"), join(core, "contracts")]) mkdirSync(directory, { recursive: true });
writeFileSync(join(core, "contracts/edupi-desktop-component-manifest.json"), JSON.stringify({ modules: [], assets: [] }));
writeFileSync(join(agentDir, "extensions/probe.js"), `import { appendFileSync } from 'node:fs'; export default () => appendFileSync(${JSON.stringify(marker)}, 'loaded');`);
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultTools: ["read", "bash"], compaction: { enabled: false }, retry: { enabled: false } }));
const originalSettings = readFileSync(join(agentDir, "settings.json"));
const environment = { PI_CODING_AGENT_DIR: agentDir, EDUPI_CORE_ROOT: core, EDUPI_PROJECT_ROOT: join(root, "teacher"),
  EDUPI_DATA_ROOT: join(root, "teacher"), EDUPI_DATA_ALLOWED_ROOT: root, EDUPI_CORE_ALLOWED_ROOT: root,
  PI_DESKTOP_STATE_DIR: join(root, "state") };
const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
Object.assign(process.env, environment);
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { startRpcSession, getRpcSession } = await jiti.import("./rpc-manager.ts");
const { readSessionToolNames, saveSessionToolNames } = await jiti.import("./session-tool-preferences.ts");
after(async () => {
  for (const session of globalThis.__piSessions?.values() ?? []) await session.shutdown();
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(root, { recursive: true, force: true });
});

test("an explicit empty tool selection survives cold startup before extension loading", async () => {
  const created = await startRpcSession("tools-empty", "", project, { toolNames: [] });
  await created.session.waitUntilReady();
  const file = created.session.sessionFile;
  assert.equal(existsSync(file), true, "a setup-only explicit preference is persisted");
  assert.deepEqual(readSessionToolNames(SessionManager.open(file)), []);
  assert.equal(existsSync(marker), false);
  await created.session.shutdown();
  const resumed = await startRpcSession(created.realSessionId, file, undefined);
  try {
    await resumed.session.waitUntilReady();
    assert.deepEqual(resumed.session.inner.getActiveToolNames(), []);
    assert.deepEqual(resumed.session.inner.resourceLoader.getSkills().skills, []);
    assert.equal((await resumed.session.send({ type: "get_state" })).systemPrompt, "");
    assert.equal(existsSync(marker), false);
    assert.deepEqual(readFileSync(join(agentDir, "settings.json")), originalSettings);
  } finally { await resumed.session.shutdown(); }
});

test("set_tools persists each explicit choice without changing global defaults", async () => {
  const created = await startRpcSession("tools-change", "", project, { toolNames: [] });
  await created.session.waitUntilReady();
  await created.session.send({ type: "set_tools", toolNames: ["read"] });
  assert.deepEqual(readSessionToolNames(SessionManager.open(created.session.sessionFile)), ["read"]);
  await created.session.shutdown();
  const resumed = await startRpcSession(created.realSessionId, created.session.sessionFile, undefined);
  await resumed.session.waitUntilReady();
  assert.deepEqual(resumed.session.inner.getActiveToolNames(), ["read"]);
  await resumed.session.send({ type: "set_tools", toolNames: [] });
  const before = readFileSync(marker, "utf8");
  await resumed.session.shutdown();
  const closedTools = await startRpcSession(created.realSessionId, created.session.sessionFile, undefined);
  try {
    await closedTools.session.waitUntilReady();
    assert.deepEqual(closedTools.session.inner.getActiveToolNames(), []);
    assert.equal(readFileSync(marker, "utf8"), before, "cold startup never evaluates a third-party extension");
    assert.deepEqual(readFileSync(join(agentDir, "settings.json")), originalSettings);
  } finally { await closedTools.session.shutdown(); }
});

test("fork before the first message inherits the effective disabled selection", async () => {
  const created = await startRpcSession("tools-fork", "", project, { toolNames: ["read"] });
  await created.session.waitUntilReady();
  const manager = created.session.inner.sessionManager;
  const firstId = manager.appendMessage({ role: "user", content: [{ type: "text", text: "Synthetic question" }], timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage("Synthetic response"));
  await created.session.send({ type: "set_tools", toolNames: [] });
  const before = readFileSync(marker, "utf8");
  const forked = await created.session.send({ type: "fork", entryId: firstId });
  assert.equal(getRpcSession(created.realSessionId), undefined);
  const forkFile = created.session.sessionFile;
  assert.deepEqual(readSessionToolNames(SessionManager.open(forkFile)), []);
  const resumed = await startRpcSession(forked.newSessionId, forkFile, undefined);
  try {
    await resumed.session.waitUntilReady();
    assert.deepEqual(resumed.session.inner.getActiveToolNames(), []);
    assert.equal(readFileSync(marker, "utf8"), before);
    assert.equal(SessionManager.open(manager.getSessionFile()).buildSessionContext().messages.filter(message => message.role === "user").length, 1);
  } finally { await resumed.session.shutdown(); }
});

test("failed preference persistence stops the wrapper and preserves prior history", async () => {
  const created = await startRpcSession("tools-fail", "", project, { toolNames: ["read"] });
  await created.session.waitUntilReady();
  const file = created.session.sessionFile;
  const before = readFileSync(file);
  created.session.inner.sessionManager.appendCustomEntry = () => { throw new Error("disk unavailable"); };
  await assert.rejects(created.session.send({ type: "set_tools", toolNames: [] }), /工具设置未保存/);
  assert.equal(created.session.isAlive(), false);
  assert.equal(getRpcSession(created.realSessionId), undefined);
  assert.deepEqual(readFileSync(file), before);
});

test("invalid stored preferences fail closed and tree navigation cannot restore older tools", async () => {
  const manager = SessionManager.create(project, join(root, "manual-sessions"));
  const beforeChoice = manager.appendMessage({ role: "user", content: [{ type: "text", text: "Synthetic history" }], timestamp: Date.now() });
  saveSessionToolNames(manager, ["read"]);
  saveSessionToolNames(manager, []);
  manager.branch(beforeChoice);
  assert.deepEqual(readSessionToolNames(manager), []);
  manager.appendCustomEntry("edupi.desktop.tool-names.v1", { toolNames: "invalid" });
  const before = readFileSync(marker, "utf8");
  await assert.rejects(startRpcSession(manager.getSessionId(), manager.getSessionFile(), undefined), /Invalid session tool preferences/);
  assert.equal(readFileSync(marker, "utf8"), before);
});

for (const entrypoint of ["rpc", "extension"]) for (const selected of [[], ["read"]]) {
  test(`${entrypoint} tree navigation preserves the current ${selected.length ? "restricted" : "disabled"} tools`, async () => {
    const created = await startRpcSession(`navigate-${entrypoint}-${selected.length}`, "", project, { toolNames: ["read", "bash"] });
    const wrapper = created.session;
    try {
      await wrapper.waitUntilReady();
      const manager = wrapper.inner.sessionManager;
      manager.appendMessage({ role: "system", content: "Synthetic old branch", timestamp: Date.now(),
        toolsAdded: wrapper.inner.agent.state.tools.map(({ name, description, parameters }) => ({ name, description, parameters })) });
      manager.appendMessage({ role: "user", content: "First synthetic turn", timestamp: Date.now() });
      const first = manager.appendMessage(fauxAssistantMessage("First response"));
      manager.appendMessage({ role: "user", content: "Second synthetic turn", timestamp: Date.now() });
      const second = manager.appendMessage(fauxAssistantMessage("Second response"));
      await wrapper.send({ type: "set_tools", toolNames: selected });
      const before = readFileSync(marker, "utf8");
      // Control: this real SDK call restores the old transcript's wider loadout.
      await wrapper.inner.navigateTree(second, {});
      assert.ok(wrapper.inner.getActiveToolNames().includes("bash"));
      const result = entrypoint === "rpc"
        ? await wrapper.send({ type: "navigate_tree", targetId: first })
        : await wrapper.createExtensionCommandContextActions().navigateTree(first, { summarize: false });
      assert.equal(result.cancelled, false);
      assert.deepEqual((await wrapper.send({ type: "get_tools" })).filter(tool => tool.active).map(tool => tool.name), selected);
      assert.equal(readFileSync(marker, "utf8"), before, "navigation never reloads third-party resources");
      if (selected.length === 0) {
        assert.deepEqual((await wrapper.send({ type: "get_commands" })).commands, []);
        assert.equal((await wrapper.send({ type: "get_state" })).systemPrompt, "");
      }
    } finally { await wrapper.shutdown(); }
  });
}

for (const entrypoint of ["rpc", "extension"]) {
  test(`${entrypoint} navigation keeps a tool shutdown made while navigation was pending`, async () => {
    const created = await startRpcSession(`navigate-late-${entrypoint}`, "", project, { toolNames: ["read", "bash"] });
    const wrapper = created.session;
    let release;
    let pending;
    try {
      await wrapper.waitUntilReady();
      const manager = wrapper.inner.sessionManager;
      manager.appendMessage({ role: "system", content: "Synthetic old branch", timestamp: Date.now(),
        toolsAdded: wrapper.inner.agent.state.tools.map(({ name, description, parameters }) => ({ name, description, parameters })) });
      manager.appendMessage({ role: "user", content: "Synthetic turn", timestamp: Date.now() });
      const targetId = manager.appendMessage(fauxAssistantMessage("Synthetic response"));
      await wrapper.send({ type: "set_tools", toolNames: ["read"] });
      const gate = new Promise(resolve => { release = resolve; });
      const navigate = wrapper.inner.navigateTree.bind(wrapper.inner);
      wrapper.inner.navigateTree = async (...args) => { await gate; return navigate(...args); };
      pending = entrypoint === "rpc"
        ? wrapper.send({ type: "navigate_tree", targetId })
        : wrapper.createExtensionCommandContextActions().navigateTree(targetId, { summarize: false });
      await wrapper.send({ type: "set_tools", toolNames: [] });
      const before = readFileSync(marker, "utf8");
      release();
      assert.equal((await pending).cancelled, false);
      assert.deepEqual((await wrapper.send({ type: "get_tools" })).filter(tool => tool.active), []);
      assert.deepEqual(readSessionToolNames(SessionManager.open(wrapper.sessionFile)), []);
      assert.equal(readFileSync(marker, "utf8"), before);
    } finally {
      release?.();
      await pending?.catch(() => {});
      await wrapper.shutdown();
    }
  });
}
