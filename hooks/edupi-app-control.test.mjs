import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the Agent UI channel acknowledges allowlisted EduPi app actions", async () => {
  const hook = await read("./useAgentSession.ts");
  const appShell = await read("../components/AppShell.tsx");
  assert.match(hook, /case "edupi_action"/);
  assert.match(hook, /case "edupi_computer_action"/);
  assert.match(hook, /request\.expiresAt !== undefined && request\.expiresAt < Date\.now\(\)/);
  assert.match(hook, /type: "extension_ui_response"/);
  assert.match(appShell, /handleEduPiAppAction/);
  assert.match(appShell, /handleEduPiComputerAction/);
  assert.match(appShell, /runComputerUseFromAgent/);
  for (const action of ["show_window", "open_settings", "open_context", "close_panel", "set_inspector", "open_task"]) {
    assert.match(appShell, new RegExp(`action\\.action === "${action}"`));
  }
  assert.match(appShell, /moduleFromView\(action\.view\)/);
});

test("global computer use keeps native execution behind opt-in, approval, snapshot, audit, and stop boundaries", async () => {
  const tool = await read("../lib/edupi-computer-tool.ts");
  const contract = await read("../lib/edupi-computer-use.ts");
  const settings = await read("../components/AppSettings.tsx");
  const native = await read("../src-tauri/src/computer_use.rs");
  assert.match(native, /blocking_show/);
  assert.match(tool, /name: "edupi_computer_use"/);
  assert.match(contract, /snapshot_id/);
  assert.match(native, /execution_lock/);
  assert.match(native, /computer-use-audit\.jsonl/);
  assert.match(native, /That desktop snapshot is stale/);
  assert.match(native, /request_expired\(expires_at_ms\)/);
  assert.match(native, /enabled: AtomicBool::new\(false\)/);
  assert.match(settings, /<summary>权限用途<\/summary>/);
  assert.match(settings, /每次操作仍需你确认/);
  assert.match(settings, /emergencyStopComputerUseNative/);
  assert.match(settings, /停止控制/);
});

test("app control never exposes arbitrary selectors, scripts, URLs, review, or external-send actions", async () => {
  const contract = await read("../lib/edupi-desktop-control.ts");
  const tool = await read("../lib/edupi-desktop-tool.ts");
  for (const unsafe of ["selector", "script", "rawUrl", "reviewTask", "externalSend"]) {
    assert.doesNotMatch(`${contract}\n${tool}`, new RegExp(`${unsafe}:`));
  }
});
