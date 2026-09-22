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
    await updateReminderStore(file, snapshot, { id: first.id, type: "notification_delivered" }, 2_100);
    await updateReminderStore(file, snapshot, { id: second.id, type: "notification_failed" }, 2_200);
    const suppressed = await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 3_000);
    assert.equal(suppressed.notifications.length, 0);
    const retry = await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 302_201);
    assert.deepEqual(retry.notifications.map((item) => item.id), [second.id]);
    await updateReminderStore(file, snapshot, { id: second.id, type: "notification_delivered" }, 302_301);
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
    await updateReminderStore(file, snapshot, { id: first.id, type: "notification_failed" }, 400_000);
    await updateReminderStore(file, snapshot, { id: first.id, type: "notification_failed" }, 401_000);
    const capped = await updateReminderStore(file, snapshot, { id: first.id, type: "notification_failed" }, 402_000);
    assert.equal((await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 1_000_000)).notifications.length, 0);
    assert.equal(capped.metrics.notificationSuppressedCount, 1);
    assert.equal(created.metrics.candidateCount, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
