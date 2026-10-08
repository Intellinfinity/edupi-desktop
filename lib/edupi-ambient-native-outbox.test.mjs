import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("native outbox commands are capability-scoped to the trusted desktop window", async () => {
  const [rust, shell, permissions, capability, client] = await Promise.all([
    readFile(new URL("../src-tauri/src/ambient_capture_outbox.rs", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/permissions/desktop-shell.toml", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/capabilities/desktop-dialog.json", import.meta.url), "utf8"),
    readFile(new URL("./desktop-native.ts", import.meta.url), "utf8"),
  ]);
  for (const command of ["get_ambient_capture_outbox", "remember_ambient_capture", "clear_ambient_capture"]) {
    assert.match(rust, new RegExp(`fn ${command}`));
    assert.match(shell, new RegExp(`ambient_capture_outbox::${command}`));
    assert.match(permissions, new RegExp(`"${command}"`));
    assert.match(client, new RegExp(`"${command}"`));
  }
  assert.match(capability, /"allow-ambient-capture-outbox"/);
  assert.match(capability, /"windows": \["main"\]/);
  assert.match(rust, /foreground_prefs::settings_path/);
  assert.match(rust, /create_new\(true\)/);
});
