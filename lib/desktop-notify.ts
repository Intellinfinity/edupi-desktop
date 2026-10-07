import { isTauriDesktop } from "@/lib/desktop-updater";
import { APP_PREF_KEYS, getPrefBool } from "@/lib/app-prefs";
import { isCancelledReminderNotificationError, isDeferredReminderNotificationError, sendReminderNotificationNative, type NativeReminderNotification } from "@/lib/desktop-native";

export function desktopNotificationsEnabled(): boolean {
  return getPrefBool(APP_PREF_KEYS.notifyOnComplete, true);
}

async function ensurePermission(): Promise<boolean> {
  const {
    isPermissionGranted,
    requestPermission,
  } = await import("@tauri-apps/plugin-notification");
  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === "granted";
  }
  return granted;
}

/** Show a native notification when the desktop window is in the background. */
export async function notifyDesktop(options: {
  title: string;
  body: string;
  reminder?: Pick<NativeReminderNotification, "target" | "claims">;
  isCurrent?: () => boolean | Promise<boolean>;
}): Promise<"attempted" | "skipped" | "failed" | "cancelled"> {
  if (!isTauriDesktop() || !desktopNotificationsEnabled()) return "skipped";

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const focused = await getCurrentWindow().isFocused();
    if (focused) return "skipped";
  } catch {
    // If focus cannot be determined, still notify.
  }

  try {
    if (!(await ensurePermission())) return "skipped";
  } catch (error) {
    console.error("Desktop notification authorization unavailable:", error);
    return "skipped";
  }

  // The teacher can disable notifications or reopen the window while the OS
  // permission prompt is pending. An unsent reminder claim must be released.
  if (!desktopNotificationsEnabled()) return options.reminder ? "cancelled" : "skipped";
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    if (await getCurrentWindow().isFocused()) return options.reminder ? "cancelled" : "skipped";
  } catch {
    // Keep the existing fallback when focus cannot be determined.
  }

  try {
    if (options.reminder) {
      if (options.isCurrent && !await options.isCurrent()) return "cancelled";
      await sendReminderNotificationNative({ title: options.title, body: options.body, ...options.reminder }, options.isCurrent);
    }
    else {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      sendNotification({ title: options.title, body: options.body });
    }
    return "attempted";
  } catch (error) {
    if (isCancelledReminderNotificationError(error)) return "cancelled";
    console.error("Desktop notification failed:", error);
    if (isDeferredReminderNotificationError(error)) return "skipped";
    return "failed";
  }
}

export async function focusDesktopWindow(): Promise<void> {
  if (!isTauriDesktop()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const window = getCurrentWindow();
    await window.show();
    await window.unminimize();
    await window.setFocus();
  } catch {
    // ignore
  }
}

/** Explicit user action: test delivery even while the settings window is focused. */
export async function testDesktopNotification(): Promise<void> {
  if (!isTauriDesktop()) throw new Error("请在桌面应用中测试通知");
  if (!desktopNotificationsEnabled()) throw new Error("请先开启通知");
  if (!(await ensurePermission())) throw new Error("通知权限未开启，请在系统设置中允许 EduPi 通知");
  if (!desktopNotificationsEnabled()) throw new Error("请先开启通知");
  await sendReminderNotificationNative({
    title: "EduPi",
    body: "点击后打开提醒",
    target: null,
    claims: [{ id: "notification-test", attemptedAt: new Date().toISOString() }],
  });
}
