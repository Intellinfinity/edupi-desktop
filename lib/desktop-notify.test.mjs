import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { isDeferredReminderNotificationError } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./desktop-native.ts");

test("the explicit notification test exercises the reminder click callback", async () => {
  const source = await readFile(new URL("./desktop-notify.ts", import.meta.url), "utf8");
  const testSource = source.slice(source.indexOf("export async function testDesktopNotification"));
  assert.match(testSource, /sendReminderNotificationNative/);
  assert.match(testSource, /body: "点击后打开提醒"/);
  assert.match(testSource, /target: null/);
  assert.match(testSource, /id: "notification-test"/);
  assert.doesNotMatch(testSource, /sendNotification/);
});

test("native permission failures surface a teacher-readable action", async () => {
  const source = await readFile(new URL("./desktop-native.ts", import.meta.url), "utf8");
  const functionSource = source.slice(source.indexOf("export async function sendReminderNotificationNative"));
  assert.match(functionSource, /notification_permission_denied/);
  assert.match(functionSource, /通知权限未开启，请在系统设置中允许 EduPi 通知/);
  assert.match(functionSource, /notification_permission_timeout/);
  assert.match(functionSource, /notification_failed/);
  assert.match(functionSource, /通知发送失败，请检查系统通知设置/);
  assert.match(functionSource, /notification_busy/);
});

test("native authorization and busy errors defer without consuming the OS send failure budget", async () => {
  for (const code of ["notification_permission_denied", "notification_permission_timeout",
    "notification_permission_unavailable", "notification_busy"]) {
    assert.equal(isDeferredReminderNotificationError({ code }), true);
  }
  assert.equal(isDeferredReminderNotificationError({ code: "notification_failed" }), false);
  assert.equal(isDeferredReminderNotificationError(new Error("通知权限未开启")), false, "classification must not depend on translated prose");
  const source = await readFile(new URL("./desktop-notify.ts", import.meta.url), "utf8");
  assert.match(source, /isDeferredReminderNotificationError\(error\)\) return "skipped"/u);
});
