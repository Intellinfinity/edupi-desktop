import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { updateReminderStore } = await jiti.import("./edupi-reminder-store.ts");
const { reconcileReminderAttentionOutbox, reconcileReminderAttentionOutboxWithin, nativeAttentionRoute,
  persistNativeAttentionRouteMarks } = await jiti.import("./edupi-attention-outbox.ts");

function linkedData(reminderId, instanceId, status = "queued", taskId = "task-one") {
  return { workCases: [], l4Preparation: {
    attentionIntents: [{ attentionIntentId: "intent-one", opportunityId: "opportunity-one", workCaseId: taskId, deepLink: `edupi://task/${taskId}` }],
    attentionDeliveries: [{ deliveryId: reminderId, attentionIntentId: "intent-one", opportunityId: "opportunity-one",
      workCaseId: taskId, deepLink: `edupi://task/${taskId}`, carrier: { kind: "desktop", instanceId },
      status, version: 1, intentCurrent: true }],
  } };
}

test("Core outage leaves a durable native failure to retry after restart without spending another failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-attention-outage-"));
  const file = path.join(root, "reminders.json");
  const snapshot = { one: { taskId: "task-one", title: "数学草稿", completion: "ready", identity: "v1" } };
  try {
    const claim = (await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_000)).notifications[0];
    await updateReminderStore(file, snapshot, { id: "*", type: "mark_attention_routes", routes: [{
      reminderId: claim.id, attemptedAt: claim.notificationAttemptedAt, route: "core_linked", instanceId: "desktop-before-restart",
    }] }, 1_010);
    await updateReminderStore(file, snapshot, { id: claim.id, type: "notification_failed", attemptedAt: claim.notificationAttemptedAt }, 1_100);
    const unavailable = await reconcileReminderAttentionOutbox({ file, snapshot,
      readData: async () => linkedData(claim.id, "desktop-before-restart"),
      sync: async () => ({ status: "unavailable", recorded: 0 }),
    });
    assert.equal(unavailable.status, "unavailable");
    assert.equal(unavailable.pendingCount, 1);
    const duplicate = await updateReminderStore(file, snapshot, { id: claim.id, type: "notification_failed", attemptedAt: claim.notificationAttemptedAt }, 1_200);
    assert.equal(duplicate.attentionOutbox.length, 1);
    assert.equal(duplicate.items[0].notificationFailureCount, 1);

    const replayed = [];
    const recovered = await reconcileReminderAttentionOutbox({ file, snapshot,
      readData: async () => linkedData(claim.id, "desktop-before-restart"),
      sync: async ({ action, instanceId, now }) => {
        replayed.push({ type: action.type, instanceId, at: now.toISOString() });
        return { status: "synced", recorded: 1 };
      },
    });
    assert.equal(recovered.status, "synced");
    assert.equal(recovered.pendingCount, 0);
    assert.deepEqual(replayed, [{ type: "notification_failed", instanceId: "desktop-before-restart", at: new Date(1_100).toISOString() }]);
    const persisted = await updateReminderStore(file, snapshot, undefined, 1_300);
    assert.equal(persisted.attentionOutbox.length, 0);
    assert.equal(persisted.items[0].notificationFailureCount, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an unprovable first reminder does not starve a later linked outcome", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-attention-no-starvation-"));
  const file = path.join(root, "reminders.json");
  const snapshot = {
    first: { taskId: "task-one", title: "旧草稿", completion: "ready", identity: "v1" },
    second: { taskId: "task-two", title: "新草稿", completion: "ready", identity: "v1" },
  };
  try {
    const claimed = (await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_000)).notifications;
    const first = claimed.find((item) => item.taskId === "task-one");
    const second = claimed.find((item) => item.taskId === "task-two");
    assert.ok(first && second);
    await updateReminderStore(file, snapshot, { id: "*", type: "mark_attention_routes", routes: [{
      reminderId: second.id, attemptedAt: second.notificationAttemptedAt, route: "core_linked", instanceId: "desktop-original",
    }] }, 1_010);
    await updateReminderStore(file, snapshot, { id: first.id, type: "notification_delivered", attemptedAt: first.notificationAttemptedAt }, 1_100);
    await updateReminderStore(file, snapshot, { id: second.id, type: "notification_delivered", attemptedAt: second.notificationAttemptedAt }, 1_200);
    const replayed = [];
    const result = await reconcileReminderAttentionOutbox({ file, snapshot,
      readData: async () => linkedData(second.id, "desktop-original", "queued", "task-two"),
      sync: async ({ items }) => { replayed.push(items[0].id); return { status: "synced", recorded: 1 }; },
    });
    assert.equal(result.status, "unavailable");
    assert.deepEqual(replayed, [second.id]);
    assert.deepEqual(result.pendingIds, [first.id]);
    assert.equal(result.pendingCount, 1);
    assert.deepEqual(result.blocked, [{ reminderId: first.id, code: "core_link_unproven" }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("thirty-two unprovable rows cannot starve the thirty-third linked outcome", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-attention-deep-scan-"));
  const file = path.join(root, "reminders.json");
  const snapshot = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [String(index), {
    taskId: `task-${index}`, title: `草稿 ${index}`, completion: "ready", identity: "v1",
  }]));
  try {
    const created = await updateReminderStore(file, snapshot, undefined, 1_000);
    const linked = created.items[32];
    const stored = JSON.parse(await readFile(file, "utf8"));
    stored.items[32].attentionRoute = "core_linked";
    stored.items[32].attentionCarrierInstanceId = "desktop-original";
    stored.attentionOutbox = created.items.map((item, index) => ({ id: `outcome-${index}`, reminderId: item.id,
      taskId: item.taskId, type: "notification_delivered", occurredAt: new Date(1_100 + index).toISOString(),
      route: index === 32 ? "core_linked" : "unknown", ...(index === 32 ? { instanceId: "desktop-original" } : {}) }));
    await writeFile(file, JSON.stringify(stored));
    const replayed = [];
    const result = await reconcileReminderAttentionOutbox({ file, snapshot,
      readData: async () => linkedData(linked.id, "desktop-original", "queued", linked.taskId),
      sync: async ({ items }) => { replayed.push(items[0].id); return { status: "synced", recorded: 1 }; },
    });
    assert.deepEqual(replayed, [linked.id]);
    assert.equal(result.pendingCount, 32);
    assert.equal(JSON.parse(await readFile(file, "utf8")).attentionOutbox.length, 32);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a full queue rotates past 256 unprovable rows and replays a quarantined linked outcome", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-attention-overflow-replay-"));
  const file = path.join(root, "reminders.json");
  const snapshot = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [String(index), {
    taskId: `task-${index}`, title: `草稿 ${index}`, completion: "ready", identity: "v1",
  }]));
  try {
    const created = await updateReminderStore(file, snapshot, undefined, 1_000);
    const linked = created.items[256];
    const stored = JSON.parse(await readFile(file, "utf8"));
    stored.items[256].attentionRoute = "core_linked";
    stored.items[256].attentionCarrierInstanceId = "desktop-original";
    stored.attentionOutbox = created.items.slice(0, 256).map((item, index) => ({ id: `outcome-${index}`,
      reminderId: item.id, taskId: item.taskId, type: "notification_delivered", occurredAt: new Date(1_100 + index).toISOString(), route: "unknown" }));
    stored.attentionOverflow = { [linked.id]: [{ id: "overflow-linked", reminderId: linked.id, taskId: linked.taskId,
      type: "notification_delivered", occurredAt: new Date(2_000).toISOString(),
      route: "core_linked", instanceId: "desktop-original" }] };
    await writeFile(file, JSON.stringify(stored));
    const replayed = [];
    const options = { file, snapshot,
      readData: async () => linkedData(linked.id, "desktop-original", "queued", linked.taskId),
      sync: async ({ items }) => { replayed.push(items[0].id); return { status: "synced", recorded: 1 }; },
    };
    await reconcileReminderAttentionOutbox(options);
    assert.equal(replayed.length, 0);
    await reconcileReminderAttentionOutbox(options);
    assert.deepEqual(replayed, [linked.id]);
    const after = JSON.parse(await readFile(file, "utf8"));
    assert.equal(after.attentionOverflow[linked.id], undefined);
    assert.equal(after.attentionOutbox.length, 256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("multiple Core-linked outcomes replay in occurrence order and each uses fresh Core state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-attention-order-"));
  const file = path.join(root, "reminders.json");
  const snapshot = { one: { taskId: "task-one", title: "数学草稿", completion: "ready", identity: "v1" } };
  try {
    const claim = (await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_000)).notifications[0];
    await updateReminderStore(file, snapshot, { id: "*", type: "mark_attention_routes", routes: [{
      reminderId: claim.id, attemptedAt: claim.notificationAttemptedAt, route: "core_linked", instanceId: "desktop-original",
    }] }, 1_010);
    await updateReminderStore(file, snapshot, { id: claim.id, type: "notification_delivered", attemptedAt: claim.notificationAttemptedAt }, 1_100);
    await updateReminderStore(file, snapshot, { id: claim.id, taskId: claim.taskId, type: "notification_opened" }, 1_200);
    let currentStatus = "queued";
    const observed = [];
    const result = await reconcileReminderAttentionOutbox({ file, snapshot,
      readData: async () => linkedData(claim.id, "desktop-original", currentStatus),
      sync: async ({ action, data }) => {
        observed.push([action.type, data.l4Preparation.attentionDeliveries[0].status]);
        currentStatus = action.type === "notification_delivered" ? "delivered" : "opened";
        return { status: "synced", recorded: 1 };
      },
    });
    assert.equal(result.status, "synced");
    assert.deepEqual(observed, [["notification_delivered", "queued"], ["notification_opened", "delivered"]]);
    assert.equal((await updateReminderStore(file, snapshot)).attentionOutbox.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unbound outcomes remain pending when Core linkage cannot be proven; explicit G1 local outcomes do not queue", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-attention-scope-"));
  const file = path.join(root, "reminders.json");
  const snapshot = { one: { taskId: "task-one", title: "数学草稿", completion: "ready", identity: "v1", nativeSource: "core_g1" } };
  try {
    const claim = (await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_000)).notifications[0];
    await updateReminderStore(file, snapshot, { id: claim.id, type: "notification_delivered", attemptedAt: claim.notificationAttemptedAt }, 1_100);
    let syncCalls = 0;
    const unknown = await reconcileReminderAttentionOutbox({ file, snapshot,
      readData: async () => ({ workCases: [], l4Preparation: null }),
      sync: async () => { syncCalls++; return { status: "synced", recorded: 1 }; },
    });
    assert.equal(unknown.status, "unavailable");
    assert.equal(unknown.pendingCount, 1);
    assert.equal(syncCalls, 0);

    const localFile = path.join(root, "local.json");
    const localClaim = (await updateReminderStore(localFile, snapshot, { id: "*", type: "claim_notifications" }, 2_000)).notifications[0];
    await updateReminderStore(localFile, snapshot, { id: "*", type: "mark_attention_routes", routes: [{
      reminderId: localClaim.id, attemptedAt: localClaim.notificationAttemptedAt, route: "g1_local",
    }] }, 2_010);
    const local = await updateReminderStore(localFile, snapshot, { id: localClaim.id, type: "notification_delivered", attemptedAt: localClaim.notificationAttemptedAt }, 2_100);
    assert.equal(local.attentionOutbox.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a G1-local failure can later bind a Core claim, while an old Core claim cannot silently downgrade to local", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-attention-route-change-"));
  const file = path.join(root, "reminders.json");
  const snapshot = { one: { taskId: "task-one", title: "数学草稿", completion: "ready", identity: "v1", nativeSource: "core_g1" } };
  try {
    const first = (await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_000)).notifications[0];
    await updateReminderStore(file, snapshot, { id: "*", type: "mark_attention_routes", routes: [{
      reminderId: first.id, attemptedAt: first.notificationAttemptedAt, route: "g1_local",
    }] }, 1_010);
    await updateReminderStore(file, snapshot, { id: first.id, type: "notification_failed", attemptedAt: first.notificationAttemptedAt }, 1_100);
    const retry = (await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 301_101)).notifications[0];
    const promoted = nativeAttentionRoute(retry, { status: "synced", recorded: 1,
      linkedNotificationIds: [retry.id], currentNotificationIds: [retry.id] });
    assert.equal(promoted, "core_linked");
    await updateReminderStore(file, snapshot, { id: "*", type: "mark_attention_routes", routes: [{
      reminderId: retry.id, attemptedAt: retry.notificationAttemptedAt, route: promoted, instanceId: "desktop-after-restart",
    }] }, 301_110);
    const linked = (await updateReminderStore(file, snapshot)).items[0];
    assert.equal(linked.attentionRoute, "core_linked");
    assert.equal(linked.attentionCarrierInstanceId, "desktop-after-restart");
    assert.equal(nativeAttentionRoute(linked, { status: "unsupported", recorded: 0, g1LocalFallback: true }), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an inbox read has a short reconciliation budget while the durable outcome continues in the background", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-attention-budget-"));
  const file = path.join(root, "reminders.json");
  const snapshot = { one: { taskId: "task-one", title: "数学草稿", completion: "ready", identity: "v1" } };
  let releaseCore;
  try {
    const claim = (await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_000)).notifications[0];
    await updateReminderStore(file, snapshot, { id: "*", type: "mark_attention_routes", routes: [{
      reminderId: claim.id, attemptedAt: claim.notificationAttemptedAt, route: "core_linked", instanceId: "desktop-original",
    }] }, 1_010);
    const delivered = await updateReminderStore(file, snapshot, { id: claim.id, type: "notification_delivered", attemptedAt: claim.notificationAttemptedAt }, 1_100);
    const coreWait = new Promise((resolve) => { releaseCore = resolve; });
    const started = Date.now();
    const response = await reconcileReminderAttentionOutboxWithin({ file, snapshot,
      readData: async () => linkedData(claim.id, "desktop-original"),
      sync: async () => { await coreWait; return { status: "synced", recorded: 1 }; },
    }, 20, delivered.attentionOutbox);
    assert.equal(response.status, "unavailable");
    assert.equal(response.pendingCount, 1);
    assert.ok(Date.now() - started < 500);
    assert.equal((await updateReminderStore(file, snapshot)).attentionOutbox.length, 1);
    releaseCore();
    let remaining = 1;
    for (let index = 0; index < 100; index++) {
      remaining = JSON.parse(await readFile(file, "utf8")).attentionOutbox.length;
      if (!remaining) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(remaining, 0);
  } finally { releaseCore?.(); await rm(root, { recursive: true, force: true }); }
});

test("one conflicting route mark is deferred without blocking another valid native claim", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-attention-mark-conflict-"));
  const file = path.join(root, "reminders.json");
  const snapshot = {
    first: { taskId: "task-one", title: "数学草稿", completion: "ready", identity: "v1" },
    second: { taskId: "task-two", title: "语文草稿", completion: "ready", identity: "v1", nativeSource: "teacher_created" },
  };
  try {
    const claims = (await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_000)).notifications;
    const first = claims.find((item) => item.taskId === "task-one");
    const second = claims.find((item) => item.taskId === "task-two");
    assert.ok(first && second);
    await updateReminderStore(file, snapshot, { id: "*", type: "mark_attention_routes", routes: [{
      reminderId: first.id, attemptedAt: first.notificationAttemptedAt, route: "core_linked", instanceId: "old-carrier",
    }] }, 1_010);
    const result = await persistNativeAttentionRouteMarks(file, snapshot, [
      { reminderId: first.id, attemptedAt: first.notificationAttemptedAt, route: "core_linked", instanceId: "new-carrier" },
      { reminderId: second.id, attemptedAt: second.notificationAttemptedAt, route: "teacher_local" },
    ]);
    assert.deepEqual(result.acceptedIds, [second.id]);
    assert.deepEqual(result.deferredIds, [first.id]);
    const persisted = await updateReminderStore(file, snapshot);
    assert.equal(persisted.items.find((item) => item.id === first.id).notificationAttemptedAt, undefined);
    assert.ok(persisted.items.find((item) => item.id === first.id).notificationRetryAt);
    assert.equal(persisted.items.find((item) => item.id === second.id).attentionRoute, "teacher_local");
    assert.equal(persisted.items.find((item) => item.id === second.id).notificationAttemptedAt, second.notificationAttemptedAt);
  } finally { await rm(root, { recursive: true, force: true }); }
});
