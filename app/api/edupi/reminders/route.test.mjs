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
const compiledNativeSend = ts.transpileModule(fs.readFileSync(new URL("./native-send/route.ts", import.meta.url), "utf8"), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const fixtureNow = "2026-10-08T01:00:00+08:00";
class FixtureDate extends Date { constructor(value) { super(value === undefined ? fixtureNow : value); } }

async function reminderRouteFixture(work, { graceDays = 3, afterSync } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-route-foreground-"));
  const prefs = path.join(root, "foreground-prefs.json");
  const previous = process.env.PI_DESKTOP_STATE_DIR;
  const previousInstance = process.env.PI_DESKTOP_INSTANCE_ID;
  process.env.PI_DESKTOP_STATE_DIR = root;
  process.env.PI_DESKTOP_INSTANCE_ID = "a".repeat(64);
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
    if (previousInstance === undefined) delete process.env.PI_DESKTOP_INSTANCE_ID; else process.env.PI_DESKTOP_INSTANCE_ID = previousInstance;
    await rm(root, { recursive: true, force: true });
  }
}

test("notification outcomes require an exact bounded claim timestamp", () => {
  const delivered = { id: "reminder-one", type: "notification_delivered", attemptId: "11111111-1111-4111-8111-111111111111",
    attemptedAt: "2026-09-26T00:00:00.000Z" };
  assert.equal(validReminderAction(delivered), true);
  assert.equal(validReminderAction({ ...delivered, attemptId: undefined }), true, "legacy v1 attempts remain addressable by timestamp");
  assert.equal(validReminderAction({ ...delivered, attemptId: "not-a-uuid" }), false);
  assert.equal(validReminderAction({ ...delivered, attemptedAt: undefined }), false);
  assert.equal(validReminderAction({ ...delivered, attemptedAt: "bad" }), false);
  assert.equal(validReminderAction({ ...delivered, id: "*" }), false);
  assert.equal(validReminderAction({ ...delivered, type: "notification_failed" }), true);
  assert.equal(validReminderAction({ ...delivered, type: "notification_unknown" }), true);
  assert.equal(validReminderAction({ ...delivered, type: "rearm_notification" }), true);
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

test("manual rearm cannot bypass the claim lease or replace another attempt", async () => reminderRouteFixture(async fixture => {
  const first = (await (await fixture.claim()).json()).notifications[0];
  assert.ok(first?.notificationAttemptId);
  const snapshot = events.reminderEvents(fixture.data.tasks, fixture.data.workspace, new FixtureDate(), [], fixture.data.workCases, fixture.data.generatedArtifacts);
  await store.updateReminderStore(fixture.file, snapshot, { id: "*", type: "begin_notification_send", instanceId: "a".repeat(64),
    claims: [{ id: first.id, attemptId: first.notificationAttemptId, attemptedAt: first.notificationAttemptedAt }] }, Date.now(), {
    sourceFingerprint: item => proof.reminderNotificationSourceFingerprint(item, fixture.data), authorizeNativeSend: async () => true });
  const early = await fixture.claim({ id: first.id, type: "rearm_notification", attemptId: first.notificationAttemptId,
    attemptedAt: first.notificationAttemptedAt });
  assert.equal(early.status, 409);
  const started = (JSON.parse(await readFile(fixture.file, "utf8"))).items[0];
  assert.equal(started.notificationSendState, "send_started");
  const rearmAt = Math.max(Date.parse(first.notificationAttemptedAt), Date.parse(started.notificationSendStartedAt)) + 120_000;
  await store.updateReminderStore(fixture.file, snapshot, { id: first.id, type: "rearm_notification", attemptId: first.notificationAttemptId,
    attemptedAt: first.notificationAttemptedAt }, rearmAt);
  const second = (await store.updateReminderStore(fixture.file, snapshot, { id: "*", type: "claim_notifications", instanceId: "a".repeat(64) },
    rearmAt, { sourceFingerprint: item => proof.reminderNotificationSourceFingerprint(item, fixture.data) })).notifications[0];
  assert.notEqual(second.notificationAttemptId, first.notificationAttemptId);
  const stale = await fixture.claim({ id: first.id, type: "rearm_notification", attemptId: first.notificationAttemptId,
    attemptedAt: first.notificationAttemptedAt });
  assert.equal(stale.status, 409);
  const persisted = JSON.parse(await readFile(fixture.file, "utf8"));
  assert.equal(persisted.items[0].notificationAttemptId, second.notificationAttemptId);
  assert.equal(persisted.items[0].read, false);
}, { graceDays: 7 }));

async function nativeSendFixture(work, { authorize = true, readError = false, count = 1 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminder-native-atomic-"));
  const previous = process.env.PI_DESKTOP_INSTANCE_ID;
  process.env.PI_DESKTOP_INSTANCE_ID = "a".repeat(64);
  const file = path.join(root, ".edupi", "desktop", "reminders.json");
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  const data = buildEducationContract({ tasks: Array.from({ length: count }, (_, index) => ({
    id: `teacher-task-10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    title: `合成课前事项 ${index}`, trigger: "teacher_created", status: "planned",
    content_status: "draft_ready", due_date: today, evidence: { source_revision: "v1" },
  })) });
  data.workspace = root;
  const snapshot = events.reminderEvents(data.tasks, root, new Date(), data.continuity.documents, data.workCases, data.generatedArtifacts);
  let proofCalls = 0, coreReads = 0;
  const dependencies = {
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: request => request.headers.get("x-pi-desktop-token") === "synthetic-token" },
    "@/lib/desktop-api": desktopApi,
    "@/lib/request-security": security,
    "@/lib/bounded-form-data": bounded,
    "@/lib/edupi-core-root": { resolveEduPiDataRoot: () => ({ root }) },
    "@/lib/edupi-reminder-notification-proof": { ...proof, readCurrentReminderEducation: async () => {
      coreReads++;
      if (readError) throw new Error("synthetic Core outage");
      return data;
    },
      notificationClaimsAreCurrent: async (claims, options) => { proofCalls++; return authorize
        && await proof.notificationClaimsAreCurrent(claims, { ...options, now: () => new Date(),
          readPolicy: async () => ({ today, graceDays: 7, pinnedTaskIds: [] }) }); } },
    "@/lib/edupi-reminder-store": store,
  };
  const route = { exports: {} };
  new Function("require", "module", "exports", compiledNativeSend)(name => dependencies[name] || require(name), route, route.exports);
  const send = (claims, { nonce = "b".repeat(64), token = "synthetic-token" } = {}) => route.exports.POST(new Request("http://localhost:30373/api/edupi/reminders/native-send", {
    method: "POST", headers: { host: "localhost:30373", origin: "http://localhost:30373", "content-type": "application/json", "x-pi-desktop-token": token },
    body: JSON.stringify({ version: 1, nonce, claims }),
  }));
  try {
    const claimed = (await store.updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications", instanceId: "a".repeat(64) },
      Date.now(), { sourceFingerprint: item => proof.reminderNotificationSourceFingerprint(item, data) })).notifications;
    await store.updateReminderStore(file, snapshot, { id: "*", type: "mark_attention_routes", routes: claimed.map(item => ({
      reminderId: item.id, attemptId: item.notificationAttemptId, attemptedAt: item.notificationAttemptedAt, route: "teacher_local",
    })) });
    const claims = claimed.map(item => ({ id: item.id, attemptId: item.notificationAttemptId, attemptedAt: item.notificationAttemptedAt }));
    await work({ file, claims, send, data, proofCalls: () => proofCalls, coreReads: () => coreReads });
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_INSTANCE_ID; else process.env.PI_DESKTOP_INSTANCE_ID = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("native send atomically accepts once with exact proof headers; concurrent replay is stale", async () => nativeSendFixture(async fixture => {
  const denied = await fixture.send(fixture.claims, { token: "wrong-token" });
  assert.equal(denied.status, 403);
  assert.equal(fixture.proofCalls(), 0);
  const [first, second] = await Promise.all([fixture.send(fixture.claims), fixture.send(fixture.claims)]);
  assert.deepEqual([first.status, second.status].sort(), [204, 409]);
  const accepted = first.status === 204 ? first : second;
  assert.equal(accepted.headers.get("x-pi-desktop-instance"), "a".repeat(64));
  assert.equal(accepted.headers.get("x-pi-reminder-proof-nonce"), "b".repeat(64));
  assert.match(accepted.headers.get("x-pi-reminder-dispatch-id"), /^[0-9a-f]{8}-[0-9a-f-]{27}$/u);
  assert.equal(await accepted.text(), "");
  const persisted = JSON.parse(await readFile(fixture.file, "utf8"));
  assert.equal(persisted.items[0].notificationSendState, "send_started");
  assert.equal(persisted.items[0].notificationDispatchId, accepted.headers.get("x-pi-reminder-dispatch-id"));
  assert.equal((await fixture.send(fixture.claims)).status, 409);
}));

test("native send reads Core once at the final gate and vetoes a changed source without a write", async () => nativeSendFixture(async fixture => {
  const before = await readFile(fixture.file);
  fixture.data.tasks[0].evidence.source_revision = "v2";
  assert.equal((await fixture.send(fixture.claims)).status, 409);
  assert.equal(fixture.coreReads(), 1);
  assert.deepEqual(await readFile(fixture.file), before);
}));

test("one native begin uses one fresh Core read before persisting send_started", async () => nativeSendFixture(async fixture => {
  assert.equal((await fixture.send(fixture.claims)).status, 204);
  assert.equal(fixture.coreReads(), 1);
  assert.equal((JSON.parse(await readFile(fixture.file, "utf8"))).items[0].notificationSendState, "send_started");
}));

test("one stale member vetoes the whole native batch; accepted batch shares one dispatch identity", async () => nativeSendFixture(async fixture => {
  assert.equal(fixture.claims.length, 2);
  const before = await readFile(fixture.file);
  const staleBatch = [fixture.claims[0], { ...fixture.claims[1], attemptId: "22222222-2222-4222-8222-222222222222" }];
  assert.equal((await fixture.send(staleBatch)).status, 409);
  assert.deepEqual(await readFile(fixture.file), before);
  const response = await fixture.send(fixture.claims);
  assert.equal(response.status, 204);
  const dispatchId = response.headers.get("x-pi-reminder-dispatch-id");
  const persisted = JSON.parse(await readFile(fixture.file, "utf8"));
  assert.deepEqual(persisted.items.map(item => item.notificationSendState), ["send_started", "send_started"]);
  assert.deepEqual(persisted.items.map(item => item.notificationDispatchId), [dispatchId, dispatchId]);
}, { count: 2 }));

test("native send proof refusal fails closed and leaves the persisted claim byte-for-byte unchanged", async () => nativeSendFixture(async fixture => {
  const before = await readFile(fixture.file);
  const response = await fixture.send(fixture.claims);
  assert.equal(response.status, 409);
  assert.ok(fixture.proofCalls() > 0);
  assert.deepEqual(await readFile(fixture.file), before);
}, { authorize: false }));

test("native send rejects malformed attempt without reading or consuming the claim", async () => nativeSendFixture(async fixture => {
  const before = await readFile(fixture.file);
  const invalid = await fixture.send([{ ...fixture.claims[0], attemptId: "not-a-uuid" }]);
  assert.equal(invalid.status, 400);
  assert.equal(fixture.proofCalls(), 0);
  assert.deepEqual(await readFile(fixture.file), before);
}));

test("native send reports source outage as 503 without changing a claim", async () => nativeSendFixture(async fixture => {
  const before = await readFile(fixture.file);
  const unavailable = await fixture.send(fixture.claims);
  assert.equal(unavailable.status, 503);
  assert.equal(fixture.proofCalls(), 1);
  assert.deepEqual(await readFile(fixture.file), before);
}, { readError: true }));
