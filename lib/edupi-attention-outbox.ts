import lockfile from "proper-lockfile";
import { selectNativeReminderNotifications, syncReminderAttention } from "./edupi-attention-delivery";
import type { EducationContract } from "./edupi-education-contract";
import type { ReminderEvent } from "./edupi-reminder-events";
import { pendingReminderAttentionOutcomes, updateReminderStore, type Reminder, type ReminderAttentionOutcome,
  type ReminderAttentionRoute, type ReminderAttentionRouteMark } from "./edupi-reminder-store";

const MAX_REPLAYS_PER_REQUEST = 8;
const MAX_SCANNED_PER_REQUEST = 256;
type Sync = typeof syncReminderAttention;
type BlockCode = "sync_busy" | "projection_unavailable" | "invalid_outcome" | "core_link_unproven" | "carrier_mismatch" | "core_unavailable" | "budget_exhausted";
type ReconcileResult = { status: "synced" | "unavailable"; recorded: number; pendingCount: number; pendingIds: string[];
  blocked?: { reminderId: string; code: BlockCode }[] };
type ReconcileOptions = { file: string; snapshot: Record<string, ReminderEvent>; readData: () => Promise<EducationContract>; sync?: Sync };

export function nativeAttentionRoute(item: Reminder, attention: Awaited<ReturnType<Sync>>): ReminderAttentionRoute | null {
  if (!selectNativeReminderNotifications([item], attention).length) return null;
  const currentCoreDelivery = attention.status === "synced" && attention.currentNotificationIds?.includes(item.id);
  if (currentCoreDelivery) return "core_linked";
  if (item.attentionRoute === "core_linked") return null;
  if (item.nativeSource === "teacher_created") return "teacher_local";
  if (item.nativeSource === "core_g1" && attention.g1LocalFallback === true) return "g1_local";
  if (item.kind === "brief" && item.taskId.startsWith("document:")) return "legacy_local";
  return null;
}

export async function persistNativeAttentionRouteMarks(file: string, snapshot: Record<string, ReminderEvent>,
  marks: readonly ReminderAttentionRouteMark[]): Promise<{ acceptedIds: string[]; deferredIds: string[];
    state: Awaited<ReturnType<typeof updateReminderStore>> | null }> {
  const acceptedIds: string[] = [];
  const deferredIds: string[] = [];
  let state: Awaited<ReturnType<typeof updateReminderStore>> | null = null;
  for (const mark of marks) {
    try {
      state = await updateReminderStore(file, snapshot, { id: "*", type: "mark_attention_routes", routes: [mark] });
      acceptedIds.push(mark.reminderId);
    } catch {
      // A concurrent claim or changed Core binding must not strand the whole
      // batch after claims were persisted. Defer only this exact attempt.
      state = await updateReminderStore(file, snapshot, { id: mark.reminderId,
        type: "notification_deferred", attemptedAt: mark.attemptedAt });
      deferredIds.push(mark.reminderId);
    }
  }
  return { acceptedIds, deferredIds, state };
}

function pending(items: readonly ReminderAttentionOutcome[]): Pick<ReconcileResult, "pendingCount" | "pendingIds"> {
  return { pendingCount: items.length, pendingIds: [...new Set(items.map((item) => item.reminderId))] };
}

function linkedCarrier(data: EducationContract, item: Reminder, outcome: ReminderAttentionOutcome): string | null {
  const preparation = data.l4Preparation;
  if (!preparation) return null;
  const workCase = data.workCases.find((candidate) => candidate.id === item.taskId || candidate.taskId === item.taskId);
  const workCaseId = workCase?.id || item.taskId;
  const intent = preparation.attentionIntents.find((candidate) => candidate.workCaseId === workCaseId);
  if (!intent) return null;
  const deliveries = preparation.attentionDeliveries.filter((delivery) => delivery.deliveryId === item.id
    && delivery.attentionIntentId === intent.attentionIntentId && delivery.opportunityId === intent.opportunityId
    && delivery.workCaseId === intent.workCaseId && delivery.deepLink === intent.deepLink
    && delivery.carrier.kind === "desktop" && delivery.intentCurrent === true
    && (outcome.route !== "core_linked" || delivery.carrier.instanceId === outcome.instanceId));
  return deliveries.length === 1 ? deliveries[0].carrier.instanceId : null;
}

export async function reconcileReminderAttentionOutbox({ file, snapshot, readData, sync = syncReminderAttention }: ReconcileOptions): Promise<ReconcileResult> {
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(file, { lockfilePath: `${file}.attention.lock`, retries: 0 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ELOCKED") throw error;
    const state = await updateReminderStore(file, snapshot);
    const remaining = pending(pendingReminderAttentionOutcomes(state));
    return { status: "unavailable", recorded: 0, ...remaining,
      blocked: remaining.pendingIds.slice(0, MAX_SCANNED_PER_REQUEST).map((reminderId) => ({ reminderId, code: "sync_busy" })) };
  }
  let recorded = 0;
  let replayed = 0;
  let scanned = 0;
  const deferredReminderIds = new Set<string>();
  const blocked: NonNullable<ReconcileResult["blocked"]> = [];
  const markBlocked = (reminderId: string, code: BlockCode) => {
    if (!deferredReminderIds.has(reminderId)) blocked.push({ reminderId, code });
    deferredReminderIds.add(reminderId);
  };
  try {
    while (replayed < MAX_REPLAYS_PER_REQUEST && scanned < MAX_SCANNED_PER_REQUEST) {
      const state = await updateReminderStore(file, snapshot);
      const outcomes = pendingReminderAttentionOutcomes(state);
      if (!outcomes.length) return { status: "synced", recorded, pendingCount: 0, pendingIds: [] };
      let data: EducationContract;
      try { data = await readData(); }
      catch { return { status: "unavailable", recorded, ...pending(outcomes),
        blocked: pending(outcomes).pendingIds.slice(0, MAX_SCANNED_PER_REQUEST).map((reminderId) => ({ reminderId, code: "projection_unavailable" })) }; }
      let progressed = false;
      // Preserve order within one reminder; an unprovable reminder cannot
      // hold up independent, already-linked outcomes behind it.
      const seenReminders = new Set<string>();
      const firstByReminder = outcomes.filter((outcome) => {
        if (seenReminders.has(outcome.reminderId)) return false;
        seenReminders.add(outcome.reminderId);
        return true;
      });
      const start = (state.attentionScanOffset ?? 0) % firstByReminder.length;
      const ordered = [...firstByReminder.slice(start), ...firstByReminder.slice(0, start)];
      let traversed = 0;
      for (const outcome of ordered) {
        if (scanned >= MAX_SCANNED_PER_REQUEST) break;
        traversed++;
        if (deferredReminderIds.has(outcome.reminderId)) continue;
        scanned++;
        const item = state.items.find((candidate) => candidate.id === outcome.reminderId && candidate.taskId === outcome.taskId);
        if (!item || !["notification_delivered", "notification_failed", "notification_opened"].includes(outcome.type)
          || !Number.isFinite(Date.parse(outcome.occurredAt))) {
          markBlocked(outcome.reminderId, "invalid_outcome");
          continue;
        }
        const instanceId = linkedCarrier(data, item, outcome);
        if (!instanceId || item.attentionCarrierInstanceId && item.attentionCarrierInstanceId !== instanceId) {
          markBlocked(outcome.reminderId, instanceId ? "carrier_mismatch" : "core_link_unproven");
          continue;
        }
        try {
          if (!item.attentionCarrierInstanceId) {
            await updateReminderStore(file, snapshot, { id: item.id, type: "bind_attention_carrier", instanceId });
          }
          const result = await sync({ data, items: [item], action: { id: item.id, taskId: item.taskId, type: outcome.type },
            now: new Date(outcome.occurredAt), instanceId });
          if (result.status !== "synced") {
            markBlocked(outcome.reminderId, "core_unavailable");
            continue;
          }
          recorded += result.recorded;
          await updateReminderStore(file, snapshot, { id: "*", type: "ack_attention_outcome", outcomeId: outcome.id });
          replayed++;
          progressed = true;
          break;
        } catch {
          markBlocked(outcome.reminderId, "core_unavailable");
        }
      }
      await updateReminderStore(file, snapshot, { id: "*", type: "set_attention_scan_offset",
        scanOffset: (start + traversed) % firstByReminder.length });
      if (!progressed) break;
    }
    const state = await updateReminderStore(file, snapshot);
    const remaining = pendingReminderAttentionOutcomes(state);
    return { status: remaining.length ? "unavailable" : "synced", recorded,
      ...pending(remaining), ...(blocked.length ? { blocked } : {}) };
  } finally {
    await release();
  }
}

export async function reconcileReminderAttentionOutboxWithin(options: ReconcileOptions, budgetMs: number,
  pendingOutcomes: readonly ReminderAttentionOutcome[]): Promise<ReconcileResult> {
  if (!pendingOutcomes.length) return { status: "synced", recorded: 0, pendingCount: 0, pendingIds: [] };
  const remaining = pending(pendingOutcomes);
  const fallback: ReconcileResult = { status: "unavailable", recorded: 0, ...remaining,
    blocked: remaining.pendingIds.slice(0, MAX_SCANNED_PER_REQUEST).map((reminderId) => ({ reminderId, code: "budget_exhausted" })) };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = reconcileReminderAttentionOutbox(options).catch(() => fallback);
  try {
    return await Promise.race([work, new Promise<ReconcileResult>((resolve) => {
      timer = setTimeout(() => resolve(fallback), Math.max(1, Math.min(5_000, budgetMs)));
    })]);
  } finally {
    clearTimeout(timer);
  }
}
