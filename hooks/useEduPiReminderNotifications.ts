"use client";
import { useEffect } from "react";
import { desktopNotificationsEnabled, notifyDesktop } from "@/lib/desktop-notify";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { listenReminderNotificationsNative, type ReminderNotificationTarget, type ReminderNotificationClaim } from "@/lib/desktop-native";
import type { Reminder } from "@/lib/edupi-reminder-store";
import type { DesktopControlInput } from "@/lib/edupi-desktop-control";

export function reminderNotificationAction(target: ReminderNotificationTarget | null): DesktopControlInput | null {
  if (!target) return null;
  if (target.kind === "brief") return target.taskId.startsWith("document:") ? { action: "open_document", documentId: target.taskId.slice(9) } : null;
  return { action: "open_task", taskId: target.taskId, stage: target.kind === "failed" ? "run" : target.kind === "due" ? "brief" : "artifact" };
}

export function authorizedReminderNotifications(result: { notifications?: Reminder[]; nativeNotificationIds?: string[] }): Reminder[] {
  const ids = new Set(result.nativeNotificationIds);
  return (result.notifications || []).filter((item) => ids.has(item.id));
}

export function useEduPiReminderNotifications(onOpen: (target: ReminderNotificationTarget | null) => void) {
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let unlisten: (() => void) | undefined;
    let nativeReady = false;
    const updateClaims = async (claims: ReminderNotificationClaim[], type: "notification_delivered" | "notification_failed") => {
      for (const item of claims) await fetch("/api/edupi/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, type }), signal: controller.signal });
    };
    const markOpened = async (target: ReminderNotificationTarget | null) => {
      await fetch("/api/edupi/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "*", type: "notification_opened", ...(target?.taskId ? { taskId: target.taskId } : {}) }), signal: controller.signal });
    };
    const poll = async () => {
      try {
        const notify = nativeReady && isTauriDesktop() && desktopNotificationsEnabled() && !document.hasFocus();
        const response = await fetch("/api/edupi/reminders", {
          signal: controller.signal,
          ...(notify ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "*", type: "claim_notifications" }) } : {}),
        });
        if (!response.ok) return;
        const result = await response.json();
        if (controller.signal.aborted) return;
        const items = authorizedReminderNotifications(result);
        if (items.length) {
          const claims = items.map(item => ({ id: item.id, attemptedAt: item.notificationAttemptedAt! }));
          const target = items.length === 1 ? { taskId: items[0].taskId, kind: items[0].kind } : null;
          const status = await notifyDesktop({ title: "EduPi 提醒", body: items.length === 1 ? items[0].title : `${items.length} 项待处理`, reminder: { target, claims } });
          if (status === "attempted") await updateClaims(claims, "notification_delivered");
          else await updateClaims(claims, "notification_failed");
        }
      } catch { /* Persistent inbox remains available after network or notification failure. */ }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 30000); }
    };
    void listenReminderNotificationsNative((target) => { void markOpened(target).catch(() => {}); onOpen(target); }, claims => { void updateClaims(claims, "notification_failed").catch(() => {}); }).then(cleanup => {
      if (controller.signal.aborted) { cleanup(); return; }
      unlisten = cleanup; nativeReady = true; void poll();
    }).catch(() => { if (!controller.signal.aborted) void poll(); });
    return () => { controller.abort(); clearTimeout(timer); unlisten?.(); };
  }, [onOpen]);
}
