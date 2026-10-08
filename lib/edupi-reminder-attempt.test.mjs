import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { notificationSendNeedsReview, NOTIFICATION_CLAIM_LEASE_MS } = await createJiti(import.meta.url).import("./edupi-reminder-attempt.ts");
const at = Date.parse("2026-10-08T00:00:00Z");

test("only a matured uncertain native attempt offers explicit rearm", () => {
  const base = { notificationAttemptedAt: new Date(at).toISOString(), read: false, handled: false, withdrawn: false };
  assert.equal(notificationSendNeedsReview({ ...base, notificationSendState: "claimed" }, at + NOTIFICATION_CLAIM_LEASE_MS + 1), false);
  assert.equal(notificationSendNeedsReview({ ...base, notificationSendState: "send_started" }, at + NOTIFICATION_CLAIM_LEASE_MS - 1), false);
  for (const state of ["send_started", "unknown", undefined]) {
    assert.equal(notificationSendNeedsReview({ ...base, notificationSendState: state }, at + NOTIFICATION_CLAIM_LEASE_MS), true);
  }
  assert.equal(notificationSendNeedsReview({ ...base, notificationSendState: "unknown", notificationDeliveredAt: new Date(at + 1).toISOString() }, at + NOTIFICATION_CLAIM_LEASE_MS), false);
  assert.equal(notificationSendNeedsReview({ ...base, notificationSendState: "unknown", handled: true }, at + NOTIFICATION_CLAIM_LEASE_MS), false);
  assert.equal(notificationSendNeedsReview({ ...base, notificationSendState: "send_started",
    notificationSendStartedAt: new Date(at + NOTIFICATION_CLAIM_LEASE_MS - 1).toISOString() }, at + NOTIFICATION_CLAIM_LEASE_MS), false);
});
