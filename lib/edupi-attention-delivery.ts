import { DESKTOP_INSTANCE_ID_ENV } from "./desktop-api";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import { ensureEduPiRuntime } from "./edupi-runtime-supervisor";
import type { EducationContract } from "./edupi-education-contract";
import type { Reminder } from "./edupi-reminder-store";

type AttentionAction = {
  id: string;
  type: "claim_notifications" | "notification_delivered" | "notification_failed" | "notification_opened" | "read" | "dismiss" | "handled" | "snooze" | "release_notification";
  taskId?: string;
};

type AttentionTransition = "queued" | "delivered" | "failed" | "retry" | "opened";

type SyncResult = { status: "synced" | "unsupported" | "unavailable"; recorded: number };
type RuntimeHost = { call(operation: string, payload: unknown): Promise<Record<string, unknown>> };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function affectedItems(items: readonly Reminder[], action: AttentionAction): readonly Reminder[] {
  if (action.type === "claim_notifications") return items;
  if (action.taskId) return items.filter((item) => item.taskId === action.taskId);
  if (action.id === "*") return items.filter((item) => item.notificationAttemptedAt);
  return items.filter((item) => item.id === action.id);
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

export async function syncReminderAttention({ data, items, action, now = new Date(), runtime }: {
  data: EducationContract;
  items: readonly Reminder[];
  action: AttentionAction;
  now?: Date;
  runtime?: { host: { call(operation: string, payload: unknown): Promise<Record<string, unknown>> }; roots?: unknown };
}): Promise<SyncResult> {
  if (!["claim_notifications", "notification_delivered", "notification_failed", "notification_opened"].includes(action.type)) {
    return { status: "synced", recorded: 0 };
  }
  if (!data.l4Preparation?.attentionIntents.length) return { status: "unsupported", recorded: 0 };
  const targets = affectedItems(items, action);
  if (!targets.length) return { status: "synced", recorded: 0 };
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
    if (typeof fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(fingerprint)
      || !Array.isArray(supported) || !supported.includes("attention_delivery_record")) {
      return { status: "unsupported", recorded: 0 };
    }
    const instanceId = process.env[DESKTOP_INSTANCE_ID_ENV]?.trim() || "desktop-dev";
    let recorded = 0;
    for (const item of targets) {
      const intent = intentFor(data, item);
      if (!intent) continue;
      const delivery = currentDelivery(data, item, instanceId);
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
          carrier: { kind: "desktop", instance_id: instanceId },
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
    return { status: "synced", recorded };
  } catch {
    return { status: "unavailable", recorded: 0 };
  }
}
