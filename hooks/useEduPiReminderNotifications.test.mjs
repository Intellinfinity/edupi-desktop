import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import { createRequire } from "node:module";
import ts from "typescript";

const source = await readFile(new URL("./useEduPiReminderNotifications.ts", import.meta.url), "utf8");
const { authorizedReminderNotifications, reminderOutcomeAction, reminderOutcomeType, reminderContinuationTaskId } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./useEduPiReminderNotifications.ts");
const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
function waitingHookFixture(status = "attempted") {
  let cleanup, finishWait, startedWait;
  const started = new Promise(resolve => { startedWait = resolve; });
  const state = { day: "2026-10-08", graceDays: 7, pins: [], nativeMatches: true, enabled: true, focused: false };
  const outcomes = [];
  let sends = 0;
  const claim = { id: "synthetic-reminder", attemptId: ATTEMPT_ID, attemptedAt: "2026-10-08T00:00:00.000Z" };
  const dependencies = {
    react: { useEffect: work => { cleanup = work(); } },
    "@/lib/desktop-updater": { isTauriDesktop: () => true },
    "@/lib/desktop-native": { listenReminderNotificationsNative: async () => () => {} },
    "@/lib/edupi-foreground-settings": { readForegroundSettings: () => ({ graceDays: state.graceDays, pinnedTaskIds: state.pins }), foregroundNotificationPolicyMatchesNative: async () => state.nativeMatches },
    "@/lib/edupi-foreground": { shanghaiDate: () => state.day },
    "@/lib/desktop-notify": { desktopNotificationsEnabled: () => state.enabled, notifyDesktop: async options => {
      startedWait(); await new Promise(resolve => { finishWait = resolve; });
      if (!await options.isCurrent()) return "cancelled";
      sends += 1; return status;
    } },
  };
  const fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.type === "claim_notifications") return Response.json({ notifications: [{ id: claim.id, taskId: "synthetic-task", kind: "ready", title: "合成事项", notificationAttemptId: claim.attemptId, notificationAttemptedAt: claim.attemptedAt }], nativeNotificationIds: [claim.id] });
    outcomes.push(body);
    return Response.json({});
  };
  const hookModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", "document", "setTimeout", "clearTimeout", compiled)(
    name => dependencies[name] || require(name), hookModule, hookModule.exports, fetch, { hasFocus: () => state.focused }, () => 1, () => {});
  hookModule.exports.useEduPiReminderNotifications(() => {});
  return { state, claim, outcomes, started, cleanup: () => cleanup(), finish: () => finishWait(), sends: () => sends };
}

test("late preference, pin, day and unmount vetoes release the exact attempt without sending or acknowledging the task", async () => {
  for (const change of [fixture => { fixture.state.graceDays = 3; }, fixture => { fixture.state.pins = ["changed-pinned-task"]; },
    fixture => { fixture.state.day = "2026-10-09"; }, fixture => { fixture.state.nativeMatches = false; },
    fixture => { fixture.state.enabled = false; }, fixture => { fixture.state.focused = true; }, fixture => fixture.cleanup()]) {
    const fixture = waitingHookFixture();
    await fixture.started;
    change(fixture);
    fixture.finish();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fixture.sends(), 0);
    assert.deepEqual(fixture.outcomes, [{ ...fixture.claim, type: "release_notification" }]);
    fixture.cleanup();
  }
});

test("an uncertain native send posts one exact attempt as unknown, not a retryable failure", async () => {
  const fixture = waitingHookFixture("unknown");
  await fixture.started;
  fixture.finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.sends(), 1);
  assert.deepEqual(fixture.outcomes, [{ ...fixture.claim, type: "notification_unknown" }]);
  fixture.cleanup();
});

test("an unmounted hook waits for a delayed persisted claim and releases its exact attempt", async () => {
  let cleanup, finishClaim, claimStarted;
  const started = new Promise(resolve => { claimStarted = resolve; });
  const outcomes = [];
  let sends = 0;
  const claim = { id: "synthetic-delayed", attemptId: ATTEMPT_ID, attemptedAt: "2026-10-08T00:00:00.000Z" };
  const dependencies = {
    react: { useEffect: work => { cleanup = work(); } },
    "@/lib/desktop-updater": { isTauriDesktop: () => true },
    "@/lib/desktop-native": { listenReminderNotificationsNative: async () => () => {} },
    "@/lib/edupi-foreground-settings": { readForegroundSettings: () => ({ graceDays: 3, pinnedTaskIds: [] }), foregroundNotificationPolicyMatchesNative: async () => true },
    "@/lib/edupi-foreground": { shanghaiDate: () => "2026-10-08" },
    "@/lib/desktop-notify": { desktopNotificationsEnabled: () => true, notifyDesktop: async () => { sends += 1; return "attempted"; } },
  };
  const fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.type === "claim_notifications") {
      assert.equal(options.signal, undefined, "the client cannot abort after the attempt is persisted");
      claimStarted();
      await new Promise(resolve => { finishClaim = resolve; });
      return Response.json({ notifications: [{ id: claim.id, taskId: "synthetic-task", kind: "ready", title: "合成事项", notificationAttemptId: claim.attemptId, notificationAttemptedAt: claim.attemptedAt }], nativeNotificationIds: [claim.id] });
    }
    outcomes.push(body);
    return Response.json({});
  };
  const hookModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", "document", "setTimeout", "clearTimeout", compiled)(
    name => dependencies[name] || require(name), hookModule, hookModule.exports, fetch, { hasFocus: () => false }, () => 1, () => {});
  hookModule.exports.useEduPiReminderNotifications(() => {});
  await started;
  cleanup();
  finishClaim();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sends, 0);
  assert.deepEqual(outcomes, [{ ...claim, type: "release_notification" }]);
});

test("unmount during native policy read cannot create a fresh server claim", async () => {
  let cleanup, finishPolicy, policyStarted;
  const started = new Promise(resolve => { policyStarted = resolve; });
  let claims = 0;
  const dependencies = {
    react: { useEffect: work => { cleanup = work(); } },
    "@/lib/desktop-updater": { isTauriDesktop: () => true },
    "@/lib/desktop-native": { listenReminderNotificationsNative: async () => () => {} },
    "@/lib/edupi-foreground-settings": { readForegroundSettings: () => ({ graceDays: 3, pinnedTaskIds: [] }), foregroundNotificationPolicyMatchesNative: () => {
      policyStarted(); return new Promise(resolve => { finishPolicy = resolve; });
    } },
    "@/lib/edupi-foreground": { shanghaiDate: () => "2026-10-08" },
    "@/lib/desktop-notify": { desktopNotificationsEnabled: () => true, notifyDesktop: async () => "attempted" },
  };
  const hookModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", "document", "setTimeout", "clearTimeout", compiled)(
    name => dependencies[name] || require(name), hookModule, hookModule.exports, async () => { claims += 1; return Response.json({ notifications: [] }); }, { hasFocus: () => false }, () => 1, () => {});
  hookModule.exports.useEduPiReminderNotifications(() => {});
  await started;
  cleanup();
  finishPolicy(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(claims, 0);
});

test("one notification opens only its exact task continuation", () => {
  assert.equal(reminderContinuationTaskId({ reminderId: "r1", taskId: "task-one", kind: "ready" }), "task-one");
  assert.equal(reminderContinuationTaskId({ reminderId: "r2", taskId: "document:brief-one", kind: "brief" }), "document:brief-one");
  assert.equal(reminderContinuationTaskId(null), null);
  assert.equal(reminderContinuationTaskId({ reminderId: "r3", taskId: "", kind: "ready" }), null);
});

test("native notification outcomes carry the exact Core claim identity", () => {
  const claim = { id: "reminder-one", attemptId: ATTEMPT_ID, attemptedAt: "2026-09-26T00:00:00.000Z" };
  assert.deepEqual(reminderOutcomeAction(claim, "notification_failed"), { ...claim, type: "notification_failed" });
  assert.deepEqual(reminderOutcomeAction(claim, "notification_delivered"), { ...claim, type: "notification_delivered" });
});

test("skipped system permission defers a reminder without spending its native failure budget", () => {
  assert.equal(reminderOutcomeType("attempted"), "notification_delivered");
  assert.equal(reminderOutcomeType("failed"), "notification_failed");
  assert.equal(reminderOutcomeType("skipped"), "notification_deferred");
  assert.equal(reminderOutcomeType("cancelled"), "release_notification");
  assert.equal(reminderOutcomeType("unknown"), "notification_unknown");
  assert.deepEqual(reminderOutcomeAction({ id: "synthetic", attemptId: ATTEMPT_ID, attemptedAt: "2026-10-08T00:00:00Z" }, "release_notification"),
    { id: "synthetic", attemptId: ATTEMPT_ID, attemptedAt: "2026-10-08T00:00:00Z", type: "release_notification" });
});

test("notification lifecycle records delivery, failure, and opened targets", () => {
  assert.match(source, /notification_delivered[\s\S]*notification_failed/);
  assert.match(source, /notification_opened/);
  assert.match(source, /id: target\.reminderId, type: "notification_opened", taskId: target\.taskId, attemptId: target\.attemptId/u);
  assert.match(source, /taskId: target\.taskId/);
  assert.doesNotMatch(source, /id: "\*", type: "notification_opened"/u);
  assert.match(source, /void markOpened\(target\)\.catch\(\(\) => \{\}\); await onOpen\(target\)/u);
  assert.doesNotMatch(source, /await markOpened\(target\)/u);
});

test("native send requires the current server authorization list, not just a claimed notification", () => {
  const claimed = [{ id: "current-l4", taskId: "task-1", notificationAttemptId: ATTEMPT_ID, notificationAttemptedAt: "2026-10-08T00:00:00Z" },
    { id: "stale-l4", taskId: "task-2", notificationAttemptId: ATTEMPT_ID, notificationAttemptedAt: "2026-10-08T00:00:00Z" },
    { id: "legacy", taskId: "task-3" }];
  assert.deepEqual(authorizedReminderNotifications({ notifications: claimed, nativeNotificationIds: ["current-l4", "legacy"] }).map((item) => item.id), ["current-l4"]);
  assert.deepEqual(authorizedReminderNotifications({ notifications: claimed }).map((item) => item.id), []);
  assert.match(source, /authorizedReminderNotifications\(result\)/);
});
