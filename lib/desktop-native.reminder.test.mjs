import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import { createRequire } from "node:module";
import ts from "typescript";

const { createReminderOpenDrainer } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./desktop-native.ts");
const source = await readFile(new URL("./desktop-native.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const require = createRequire(import.meta.url);
const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";

function nativeSendFixture({ proofStatus = 204, afterImport, afterProof, failCode } = {}) {
  let sends = 0, proofs = 0;
  const dependencies = { "@/lib/desktop-updater": { isTauriDesktop: () => true },
    "@/lib/desktop-api": { DESKTOP_API_TOKEN_HEADER: "x-pi-desktop-token" },
    "@/lib/edupi-material-staging-client": {},
    "@tauri-apps/api/core": { invoke: async name => {
      if (name === "get_desktop_api_token") return "synthetic-native-proof-token-123456789";
      assert.equal(name, "send_reminder_notification"); sends += 1;
      if (failCode) throw failCode;
    } },
  };
  const nativeModule = { exports: {} };
  const fetch = async (url, init) => {
    assert.equal(url, "/api/edupi/reminders/notification-proof");
    assert.equal(init.redirect, "error");
    const request = JSON.parse(init.body);
    assert.equal(Object.keys(request).sort().join(","), "claims,nonce,version");
    assert.equal(request.nonce.length, 64);
    proofs += 1; afterProof?.();
    return new Response(null, { status: proofStatus, headers: { "x-pi-reminder-proof-nonce": request.nonce } });
  };
  new Function("require", "module", "exports", "fetch", compiled)(name => {
    if (name === "@tauri-apps/api/core") afterImport?.();
    return dependencies[name] || require(name);
  }, nativeModule, nativeModule.exports, fetch);
  return { ...nativeModule.exports, sends: () => sends, proofs: () => proofs };
}
const request = () => ({ title: "EduPi 提醒", body: "合成事务", target: null,
  claims: [{ id: "synthetic-reminder", attemptId: ATTEMPT_ID, attemptedAt: "2026-10-08T00:00:00.000Z" }] });

test("native invoke cannot use a server claim invalidated during import or fresh proof wait", async () => {
  for (const phase of ["import", "proof"]) {
    let current = true;
    const fixture = nativeSendFixture({ afterImport: () => { if (phase === "import") current = false; }, afterProof: () => { if (phase === "proof") current = false; } });
    await assert.rejects(fixture.sendReminderNotificationNative(request(), () => current), error => fixture.isCancelledReminderNotificationError(error));
    assert.equal(fixture.sends(), 0);
  }
});

test("native proof denial fails closed without a send, while current proof reaches native last-gate", async () => {
  const unavailable = nativeSendFixture({ proofStatus: 503 });
  await assert.rejects(unavailable.sendReminderNotificationNative(request()), error => unavailable.isCancelledReminderNotificationError(error));
  assert.equal(unavailable.sends(), 0);
  const current = nativeSendFixture();
  await current.sendReminderNotificationNative(request());
  assert.equal(current.proofs(), 1);
  assert.equal(current.sends(), 1);
  const rustVeto = nativeSendFixture({ failCode: "notification_validation_unavailable" });
  await assert.rejects(rustVeto.sendReminderNotificationNative(request()), error => rustVeto.isCancelledReminderNotificationError(error));
});

test("lost native reply is sticky unknown, never cancelled for automatic retry", async () => {
  for (const code of ["notification_send_unknown", "synthetic-transport-lost"]) {
    const fixture = nativeSendFixture({ failCode: code });
    await assert.rejects(fixture.sendReminderNotificationNative(request()), error => fixture.isUnknownReminderNotificationError(error)
      && !fixture.isCancelledReminderNotificationError(error) && !fixture.isDeferredReminderNotificationError(error));
    assert.equal(fixture.sends(), 1);
  }
});

test("only the full fixed notification diagnostic bypasses transaction proof, never an arbitrary test ID payload", async () => {
  const fixture = nativeSendFixture({ proofStatus: 409 });
  const diagnostic = { title: "EduPi", body: "点击后打开提醒", target: null, claims: [{ id: "notification-test", attemptId: ATTEMPT_ID, attemptedAt: "2026-10-08T00:00:00.000Z" }] };
  await fixture.sendReminderNotificationNative(diagnostic);
  assert.equal(fixture.proofs(), 0);
  assert.equal(fixture.sends(), 1);
  await assert.rejects(fixture.sendReminderNotificationNative({ ...diagnostic, body: "旧事务不能绕过" }), error => fixture.isCancelledReminderNotificationError(error));
  assert.equal(fixture.sends(), 1);
});

test("native reminder wake and startup drain each click once even when they race", async () => {
  const pending = [{ reminderId: "r1", taskId: "task-1", kind: "ready" }];
  const opened = [];
  let calls = 0;
  const drainer = createReminderOpenDrainer(async () => {
    calls++;
    return pending.splice(0);
  }, target => opened.push(target));
  await Promise.all([drainer.request(), drainer.request()]);
  assert.equal(calls, 2);
  assert.deepEqual(opened.map(target => target?.reminderId), ["r1"]);
  pending.push({ reminderId: "r2", taskId: "task-2", kind: "failed" });
  await drainer.request();
  assert.deepEqual(opened.map(target => target?.reminderId), ["r1", "r2"]);
  drainer.stop();
  pending.push({ reminderId: "r3", taskId: "task-3", kind: "due" });
  await drainer.request();
  assert.deepEqual(opened.map(target => target?.reminderId), ["r1", "r2"]);
});

test("an in-flight native drain delivers its click even if the listener is replaced", async () => {
  let release;
  const opened = [];
  const drainer = createReminderOpenDrainer(() => new Promise(resolve => { release = resolve; }), target => opened.push(target));
  const pending = drainer.request();
  await Promise.resolve();
  drainer.stop();
  release([{ reminderId: "r1", taskId: "task-1", kind: "ready" }]);
  await pending;
  assert.deepEqual(opened.map(target => target?.reminderId), ["r1"]);
});

test("multiple queued notification clicks await each continuation in arrival order", async () => {
  const targets = [{ reminderId: "r1", taskId: "task-1", kind: "ready" },
    { reminderId: "r2", taskId: "task-2", kind: "failed" }];
  const order = [];
  let finishFirst;
  const drainer = createReminderOpenDrainer(async () => targets.splice(0), async target => {
    order.push(`${target.reminderId}:start`);
    if (target.reminderId === "r1") await new Promise(resolve => { finishFirst = resolve; });
    order.push(`${target.reminderId}:done`);
  });
  const draining = drainer.request();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(order, ["r1:start"]);
  finishFirst();
  await draining;
  assert.deepEqual(order, ["r1:start", "r1:done", "r2:start", "r2:done"]);
});

test("listener treats native event only as a wake and drains after registering", () => {
  assert.match(source, /listen<ReminderNotificationTarget \| null>\("edupi:\/\/reminder-open", \(\) => \{ void drainer\.request\(\); \}\)/u);
  assert.match(source, /void drainer\.request\(\)/u);
  assert.doesNotMatch(source, /onOpen\(event\.payload\)/u);
});
