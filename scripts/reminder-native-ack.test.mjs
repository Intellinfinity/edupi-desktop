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
