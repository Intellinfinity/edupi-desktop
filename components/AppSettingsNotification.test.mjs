import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop settings tell the user how to verify notification navigation", async () => {
  const source = await readFile(new URL("./AppSettings.tsx", import.meta.url), "utf8");
  assert.match(source, /测试通知跳转/);
  assert.match(source, /系统已接受通知；点击通知应打开提醒/);
  assert.match(source, /await testDesktopNotification\(\)/);
  assert.match(source, /getNotificationPermissionStatusNative/);
  assert.match(source, /notificationStatusLabel/);
  assert.match(source, /系统通知/);
  assert.match(source, /await refreshNotificationStatus\(\)/);
});
