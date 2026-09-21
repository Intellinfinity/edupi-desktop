import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { syncReminderAttention } = await createJiti(import.meta.url).import("./edupi-attention-delivery.ts");

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
