import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import type { ReminderEvent } from "./edupi-reminder-events";

export type ReminderAttentionRoute = "core_linked" | "g1_local" | "teacher_local" | "legacy_local";
export type ReminderAttentionOutcome = { id: string; reminderId: string; taskId: string; type: "notification_delivered" | "notification_failed" | "notification_opened"; attemptedAt?: string; occurredAt: string; route: "core_linked" | "unknown"; instanceId?: string };
export type ReminderAttentionRouteMark = { reminderId: string; attemptedAt: string; route: ReminderAttentionRoute; instanceId?: string };
export type Reminder = { id: string; taskId: string; title: string; kind: "ready" | "failed" | "due" | "brief"; identity: string; createdAt: string; read: boolean; handled: boolean; snoozedUntil: string | null; nativeSource?: "teacher_created" | "core_g1"; notificationAttemptedAt?: string; notificationDeliveredAt?: string; notificationOpenedAt?: string; notificationFailureAt?: string; notificationFailureCount?: number; notificationRetryAt?: string; attentionRoute?: ReminderAttentionRoute; attentionCarrierInstanceId?: string; withdrawn?: boolean };
export type ReminderActivityType = "candidate_created" | "candidate_withdrawn" | "notification_claimed" | "notification_delivered" | "notification_released" | "notification_deferred" | "notification_failed" | "notification_opened" | "read" | "handled" | "snoozed";
export type ReminderActivity = { type: ReminderActivityType; reminderId: string; taskId: string; at: string; latencyMs?: number };
export type ReminderMetrics = {
  candidateCount: number;
  pendingCount: number;
  snoozedCount: number;
  handledCount: number;
  withdrawnCount: number;
  notificationClaimCount: number;
  notificationDeliveredCount: number;
  notificationDeferredCount: number;
  notificationFailedCount: number;
  notificationOpenedCount: number;
  notificationSuppressedCount: number;
  duplicateClaimCount: number;
  teacherActionCount: number;
  averageDeliveryLatencyMs: number | null;
  averageOpenLatencyMs: number | null;
};
type Store = { version: 1; items: Reminder[]; notifications?: Reminder[]; activity?: ReminderActivity[];
  attentionOutbox?: ReminderAttentionOutcome[]; attentionOverflow?: Record<string, ReminderAttentionOutcome[]>; attentionScanOffset?: number };
type ReminderAction = { id: string; type: "read" | "dismiss" | "handled" | "snooze" | "claim_notifications" | "release_notification" | "notification_deferred" | "notification_delivered" | "notification_failed" | "notification_opened" | "mark_attention_routes" | "bind_attention_carrier" | "ack_attention_outcome" | "set_attention_scan_offset"; attemptedAt?: string; taskId?: string; routes?: ReminderAttentionRouteMark[]; outcomeId?: string; instanceId?: string; scanOffset?: number };
type ReminderStoreResult = Store & { metrics: ReminderMetrics; notificationTransitionApplied: boolean };
const MAX_ACTIVITY = 2000;
const MAX_ATTENTION_OUTBOX = 256;
// A reminder can fail three native attempts, then be opened; five slots leave
// room for the delivered/opened path without allowing unbounded per-item growth.
const MAX_ATTENTION_OVERFLOW_PER_REMINDER = 5;
const MAX_NOTIFICATION_FAILURES = 3;
const MAX_NATIVE_CLAIMS_PER_POLL = 16;
const NOTIFICATION_RETRY_BASE_MS = 5 * 60_000;

function addActivity(state: Store, activity: ReminderActivity): void {
  state.activity ??= [];
  state.activity.push(activity);
  if (state.activity.length > MAX_ACTIVITY) state.activity.splice(0, state.activity.length - MAX_ACTIVITY);
}

function enqueueAttentionOutcome(state: Store, item: Reminder, type: ReminderAttentionOutcome["type"], at: string, attemptedAt?: string): void {
  if (item.attentionRoute && item.attentionRoute !== "core_linked") return;
  if (item.attentionRoute === "core_linked" && !item.attentionCarrierInstanceId) throw new Error("Core 提醒载体标识缺失");
  const outcome = { id: randomUUID(), reminderId: item.id, taskId: item.taskId, type,
    ...(attemptedAt ? { attemptedAt } : {}), occurredAt: at,
    route: item.attentionRoute === "core_linked" ? "core_linked" : "unknown",
    ...(item.attentionCarrierInstanceId ? { instanceId: item.attentionCarrierInstanceId } : {}) } satisfies ReminderAttentionOutcome;
  // Once this reminder has overflowed, keep its later transitions behind the
  // earlier overflow entries even if another reminder frees a main slot.
  if (state.attentionOutbox!.length < MAX_ATTENTION_OUTBOX && !state.attentionOverflow![item.id]?.length) {
    state.attentionOutbox!.push(outcome);
  } else {
    const overflow = state.attentionOverflow![item.id] ??= [];
    if (overflow.length >= MAX_ATTENTION_OVERFLOW_PER_REMINDER) throw new Error("Core 提醒回执溢出记录已满");
    overflow.push(outcome);
  }
}

export function pendingReminderAttentionOutcomes(state: { attentionOutbox?: ReminderAttentionOutcome[];
  attentionOverflow?: Record<string, ReminderAttentionOutcome[]> }): ReminderAttentionOutcome[] {
  return [...(state.attentionOutbox ?? []), ...Object.values(state.attentionOverflow ?? {}).flat()];
}

function matchingItems(state: Store, action: ReminderAction): Reminder[] {
  const items = action.id === "*" ? action.taskId ? state.items : state.items.filter((item) => item.notificationAttemptedAt) : state.items.filter((item) => item.id === action.id);
  return action.taskId ? items.filter((item) => item.taskId === action.taskId) : items;
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
    notificationDeferredCount: activity.filter((item) => item.type === "notification_deferred").length,
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
    let notificationTransitionApplied = false;
    try { state = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (state.version !== 1 || !Array.isArray(state.items) || state.attentionOutbox !== undefined && !Array.isArray(state.attentionOutbox)
      || (state.attentionOutbox?.length ?? 0) > MAX_ATTENTION_OUTBOX
      || state.attentionOverflow !== undefined && (!state.attentionOverflow || typeof state.attentionOverflow !== "object"
        || Array.isArray(state.attentionOverflow) || Object.values(state.attentionOverflow).some((entries) => !Array.isArray(entries)
          || entries.length > MAX_ATTENTION_OVERFLOW_PER_REMINDER))
      || state.attentionScanOffset !== undefined && (!Number.isSafeInteger(state.attentionScanOffset) || state.attentionScanOffset < 0)) {
      throw new Error("提醒记录无法读取");
    }
    state.attentionOutbox ??= [];
    state.attentionOverflow ??= {};
    const events = Object.values(snapshot);
    for (const item of state.items) {
      const current = events.find(event => event.taskId === item.taskId && event.identity === item.identity && event.completion);
      if (!current && !item.withdrawn) addActivity(state, { type: "candidate_withdrawn", reminderId: item.id, taskId: item.taskId, at: new Date(now).toISOString() });
      item.withdrawn = !current;
      if (current) item.title = current.title;
      if (item.nativeSource && current?.nativeSource !== item.nativeSource) delete item.nativeSource;
    }
    for (const item of Object.values(snapshot)) {
      if (!item.completion || state.items.some(record => record.taskId === item.taskId && record.identity === item.identity)) continue;
      const reminder = { id: randomUUID(), taskId: item.taskId, title: item.title, kind: item.completion, identity: item.identity, createdAt: new Date(now).toISOString(), read: false, handled: false, snoozedUntil: null,
        ...(item.nativeSource ? { nativeSource: item.nativeSource } : {}) } satisfies Reminder;
      state.items.push(reminder);
      addActivity(state, { type: "candidate_created", reminderId: reminder.id, taskId: reminder.taskId, at: reminder.createdAt });
    }
    if (action?.type === "mark_attention_routes") {
      for (const mark of action.routes ?? []) {
        const item = state.items.find((candidate) => candidate.id === mark.reminderId && candidate.notificationAttemptedAt === mark.attemptedAt);
        if (!item || !["core_linked", "g1_local", "teacher_local", "legacy_local"].includes(mark.route)
          || mark.route === "core_linked" && (!mark.instanceId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(mark.instanceId))
          || item.attentionRoute && (item.attentionRoute !== mark.route
            && !(item.attentionRoute !== "core_linked" && mark.route === "core_linked")
            || item.attentionRoute === "core_linked" && item.attentionCarrierInstanceId !== mark.instanceId)) {
          throw new Error("提醒关联已变化");
        }
        item.attentionRoute = mark.route;
        if (mark.route === "core_linked") item.attentionCarrierInstanceId = mark.instanceId;
      }
    }
    if (action?.type === "bind_attention_carrier") {
      const item = state.items.find((candidate) => candidate.id === action.id);
      if (!item || !action.instanceId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(action.instanceId)
        || item.attentionRoute && (item.attentionRoute !== "core_linked" || item.attentionCarrierInstanceId !== action.instanceId)) {
        throw new Error("提醒关联已变化");
      }
      item.attentionRoute = "core_linked";
      item.attentionCarrierInstanceId = action.instanceId;
      for (const entry of state.attentionOutbox) if (entry.reminderId === item.id && entry.route === "unknown") {
        entry.route = "core_linked";
        entry.instanceId = action.instanceId;
      }
      for (const entry of state.attentionOverflow[item.id] ?? []) if (entry.route === "unknown") {
        entry.route = "core_linked";
        entry.instanceId = action.instanceId;
      }
    }
    if (action?.type === "ack_attention_outcome") {
      state.attentionOutbox = state.attentionOutbox.filter((entry) => entry.id !== action.outcomeId);
      for (const [reminderId, entries] of Object.entries(state.attentionOverflow)) {
        const kept = entries.filter((entry) => entry.id !== action.outcomeId);
        if (kept.length) state.attentionOverflow[reminderId] = kept;
        else delete state.attentionOverflow[reminderId];
      }
    }
    if (action?.type === "set_attention_scan_offset") {
      if (!Number.isSafeInteger(action.scanOffset) || action.scanOffset! < 0) throw new Error("提醒扫描位置无效");
      state.attentionScanOffset = action.scanOffset;
    }
    if (action && !["claim_notifications", "mark_attention_routes", "bind_attention_carrier", "ack_attention_outcome", "set_attention_scan_offset"].includes(action.type)) {
      const items = matchingItems(state, action);
      if (!items.length) throw new Error("提醒不存在");
      const at = new Date(now).toISOString();
      for (const item of items) {
        if (action.type === "release_notification" && action.attemptedAt === item.notificationAttemptedAt
          && !item.notificationDeliveredAt && !item.notificationOpenedAt) {
          delete item.notificationAttemptedAt;
          addActivity(state, { type: "notification_released", reminderId: item.id, taskId: item.taskId, at });
        }
        if (action.type === "notification_deferred" && action.attemptedAt === item.notificationAttemptedAt && item.notificationAttemptedAt
          && !item.notificationDeliveredAt && !item.notificationOpenedAt) {
          delete item.notificationAttemptedAt;
          item.notificationRetryAt = new Date(now + NOTIFICATION_RETRY_BASE_MS).toISOString();
          addActivity(state, { type: "notification_deferred", reminderId: item.id, taskId: item.taskId, at });
        }
        if (action.type === "notification_failed" && action.attemptedAt && action.attemptedAt === item.notificationAttemptedAt && !item.notificationDeliveredAt && !item.notificationOpenedAt) {
          delete item.notificationAttemptedAt;
          item.notificationFailureAt = at;
          item.notificationFailureCount = (item.notificationFailureCount ?? 0) + 1;
          item.notificationRetryAt = item.notificationFailureCount < MAX_NOTIFICATION_FAILURES
            ? new Date(now + NOTIFICATION_RETRY_BASE_MS * (2 ** (item.notificationFailureCount - 1))).toISOString()
            : undefined;
          addActivity(state, { type: "notification_failed", reminderId: item.id, taskId: item.taskId, at });
          enqueueAttentionOutcome(state, item, "notification_failed", at, action.attemptedAt);
          notificationTransitionApplied = true;
        }
        if (action.type === "notification_delivered" && action.attemptedAt && action.attemptedAt === item.notificationAttemptedAt && !item.notificationDeliveredAt && !item.notificationOpenedAt) {
          item.notificationDeliveredAt = at;
          delete item.notificationRetryAt;
          const latencyMs = Date.parse(at) - Date.parse(item.notificationAttemptedAt || at);
          addActivity(state, { type: "notification_delivered", reminderId: item.id, taskId: item.taskId, at, latencyMs: Math.max(0, latencyMs) });
          enqueueAttentionOutcome(state, item, "notification_delivered", at, action.attemptedAt);
          notificationTransitionApplied = true;
        }
        if (action.type === "notification_opened" && !item.notificationOpenedAt) {
          item.read = true;
          item.notificationOpenedAt = at;
          delete item.notificationRetryAt;
          const latencyMs = Date.parse(at) - Date.parse(item.notificationDeliveredAt || item.notificationAttemptedAt || at);
          addActivity(state, { type: "notification_opened", reminderId: item.id, taskId: item.taskId, at, latencyMs: Math.max(0, latencyMs) });
          enqueueAttentionOutcome(state, item, "notification_opened", at);
          notificationTransitionApplied = true;
        }
        if (action.type === "read") { item.read = true; addActivity(state, { type: "read", reminderId: item.id, taskId: item.taskId, at }); }
        if (action.type === "dismiss" || action.type === "handled") { item.handled = true; item.read = true; addActivity(state, { type: "handled", reminderId: item.id, taskId: item.taskId, at }); }
        if (action.type === "snooze") { item.snoozedUntil = new Date(now + 60 * 60_000).toISOString(); item.read = true; addActivity(state, { type: "snoozed", reminderId: item.id, taskId: item.taskId, at }); }
      }
    }
    for (const item of state.items) if (item.snoozedUntil && Date.parse(item.snoozedUntil) <= now) { item.snoozedUntil = null; if (!item.handled) { item.read = false; delete item.notificationAttemptedAt; } }
    const notifications = action?.type === "claim_notifications" ? state.items.filter(item => !item.withdrawn && !item.handled && !item.read && !item.snoozedUntil && !item.notificationAttemptedAt && (item.notificationFailureCount ?? 0) < MAX_NOTIFICATION_FAILURES && (!item.notificationRetryAt || Date.parse(item.notificationRetryAt) <= now)).slice(0, MAX_NATIVE_CLAIMS_PER_POLL) : [];
    for (const item of notifications) {
      item.notificationAttemptedAt = new Date(now).toISOString();
      delete item.notificationDeliveredAt;
      addActivity(state, { type: "notification_claimed", reminderId: item.id, taskId: item.taskId, at: item.notificationAttemptedAt });
    }
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, file);
    return { ...state, notifications, metrics: metrics(state), notificationTransitionApplied };
  } finally { await rm(temporary, { force: true }); await release(); }
}
