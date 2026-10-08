import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { updateReminderStore } = await createJiti(import.meta.url).import("./edupi-reminder-store.ts");
const at = Date.parse("2026-10-08T00:00:00.000Z");
const snapshot = { a: { taskId: "synthetic-a", title: "合成待办A", completion: "due", identity: "a-v1" },
  b: { taskId: "synthetic-b", title: "合成待办B", completion: "due", identity: "b-v1" } };
const instanceId = "a".repeat(64);

test("only an expired claim that never began native send is automatically recovered", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-lease-"));
  const file = path.join(root, "reminders.json");
  try {
    const first = await updateReminderStore(file, { a: snapshot.a }, { id: "*", type: "claim_notifications", instanceId }, at);
    const claim = first.notifications[0];
    assert.match(claim.notificationAttemptId, /^[a-f0-9-]{36}$/);
    assert.equal(claim.notificationSendState, "claimed");
    assert.equal(claim.notificationAttemptInstanceId, instanceId);
    assert.equal(Date.parse(claim.notificationClaimExpiresAt) > at, true);
    const recovered = await updateReminderStore(file, { a: snapshot.a }, undefined, at + 10 * 60_000);
    assert.equal(recovered.items[0].notificationAttemptedAt, undefined);
    const next = await updateReminderStore(file, { a: snapshot.a }, { id: "*", type: "claim_notifications", instanceId }, at + 10 * 60_000 + 1);
    assert.equal(next.notifications.length, 1);
    assert.notEqual(next.notifications[0].notificationAttemptId, claim.notificationAttemptId);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("native begin is all-or-nothing, one winner, and unknown OS outcomes never auto-retry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-native-begin-"));
  const file = path.join(root, "reminders.json");
  try {
    const claimed = await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications", instanceId }, at,
      { sourceFingerprint: () => "source-v1" });
    const claims = claimed.notifications.map(item => ({ id: item.id, attemptId: item.notificationAttemptId, attemptedAt: item.notificationAttemptedAt }));
    const begin = { id: "*", type: "begin_notification_send", instanceId, claims };
    const [one, two] = await Promise.allSettled([
      updateReminderStore(file, snapshot, begin, at + 1, { sourceFingerprint: () => "source-v1", authorizeNativeSend: async () => true }),
      updateReminderStore(file, snapshot, begin, at + 1, { sourceFingerprint: () => "source-v1", authorizeNativeSend: async () => true }),
    ]);
    assert.equal([one, two].filter(result => result.status === "fulfilled" && result.value.nativeDispatchId).length, 1);
    assert.equal([one, two].filter(result => result.status === "rejected" || !result.value.nativeDispatchId).length, 1);
    const after = await updateReminderStore(file, snapshot, undefined, at + 10 * 60_000);
    assert.deepEqual(after.items.map(item => item.notificationSendState), ["send_started", "send_started"]);
    assert.deepEqual(after.items.map(item => item.notificationAttemptedAt), claims.map(claim => claim.attemptedAt));
    const uncertain = await updateReminderStore(file, snapshot, { id: claims[0].id, type: "notification_unknown",
      attemptedAt: claims[0].attemptedAt, attemptId: claims[0].attemptId }, at + 10 * 60_000 + 1);
    assert.equal(uncertain.items.find(item => item.id === claims[0].id).notificationSendState, "unknown");
    assert.equal((await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications", instanceId }, at + 11 * 60_000)).notifications.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a slow final authorization cannot begin a claim after its lease expires", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-expiring-begin-"));
  const file = path.join(root, "reminders.json");
  try {
    const claimed = (await updateReminderStore(file, { a: snapshot.a }, { id: "*", type: "claim_notifications", instanceId }, at,
      { sourceFingerprint: () => "source-v1" })).notifications[0];
    await assert.rejects(updateReminderStore(file, { a: snapshot.a }, { id: "*", type: "begin_notification_send", instanceId,
      claims: [{ id: claimed.id, attemptId: claimed.notificationAttemptId, attemptedAt: claimed.notificationAttemptedAt }] },
    at + 1, { sourceFingerprint: () => "source-v1", authorizeNativeSend: async () => true,
      currentTime: () => at + 2 * 60_000 + 1 }), /提醒关联已变化/u);
    const state = JSON.parse(await readFile(file, "utf8"));
    assert.equal(state.items[0].notificationSendState, "claimed");
    assert.equal(state.items[0].notificationDispatchId, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("manual rearm waits two minutes from a late native begin, not the earlier claim", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-late-begin-"));
  const file = path.join(root, "reminders.json");
  try {
    const claimed = (await updateReminderStore(file, { a: snapshot.a }, { id: "*", type: "claim_notifications", instanceId }, at,
      { sourceFingerprint: () => "source-v1" })).notifications[0];
    const begunAt = at + 2 * 60_000 - 1;
    await updateReminderStore(file, { a: snapshot.a }, { id: "*", type: "begin_notification_send", instanceId,
      claims: [{ id: claimed.id, attemptId: claimed.notificationAttemptId, attemptedAt: claimed.notificationAttemptedAt }] }, begunAt,
    { sourceFingerprint: () => "source-v1", authorizeNativeSend: async () => true });
    const action = { id: claimed.id, type: "rearm_notification", attemptId: claimed.notificationAttemptId,
      attemptedAt: claimed.notificationAttemptedAt };
    const tooEarly = await updateReminderStore(file, { a: snapshot.a }, action, at + 2 * 60_000);
    assert.equal(tooEarly.notificationTransitionApplied, false);
    assert.equal(tooEarly.items[0].notificationSendState, "send_started");
    const allowed = await updateReminderStore(file, { a: snapshot.a }, action, begunAt + 2 * 60_000);
    assert.equal(allowed.notificationTransitionApplied, true);
    assert.equal(allowed.items[0].notificationAttemptedAt, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("teacher rearm preserves the item and an old callback cannot touch the next attempt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-rearm-"));
  const file = path.join(root, "reminders.json");
  try {
    const first = (await updateReminderStore(file, { a: snapshot.a }, { id: "*", type: "claim_notifications", instanceId }, at,
      { sourceFingerprint: () => "source-v1" })).notifications[0];
    await updateReminderStore(file, { a: snapshot.a }, { id: first.id, type: "begin_notification_send", instanceId,
      claims: [{ id: first.id, attemptId: first.notificationAttemptId, attemptedAt: first.notificationAttemptedAt }] }, at + 1,
    { sourceFingerprint: () => "source-v1", authorizeNativeSend: async () => true });
    const unknown = await updateReminderStore(file, { a: snapshot.a }, undefined, at + 10 * 60_000);
    assert.equal(unknown.items[0].notificationAttemptId, first.notificationAttemptId, "started OS send cannot be TTL-cleared");
    const rearmed = await updateReminderStore(file, { a: snapshot.a }, { id: first.id, type: "rearm_notification",
      attemptedAt: first.notificationAttemptedAt, attemptId: first.notificationAttemptId }, at + 10 * 60_000 + 1);
    assert.equal(rearmed.items[0].notificationAttemptedAt, undefined);
    assert.equal(rearmed.items[0].read, false);
    const second = (await updateReminderStore(file, { a: snapshot.a }, { id: "*", type: "claim_notifications", instanceId }, at + 10 * 60_000 + 1)).notifications[0];
    assert.notEqual(second.notificationAttemptId, first.notificationAttemptId);
    const stale = await updateReminderStore(file, { a: snapshot.a }, { id: first.id, type: "notification_delivered",
      attemptedAt: first.notificationAttemptedAt, attemptId: first.notificationAttemptId }, at + 10 * 60_000 + 2);
    assert.equal(stale.items[0].notificationAttemptId, second.notificationAttemptId);
    assert.equal(stale.items[0].notificationDeliveredAt, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an old same-millisecond callback cannot consume a re-claimed attempt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-same-ms-"));
  const file = path.join(root, "reminders.json");
  try {
    const first = (await updateReminderStore(file, { a: snapshot.a }, { id: "*", type: "claim_notifications", instanceId }, at)).notifications[0];
    await updateReminderStore(file, { a: snapshot.a }, { id: first.id, type: "release_notification",
      attemptedAt: first.notificationAttemptedAt, attemptId: first.notificationAttemptId }, at);
    const second = (await updateReminderStore(file, { a: snapshot.a }, { id: "*", type: "claim_notifications", instanceId }, at)).notifications[0];
    assert.equal(second.notificationAttemptedAt, first.notificationAttemptedAt);
    assert.notEqual(second.notificationAttemptId, first.notificationAttemptId);
    const late = await updateReminderStore(file, { a: snapshot.a }, { id: first.id, type: "notification_delivered",
      attemptedAt: first.notificationAttemptedAt, attemptId: first.notificationAttemptId }, at + 1);
    assert.equal(late.items[0].notificationAttemptId, second.notificationAttemptId);
    assert.equal(late.items[0].notificationDeliveredAt, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("legacy attempts without a phase are unknown and require teacher rearm", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-legacy-"));
  const file = path.join(root, "reminders.json");
  try {
    const initial = await updateReminderStore(file, { a: snapshot.a }, undefined, at);
    const legacy = { ...initial, items: initial.items.map(item => ({ ...item, notificationAttemptedAt: new Date(at).toISOString() })) };
    await writeFile(file, JSON.stringify(legacy));
    const after = await updateReminderStore(file, { a: snapshot.a }, undefined, at + 10 * 60_000);
    assert.equal(after.items[0].notificationAttemptedAt, new Date(at).toISOString());
    assert.equal((await updateReminderStore(file, { a: snapshot.a }, { id: "*", type: "claim_notifications", instanceId }, at + 10 * 60_000)).notifications.length, 0);
    const manual = await updateReminderStore(file, { a: snapshot.a }, { id: after.items[0].id, type: "rearm_notification",
      attemptedAt: after.items[0].notificationAttemptedAt }, at + 10 * 60_000 + 1);
    assert.equal(manual.items[0].notificationAttemptedAt, undefined);
    assert.equal((await readFile(file, "utf8")).includes("synthetic-a"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
