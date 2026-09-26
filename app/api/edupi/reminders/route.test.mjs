import assert from "node:assert/strict";
import { createJiti } from "jiti";
import test from "node:test";

const { validReminderAction } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-reminder-action.ts");

test("notification outcomes require an exact bounded claim timestamp", () => {
  const delivered = { id: "reminder-one", type: "notification_delivered", attemptedAt: "2026-09-26T00:00:00.000Z" };
  assert.equal(validReminderAction(delivered), true);
  assert.equal(validReminderAction({ ...delivered, attemptedAt: undefined }), false);
  assert.equal(validReminderAction({ ...delivered, attemptedAt: "bad" }), false);
  assert.equal(validReminderAction({ ...delivered, id: "*" }), false);
  assert.equal(validReminderAction({ ...delivered, type: "notification_failed" }), true);
  assert.equal(validReminderAction({ ...delivered, type: "notification_deferred" }), true);
  assert.equal(validReminderAction({ ...delivered, type: "notification_deferred", attemptedAt: undefined }), false);
  assert.equal(validReminderAction({ id: "*", type: "notification_opened", taskId: "task-one" }), false);
  assert.equal(validReminderAction({ id: "reminder-one", type: "notification_opened", taskId: "task-one" }), true);
  assert.equal(validReminderAction({ id: "reminder-one", type: "read" }), true);
});
