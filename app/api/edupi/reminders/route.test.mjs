import assert from "node:assert/strict";
import { createJiti } from "jiti";
import test from "node:test";

const { validReminderAction, shouldSyncReminderAttention } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-reminder-action.ts");

test("notification outcomes require an exact bounded claim timestamp", () => {
  const delivered = { id: "reminder-one", type: "notification_delivered", attemptedAt: "2026-09-26T00:00:00.000Z" };
  assert.equal(validReminderAction(delivered), true);
  assert.equal(validReminderAction({ ...delivered, attemptedAt: undefined }), false);
  assert.equal(validReminderAction({ ...delivered, attemptedAt: "bad" }), false);
  assert.equal(validReminderAction({ ...delivered, id: "*" }), false);
  assert.equal(validReminderAction({ ...delivered, type: "notification_failed" }), true);
  assert.equal(validReminderAction({ id: "*", type: "notification_opened", taskId: "task-one" }), true);
  assert.equal(validReminderAction({ id: "reminder-one", type: "read" }), true);
});

test("duplicate native outcomes cannot write a second Core attention transition", () => {
  assert.equal(shouldSyncReminderAttention({ id: "r1", type: "notification_failed", attemptedAt: "2026-09-26T00:00:00Z" }, false), false);
  assert.equal(shouldSyncReminderAttention({ id: "r1", type: "notification_failed", attemptedAt: "2026-09-26T00:00:00Z" }, true), true);
  assert.equal(shouldSyncReminderAttention({ id: "*", type: "claim_notifications" }, false), true);
  assert.equal(shouldSyncReminderAttention(undefined, false), false);
});
