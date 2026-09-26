import { DESKTOP_INSTANCE_ID_ENV } from "./desktop-api";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import { ensureEduPiRuntime } from "./edupi-runtime-supervisor";
import { reminderEvents } from "./edupi-reminder-events";
import type { EducationContract } from "./edupi-education-contract";
import type { Reminder } from "./edupi-reminder-store";

type AttentionAction = {
  id: string;
  type: "claim_notifications" | "notification_delivered" | "notification_failed" | "notification_opened" | "read" | "dismiss" | "handled" | "snooze" | "release_notification";
  taskId?: string;
};

type AttentionTransition = "queued" | "delivered" | "failed" | "retry" | "opened";

type SyncResult = { status: "synced" | "unsupported" | "unavailable"; recorded: number;
  linkedNotificationIds?: string[]; currentNotificationIds?: string[]; g1LocalFallback?: boolean };
type RuntimeHost = { call(operation: string, payload: unknown): Promise<Record<string, unknown>> };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function affectedItems(items: readonly Reminder[], action: AttentionAction): readonly Reminder[] {
  if (action.type === "claim_notifications") return items;
  if (action.id !== "*") return items.filter((item) => item.id === action.id && (!action.taskId || item.taskId === action.taskId));
  if (action.taskId) return items.filter((item) => item.taskId === action.taskId);
  return items.filter((item) => item.notificationAttemptedAt);
}

function transitionFor(action: AttentionAction, current: string | null): AttentionTransition | null {
  if (action.type === "claim_notifications") return current === "failed" ? "retry" : current ? null : "queued";
  if (action.type === "notification_delivered") return current === "delivered" || current === "opened" ? null : "delivered";
  if (action.type === "notification_failed") return current === "failed" || current === "expired" ? null : "failed";
  if (action.type === "notification_opened") return current === "opened" ? null : "opened";
  return null;
}

function intentFor(data: EducationContract, item: Reminder) {
  const preparation = data.l4Preparation;
  if (!preparation) return null;
  const workCase = data.workCases.find((candidate) => candidate.id === item.taskId || candidate.taskId === item.taskId);
  const workCaseId = workCase?.id || item.taskId;
  return preparation.attentionIntents.find((intent) => intent.workCaseId === workCaseId) || null;
}

function currentDelivery(data: EducationContract, item: Reminder, instanceId: string) {
  return data.l4Preparation?.attentionDeliveries.find((delivery) => delivery.deliveryId === item.id
    && delivery.carrier.kind === "desktop" && delivery.carrier.instanceId === instanceId) || null;
}

function commandId(deliveryId: string, status: AttentionTransition, version: number): string {
  return `desktop_attention_${deliveryId}_${status}_${version}`;
}

export function selectNativeReminderNotifications(claimed: readonly Reminder[], attention: SyncResult): Reminder[] {
  const linked = new Set(attention.linkedNotificationIds);
  const current = new Set(attention.currentNotificationIds);
  // An empty Core read does not prove that an old unmarked task never had a withdrawn intent.
  return claimed.filter((item) => {
    if (attention.status === "synced" && current.has(item.id)) return true;
    return !linked.has(item.id) && (item.nativeSource === "teacher_created" || item.nativeSource === "core_g1" && attention.g1LocalFallback === true
      || item.kind === "brief" && item.taskId.startsWith("document:"));
  });
}

export async function revalidateG1LocalClaims(claimed: readonly Reminder[], readCurrent: () => Promise<EducationContract>): Promise<Reminder[]> {
  if (!claimed.some(item => item.nativeSource === "core_g1")) return [...claimed];
  let current: EducationContract;
  try { current = await readCurrent(); }
  catch { return claimed.filter(item => item.nativeSource !== "core_g1"); }
  if (current.scope !== "teacher_internal" || current.externalSend !== false || current.requiresTeacherReview !== true
    || current.l4Preparation !== null) return claimed.filter(item => item.nativeSource !== "core_g1");
  const events = Object.values(reminderEvents(current.tasks, current.workspace, new Date(),
    current.continuity.documents, current.workCases, current.generatedArtifacts));
  return claimed.filter(item => item.nativeSource !== "core_g1" || events.some(event => event.nativeSource === "core_g1"
    && event.taskId === item.taskId && event.identity === item.identity && event.completion === item.kind));
}

export async function syncReminderAttention({ data, items, action, now = new Date(), runtime, instanceId }: {
  data: EducationContract;
  items: readonly Reminder[];
  action: AttentionAction;
  now?: Date;
  instanceId?: string;
  runtime?: { host: { call(operation: string, payload: unknown): Promise<Record<string, unknown>> }; roots?: unknown };
}): Promise<SyncResult> {
  if (!["claim_notifications", "notification_delivered", "notification_failed", "notification_opened"].includes(action.type)) {
    return { status: "synced", recorded: 0 };
  }
  const targets = affectedItems(items, action);
  if (!targets.length) return { status: "synced", recorded: 0 };
  const claiming = action.type === "claim_notifications";
  const linked = targets.filter((item) => intentFor(data, item) || data.l4Preparation?.attentionDeliveries.some((delivery) => delivery.deliveryId === item.id));
  const linkedNotificationIds = linked.map((item) => item.id);
  const claimResult = (status: SyncResult["status"], recorded = 0, currentNotificationIds: string[] = [], g1LocalFallback = false): SyncResult =>
    ({ status, recorded, ...(claiming ? { linkedNotificationIds, currentNotificationIds } : {}),
      ...(g1LocalFallback ? { g1LocalFallback: true } : {}) });
  if (!claiming && !data.l4Preparation?.attentionIntents.length) return claimResult("unsupported");
  const carrierInstanceId = instanceId === undefined ? process.env[DESKTOP_INSTANCE_ID_ENV]?.trim() || "desktop-dev" : instanceId;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(carrierInstanceId)) return claimResult("unavailable");
  let roots;
  let host: RuntimeHost;
  try {
    if (runtime) {
      host = runtime.host;
    } else {
      roots = resolveEduPiBridgeRoots();
      host = await ensureEduPiRuntime(roots);
    }
    const health = asRecord(await host.call("health", null));
    const healthResult = asRecord(health?.result);
    const fingerprint = healthResult?.data_root_fingerprint;
    const capabilities = asRecord(healthResult?.capabilities);
    const supported = capabilities?.supported_operations;
    if (health?.ok !== true || typeof fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(fingerprint)
      || !Array.isArray(supported) || !supported.includes("attention_delivery_record")
      || claiming && !supported.includes("attention_delivery_read")) {
      return claimResult("unsupported");
    }
    let recorded = 0;
    for (const item of targets) {
      const intent = intentFor(data, item);
      if (!intent) continue;
      const delivery = currentDelivery(data, item, carrierInstanceId);
      let currentVersion = delivery?.version || 0;
      let currentStatus = delivery?.status || null;
      let next = transitionFor(action, currentStatus);
      if (!next) continue;
      const record = async (status: AttentionTransition, expectedVersion: number) => {
        const response = asRecord(await host!.call("attention_delivery_record", {
          command_id: commandId(item.id, status, expectedVersion + 1),
          root_ref: fingerprint,
          attention_intent_id: intent.attentionIntentId,
          opportunity_id: intent.opportunityId,
          work_case_id: intent.workCaseId,
          deep_link: intent.deepLink,
          carrier: { kind: "desktop", instance_id: carrierInstanceId },
          delivery_id: item.id,
          expected_version: expectedVersion,
          status,
          failure_code: status === "failed" || status === "retry" ? "notification_failed" : null,
          occurred_at: now.toISOString(),
        }));
        if (response?.ok !== true) throw new Error("attention_delivery_unavailable");
        recorded += 1;
      };
      if (!delivery && next !== "queued" && next !== "retry") {
        await record("queued", 0);
        currentVersion = 1;
        currentStatus = "queued";
        next = transitionFor(action, currentStatus);
      }
      if (!next) continue;
      await record(next, currentVersion);
    }
    if (!claiming) return claimResult("synced", recorded);
    const response = asRecord(await host.call("attention_delivery_read", {
      root_ref: fingerprint,
      carrier: { kind: "desktop", instance_id: carrierInstanceId },
    }));
    if (response?.ok === false && response.error_code === "activation_pending" && data.l4Preparation === null
      && linkedNotificationIds.length === 0 && capabilities?.g1_processor === "active"
      && capabilities.ambient_planning === "activation_pending" && capabilities.attention_delivery === "activation_pending") {
      return claimResult("unsupported", recorded, [], true);
    }
    const snapshot = asRecord(response?.result);
    if (response?.ok !== true || snapshot?.root_ref !== fingerprint || snapshot?.apply !== false
      || snapshot?.external_send !== false || !Array.isArray(snapshot?.deliveries)) return claimResult("unavailable", recorded);
    const currentNotificationIds: string[] = [];
    for (const item of targets) {
      const deliveries = snapshot.deliveries.map(asRecord).filter((delivery) => delivery?.delivery_id === item.id);
      if (deliveries.length) {
        if (!linkedNotificationIds.includes(item.id)) linkedNotificationIds.push(item.id);
        const intent = intentFor(data, item);
        const delivery = deliveries.length === 1 ? deliveries[0] : null;
        const carrier = asRecord(delivery?.carrier);
        if (intent && delivery?.attention_intent_id === intent.attentionIntentId
          && delivery.opportunity_id === intent.opportunityId && delivery.work_case_id === intent.workCaseId
          && delivery.deep_link === intent.deepLink && carrier?.kind === "desktop"
          && carrier.instance_id === carrierInstanceId && delivery.intent_current === true
          && delivery.external_send === false && (delivery.status === "queued" || delivery.status === "retry")) {
          currentNotificationIds.push(item.id);
        }
      }
    }
    return claimResult("synced", recorded, currentNotificationIds);
  } catch {
    return claimResult("unavailable");
  }
}
