"use client";
import { useEffect } from "react";
import { desktopNotificationsEnabled, notifyDesktop } from "@/lib/desktop-notify";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { listenReminderNotificationsNative, type ReminderNotificationTarget, type ReminderNotificationClaim } from "@/lib/desktop-native";
import type { Reminder } from "@/lib/edupi-reminder-store";
import { foregroundNotificationPolicyMatchesNative, readForegroundSettings } from "@/lib/edupi-foreground-settings";
import { shanghaiDate } from "@/lib/edupi-foreground";

export function reminderContinuationTaskId(target: ReminderNotificationTarget | null): string | null {
  if (!target || typeof target.reminderId !== "string" || !target.reminderId || target.reminderId.length > 64
    || typeof target.taskId !== "string" || !target.taskId || target.taskId.length > 500
    || !["ready", "failed", "due", "brief"].includes(target.kind)) return null;
  return target.taskId;
}

export function authorizedReminderNotifications(result: { notifications?: Reminder[]; nativeNotificationIds?: string[] }): Reminder[] {
  const ids = new Set(result.nativeNotificationIds);
  return (result.notifications || []).filter((item) => ids.has(item.id));
}

export function reminderOutcomeType(status: "attempted" | "failed" | "skipped" | "cancelled"): "notification_delivered" | "notification_failed" | "notification_deferred" | "release_notification" {
  return status === "cancelled" ? "release_notification" : status === "attempted" ? "notification_delivered" : status === "skipped" ? "notification_deferred" : "notification_failed";
}

export function reminderOutcomeAction(claim: ReminderNotificationClaim, type: "notification_delivered" | "notification_failed" | "notification_deferred" | "release_notification") {
  return { id: claim.id, attemptedAt: claim.attemptedAt, type };
}

export function useEduPiReminderNotifications(onOpen: (target: ReminderNotificationTarget | null) => void | Promise<void>) {
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let unlisten: (() => void) | undefined;
    let nativeReady = false;
    const updateClaims = async (claims: ReminderNotificationClaim[], type: "notification_delivered" | "notification_failed" | "notification_deferred" | "release_notification") => {
      for (const item of claims) await fetch("/api/edupi/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reminderOutcomeAction(item, type)), signal: type === "release_notification" ? AbortSignal.timeout(5000) : controller.signal });
    };
    const markOpened = async (target: ReminderNotificationTarget | null) => {
      if (!target || !reminderContinuationTaskId(target)) return;
      await fetch("/api/edupi/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: target.reminderId, type: "notification_opened", taskId: target.taskId }) });
    };
    const poll = async () => {
      try {
        const mayNotify = nativeReady && isTauriDesktop() && desktopNotificationsEnabled() && !document.hasFocus();
        const nativePolicyCurrent = mayNotify && await foregroundNotificationPolicyMatchesNative();
        if (controller.signal.aborted) return;
        const notify = nativePolicyCurrent && desktopNotificationsEnabled() && !document.hasFocus();
        const localPolicy = () => { const { graceDays, pinnedTaskIds } = readForegroundSettings(); return JSON.stringify({ today: shanghaiDate(), graceDays, pinnedTaskIds }); };
        const policyAtClaim = localPolicy();
        const response = await fetch("/api/edupi/reminders", {
          // Let a persisted claim return its exact attempt after unmount;
          // aborting here would strand an unknown attempt on the server.
          signal: notify ? undefined : controller.signal,
          ...(notify ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "*", type: "claim_notifications" }) } : {}),
        });
        if (!response.ok) return;
        const result = await response.json();
        const items = authorizedReminderNotifications(result);
        if (controller.signal.aborted) {
          if (items.length) await updateClaims(items.map(item => ({ id: item.id, attemptedAt: item.notificationAttemptedAt! })), "release_notification");
          return;
        }
        if (items.length) {
          const claims = items.map(item => ({ id: item.id, attemptedAt: item.notificationAttemptedAt! }));
          const target = items.length === 1 ? { reminderId: items[0].id, taskId: items[0].taskId, kind: items[0].kind } : null;
          const isCurrent = async () => {
            const localCurrent = () => !controller.signal.aborted && desktopNotificationsEnabled() && !document.hasFocus() && policyAtClaim === localPolicy();
            return localCurrent() && await foregroundNotificationPolicyMatchesNative() && localCurrent();
          };
          if (!await isCurrent()) { await updateClaims(claims, "release_notification"); return; }
          const status = await notifyDesktop({ title: "EduPi 提醒", body: items.length === 1 ? items[0].title : `${items.length} 项待处理`, reminder: { target, claims },
            isCurrent });
          await updateClaims(claims, reminderOutcomeType(status));
        }
      } catch { /* Persistent inbox remains available after network or notification failure. */ }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 30000); }
    };
    void listenReminderNotificationsNative(async (target) => { void markOpened(target).catch(() => {}); await onOpen(target); }, claims => { void updateClaims(claims, "notification_failed").catch(() => {}); }).then(cleanup => {
      if (controller.signal.aborted) { cleanup(); return; }
      unlisten = cleanup; nativeReady = true; void poll();
    }).catch(() => { if (!controller.signal.aborted) void poll(); });
    return () => { controller.abort(); clearTimeout(timer); unlisten?.(); };
  }, [onOpen]);
}
