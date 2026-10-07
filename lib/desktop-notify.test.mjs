import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import { createRequire } from "node:module";
import ts from "typescript";

const { isDeferredReminderNotificationError } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./desktop-native.ts");
const require = createRequire(import.meta.url);
const compiledNotify = ts.transpileModule(await readFile(new URL("./desktop-notify.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function waitingNotificationFixture() {
  let completePermission;
  let requestedPermission;
  const permissionRequested = new Promise(resolve => { requestedPermission = resolve; });
  let reminderSends = 0, ordinarySends = 0, enabled = true, focused = false;
  const dependencies = {
    "@/lib/desktop-updater": { isTauriDesktop: () => true },
    "@/lib/app-prefs": { APP_PREF_KEYS: {}, getPrefBool: () => enabled },
    "@/lib/desktop-native": { isDeferredReminderNotificationError, sendReminderNotificationNative: async () => { reminderSends += 1; } },
    "@tauri-apps/api/window": { getCurrentWindow: () => ({ isFocused: async () => focused }) },
    "@tauri-apps/plugin-notification": { isPermissionGranted: async () => false, requestPermission: () => {
      requestedPermission(); return new Promise(resolve => { completePermission = resolve; });
    }, sendNotification: () => { ordinarySends += 1; } },
  };
  const notifyModule = { exports: {} };
  new Function("require", "module", "exports", compiledNotify)(name => dependencies[name] || require(name), notifyModule, notifyModule.exports);
  return { notify: notifyModule.exports.notifyDesktop, permissionRequested, completePermission: value => completePermission(value), reminderSends: () => reminderSends, ordinarySends: () => ordinarySends, setEnabled: value => { enabled = value; }, setFocused: value => { focused = value; } };
}

test("a reminder invalidated while native permission waits is cancelled without invoking send", async () => {
  const fixture = waitingNotificationFixture();
  let current = true;
  const pending = fixture.notify({ title: "EduPi 提醒", body: "合成旧事务", reminder: { target: null, claims: [{ id: "synthetic-reminder", attemptedAt: "2026-10-08T00:00:00.000Z" }] }, isCurrent: () => current });
  await fixture.permissionRequested;
  current = false;
  fixture.completePermission("granted");
  assert.equal(await pending, "cancelled");
  assert.equal(fixture.reminderSends(), 0);
});

test("turning off notifications during native permission wait releases the reminder claim", async () => {
  const fixture = waitingNotificationFixture();
  const pending = fixture.notify({ title: "EduPi 提醒", body: "合成事务", reminder: { target: null, claims: [{ id: "synthetic-reminder", attemptedAt: "2026-10-08T00:00:00.000Z" }] } });
  await fixture.permissionRequested;
  fixture.setEnabled(false);
  fixture.completePermission("granted");
  assert.equal(await pending, "cancelled");
  assert.equal(fixture.reminderSends(), 0);
});

test("a window refocused during permission wait does not send a reminder", async () => {
  const fixture = waitingNotificationFixture();
  const pending = fixture.notify({ title: "EduPi 提醒", body: "合成事务", reminder: { target: null, claims: [{ id: "synthetic-reminder", attemptedAt: "2026-10-08T00:00:00.000Z" }] } });
  await fixture.permissionRequested;
  fixture.setFocused(true);
  fixture.completePermission("granted");
  assert.equal(await pending, "cancelled");
  assert.equal(fixture.reminderSends(), 0);
});

test("non-transaction completion notifications are not vetoed by the teacher reminder predicate", async () => {
  const fixture = waitingNotificationFixture();
  const pending = fixture.notify({ title: "合成协作完成", body: "合成回复", isCurrent: () => false });
  await fixture.permissionRequested;
  fixture.completePermission("granted");
  assert.equal(await pending, "attempted");
  assert.equal(fixture.ordinarySends(), 1);
});

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
