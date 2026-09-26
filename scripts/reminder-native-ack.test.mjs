import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Windows notification command waits for Toast.show outcome before acknowledging delivery", async () => {
  const source = await readFile("src-tauri/src/reminder_notification.rs", "utf8");
  const command = source.slice(source.indexOf("pub fn send_reminder_notification("), source.indexOf("#[cfg(test)]", source.indexOf("pub fn send_reminder_notification(")));
  assert.match(command, /#\[cfg\(target_os = "windows"\)\][\s\S]*?receiver\s*\.recv_timeout/u);
  assert.match(command, /sender\.send\(result\)/u);
  assert.match(command, /#\[cfg\(target_os = "linux"\)\]/u);
});

test("native reminder clicks can be drained by the trusted main WebView after cold start", async () => {
  const rust = await readFile("src-tauri/src/reminder_notification.rs", "utf8");
  const library = await readFile("src-tauri/src/lib.rs", "utf8");
  const permissions = await readFile("src-tauri/permissions/desktop-shell.toml", "utf8");
  const capability = await readFile("src-tauri/capabilities/desktop-dialog.json", "utf8");
  assert.match(rust, /pub fn take_pending_reminder_open\(\)/u);
  assert.match(rust, /set_persisted_target_user_info/u);
  assert.match(library, /reminder_notification::take_pending_reminder_open/u);
  assert.match(permissions, /commands\.allow = \["take_pending_reminder_open"\]/u);
  assert.match(capability, /"allow-take-pending-reminder-open"/u);
});
