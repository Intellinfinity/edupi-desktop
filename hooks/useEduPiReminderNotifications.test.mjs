import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const source = await readFile(new URL("./useEduPiReminderNotifications.ts", import.meta.url), "utf8");
const { authorizedReminderNotifications } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./useEduPiReminderNotifications.ts");

test("notification lifecycle records delivery, failure, and opened targets", () => {
  assert.match(source, /notification_delivered[\s\S]*notification_failed/);
  assert.match(source, /notification_opened/);
  assert.match(source, /id: "\*"/);
  assert.match(source, /taskId: target\.taskId/);
});

test("native send requires the current server authorization list, not just a claimed notification", () => {
  const claimed = [{ id: "current-l4", taskId: "task-1" }, { id: "stale-l4", taskId: "task-2" }, { id: "legacy", taskId: "task-3" }];
  assert.deepEqual(authorizedReminderNotifications({ notifications: claimed, nativeNotificationIds: ["current-l4", "legacy"] }).map((item) => item.id), ["current-l4", "legacy"]);
  assert.deepEqual(authorizedReminderNotifications({ notifications: claimed }).map((item) => item.id), []);
  assert.match(source, /authorizedReminderNotifications\(result\)/);
});
