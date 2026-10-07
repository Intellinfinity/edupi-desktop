import { APP_PREF_KEYS, getPref, getPrefJson, setPref, setPrefJson } from "./app-prefs";
import { isTauriDesktop } from "./desktop-updater";

export const FOREGROUND_SETTINGS_CHANGED = "edupi-foreground-settings-changed";
let settingsRevision = 0;
let pendingNativeSave: Promise<void> = Promise.resolve();

export function normalizeForegroundSettings(value: unknown): { graceDays: number; pinnedTaskIds: string[]; dismissedStaleTaskIds: string[] } {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const days = input.graceDays;
  const ids = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 256))].slice(0, 1000) : [];
  return {
    graceDays: typeof days === "number" && Number.isInteger(days) && days >= 0 && days <= 365 ? days : 3,
    pinnedTaskIds: ids(input.pinnedTaskIds),
    dismissedStaleTaskIds: ids(input.dismissedStaleTaskIds),
  };
}

export function readForegroundSettings() {
  const raw = getPref(APP_PREF_KEYS.edupiForegroundGraceDays);
  return normalizeForegroundSettings({ graceDays: raw === null ? undefined : Number(raw), pinnedTaskIds: getPrefJson(APP_PREF_KEYS.edupiPinnedTaskIds), dismissedStaleTaskIds: getPrefJson(APP_PREF_KEYS.edupiDismissedStaleTaskIds) });
}

function notificationPolicy(settings: ReturnType<typeof normalizeForegroundSettings>): string {
  return JSON.stringify({ graceDays: settings.graceDays, pinnedTaskIds: settings.pinnedTaskIds });
}

/** The server reads the native file, so a pending or failed save cannot authorize an OS reminder. */
export async function foregroundNotificationPolicyMatchesNative(loader?: () => Promise<unknown>): Promise<boolean> {
  if (!loader && !isTauriDesktop()) return true;
  const before = notificationPolicy(readForegroundSettings());
  const unavailable = Symbol("foreground-policy-unavailable");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = loader ?? (async () => (await import("./desktop-native")).getForegroundSettingsNative());
    const saved = await Promise.race([read(), new Promise<typeof unavailable>(resolve => { timer = setTimeout(() => resolve(unavailable), 2_000); })]);
    if (saved === unavailable) return false;
    return before === notificationPolicy(readForegroundSettings()) && before === notificationPolicy(normalizeForegroundSettings(saved));
  } catch { return false; }
  finally { clearTimeout(timer); }
}

function applyForegroundSettings(settings: ReturnType<typeof normalizeForegroundSettings>): void {
  setPref(APP_PREF_KEYS.edupiForegroundGraceDays, String(settings.graceDays));
  setPrefJson(APP_PREF_KEYS.edupiPinnedTaskIds, settings.pinnedTaskIds);
  setPrefJson(APP_PREF_KEYS.edupiDismissedStaleTaskIds, settings.dismissedStaleTaskIds);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FOREGROUND_SETTINGS_CHANGED));
}

export function writeForegroundSettings(value: unknown): Promise<void> {
  const settings = normalizeForegroundSettings(value);
  settingsRevision += 1;
  applyForegroundSettings(settings);
  if (!isTauriDesktop()) return Promise.resolve();
  const save = pendingNativeSave.catch(() => {}).then(async () => {
    const { setForegroundSettingsNative } = await import("./desktop-native");
    await setForegroundSettingsNative(settings);
  });
  pendingNativeSave = save;
  return save;
}

/** Restore display preferences without allowing a late read to overwrite a new user choice. */
export async function restoreForegroundSettings(loader?: () => Promise<unknown>): Promise<boolean> {
  if (!loader && !isTauriDesktop()) return false;
  const revision = settingsRevision;
  const currentPreferences = JSON.stringify(readForegroundSettings());
  const load = loader ?? (async () => (await import("./desktop-native")).getForegroundSettingsNative());
  const saved = await load();
  if (saved === null || saved === undefined || revision !== settingsRevision || currentPreferences !== JSON.stringify(readForegroundSettings())) return false;
  applyForegroundSettings(normalizeForegroundSettings(saved));
  return true;
}
