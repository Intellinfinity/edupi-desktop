import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import type { ReminderEvent } from "./edupi-reminder-events";

export type Reminder = { id: string; taskId: string; title: string; kind: "ready" | "failed" | "due" | "brief"; identity: string; createdAt: string; read: boolean; handled: boolean; snoozedUntil: string | null; notificationAttemptedAt?: string; notificationDeliveredAt?: string; notificationOpenedAt?: string; notificationFailureAt?: string; notificationFailureCount?: number; notificationRetryAt?: string; withdrawn?: boolean };
export type ReminderActivityType = "candidate_created" | "candidate_withdrawn" | "notification_claimed" | "notification_delivered" | "notification_released" | "notification_failed" | "notification_opened" | "read" | "handled" | "snoozed";
export type ReminderActivity = { type: ReminderActivityType; reminderId: string; taskId: string; at: string; latencyMs?: number };
export type ReminderMetrics = {
  candidateCount: number;
  pendingCount: number;
  snoozedCount: number;
  handledCount: number;
  withdrawnCount: number;
  notificationClaimCount: number;
  notificationDeliveredCount: number;
  notificationFailedCount: number;
  notificationOpenedCount: number;
  notificationSuppressedCount: number;
  duplicateClaimCount: number;
  teacherActionCount: number;
  averageDeliveryLatencyMs: number | null;
  averageOpenLatencyMs: number | null;
};
type Store = { version: 1; items: Reminder[]; notifications?: Reminder[]; activity?: ReminderActivity[] };
type ReminderAction = { id: string; type: "read" | "dismiss" | "handled" | "snooze" | "claim_notifications" | "release_notification" | "notification_delivered" | "notification_failed" | "notification_opened"; attemptedAt?: string; taskId?: string };
type ReminderStoreResult = Store & { metrics: ReminderMetrics };
const MAX_ACTIVITY = 2000;
const MAX_NOTIFICATION_FAILURES = 3;
const NOTIFICATION_RETRY_BASE_MS = 5 * 60_000;

function addActivity(state: Store, activity: ReminderActivity): void {
  state.activity ??= [];
  state.activity.push(activity);
  if (state.activity.length > MAX_ACTIVITY) state.activity.splice(0, state.activity.length - MAX_ACTIVITY);
}

function matchingItems(state: Store, action: ReminderAction): Reminder[] {
  if (action.id === "*") return action.taskId ? state.items.filter((item) => item.taskId === action.taskId) : state.items.filter((item) => item.notificationAttemptedAt);
  return state.items.filter((item) => item.id === action.id);
}

function metrics(state: Store): ReminderMetrics {
  const activity = state.activity ?? [];
  const claims = activity.filter((item) => item.type === "notification_claimed");
  const deliveries = activity.filter((item) => item.type === "notification_delivered");
  const opens = activity.filter((item) => item.type === "notification_opened");
  const claimCounts = new Map<string, number>();
  for (const item of claims) claimCounts.set(item.reminderId, (claimCounts.get(item.reminderId) ?? 0) + 1);
  const average = (items: ReminderActivity[]) => {
    const values = items.flatMap((item) => typeof item.latencyMs === "number" ? [item.latencyMs] : []);
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  };
  return {
    candidateCount: state.items.length,
    pendingCount: state.items.filter((item) => !item.withdrawn && !item.handled && !item.snoozedUntil).length,
    snoozedCount: state.items.filter((item) => !item.withdrawn && !item.handled && Boolean(item.snoozedUntil)).length,
    handledCount: state.items.filter((item) => item.handled).length,
    withdrawnCount: state.items.filter((item) => item.withdrawn).length,
    notificationClaimCount: claims.length,
    notificationDeliveredCount: deliveries.length,
    notificationFailedCount: activity.filter((item) => item.type === "notification_failed").length,
    notificationOpenedCount: opens.length,
    notificationSuppressedCount: state.items.filter((item) => (item.notificationFailureCount ?? 0) >= MAX_NOTIFICATION_FAILURES).length,
    duplicateClaimCount: [...claimCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    teacherActionCount: activity.filter((item) => item.type === "read" || item.type === "handled" || item.type === "snoozed" || item.type === "notification_opened").length,
    averageDeliveryLatencyMs: average(deliveries),
    averageOpenLatencyMs: average(opens),
  };
}

export async function updateReminderStore(file: string, snapshot: Record<string, ReminderEvent>, action?: ReminderAction, now = Date.now()): Promise<ReminderStoreResult> {
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
      if (!current && !item.withdrawn) addActivity(state, { type: "candidate_withdrawn", reminderId: item.id, taskId: item.taskId, at: new Date(now).toISOString() });
      item.withdrawn = !current;
      if (current) item.title = current.title;
    }
    for (const item of Object.values(snapshot)) {
      if (!item.completion || state.items.some(record => record.taskId === item.taskId && record.identity === item.identity)) continue;
      const reminder = { id: randomUUID(), taskId: item.taskId, title: item.title, kind: item.completion, identity: item.identity, createdAt: new Date(now).toISOString(), read: false, handled: false, snoozedUntil: null } satisfies Reminder;
      state.items.push(reminder);
      addActivity(state, { type: "candidate_created", reminderId: reminder.id, taskId: reminder.taskId, at: reminder.createdAt });
    }
    if (action && action.type !== "claim_notifications") {
      const items = matchingItems(state, action);
      if (!items.length) throw new Error("提醒不存在");
      const at = new Date(now).toISOString();
      for (const item of items) {
        if (action.type === "release_notification" && action.attemptedAt === item.notificationAttemptedAt) {
          delete item.notificationAttemptedAt;
          addActivity(state, { type: "notification_released", reminderId: item.id, taskId: item.taskId, at });
        }
        if (action.type === "notification_failed") {
          delete item.notificationAttemptedAt;
          item.notificationFailureAt = at;
          item.notificationFailureCount = (item.notificationFailureCount ?? 0) + 1;
          item.notificationRetryAt = item.notificationFailureCount < MAX_NOTIFICATION_FAILURES
            ? new Date(now + NOTIFICATION_RETRY_BASE_MS * (2 ** (item.notificationFailureCount - 1))).toISOString()
            : undefined;
          addActivity(state, { type: "notification_failed", reminderId: item.id, taskId: item.taskId, at });
        }
        if (action.type === "notification_delivered") {
          item.notificationDeliveredAt = at;
          delete item.notificationRetryAt;
          const latencyMs = Date.parse(at) - Date.parse(item.notificationAttemptedAt || at);
          addActivity(state, { type: "notification_delivered", reminderId: item.id, taskId: item.taskId, at, latencyMs: Math.max(0, latencyMs) });
        }
        if (action.type === "notification_opened") {
          item.read = true;
          item.notificationOpenedAt = at;
          delete item.notificationRetryAt;
          const latencyMs = Date.parse(at) - Date.parse(item.notificationDeliveredAt || item.notificationAttemptedAt || at);
          addActivity(state, { type: "notification_opened", reminderId: item.id, taskId: item.taskId, at, latencyMs: Math.max(0, latencyMs) });
        }
        if (action.type === "read") { item.read = true; addActivity(state, { type: "read", reminderId: item.id, taskId: item.taskId, at }); }
        if (action.type === "dismiss" || action.type === "handled") { item.handled = true; item.read = true; addActivity(state, { type: "handled", reminderId: item.id, taskId: item.taskId, at }); }
        if (action.type === "snooze") { item.snoozedUntil = new Date(now + 60 * 60_000).toISOString(); item.read = true; addActivity(state, { type: "snoozed", reminderId: item.id, taskId: item.taskId, at }); }
      }
    }
    for (const item of state.items) if (item.snoozedUntil && Date.parse(item.snoozedUntil) <= now) { item.snoozedUntil = null; if (!item.handled) { item.read = false; delete item.notificationAttemptedAt; } }
    const notifications = action?.type === "claim_notifications" ? state.items.filter(item => !item.withdrawn && !item.handled && !item.read && !item.snoozedUntil && !item.notificationAttemptedAt && (item.notificationFailureCount ?? 0) < MAX_NOTIFICATION_FAILURES && (!item.notificationRetryAt || Date.parse(item.notificationRetryAt) <= now)) : [];
    for (const item of notifications) {
      item.notificationAttemptedAt = new Date(now).toISOString();
      addActivity(state, { type: "notification_claimed", reminderId: item.id, taskId: item.taskId, at: item.notificationAttemptedAt });
    }
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, file);
    return { ...state, notifications, metrics: metrics(state) };
  } finally { await rm(temporary, { force: true }); await release(); }
}
