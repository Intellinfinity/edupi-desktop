import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the explicit notification test exercises the reminder click callback", async () => {
  const source = await readFile(new URL("./desktop-notify.ts", import.meta.url), "utf8");
  const testSource = source.slice(source.indexOf("export async function testDesktopNotification"));
  assert.match(testSource, /sendReminderNotificationNative/);
  assert.match(testSource, /body: "点击后打开提醒"/);
  assert.match(testSource, /target: null/);
  assert.match(testSource, /id: "notification-test"/);
  assert.doesNotMatch(testSource, /sendNotification/);
});
