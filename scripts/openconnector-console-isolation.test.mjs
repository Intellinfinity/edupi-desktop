import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("the separate OpenConnector window inherits no main-window Tauri capability", async () => {
  const capabilities = ["desktop-dialog.json", "desktop-updater.json", "window-controls.json"];
  for (const file of capabilities) {
    const value = JSON.parse(await readFile(path.resolve("src-tauri/capabilities", file), "utf8"));
    assert.deepEqual(value.windows, ["main"], file);
    assert.equal(value.webviews?.some((label) => label.includes("openconnector")) || false, false, file);
  }
  const shell = await readFile(path.resolve("src-tauri/src/lib.rs"), "utf8");
  assert.match(shell, /OPENCONNECTOR_WINDOW_LABEL: &str = "openconnector-console"/u);
  assert.match(shell, /WebviewWindowBuilder::new\(&app, &label/u);
  assert.match(shell, /let label = format!\("\{OPENCONNECTOR_WINDOW_LABEL\}-\{port\}"\)/u);
  assert.match(shell, /if same_origin\(target, &navigation_origin\)/u);
  assert.match(shell, /show_openconnector_console,/u);
});

test("Console host has no credential store outside its temporary root and blocks every runtime Action", async () => {
  const host = await readFile(path.resolve("desktop/open-connector-console-host.mjs"), "utf8");
  assert.match(host, /mkdtemp\(join\(tmpdir\(\), "edupi-openconnector-console-"\)\)/u);
  assert.match(host, /blockedActions: \["\*"\], blockedProxies: \["\*"\]/u);
  assert.match(host, /request.method !== "GET"/u);
  assert.doesNotMatch(host, /adminToken:|runtimeToken:|encryptionKey:/u);
});
