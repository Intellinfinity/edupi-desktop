import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import type { ReminderEvent } from "./edupi-reminder-events";

export type Reminder = { id: string; taskId: string; title: string; kind: "ready" | "failed" | "due" | "brief"; identity: string; createdAt: string; read: boolean; handled: boolean; snoozedUntil: string | null; notificationAttemptedAt?: string; withdrawn?: boolean };
type Store = { version: 1; items: Reminder[]; notifications?: Reminder[] };
export async function updateReminderStore(file: string, snapshot: Record<string, ReminderEvent>, action?: { id: string; type: "read" | "dismiss" | "handled" | "snooze" | "claim_notifications" | "release_notification"; attemptedAt?: string }, now = Date.now()): Promise<Store> {
  await mkdir(dirname(file), { recursive: true });
  const release = await lockfile.lock(dirname(file), { lockfilePath: `${file}.lock`, retries: 5 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    let state: Store = { version: 1, items: [] };
    try { state = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (state.version !== 1 || !Array.isArray(state.items)) throw new Error("提醒记录无法读取");
    const events = Object.values(snapshot);
    for (const item of state.items) {
      const current = events.find(event => event.taskId === item.taskId && event.identity === item.identity && event.completion);
      item.withdrawn = !current;
      if (current) item.title = current.title;
    }
    for (const item of Object.values(snapshot)) {
      if (!item.completion || state.items.some(record => record.taskId === item.taskId && record.identity === item.identity)) continue;
      state.items.push({ id: randomUUID(), taskId: item.taskId, title: item.title, kind: item.completion, identity: item.identity, createdAt: new Date(now).toISOString(), read: false, handled: false, snoozedUntil: null });
    }
    if (action && action.type !== "claim_notifications") {
      const item = state.items.find(item => item.id === action.id);
      if (!item) throw new Error("提醒不存在");
      if (action.type === "release_notification" && action.attemptedAt === item.notificationAttemptedAt) delete item.notificationAttemptedAt;
      if (action.type === "read") item.read = true;
      if (action.type === "dismiss" || action.type === "handled") { item.handled = true; item.read = true; }
      if (action.type === "snooze") { item.snoozedUntil = new Date(now + 60 * 60_000).toISOString(); item.read = true; }
    }
    for (const item of state.items) if (item.snoozedUntil && Date.parse(item.snoozedUntil) <= now) { item.snoozedUntil = null; if (!item.handled) { item.read = false; delete item.notificationAttemptedAt; } }
    const notifications = action?.type === "claim_notifications" ? state.items.filter(item => !item.withdrawn && !item.handled && !item.read && !item.snoozedUntil && !item.notificationAttemptedAt) : [];
    for (const item of notifications) item.notificationAttemptedAt = new Date(now).toISOString();
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, file);
    return { ...state, notifications };
  } finally { await rm(temporary, { force: true }); await release(); }
}
