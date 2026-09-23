#!/usr/bin/env node

import assert from "node:assert/strict";
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
  assert.deepEqual(enableAttempts.map((item) => item.status).sort((left, right) => left - right), [200, 409]);
  const enabled = enableAttempts.find((item) => item.status === 200);
  assert.ok(enabled);
  const enabledBody = await enabled.json();
  assert.equal(enabled.status, 200, JSON.stringify(enabledBody));
  assert.equal(enabledBody.activation.enabled, true);
  assert.equal(enabledBody.grant.status, "active");
  assert.deepEqual(enabledBody.capabilities, { ambientPlanning: true, ownerIntent: true, attentionDelivery: true, teacherFeedback: true });
  assert.equal(enabledBody.externalSend, false);
  assert.equal((await (await messageRoute.GET(request("http://localhost/api/edupi/proactivity/messages"))).json()).status, "enabled");

  const messageBody = { sessionId, messageId: "canary-message-1", text: "帮我准备明天的数学教案", occurredAt: new Date().toISOString() };
  const firstMessage = await messageRoute.POST(request("http://localhost/api/edupi/proactivity/messages", "POST", messageBody));
  const firstMessageBody = await firstMessage.json();
  assert.equal(firstMessage.status, 200, JSON.stringify(firstMessageBody));
  assert.equal(firstMessageBody.status, "applied");
  assert.equal(firstMessageBody.externalSend, false);
  const replayMessage = await messageRoute.POST(request("http://localhost/api/edupi/proactivity/messages", "POST", messageBody));
  const replayMessageBody = await replayMessage.json();
  assert.equal(replayMessage.status, 200, JSON.stringify(replayMessageBody));
  assert.equal(replayMessageBody.goalId, firstMessageBody.goalId);

  const feedbackTargetResponse = await feedbackRoute.POST(request("http://localhost/api/edupi/teacher-feedback", "POST",
    { action: "target_read", target: { kind: "goal", target_id: firstMessageBody.goalId } }));
  const feedbackTargetBody = await feedbackTargetResponse.json();
  assert.equal(feedbackTargetResponse.status, 200, JSON.stringify(feedbackTargetBody));
  assert.equal(feedbackTargetBody.ok, true, JSON.stringify(feedbackTargetBody));
  const feedbackTarget = feedbackTargetBody.result;
  const feedbackRecord = {
    command_id: "canary-feedback-record-1", session_id: "canary-synthetic-e2", evidence_level: "synthetic",
    domain: "teaching_preparation", scope: { class_id: "class-7-1", subject: "数学" }, signal: "surfaced",
    target: { kind: "goal", target_id: firstMessageBody.goalId, expected_revision: feedbackTarget.revision, expected_fingerprint: feedbackTarget.fingerprint },
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

  const correctionBody = { sessionId, messageId: "canary-message-2", text: `改到${correctedDay.date}的数学课`, occurredAt: new Date().toISOString() };
  const correction = await messageRoute.POST(request("http://localhost/api/edupi/proactivity/messages", "POST", correctionBody));
  const correctionResult = await correction.json();
  assert.equal(correction.status, 200, JSON.stringify(correctionResult));
  assert.equal(correctionResult.status, "corrected", JSON.stringify(correctionResult));
  assert.notEqual(correctionResult.goalId, firstMessageBody.goalId);
  assert.equal(correctionResult.externalSend, false);
  const correctionReplay = await messageRoute.POST(request("http://localhost/api/edupi/proactivity/messages", "POST", correctionBody));
  const correctionReplayResult = await correctionReplay.json();
  assert.equal(correctionReplay.status, 200, JSON.stringify(correctionReplayResult));
  assert.equal(correctionReplayResult.status, "corrected", JSON.stringify(correctionReplayResult));
  assert.equal(correctionReplayResult.goalId, correctionResult.goalId);

  const cancellationBody = { sessionId, messageId: "canary-message-3", text: "取消这节数学备课", occurredAt: new Date().toISOString() };
  const cancellation = await messageRoute.POST(request("http://localhost/api/edupi/proactivity/messages", "POST", cancellationBody));
  const cancellationResult = await cancellation.json();
  assert.equal(cancellation.status, 200, JSON.stringify(cancellationResult));
  assert.equal(cancellationResult.status, "cancelled", JSON.stringify(cancellationResult));
  assert.equal(cancellationResult.goalId, correctionResult.goalId);
  assert.equal(cancellationResult.externalSend, false);
  const planningFile = path.join(home, "output", "ambient-planning-v1.json");
  const controlEventsBeforeReplay = JSON.parse(fs.readFileSync(planningFile, "utf8")).state.events.filter((item) => item.kind === "goal_control").length;
  const cancellationReplay = await messageRoute.POST(request("http://localhost/api/edupi/proactivity/messages", "POST", cancellationBody));
  const cancellationReplayResult = await cancellationReplay.json();
  assert.equal(cancellationReplay.status, 200, JSON.stringify(cancellationReplayResult));
  assert.ok(["cancelled", "captured"].includes(cancellationReplayResult.status));
  const controlEventsAfterReplay = JSON.parse(fs.readFileSync(planningFile, "utf8")).state.events.filter((item) => item.kind === "goal_control").length;
  assert.equal(controlEventsAfterReplay, controlEventsBeforeReplay);
  const deletionSource = await messageRoute.POST(request("http://localhost/api/edupi/proactivity/messages", "POST", {
    sessionId, messageId: "canary-message-4", text: `帮我准备${deletionDay.date}的数学教案`, occurredAt: new Date().toISOString(),
  }));
  const deletionSourceResult = await deletionSource.json();
  assert.equal(deletionSource.status, 200, JSON.stringify(deletionSourceResult));
  assert.equal(deletionSourceResult.status, "applied");

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
  assert.equal(capturedBindings.length, 4);
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
  assert.equal(afterDeletePlanning.goals.find((item) => item.id === deletionSourceResult.goalId).status, "revoked");
  console.log(JSON.stringify({ status: "passed", explicit_opt_in: true, scope_bound: true, ordinary_message_goal: true,
    concurrent_activation_cas: true, natural_correction: true, natural_cancellation: true, replay_no_duplicate: true, restart_persistent: true,
    feedback_channel: true, synthetic_feedback_excluded: true, explicit_stop: true, session_delete_withdrawal: true,
    active_goal_delete_propagation: true, capture_crash_recovery: true, model_provider_calls: 0, external_send: false }));
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
