import type { Reminder } from "./edupi-reminder-store";

export const NOTIFICATION_CLAIM_LEASE_MS = 2 * 60_000;

export function notificationRearmAt(item: Pick<Reminder, "notificationAttemptedAt" | "notificationSendStartedAt">): number {
  const attempted = Date.parse(item.notificationAttemptedAt || "");
  const started = Date.parse(item.notificationSendStartedAt || "");
  return Number.isFinite(attempted) ? Math.max(attempted, Number.isFinite(started) ? started : attempted) + NOTIFICATION_CLAIM_LEASE_MS : Infinity;
}

/** A native send may already have happened, so only the teacher may rearm it. */
export function notificationSendNeedsReview(item: Reminder, now = Date.now()): boolean {
  return Boolean(item.notificationAttemptedAt && !item.notificationDeliveredAt && !item.notificationOpenedAt
    && !item.withdrawn && !item.handled
    && (item.notificationSendState === "send_started" || item.notificationSendState === "unknown" || !item.notificationSendState)
    && now >= notificationRearmAt(item));
}
