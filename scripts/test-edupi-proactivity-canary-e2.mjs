#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.ok(configuredCoreRoot && path.isAbsolute(configuredCoreRoot), "EDUPI_CORE_ROOT is required");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const keepArtifacts = process.env.EDUPI_E2_KEEP === "1";
const desktopRoot = path.resolve(new URL("..", import.meta.url).pathname);
const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts/edupi-core-compat.json"), "utf8"));
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-proactivity-canary-e2-")));
const dataRoot = path.join(temp, "data");
const stateDir = path.join(temp, "desktop-state");
const agentDir = path.join(temp, "empty-agent");
const home = path.join(dataRoot, ".edupi");
for (const directory of [stateDir, agentDir, path.join(home, "memory"), path.join(home, "output"), path.join(home, "locks")]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}
// G1 can only become active with a private model configuration. Keep this
// canary entirely on loopback with a synthetic key and no external provider.
fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
  api: "openai-completions", apiKey: "synthetic-local-placeholder", baseUrl: "http://127.0.0.1:9/v1",
  models: [{ id: "local", name: "Synthetic local", input: ["text"], reasoning: false,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048 }],
} } }), { mode: 0o600 });
fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "local", defaultModel: "local",
  extensions: [], packages: [], skills: [] }), { mode: 0o600 });
const token = "proactivity-canary-test-token-012345678901234567890123";
const keys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT",
  "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT", "EDUPI_AMBIENT_PLANNING",
  "PI_DESKTOP_STATE_DIR", "PI_DESKTOP_API_TOKEN", "PI_CODING_AGENT_DIR"];
const previous = new Map(keys.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  EDUPI_PROJECT_ROOT: dataRoot,
  EDUPI_DATA_ROOT: dataRoot,
  EDUPI_DATA_ALLOWED_ROOT: temp,
  EDUPI_CORE_ROOT: coreRoot,
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: path.join(home, "memory"),
  EDUPI_OUTPUT_DIR: path.join(home, "output"),
  EDUPI_LOCK_DIR: path.join(home, "locks"),
  EDUPI_CORE_COMMIT: compat.core_runtime.core_commit,
  PI_DESKTOP_STATE_DIR: stateDir,
  PI_DESKTOP_API_TOKEN: token,
  PI_CODING_AGENT_DIR: agentDir,
});
delete process.env.EDUPI_AMBIENT_PLANNING;

function request(url, method = "GET", body = null) {
  return new Request(url, {
    method,
    headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin", "content-type": "application/json", "x-pi-desktop-token": token },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function localFuture(days) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(Date.now() + days * 86_400_000)).filter((item) => ["year", "month", "day"].includes(item.type)).map((item) => [item.type, item.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7;
  return { date, day };
}

try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const staging = await jiti.import("../lib/edupi-material-staging.ts");
  const flow = await jiti.import("../lib/edupi-material-intake-flow.ts");
  const intake = await jiti.import("../lib/edupi-education-intake.ts");
  const proactivityRoute = await jiti.import("../app/api/edupi/proactivity/route.ts");
  const messageRoute = await jiti.import("../app/api/edupi/proactivity/messages/route.ts");
  const feedbackRoute = await jiti.import("../app/api/edupi/teacher-feedback/route.ts");
  const statusRoute = await jiti.import("../app/api/edupi/status/route.ts");
  const supervisor = await jiti.import("../lib/edupi-runtime-supervisor.ts");
  const snapshotRoots = await jiti.import("../lib/edupi-core-snapshot.ts");
  const grantRuntime = await jiti.import("../lib/edupi-proactivity-runtime.ts");
  const registeredPrompt = await jiti.import("../lib/edupi-registered-prompt.ts");
  const sessionReader = await jiti.import("../lib/session-reader.ts");
  const sessionRoute = await jiti.import("../app/api/sessions/[id]/route.ts");
  const ambientLedger = await jiti.import("../lib/edupi-ambient-message-ledger.ts");
  const sessionId = "canary-session-1";
  const sessionDir = path.join(temp, "sessions");
  const sessionFile = path.join(sessionDir, "canary-session.jsonl");
  fs.mkdirSync(sessionDir, { mode: 0o700 });
  fs.writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: sessionId,
    timestamp: new Date().toISOString(), cwd: dataRoot })}\n`, { mode: 0o600 });
  sessionReader.cacheSessionPath(sessionId, sessionFile);

  const tomorrow = localFuture(1);
  const correctedDay = localFuture(2);
  const deletionDay = localFuture(3);
  const source = (id) => ({ source_id: id, source_kind: "teacher_file", source_hash: `sha256:${id.at(-1).repeat(64)}`, evidence_ids: [`evidence-${id}`] });
  const timetable = await intake.issueEducationIntake({
    command_type: "import_timetable",
    source: source("canary-timetable-1"),
    slots: [
      { slot_id: "canary-slot-1", day_of_week: tomorrow.day, period: 1, subject: "数学", class_name: "七一班", kind: "class", notes: null,
        class_id: "class-7-1", start_time: "09:00", time_zone: "Asia/Shanghai" },
      { slot_id: "canary-slot-2", day_of_week: correctedDay.day, period: 2, subject: "数学", class_name: "七一班", kind: "class", notes: null,
        class_id: "class-7-1", start_time: "10:00", time_zone: "Asia/Shanghai" },
      { slot_id: "canary-slot-3", day_of_week: deletionDay.day, period: 3, subject: "数学", class_name: "七一班", kind: "class", notes: null,
        class_id: "class-7-1", start_time: "11:00", time_zone: "Asia/Shanghai" },
    ],
  });
  assert.equal(timetable.receipt.status, "accepted");
  const bytes = Buffer.from("%PDF-1.4\nEduPi proactive canary material\n", "utf8");
  const descriptor = staging.stageMaterialInputs([{ name: "七一班数学材料.pdf", mimeType: "application/pdf", bytes: new Uint8Array(bytes) }])[0];
  const material = await flow.intakeRecognizedMaterial({ descriptor, title: "七一班数学材料", materialKind: "lesson_note", subject: "数学", classId: "class-7-1", recognize: true },
    { recognize: async () => ({ events: [], slots: [] }) });
  assert.equal(material.receipts[0].status, "accepted");

  // Upgrading an enabled v1 canary must not silently restart broad G1. The
  // old grant stays visible until the teacher explicitly stops it, then a
  // fresh v2 grant may be created for the same class and subject.
  const roots = snapshotRoots.resolveEduPiBridgeRoots();
  const oldGrantToken = crypto.createHash("sha256").update("class-7-1\0数学", "utf8").digest("hex").slice(0, 32);
  const oldGrantId = `desktop_canary_${oldGrantToken}`;
  const oldHost = await supervisor.ensureEduPiRuntime(roots);
  const oldHealth = await oldHost.call("health", null);
  const rootRef = oldHealth.result.data_root_fingerprint;
  const grantNow = Date.now();
  const oldEndsAt = new Date(grantNow + 86_400_000).toISOString();
  await grantRuntime.ensureProactivityGrant(oldHost, rootRef, { grantId: oldGrantId, endsAt: oldEndsAt,
    spec: { scope: { class_id: "class-7-1", subject: "数学" }, domains: ["teaching_preparation"], actions: ["prepare", "update"],
      source_ids: [`conversation:${"c".repeat(64)}`], starts_at: new Date(grantNow - 60_000).toISOString(),
      ends_at: oldEndsAt, budget: { id: `budget_${oldGrantToken}`, max_calls: 12 } } });
  const legacyUpdatedAt = new Date(grantNow).toISOString();
  fs.writeFileSync(path.join(stateDir, "edupi-proactivity.json"), JSON.stringify({ version: 1,
    data_root_hash: `sha256:${crypto.createHash("sha256").update(fs.realpathSync(dataRoot), "utf8").digest("hex")}`,
    enabled: true, scope: { class_id: "class-7-1", subject: "数学" }, grant_id: oldGrantId,
    updated_at: legacyUpdatedAt }), { mode: 0o600 });
  await supervisor.closeAllEduPiRuntimes();
  const legacyResponse = await proactivityRoute.GET(request("http://localhost/api/edupi/proactivity"));
  const legacyState = await legacyResponse.json();
  assert.equal(legacyState.activation.enabled, false);
  assert.equal(legacyState.activation.configurationStatus, "legacy");
  assert.deepEqual(legacyState.activation.scope, { classId: "class-7-1", subject: "数学" });
  const legacyStatus = await statusRoute.GET(new Request("http://localhost/api/edupi/status?summary=1", { headers: { host: "localhost" } }));
  assert.equal((await legacyStatus.json()).core.capabilities.g1_processor, "activation_pending");
  const earlyEnable = await proactivityRoute.POST(request("http://localhost/api/edupi/proactivity", "POST", {
    enabled: true, classId: "class-7-1", subject: "数学", expectedUpdatedAt: legacyUpdatedAt }));
  assert.equal(earlyEnable.status, 409, "legacy grant must be stopped before a v2 grant can be created");
  const stoppedLegacy = await proactivityRoute.POST(request("http://localhost/api/edupi/proactivity", "POST", {
    enabled: false, classId: null, subject: null, expectedUpdatedAt: legacyUpdatedAt }));
  const stoppedLegacyBody = await stoppedLegacy.json();
  assert.equal(stoppedLegacy.status, 200, JSON.stringify(stoppedLegacyBody));
  assert.equal(stoppedLegacyBody.grantPaused, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(stateDir, "edupi-proactivity.json"), "utf8")).version, 2);
  const stoppedHost = await supervisor.ensureEduPiRuntime(roots);
  const stoppedHealth = await stoppedHost.call("health", null);
  const stoppedOwner = await stoppedHost.call("owner_read", { root_ref: stoppedHealth.result.data_root_fingerprint });
  assert.equal(stoppedOwner.result.grants.find(item => item.id === oldGrantId).status, "paused");

  const before = await proactivityRoute.GET(request("http://localhost/api/edupi/proactivity"));
  const beforeBody = await before.json();
  assert.equal(before.status, 200, JSON.stringify(beforeBody));
  assert.equal(beforeBody.activation.enabled, false);
  assert.equal(beforeBody.scopes.some((item) => item.classId === "class-7-1" && item.subject === "数学" && item.ready), true);
  const disabledMessageIntake = await messageRoute.GET(request("http://localhost/api/edupi/proactivity/messages"));
  assert.equal(disabledMessageIntake.status, 200);
  assert.equal((await disabledMessageIntake.json()).status, "disabled");

  const enableInput = { enabled: true, classId: "class-7-1", subject: "数学", expectedUpdatedAt: beforeBody.activation.updatedAt };
  const enableAttempts = await Promise.all([
    proactivityRoute.POST(request("http://localhost/api/edupi/proactivity", "POST", enableInput)),
    proactivityRoute.POST(request("http://localhost/api/edupi/proactivity", "POST", enableInput)),
  ]);
  const enableCodes = await Promise.all(enableAttempts.map(async (item) => {
    const body = await item.clone().json();
    return { status: item.status, code: body?.code ?? null, error: body?.error ?? null };
  }));
  assert.deepEqual(enableAttempts.map((item) => item.status).sort((left, right) => left - right), [200, 409], JSON.stringify(enableCodes));
  const enabled = enableAttempts.find((item) => item.status === 200);
  assert.ok(enabled);
  const enabledBody = await enabled.json();
  assert.equal(enabled.status, 200, JSON.stringify(enabledBody));
  assert.equal(enabledBody.activation.enabled, true);
  assert.equal(enabledBody.grant.status, "active");
  assert.deepEqual(enabledBody.capabilities, { ambientPlanning: true, ownerIntent: true, attentionDelivery: true, teacherFeedback: true });
  assert.equal(enabledBody.externalSend, false);
  assert.equal((await (await messageRoute.GET(request("http://localhost/api/edupi/proactivity/messages"))).json()).status, "enabled");

  const legacyMessage = await messageRoute.POST(request("http://localhost/api/edupi/proactivity/messages", "POST", {
    sessionId, messageId: "legacy-message", text: "帮我准备明天的数学教案", occurredAt: new Date().toISOString(),
  }));
  assert.equal(legacyMessage.status, 409);
  assert.equal((await legacyMessage.json()).status, "registered_prompt_required");
  assert.deepEqual(ambientLedger.readWithdrawableEduPiAmbientMessages(sessionId, { stateDir, dataRoot }), []);

  // Paired Core must acknowledge registration before capture. The actual Pi
  // dispatch/outbox route has its own tests; this canary never sends to Pi.
  const activeHost = await supervisor.ensureEduPiRuntime(roots);
  const activeHealth = await activeHost.call("health", null);
  const activeRootRef = activeHealth.result.data_root_fingerprint;
  const activeGrantId = JSON.parse(fs.readFileSync(path.join(stateDir, "edupi-proactivity.json"), "utf8")).grant_id;
  assert.equal(typeof activeGrantId, "string");
  const activeOwner = await grantRuntime.readProactivityOwnerContext(activeHost, activeRootRef, activeGrantId);
  assert.equal(activeOwner.status, "active");
  const capture = async (messageId, text, occurredAt = new Date().toISOString()) => registeredPrompt.registerAndCapturePrompt(activeHost, {
    rootRef: activeRootRef, grantId: activeGrantId, sessionId, messageId, text, occurredAt,
    domain: "teaching_preparation", carrierId: "edupi.desktop.canary", planId: `canary.${messageId}`,
  }, {
    onBound: () => {},
    onRegistered: proof => ambientLedger.prepareEduPiAmbientMessageBinding({ sessionId, messageId,
      messageRef: proof.messageRef, ownerId: proof.binding.ownerId, grantId: proof.binding.grantId,
      captureGrantVersion: proof.binding.grantVersion, occurredAt }, { stateDir, dataRoot }),
    onCaptured: proof => ambientLedger.confirmEduPiAmbientMessageBinding(sessionId, messageId, proof.messageRef, { stateDir, dataRoot }),
  });
  const firstOccurredAt = new Date().toISOString();
  const firstProof = await capture("canary-message-1", `帮我准备${tomorrow.date}的数学教案`, firstOccurredAt);
  const bindings = async () => {
    const reply = await activeHost.callOwnerControl("owner_goal_bindings_read", { root_ref: activeRootRef,
      expected_owner_id: activeOwner.ownerId, grant_id: activeGrantId,
      expected_grant_version: activeOwner.grantVersion });
    assert.equal(reply.ok, true, JSON.stringify(reply));
    assert.equal(reply.result.external_send, false);
    return reply.result.bindings;
  };
  const firstBinding = (await bindings()).find(item => item.message_ref === firstProof.messageRef);
  assert.ok(firstBinding, "registered capture should create one Core-owned teaching goal");
  await capture("canary-message-1", `帮我准备${tomorrow.date}的数学教案`, firstOccurredAt);
  assert.equal((await bindings()).filter(item => item.message_ref === firstProof.messageRef).length, 1);
  const outsideProof = await capture("canary-outside-g1", "请跟进学生张三的课堂观察");
  assert.equal((await bindings()).some(item => item.message_ref === outsideProof.messageRef), false,
    "a G1-only grant must not turn student follow-up into a teaching goal");
  const feedbackTargetResponse = await feedbackRoute.POST(request("http://localhost/api/edupi/teacher-feedback", "POST",
    { action: "target_read", target: { kind: "goal", target_id: firstBinding.goal_id } }));
  const feedbackTargetBody = await feedbackTargetResponse.json();
  assert.equal(feedbackTargetResponse.status, 200, JSON.stringify(feedbackTargetBody));
  assert.equal(feedbackTargetBody.ok, true, JSON.stringify(feedbackTargetBody));
  const feedbackTarget = feedbackTargetBody.result;
  const feedbackRecord = {
    command_id: "canary-feedback-record-1", session_id: "canary-synthetic-e2", evidence_level: "synthetic",
    domain: "teaching_preparation", scope: { class_id: "class-7-1", subject: "数学" }, signal: "surfaced",
    target: { kind: "goal", target_id: firstBinding.goal_id, expected_revision: feedbackTarget.revision, expected_fingerprint: feedbackTarget.fingerprint },
    decision: "hold", usefulness: "not_observed", used: false, would_use_again: null, baseline_minutes: null, review_minutes: null,
    issue_codes: [], note: "自动化反馈通道验证，不计入真实教师价值", evidence_ids: feedbackTarget.evidence_ids,
    occurred_at: new Date().toISOString(), supersedes_feedback_id: null,
  };
  const feedbackRecorded = await feedbackRoute.POST(request("http://localhost/api/edupi/teacher-feedback", "POST", { action: "record", record: feedbackRecord }));
  const feedbackRecordedBody = await feedbackRecorded.json();
  assert.equal(feedbackRecorded.status, 200, JSON.stringify(feedbackRecordedBody));
  assert.equal(feedbackRecordedBody.ok, true, JSON.stringify(feedbackRecordedBody));
  const feedbackRead = await feedbackRoute.GET(request("http://localhost/api/edupi/teacher-feedback"));
  const feedbackReadBody = await feedbackRead.json();
  assert.equal(feedbackRead.status, 200, JSON.stringify(feedbackReadBody));
  assert.equal(feedbackReadBody.result.feedback.length, 1);
  assert.equal(feedbackReadBody.result.summary.real_teacher_current, 0);
  assert.equal(feedbackReadBody.result.summary.synthetic_excluded, 1);

  const planningFile = path.join(home, "output", "ambient-planning-v1.json");
  const deletionProof = await capture("canary-message-4", `帮我准备${deletionDay.date}的数学教案`);
  const deletionBinding = (await bindings()).find(item => item.message_ref === deletionProof.messageRef);
  assert.ok(deletionBinding);

  await supervisor.closeAllEduPiRuntimes();
  const restarted = await statusRoute.GET(new Request("http://localhost/api/edupi/status?summary=1", { headers: { host: "localhost" } }));
  const restartedBody = await restarted.json();
  assert.equal(restarted.status, 200, JSON.stringify(restartedBody));
  assert.equal(restartedBody.proactivity.status, "active");
  assert.equal(restartedBody.proactivity.activationSource, "desktop_canary");
  assert.equal(restartedBody.proactivity.externalSend, false);

  const disabled = await proactivityRoute.POST(request("http://localhost/api/edupi/proactivity", "POST", { enabled: false,
    classId: null, subject: null, expectedUpdatedAt: enabledBody.activation.updatedAt }));
  const disabledBody = await disabled.json();
  assert.equal(disabled.status, 200, JSON.stringify(disabledBody));
  assert.equal(disabledBody.activation.enabled, false);
  assert.equal((await (await messageRoute.GET(request("http://localhost/api/edupi/proactivity/messages"))).json()).status, "disabled");
  const ignored = await messageRoute.POST(request("http://localhost/api/edupi/proactivity/messages", "POST", { sessionId,
    messageId: "disabled-message", text: "帮我备课", occurredAt: new Date().toISOString() }));
  assert.equal(ignored.status, 202);
  assert.equal((await ignored.json()).status, "disabled");
  assert.equal(fs.existsSync(path.join(stateDir, "edupi-proactivity.json")), true);
  const capturedBindings = ambientLedger.readWithdrawableEduPiAmbientMessages(sessionId, { stateDir, dataRoot });
  assert.equal(capturedBindings.length, 3);
  ambientLedger.prepareEduPiAmbientMessageBinding({ sessionId, messageId: "canary-crash-before-capture",
    messageRef: `owner_message:${"f".repeat(64)}`, ownerId: capturedBindings[0].ownerId,
    grantId: capturedBindings[0].grantId, captureGrantVersion: capturedBindings[0].captureGrantVersion,
    occurredAt: new Date().toISOString() }, { stateDir, dataRoot });
  const deleted = await sessionRoute.DELETE(request(`http://localhost/api/sessions/${sessionId}`, "DELETE"),
    { params: Promise.resolve({ id: sessionId }) });
  assert.equal(deleted.status, 200, JSON.stringify(await deleted.clone().json()));
  assert.equal(fs.existsSync(sessionFile), false);
  assert.deepEqual(ambientLedger.readCapturedEduPiAmbientMessages(sessionId, { stateDir, dataRoot }), []);
  const afterDeletePlanning = JSON.parse(fs.readFileSync(planningFile, "utf8")).state;
  assert.equal(afterDeletePlanning.goals.find((item) => item.id === deletionBinding.goal_id).status, "revoked");
  const beforeStopFailure = await proactivityRoute.GET(request("http://localhost/api/edupi/proactivity"));
  const beforeStopFailureState = await beforeStopFailure.json();
  const enabledForStopFailure = await proactivityRoute.POST(request("http://localhost/api/edupi/proactivity", "POST", {
    enabled: true, classId: "class-7-1", subject: "数学", expectedUpdatedAt: beforeStopFailureState.activation.updatedAt }));
  const enabledForStopFailureState = await enabledForStopFailure.json();
  assert.equal(enabledForStopFailure.status, 200, JSON.stringify(enabledForStopFailureState));
  const configFile = path.join(stateDir, "edupi-proactivity.json");
  const ownerFile = path.join(home, "output", "ambient-authorization-v1.json");
  const oldConfigBytes = fs.readFileSync(configFile);
  const oldOwnerBytes = fs.readFileSync(ownerFile);
  fs.writeFileSync(ownerFile, "{}", { mode: 0o600 });
  const originalSync = fs.fsyncSync;
  let directorySyncs = 0;
  fs.fsyncSync = descriptor => {
    if (fs.fstatSync(descriptor).isDirectory() && ++directorySyncs >= 2) throw new Error("synthetic_config_sync_failure");
    return originalSync(descriptor);
  };
  let failedStop;
  try {
    failedStop = await proactivityRoute.POST(request("http://localhost/api/edupi/proactivity", "POST", {
      enabled: false, classId: null, subject: null, expectedUpdatedAt: enabledForStopFailureState.activation.updatedAt }));
  } finally { fs.fsyncSync = originalSync; }
  assert.equal(failedStop.status, 503, "pause and config durability failure must never acknowledge a stop");
  assert.equal((await failedStop.json()).code, "proactivity_stop_uncertain");
  assert.equal(supervisor.getActiveEduPiRuntime(dataRoot), null, "failed stop closes the current G1 process");
  // Model a crash restoring both old valid files; the independently durable
  // marker must still fence a fresh packaged-server process.
  fs.writeFileSync(ownerFile, oldOwnerBytes, { mode: 0o600 });
  fs.writeFileSync(configFile, oldConfigBytes, { mode: 0o600 });
  const restartSource = `import path from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(path.join(process.cwd(), "scripts/test-edupi-proactivity-canary-e2.mjs"), { tsconfigPaths: true });
const { resolveEduPiBridgeRoots } = await jiti.import("../lib/edupi-core-snapshot.ts");
const { ensureEduPiRuntime, closeAllEduPiRuntimes } = await jiti.import("../lib/edupi-runtime-supervisor.ts");
const host = await ensureEduPiRuntime(resolveEduPiBridgeRoots());
const health = await host.call("health", null);
if (!health.ok || health.result.capabilities.g1_processor !== "activation_pending") process.exitCode = 1;
await closeAllEduPiRuntimes();`;
  const afterCrash = spawnSync(process.execPath, ["--input-type=module", "-e", restartSource], {
    cwd: desktopRoot, env: process.env, encoding: "utf8", timeout: 60_000 });
  assert.equal(afterCrash.status, 0, `stop marker did not fence a new process: ${afterCrash.stderr.slice(-1000)}`);
  const pendingStopState = await (await proactivityRoute.GET(request("http://localhost/api/edupi/proactivity"))).json();
  assert.equal(pendingStopState.activation.configurationStatus, "stop_pending");
  const recoveredStop = await proactivityRoute.POST(request("http://localhost/api/edupi/proactivity", "POST", {
    enabled: false, classId: null, subject: null, expectedUpdatedAt: pendingStopState.activation.updatedAt }));
  const recoveredStopState = await recoveredStop.json();
  assert.equal(recoveredStop.status, 200, JSON.stringify(recoveredStopState));
  assert.equal(recoveredStopState.grantPaused, true);
  assert.equal(fs.existsSync(path.join(stateDir, "edupi-proactivity-stop.json")), false);
  console.log(JSON.stringify({ status: "passed", explicit_opt_in: true, scope_bound: true, registered_message_goal: true,
    concurrent_activation_cas: true, legacy_capture_rejected: true, out_of_scope_not_applied: true,
    replay_no_duplicate: true, restart_persistent: true,
    feedback_channel: true, synthetic_feedback_excluded: true, explicit_stop: true, session_delete_withdrawal: true,
    active_goal_delete_propagation: true, capture_crash_recovery: true, stop_durability_failure_fenced: true,
    external_send: false }));
} finally {
  try {
    const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
    const supervisor = await jiti.import("../lib/edupi-runtime-supervisor.ts");
    await supervisor.closeAllEduPiRuntimes();
  } catch { /* bounded cleanup */ }
  if (keepArtifacts) console.log(JSON.stringify({ status: "retained", temporary_root: temp, data_root: dataRoot, state_dir: stateDir, agent_dir: agentDir }));
  else fs.rmSync(temp, { recursive: true, force: true });
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
