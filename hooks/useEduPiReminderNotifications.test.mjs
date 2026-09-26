import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const source = await readFile(new URL("./useEduPiReminderNotifications.ts", import.meta.url), "utf8");
const { authorizedReminderNotifications, reminderOutcomeAction, reminderContinuationTaskId } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./useEduPiReminderNotifications.ts");

test("one notification opens only its exact task continuation", () => {
  assert.equal(reminderContinuationTaskId({ reminderId: "r1", taskId: "task-one", kind: "ready" }), "task-one");
  assert.equal(reminderContinuationTaskId({ reminderId: "r2", taskId: "document:brief-one", kind: "brief" }), "document:brief-one");
  assert.equal(reminderContinuationTaskId(null), null);
  assert.equal(reminderContinuationTaskId({ reminderId: "r3", taskId: "", kind: "ready" }), null);
});

test("native notification outcomes carry the exact Core claim identity", () => {
  const claim = { id: "reminder-one", attemptedAt: "2026-09-26T00:00:00.000Z" };
  assert.deepEqual(reminderOutcomeAction(claim, "notification_failed"), { ...claim, type: "notification_failed" });
  assert.deepEqual(reminderOutcomeAction(claim, "notification_delivered"), { ...claim, type: "notification_delivered" });
});

test("notification lifecycle records delivery, failure, and opened targets", () => {
  assert.match(source, /notification_delivered[\s\S]*notification_failed/);
  assert.match(source, /notification_opened/);
  assert.match(source, /id: target\.reminderId, type: "notification_opened"/u);
  assert.match(source, /taskId: target\.taskId/);
  assert.doesNotMatch(source, /id: "\*", type: "notification_opened"/u);
});

test("native send requires the current server authorization list, not just a claimed notification", () => {
  const claimed = [{ id: "current-l4", taskId: "task-1" }, { id: "stale-l4", taskId: "task-2" }, { id: "legacy", taskId: "task-3" }];
  assert.deepEqual(authorizedReminderNotifications({ notifications: claimed, nativeNotificationIds: ["current-l4", "legacy"] }).map((item) => item.id), ["current-l4", "legacy"]);
  assert.deepEqual(authorizedReminderNotifications({ notifications: claimed }).map((item) => item.id), []);
  assert.match(source, /authorizedReminderNotifications\(result\)/);
});
