import assert from "node:assert/strict";
import { createJiti } from "jiti";
import test from "node:test";
import fs from "node:fs";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const { validReminderAction } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-reminder-action.ts");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const require = createRequire(import.meta.url);
const store = await jiti.import("../../../../lib/edupi-reminder-store.ts");
const events = await jiti.import("../../../../lib/edupi-reminder-events.ts");
const policy = await jiti.import("../../../../lib/edupi-foreground-server.ts");
const proof = await jiti.import("../../../../lib/edupi-reminder-notification-proof.ts");
const outbox = await jiti.import("../../../../lib/edupi-attention-outbox.ts");
const { buildEducationContract } = await jiti.import("../../../../lib/edupi-education-contract.ts");
const security = await jiti.import("../../../../lib/request-security.ts");
const bounded = await jiti.import("../../../../lib/bounded-form-data.ts");
const desktopApi = await jiti.import("../../../../lib/desktop-api.ts");
const compiled = ts.transpileModule(fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const fixtureNow = "2026-10-08T01:00:00+08:00";
class FixtureDate extends Date { constructor(value) { super(value === undefined ? fixtureNow : value); } }

async function reminderRouteFixture(work, { graceDays = 3, afterSync } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-route-foreground-"));
  const prefs = path.join(root, "foreground-prefs.json");
  const previous = process.env.PI_DESKTOP_STATE_DIR;
  process.env.PI_DESKTOP_STATE_DIR = root;
  const data = buildEducationContract({ tasks: [{ id: "teacher-task-00000000-0000-4000-8000-000000000001", title: "合成旧事务", trigger: "teacher_created", due_date: "2026-10-02", status: "planned", content_status: "draft_ready", evidence: {} }] });
  data.workspace = root;
  let syncCalls = 0;
  const dependencies = {
    "@/lib/edupi-education-server": { readEducationWorkspaceBundle: async () => ({ data }) },
    "@/lib/edupi-reminder-events": events, "@/lib/edupi-reminder-store": store,
    "@/lib/edupi-foreground-server": { readServerForegroundPolicy: () => policy.readServerForegroundPolicy(new FixtureDate()) },
    "@/lib/edupi-reminder-notification-proof": proof,
    "@/lib/edupi-attention-delivery": { syncReminderAttention: async () => {
      syncCalls += 1;
      await afterSync?.({ prefs, data });
      return { status: "unsupported", recorded: 0 };
    }, revalidateG1LocalClaims: async items => items },
    "@/lib/edupi-attention-outbox": { ...outbox, reconcileReminderAttentionOutboxWithin: async () => ({ status: "synced", recorded: 0, pendingCount: 0, pendingIds: [] }) },
    "@/lib/request-security": security, "@/lib/bounded-form-data": bounded,
    "@/lib/desktop-api": desktopApi,
    "@/lib/edupi-reminder-action": { validReminderAction },
  };
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", "Date", compiled)(name => dependencies[name] || require(name), routeModule, routeModule.exports, FixtureDate);
  const claim = body => routeModule.exports.POST(new Request("http://localhost:30373/api/edupi/reminders", {
    method: "POST", headers: { host: "localhost:30373", origin: "http://localhost:30373", "content-type": "application/json" },
    body: JSON.stringify(body ?? { id: "*", type: "claim_notifications" }),
  }));
  try {
    await writeFile(prefs, JSON.stringify({ graceDays, pinnedTaskIds: [] }));
    await work({ ...routeModule.exports, claim, data, prefs, file: path.join(root, ".edupi", "desktop", "reminders.json"), syncCalls: () => syncCalls });
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_STATE_DIR; else process.env.PI_DESKTOP_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("notification outcomes require an exact bounded claim timestamp", () => {
  const delivered = { id: "reminder-one", type: "notification_delivered", attemptedAt: "2026-09-26T00:00:00.000Z" };
  assert.equal(validReminderAction(delivered), true);
  assert.equal(validReminderAction({ ...delivered, attemptedAt: undefined }), false);
  assert.equal(validReminderAction({ ...delivered, attemptedAt: "bad" }), false);
  assert.equal(validReminderAction({ ...delivered, id: "*" }), false);
  assert.equal(validReminderAction({ ...delivered, type: "notification_failed" }), true);
  assert.equal(validReminderAction({ ...delivered, type: "notification_deferred" }), true);
  assert.equal(validReminderAction({ ...delivered, type: "notification_deferred", attemptedAt: undefined }), false);
  assert.equal(validReminderAction({ id: "*", type: "notification_opened", taskId: "task-one" }), false);
  assert.equal(validReminderAction({ id: "reminder-one", type: "notification_opened", taskId: "task-one" }), true);
  assert.equal(validReminderAction({ id: "reminder-one", type: "read" }), true);
});

test("native claims use the server preference, retaining expired unread rows without touching Core", async () => reminderRouteFixture(async fixture => {
  const response = await fixture.claim();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.notifications.length, 0);
  assert.equal(fixture.syncCalls(), 0);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].read, false);
  assert.equal(result.items[0].handled, false);
  assert.equal(result.items[0].withdrawn, false);
  assert.equal(result.items[0].notificationAttemptedAt, undefined);
  const disk = JSON.parse(await readFile(fixture.file, "utf8"));
  assert.equal(disk.items.length, 1);
  await writeFile(fixture.prefs, JSON.stringify({ graceDays: 7, pinnedTaskIds: [] }));
  const expanded = await (await fixture.claim()).json();
  assert.equal(expanded.notifications.length, 1);
  assert.equal(fixture.syncCalls(), 1);
}));

test("late attention results cannot send a reminder after the same user narrows the threshold", async () => reminderRouteFixture(async fixture => {
  const result = await (await fixture.claim()).json();
  assert.equal(fixture.syncCalls(), 1);
  assert.equal(result.notifications.length, 0);
  assert.equal(result.nativeNotificationIds.length, 0);
  assert.equal(result.items[0].read, false);
  assert.equal(result.items[0].handled, false);
  assert.equal(result.items[0].withdrawn, false);
  assert.equal(result.items[0].notificationAttemptedAt, undefined);
}, { graceDays: 7, afterSync: ({ prefs }) => writeFile(prefs, JSON.stringify({ graceDays: 3, pinnedTaskIds: [] })) }));

test("a broken server preference suppresses claims but leaves history readable and client scope forbidden", async () => reminderRouteFixture(async fixture => {
  await writeFile(fixture.prefs, "broken synthetic preferences");
  const response = await fixture.claim();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.notifications.length, 0);
  assert.equal(result.foregroundPolicyStatus, "unavailable");
  assert.equal(result.items[0].read, false);
  assert.equal(fixture.syncCalls(), 0);
  assert.equal((await fixture.GET()).status, 200);
  assert.equal((await fixture.claim({ id: "*", type: "claim_notifications", graceDays: 365 })).status, 400);
  assert.equal((await fixture.claim({ id: "*", type: "claim_notifications", scope: "all" })).status, 400);
}));

test("a preference failure after attention completes cannot promote a stale native result", async () => reminderRouteFixture(async fixture => {
  const result = await (await fixture.claim()).json();
  assert.equal(fixture.syncCalls(), 1);
  assert.equal(result.notifications.length, 0);
  assert.equal(result.foregroundPolicyStatus, "unavailable");
  assert.equal(result.items[0].notificationAttemptedAt, undefined);
  assert.equal(result.items[0].read, false);
  assert.equal(result.items[0].handled, false);
  assert.equal(result.items[0].withdrawn, false);
}, { graceDays: 7, afterSync: ({ prefs }) => writeFile(prefs, "broken synthetic preferences") }));

test("a source date revised during attention is revalidated rather than using the initially eligible task", async () => reminderRouteFixture(async fixture => {
  const result = await (await fixture.claim()).json();
  assert.equal(fixture.syncCalls(), 1);
  assert.equal(result.notifications.length, 0);
  assert.equal(result.foregroundPolicyStatus, "current");
  assert.equal(result.items[0].notificationAttemptedAt, undefined);
  assert.equal(result.items[0].read, false);
  assert.equal(result.items[0].handled, false);
}, { graceDays: 7, afterSync: ({ data }) => { data.tasks[0].dueDate = "2026-09-01"; } }));

test("invalid UTF-8 inside otherwise valid native preference JSON cannot authorize any claim", async () => reminderRouteFixture(async fixture => {
  await writeFile(fixture.prefs, Buffer.concat([Buffer.from('{"graceDays":365,"pinnedTaskIds":["synthetic-'), Buffer.from([0x80]), Buffer.from('"]}')]));
  const result = await (await fixture.claim()).json();
  assert.equal(result.foregroundPolicyStatus, "unavailable");
  assert.equal(result.notifications.length, 0);
  assert.equal(fixture.syncCalls(), 0);
  assert.equal(result.items[0].notificationAttemptedAt, undefined);
  assert.equal(result.items[0].read, false);
}));
