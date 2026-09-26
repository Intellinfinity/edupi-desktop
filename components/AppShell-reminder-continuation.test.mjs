import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("native notification click enters the existing reminder chat flow, not a task-only page", async () => {
  const source = await readFile("components/AppShell.tsx", "utf8");
  const start = source.indexOf("const openReminderNotification = useCallback(");
  const end = source.indexOf("useEduPiReminderNotifications(openReminderNotification);", start);
  assert.ok(start > 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /continueReminder\(taskId\)/u);
  assert.doesNotMatch(handler, /handleEduPiAppAction\(/u);
  assert.match(handler, /catch\(inbox\)/u);
});
