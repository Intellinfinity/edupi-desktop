import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { selectNativeReminderNotifications, syncReminderAttention } = await createJiti(import.meta.url).import("./edupi-attention-delivery.ts");
const { updateReminderStore } = await createJiti(import.meta.url).import("./edupi-reminder-store.ts");

const intent = {
  attentionIntentId: "sha256:attention",
  opportunityId: "sha256:opportunity",
  workCaseId: "work_case_1",
  reason: "missing_material",
  createdAt: "2026-09-22T00:00:00.000Z",
  deliveryPolicy: "desktop_only",
  deepLink: "edupi://today/work/work_case_1",
  externalSend: false,
};
const data = {
  workCases: [{ id: "work_case_1", taskId: "task-1" }],
  l4Preparation: { attentionIntents: [intent], attentionDeliveries: [] },
};
const item = { id: "reminder-1", taskId: "task-1", notificationAttemptedAt: "2026-09-22T00:00:00.000Z" };

test("attention sync records a queued-to-delivered transition when Core exposes the operation", async () => {
  const calls = [];
  const host = { call: async (operation, payload) => {
    calls.push([operation, payload]);
    if (operation === "health") return { ok: true, result: { data_root_fingerprint: `sha256:${"a".repeat(64)}`, capabilities: { supported_operations: ["attention_delivery_record"] } } };
    return { ok: true, result: { receipt: {} } };
  } };
  const result = await syncReminderAttention({
    data,
    items: [item],
    action: { id: item.id, type: "notification_delivered" },
    runtime: { host, roots: {} },
  });
  assert.equal(result.status, "synced");
  assert.equal(result.recorded, 2);
  assert.equal(calls[1][0], "attention_delivery_record");
  assert.equal(calls[1][1].status, "queued");
  assert.equal(calls[2][1].status, "delivered");
});

test("attention sync safely degrades when the pinned Core lacks the operation", async () => {
  const host = { call: async () => ({ ok: true, result: { data_root_fingerprint: `sha256:${"a".repeat(64)}`, capabilities: { supported_operations: [] } } }) };
  const result = await syncReminderAttention({ data, items: [item], action: { id: item.id, type: "notification_delivered" }, runtime: { host, roots: {} } });
  assert.deepEqual(result, { status: "unsupported", recorded: 0 });
});

test("a replayed queued receipt cannot authorize native send when current Core read withdraws its intent", async () => {
  const calls = [];
  const host = { call: async (operation) => {
    calls.push(operation);
    if (operation === "health") return { ok: true, result: { data_root_fingerprint: `sha256:${"a".repeat(64)}`,
      capabilities: { supported_operations: ["attention_delivery_record", "attention_delivery_read"] } } };
    if (operation === "attention_delivery_record") return { ok: true, result: { receipt: { intent_current: true }, replayed: true } };
    return { ok: true, result: { root_ref: `sha256:${"a".repeat(64)}`, apply: false, external_send: false, deliveries: [{
      delivery_id: item.id, attention_intent_id: intent.attentionIntentId, opportunity_id: intent.opportunityId,
      work_case_id: intent.workCaseId, deep_link: intent.deepLink, carrier: { kind: "desktop", instance_id: "desktop-dev" },
      status: "queued", intent_current: false, external_send: false,
    }] } };
  } };
  const result = await syncReminderAttention({ data, items: [item], action: { id: "*", type: "claim_notifications" }, runtime: { host } });
  assert.deepEqual(result.linkedNotificationIds, [item.id]);
  assert.deepEqual(result.currentNotificationIds, []);
  assert.deepEqual(calls, ["health", "attention_delivery_record", "attention_delivery_read"]);
});

test("only an exact current Core delivery binding authorizes a linked reminder; unrelated reminders remain legacy", async () => {
  const legacy = { ...item, id: "legacy-1", taskId: "legacy-task" };
  const host = { call: async (operation) => {
    if (operation === "health") return { ok: true, result: { data_root_fingerprint: `sha256:${"a".repeat(64)}`,
      capabilities: { supported_operations: ["attention_delivery_record", "attention_delivery_read"] } } };
    if (operation === "attention_delivery_record") return { ok: true, result: { receipt: { intent_current: true }, replayed: false } };
    return { ok: true, result: { root_ref: `sha256:${"a".repeat(64)}`, apply: false, external_send: false, deliveries: [{
      delivery_id: item.id, attention_intent_id: intent.attentionIntentId, opportunity_id: intent.opportunityId,
      work_case_id: intent.workCaseId, deep_link: intent.deepLink, carrier: { kind: "desktop", instance_id: "desktop-dev" },
      status: "queued", intent_current: true, external_send: false,
    }] } };
  } };
  const result = await syncReminderAttention({ data, items: [item, legacy], action: { id: "*", type: "claim_notifications" }, runtime: { host } });
  assert.deepEqual(result.linkedNotificationIds, [item.id]);
  assert.deepEqual(result.currentNotificationIds, [item.id]);
  assert.deepEqual(selectNativeReminderNotifications([item, legacy], result).map((candidate) => candidate.id), [item.id, legacy.id]);
});

test("Core read failure never turns a linked reminder into native-send authority", async () => {
  const host = { call: async (operation) => {
    if (operation === "health") return { ok: true, result: { data_root_fingerprint: `sha256:${"a".repeat(64)}`,
      capabilities: { supported_operations: ["attention_delivery_record", "attention_delivery_read"] } } };
    if (operation === "attention_delivery_record") return { ok: true, result: { receipt: { intent_current: true }, replayed: false } };
    throw new Error("Core read unavailable");
  } };
  const result = await syncReminderAttention({ data, items: [item], action: { id: "*", type: "claim_notifications" }, runtime: { host } });
  assert.deepEqual(result.linkedNotificationIds, [item.id]);
  assert.deepEqual(result.currentNotificationIds, []);
  assert.deepEqual(selectNativeReminderNotifications([item], result), []);
});

test("a mismatched carrier or deep link is not permission to send", async () => {
  const host = { call: async (operation) => {
    if (operation === "health") return { ok: true, result: { data_root_fingerprint: `sha256:${"a".repeat(64)}`,
      capabilities: { supported_operations: ["attention_delivery_record", "attention_delivery_read"] } } };
    if (operation === "attention_delivery_record") return { ok: true, result: { receipt: {} } };
    return { ok: true, result: { root_ref: `sha256:${"a".repeat(64)}`, apply: false, external_send: false, deliveries: [{
      delivery_id: item.id, attention_intent_id: intent.attentionIntentId, opportunity_id: intent.opportunityId,
      work_case_id: intent.workCaseId, deep_link: "edupi://today/work/other",
      carrier: { kind: "desktop", instance_id: "other-desktop" }, status: "queued", intent_current: true, external_send: false,
    }] } };
  } };
  const result = await syncReminderAttention({ data, items: [item], action: { id: "*", type: "claim_notifications" }, runtime: { host } });
  assert.deepEqual(selectNativeReminderNotifications([item], result), []);
});

test("previously linked delivery stays blocked when the current intent disappears", async () => {
  const withdrawn = { ...data, l4Preparation: { ...data.l4Preparation, attentionIntents: [] } };
  const host = { call: async (operation) => {
    if (operation === "health") return { ok: true, result: { data_root_fingerprint: `sha256:${"a".repeat(64)}`,
      capabilities: { supported_operations: ["attention_delivery_record", "attention_delivery_read"] } } };
    if (operation === "attention_delivery_read") return { ok: true, result: { root_ref: `sha256:${"a".repeat(64)}`, apply: false, external_send: false, deliveries: [{
      delivery_id: item.id, attention_intent_id: intent.attentionIntentId, opportunity_id: intent.opportunityId,
      work_case_id: intent.workCaseId, deep_link: intent.deepLink,
      carrier: { kind: "desktop", instance_id: "desktop-dev" }, status: "queued", intent_current: false, external_send: false,
    }] } };
    throw new Error(`Unexpected operation ${operation}`);
  } };
  const result = await syncReminderAttention({ data: withdrawn, items: [item], action: { id: "*", type: "claim_notifications" }, runtime: { host } });
  assert.deepEqual(result.linkedNotificationIds, [item.id]);
  assert.deepEqual(selectNativeReminderNotifications([item], result), []);
});

test("a missing L4 projection does not disguise an older Core delivery as legacy", async () => {
  const host = { call: async (operation) => {
    if (operation === "health") return { ok: true, result: { data_root_fingerprint: `sha256:${"a".repeat(64)}`,
      capabilities: { supported_operations: ["attention_delivery_record", "attention_delivery_read"] } } };
    if (operation === "attention_delivery_read") return { ok: true, result: { root_ref: `sha256:${"a".repeat(64)}`, apply: false, external_send: false, deliveries: [{
      delivery_id: item.id, attention_intent_id: intent.attentionIntentId, opportunity_id: intent.opportunityId,
      work_case_id: intent.workCaseId, deep_link: intent.deepLink,
      carrier: { kind: "desktop", instance_id: "desktop-dev" }, status: "queued", intent_current: false, external_send: false,
    }] } };
    throw new Error(`Unexpected operation ${operation}`);
  } };
  const result = await syncReminderAttention({ data: { ...data, l4Preparation: null }, items: [item],
    action: { id: "*", type: "claim_notifications" }, runtime: { host } });
  assert.deepEqual(result.linkedNotificationIds, [item.id]);
  assert.deepEqual(selectNativeReminderNotifications([item], result), []);
});

test("a Core without current-read support blocks linked claims while leaving unlinked legacy claims", async () => {
  const legacy = { ...item, id: "legacy-1", taskId: "legacy-task" };
  const host = { call: async () => ({ ok: true, result: { data_root_fingerprint: `sha256:${"a".repeat(64)}`,
    capabilities: { supported_operations: ["attention_delivery_record"] } } }) };
  const result = await syncReminderAttention({ data, items: [item, legacy], action: { id: "*", type: "claim_notifications" }, runtime: { host } });
  assert.equal(result.status, "unsupported");
  assert.deepEqual(selectNativeReminderNotifications([item, legacy], result).map((candidate) => candidate.id), [legacy.id]);
});

test("blocked native claims remain in the inbox and back off without duplicate sends", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-attention-fence-"));
  const file = path.join(root, "reminders.json");
  const snapshot = { one: { taskId: item.taskId, title: "教案待审核", completion: "ready", identity: "v1" } };
  const host = { call: async (operation, payload) => {
    if (operation === "health") return { ok: true, result: { data_root_fingerprint: `sha256:${"a".repeat(64)}`,
      capabilities: { supported_operations: ["attention_delivery_record", "attention_delivery_read"] } } };
    if (operation === "attention_delivery_record") return { ok: true, result: { receipt: { intent_current: true }, replayed: true } };
    assert.equal(payload.carrier.instance_id, "desktop-dev");
    return { ok: true, result: { root_ref: `sha256:${"a".repeat(64)}`, apply: false, external_send: false, deliveries: [] } };
  } };
  try {
    for (const [claimAt, failureAt] of [[2_000, 2_100], [302_101, 302_201], [902_202, 902_302]]) {
      const claimed = await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, claimAt);
      assert.equal(claimed.notifications.length, 1);
      const attention = await syncReminderAttention({ data, items: claimed.notifications,
        action: { id: "*", type: "claim_notifications" }, runtime: { host } });
      assert.deepEqual(selectNativeReminderNotifications(claimed.notifications, attention), []);
      await updateReminderStore(file, snapshot, { id: claimed.notifications[0].id, type: "notification_failed" }, failureAt);
    }
    const persisted = await updateReminderStore(file, snapshot, undefined, 902_303);
    assert.equal(persisted.items.length, 1);
    assert.equal(persisted.items[0].withdrawn, false);
    assert.equal(persisted.items[0].notificationFailureCount, 3);
    assert.equal(persisted.metrics.notificationSuppressedCount, 1);
    assert.equal((await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 2_000_000)).notifications.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
