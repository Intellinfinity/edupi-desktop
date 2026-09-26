import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const { updateReminderStore } = await createJiti(import.meta.url).import("./edupi-reminder-store.ts");
test("reminders persist, deduplicate and separate snooze from notification dismissal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminders-"));
  const file = path.join(root, "reminders.json");
  const snapshot = { a: { taskId: "a", title: "教案", completion: "ready", identity: "v1" } };
  try {
    const first = await updateReminderStore(file, snapshot, undefined, 1000);
    const id = first.items[0].id;
    const repeated = await Promise.all([updateReminderStore(file, snapshot), updateReminderStore(file, snapshot)]);
    assert.equal(repeated[1].items.length, 1);
    const claims = await Promise.all([updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }), updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" })]);
    assert.equal(claims.reduce((sum, result) => sum + result.notifications.length, 0), 1);
    const claimed = claims.flatMap(result => result.notifications)[0];
    await updateReminderStore(file, snapshot, { id, type: "release_notification", attemptedAt: "2000-01-01T00:00:00Z" });
    assert.equal((await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" })).notifications.length, 0);
    await updateReminderStore(file, snapshot, { id, type: "release_notification", attemptedAt: claimed.notificationAttemptedAt });
    assert.equal((await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" })).notifications.length, 1);
    const read = await updateReminderStore(file, snapshot, { id, type: "read" }, 2000);
    assert.equal(read.items[0].read, true); assert.equal(read.items[0].handled, false);
    await updateReminderStore(file, snapshot, { id, type: "snooze" }, 3000);
    const due = await updateReminderStore(file, snapshot, undefined, 3603001);
    assert.equal(due.items[0].read, false); assert.equal(due.items[0].snoozedUntil, null);
    assert.equal((await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 3603002)).notifications.length, 1);
    await updateReminderStore(file, snapshot, { id, type: "dismiss" });
    assert.equal((await updateReminderStore(file, snapshot)).items[0].handled, true);
    const withdrawn = await updateReminderStore(file, {}, { id: "*", type: "claim_notifications" });
    assert.equal(withdrawn.items[0].withdrawn, true);
    assert.equal(withdrawn.notifications.length, 0);
    const renamed = await updateReminderStore(file, { a: { ...snapshot.a, title: "修订教案" } });
    assert.equal(renamed.items[0].title, "修订教案");
    assert.equal(renamed.items[0].withdrawn, false);
    assert.equal(renamed.items[0].handled, true);
    await writeFile(file, "broken");
    await assert.rejects(updateReminderStore(file, snapshot));
    assert.equal(await readFile(file, "utf8"), "broken");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("notification lifecycle records delivery, failure, open and raw proactivity metrics", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-metrics-"));
  const file = path.join(root, "reminders.json");
  const snapshot = {
    a: { taskId: "a", title: "教案", completion: "ready", identity: "v1" },
    b: { taskId: "b", title: "课表", completion: "due", identity: "v1" },
  };
  try {
    const created = await updateReminderStore(file, snapshot, undefined, 1_000);
    const claims = await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 2_000);
    assert.equal(claims.notifications.length, 2);
    const first = claims.notifications.find((item) => item.taskId === "a");
    const second = claims.notifications.find((item) => item.taskId === "b");
    assert.ok(first && second);
    await updateReminderStore(file, snapshot, { id: first.id, type: "notification_delivered", attemptedAt: first.notificationAttemptedAt }, 2_100);
    await updateReminderStore(file, snapshot, { id: second.id, type: "notification_failed", attemptedAt: second.notificationAttemptedAt }, 2_200);
    const suppressed = await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 3_000);
    assert.equal(suppressed.notifications.length, 0);
    const retry = await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 302_201);
    assert.deepEqual(retry.notifications.map((item) => item.id), [second.id]);
    await updateReminderStore(file, snapshot, { id: second.id, type: "notification_delivered", attemptedAt: retry.notifications[0].notificationAttemptedAt }, 302_301);
    const opened = await updateReminderStore(file, snapshot, { id: "*", type: "notification_opened", taskId: "b" }, 302_401);
    assert.equal(opened.items.find((item) => item.id === second.id)?.read, true);
    assert.equal(opened.metrics.candidateCount, 2);
    assert.equal(opened.metrics.notificationClaimCount, 3);
    assert.equal(opened.metrics.notificationDeliveredCount, 2);
    assert.equal(opened.metrics.notificationFailedCount, 1);
    assert.equal(opened.metrics.notificationOpenedCount, 1);
    assert.equal(opened.metrics.notificationSuppressedCount, 0);
    assert.equal(opened.metrics.duplicateClaimCount, 1);
    assert.equal(opened.metrics.averageDeliveryLatencyMs, 100);
    assert.equal(opened.metrics.averageOpenLatencyMs, 100);
    const extended = { ...snapshot, c: { taskId: "c", title: "另一项", completion: "due", identity: "v1" } };
    let capped;
    for (const claimTime of [400_100, 700_201, 1_300_302]) {
      const claim = await updateReminderStore(file, extended, { id: "*", type: "claim_notifications" }, claimTime);
      const item = claim.notifications.find((notification) => notification.taskId === "c");
      assert.ok(item?.notificationAttemptedAt);
      capped = await updateReminderStore(file, extended, { id: item.id, type: "notification_failed", attemptedAt: item.notificationAttemptedAt }, claimTime + 100);
    }
    assert.equal((await updateReminderStore(file, extended, { id: "*", type: "claim_notifications" }, 3_000_000)).notifications.length, 0);
    assert.equal(capped.metrics.notificationSuppressedCount, 1);
    assert.equal(created.metrics.candidateCount, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("notification outcomes are bound to one claim and duplicate or stale callbacks do not retry work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-claim-"));
  const file = path.join(root, "reminders.json");
  const snapshot = { one: { taskId: "task-a", title: "课前草稿", completion: "ready", identity: "draft-r1" } };
  try {
    const first = (await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_000)).notifications[0];
    assert.ok(first?.notificationAttemptedAt);
    await updateReminderStore(file, snapshot, { id: first.id, type: "notification_failed", attemptedAt: first.notificationAttemptedAt }, 1_100);
    const duplicate = await updateReminderStore(file, snapshot, { id: first.id, type: "notification_failed", attemptedAt: first.notificationAttemptedAt }, 1_200);
    assert.equal(duplicate.metrics.notificationFailedCount, 1);
    assert.equal(duplicate.items[0].notificationFailureCount, 1);

    const retry = (await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 301_101)).notifications[0];
    assert.ok(retry?.notificationAttemptedAt);
    assert.notEqual(retry.notificationAttemptedAt, first.notificationAttemptedAt);
    const stale = await updateReminderStore(file, snapshot, { id: first.id, type: "notification_failed", attemptedAt: first.notificationAttemptedAt }, 301_200);
    assert.equal(stale.items[0].notificationAttemptedAt, retry.notificationAttemptedAt);
    assert.equal(stale.metrics.notificationFailedCount, 1);

    await updateReminderStore(file, snapshot, { id: retry.id, type: "notification_delivered", attemptedAt: retry.notificationAttemptedAt }, 301_300);
    const deliveredTwice = await updateReminderStore(file, snapshot, { id: retry.id, type: "notification_delivered", attemptedAt: retry.notificationAttemptedAt }, 301_400);
    assert.equal(deliveredTwice.metrics.notificationDeliveredCount, 1);
    const lateFailure = await updateReminderStore(file, snapshot, { id: retry.id, type: "notification_failed", attemptedAt: retry.notificationAttemptedAt }, 301_500);
    assert.equal(lateFailure.metrics.notificationFailedCount, 1);
    assert.equal(lateFailure.items[0].notificationFailureCount, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("notification click opens only its exact reminder and matching task once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-open-"));
  const file = path.join(root, "reminders.json");
  const snapshot = {
    one: { taskId: "task-one", title: "数学草稿", completion: "ready", identity: "v1" },
    two: { taskId: "task-two", title: "语文草稿", completion: "ready", identity: "v1" },
  };
  try {
    const created = await updateReminderStore(file, snapshot, undefined, 1_000);
    const first = created.items.find((item) => item.taskId === "task-one");
    const second = created.items.find((item) => item.taskId === "task-two");
    assert.ok(first && second);
    await assert.rejects(updateReminderStore(file, snapshot, { id: first.id, type: "notification_opened", taskId: "task-two" }, 2_000), /提醒不存在/u);
    const opened = await updateReminderStore(file, snapshot, { id: first.id, type: "notification_opened", taskId: "task-one" }, 3_000);
    assert.equal(opened.items.find((item) => item.id === first.id)?.read, true);
    assert.equal(opened.items.find((item) => item.id === second.id)?.read, false);
    const duplicate = await updateReminderStore(file, snapshot, { id: first.id, type: "notification_opened", taskId: "task-one" }, 4_000);
    assert.equal(duplicate.metrics.notificationOpenedCount, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("opening a notification is terminal for delayed delivery and failure callbacks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-open-race-"));
  const file = path.join(root, "reminders.json");
  const snapshot = { one: { taskId: "task-one", title: "数学草稿", completion: "ready", identity: "v1" } };
  try {
    const claim = (await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_000)).notifications[0];
    await updateReminderStore(file, snapshot, { id: claim.id, taskId: claim.taskId, type: "notification_opened" }, 1_100);
    const failed = await updateReminderStore(file, snapshot, { id: claim.id, type: "notification_failed", attemptedAt: claim.notificationAttemptedAt }, 1_200);
    const delivered = await updateReminderStore(file, snapshot, { id: claim.id, type: "notification_delivered", attemptedAt: claim.notificationAttemptedAt }, 1_300);
    assert.equal(failed.notificationTransitionApplied, false);
    assert.equal(delivered.notificationTransitionApplied, false);
    assert.equal(delivered.items[0].notificationFailureCount, undefined);
    assert.equal(delivered.items[0].notificationDeliveredAt, undefined);
    assert.equal(delivered.items[0].read, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a route conflict cannot defer or release an already delivered native notification", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-delivered-terminal-"));
  const file = path.join(root, "reminders.json");
  const snapshot = { one: { taskId: "task-one", title: "数学草稿", completion: "ready", identity: "v1" } };
  try {
    const claim = (await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_000)).notifications[0];
    await updateReminderStore(file, snapshot, { id: claim.id, type: "notification_delivered", attemptedAt: claim.notificationAttemptedAt }, 1_100);
    await updateReminderStore(file, snapshot, { id: claim.id, type: "notification_deferred", attemptedAt: claim.notificationAttemptedAt }, 1_200);
    const after = await updateReminderStore(file, snapshot, { id: claim.id, type: "release_notification", attemptedAt: claim.notificationAttemptedAt }, 1_300);
    assert.equal(after.items[0].notificationAttemptedAt, claim.notificationAttemptedAt);
    assert.equal(after.items[0].notificationRetryAt, undefined);
    assert.equal(after.metrics.notificationDeferredCount, 0);
    assert.equal((await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_400)).notifications.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("new manual-task provenance persists but old unmarked records are never backfilled", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-source-"));
  const file = path.join(root, "reminders.json");
  const oldFile = path.join(root, "old-reminders.json");
  const event = { taskId: "manual-task", title: "会务", completion: "due", identity: "due:2026-09-23", nativeSource: "teacher_created" };
  try {
    const created = await updateReminderStore(file, { one: event }, undefined, 1_000);
    assert.equal(created.items[0].nativeSource, "teacher_created");
    assert.equal((await updateReminderStore(file, { one: event }, undefined, 2_000)).items[0].nativeSource, "teacher_created");
    const narrowed = await updateReminderStore(file, { one: { ...event, nativeSource: undefined } }, undefined, 3_000);
    assert.equal(narrowed.items[0].nativeSource, undefined);
    await writeFile(oldFile, JSON.stringify({ version: 1, items: [{ id: "old-id", taskId: event.taskId,
      title: event.title, kind: "due", identity: event.identity, createdAt: "2026-09-20T00:00:00.000Z",
      read: false, handled: false, snoozedUntil: null }] }));
    const old = await updateReminderStore(oldFile, { one: event }, undefined, 4_000);
    assert.equal(old.items[0].nativeSource, undefined);
    assert.equal(old.items[0].id, "old-id");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a Core-linked native outcome is durably queued with its original carrier before Core sync", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-outbox-"));
  const file = path.join(root, "reminders.json");
  const snapshot = { one: { taskId: "task-one", title: "数学草稿", completion: "ready", identity: "v1" } };
  try {
    const claim = (await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_000)).notifications[0];
    await updateReminderStore(file, snapshot, { id: "*", type: "mark_attention_routes", routes: [{
      reminderId: claim.id, attemptedAt: claim.notificationAttemptedAt, route: "core_linked", instanceId: "desktop-first-launch",
    }] }, 1_010);
    const delivered = await updateReminderStore(file, snapshot, {
      id: claim.id, type: "notification_delivered", attemptedAt: claim.notificationAttemptedAt,
    }, 1_100);
    assert.equal(delivered.attentionOutbox.length, 1);
    assert.deepEqual({ ...delivered.attentionOutbox[0], id: undefined }, {
      id: undefined, reminderId: claim.id, taskId: claim.taskId, type: "notification_delivered",
      attemptedAt: claim.notificationAttemptedAt, occurredAt: new Date(1_100).toISOString(),
      route: "core_linked", instanceId: "desktop-first-launch",
    });
    const duplicate = await updateReminderStore(file, snapshot, {
      id: claim.id, type: "notification_delivered", attemptedAt: claim.notificationAttemptedAt,
    }, 1_200);
    assert.equal(duplicate.attentionOutbox.length, 1);
    assert.equal(duplicate.metrics.notificationDeliveredCount, 1);
    const afterRestart = await updateReminderStore(file, snapshot, undefined, 1_300);
    assert.equal(afterRestart.attentionOutbox[0].id, delivered.attentionOutbox[0].id);
    assert.equal(afterRestart.items[0].attentionCarrierInstanceId, "desktop-first-launch");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a full attention outbox still persists the native outcome in a per-reminder overflow without dropping old evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-outbox-cap-"));
  const file = path.join(root, "reminders.json");
  const snapshot = { one: { taskId: "task-one", title: "数学草稿", completion: "ready", identity: "v1" } };
  try {
    const claim = (await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_000)).notifications[0];
    await updateReminderStore(file, snapshot, { id: "*", type: "mark_attention_routes", routes: [{
      reminderId: claim.id, attemptedAt: claim.notificationAttemptedAt, route: "core_linked", instanceId: "desktop-original",
    }] }, 1_010);
    const stored = JSON.parse(await readFile(file, "utf8"));
    stored.attentionOutbox = Array.from({ length: 256 }, (_, index) => ({ id: `pending-${index}`, reminderId: claim.id,
      taskId: claim.taskId, type: "notification_delivered", occurredAt: new Date(index).toISOString(),
      route: "core_linked", instanceId: "desktop-original" }));
    await writeFile(file, JSON.stringify(stored));
    const failed = await updateReminderStore(file, snapshot, {
      id: claim.id, type: "notification_failed", attemptedAt: claim.notificationAttemptedAt,
    }, 1_100);
    const after = JSON.parse(await readFile(file, "utf8"));
    assert.equal(after.attentionOutbox.length, 256);
    assert.equal(after.attentionOverflow[claim.id].length, 1);
    assert.equal(after.attentionOverflow[claim.id][0].type, "notification_failed");
    assert.equal(after.items[0].notificationFailureCount, 1);
    assert.equal(after.items[0].notificationAttemptedAt, undefined);
    assert.equal(failed.notificationTransitionApplied, true);
    const duplicate = await updateReminderStore(file, snapshot, {
      id: claim.id, type: "notification_failed", attemptedAt: claim.notificationAttemptedAt,
    }, 1_200);
    assert.equal(duplicate.attentionOverflow[claim.id].length, 1);
    assert.equal(duplicate.items[0].notificationFailureCount, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a reminder keeps later outcomes behind its overflow even after the main queue frees a slot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-overflow-order-"));
  const file = path.join(root, "reminders.json");
  const snapshot = { one: { taskId: "task-one", title: "数学草稿", completion: "ready", identity: "v1" } };
  try {
    const first = (await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_000)).notifications[0];
    await updateReminderStore(file, snapshot, { id: "*", type: "mark_attention_routes", routes: [{
      reminderId: first.id, attemptedAt: first.notificationAttemptedAt, route: "core_linked", instanceId: "desktop-original",
    }] }, 1_010);
    const stored = JSON.parse(await readFile(file, "utf8"));
    stored.attentionOutbox = Array.from({ length: 256 }, (_, index) => ({ id: `pending-${index}`, reminderId: `other-${index}`,
      taskId: `task-other-${index}`, type: "notification_delivered", occurredAt: new Date(index).toISOString(), route: "unknown" }));
    await writeFile(file, JSON.stringify(stored));
    await updateReminderStore(file, snapshot, { id: first.id, type: "notification_failed", attemptedAt: first.notificationAttemptedAt }, 1_100);
    await updateReminderStore(file, snapshot, { id: "*", type: "ack_attention_outcome", outcomeId: "pending-0" }, 1_200);
    const retry = (await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 301_101)).notifications[0];
    await updateReminderStore(file, snapshot, { id: retry.id, type: "notification_delivered", attemptedAt: retry.notificationAttemptedAt }, 301_200);
    const after = JSON.parse(await readFile(file, "utf8"));
    assert.equal(after.attentionOutbox.length, 255);
    assert.deepEqual(after.attentionOverflow[first.id].map((entry) => entry.type), ["notification_failed", "notification_delivered"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("one reminder poll claims at most sixteen native candidates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-claim-cap-"));
  const file = path.join(root, "reminders.json");
  const snapshot = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [String(index), {
    taskId: `task-${index}`, title: `草稿 ${index}`, completion: "ready", identity: "v1",
  }]));
  try {
    const first = await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_000);
    assert.equal(first.notifications.length, 16);
    const second = await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_100);
    assert.equal(second.notifications.length, 4);
    assert.equal((await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_200)).notifications.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
