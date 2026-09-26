#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const appRoot = path.resolve(process.env.EDUPI_INSTALLED_APP || "src-tauri/target/release/bundle/macos/EduPi Route1 Canary.app");
const desktopRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts/edupi-core-compat.json"), "utf8"));
const resources = path.resolve(process.env.EDUPI_PACKAGED_RESOURCES || path.join(appRoot, "Contents/Resources/resources"));
const serverDir = path.join(resources, "server");
const coreRoot = path.join(resources, "edupi-core");
const serverEntry = path.join(serverDir, "desktop-server.cjs");
const nodeBinary = path.resolve(process.env.EDUPI_PACKAGED_NODE || (process.platform === "darwin"
  ? path.join(resources, "Pi Agent Server.app/Contents/MacOS/node")
  : path.join(resources, "node", process.platform === "win32" ? "node.exe" : "node")));
for (const required of [serverEntry, coreRoot, nodeBinary]) assert.equal(fs.existsSync(required), true, `missing packaged resource: ${required}`);

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-route1-packaged-loop-")));
const dataRoot = path.join(temp, "teacher-data");
const homeRoot = path.join(temp, "home");
const agentDir = path.join(homeRoot, ".pi", "agent");
const stateDir = path.join(temp, "desktop-state");
const memoryDir = path.join(dataRoot, ".edupi", "memory");
const outputDir = path.join(dataRoot, ".edupi", "output");
const materialDir = path.join(dataRoot, ".edupi", "inbox", "teacher-materials");
for (const directory of [agentDir, stateDir, memoryDir, outputDir, materialDir, path.join(dataRoot, ".edupi", "locks")]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}
const runtimeDatabase = path.join(dataRoot, ".edupi", "runtime", "core-runtime-v1.sqlite");
const token = "route1-packaged-test-token-012345678901234567890123";
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let modelServer;
let firstServer;
let secondServer;
let modelCalls = 0;
let success = false;
const logs = [];

const dateInShanghai = (value = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
}).format(value);
const today = dateInShanghai();
const lessonDate = dateInShanghai(new Date(new Date(`${today}T12:00:00+08:00`).getTime() + 86_400_000));
const lessonDay = new Date(`${lessonDate}T12:00:00+08:00`).getUTCDay() || 7;
const slot = { slot_id: "route1-slot", subject: "数学", class_name: "class-7-1", day_of_week: lessonDay, period: 2, kind: "class", notes: "一元一次方程" };
let materialId;
const materialText = "七一班一元一次方程：移项、合并同类项和解的检验。";
fs.writeFileSync(path.join(memoryDir, "timetable.json"), JSON.stringify({ slots: [slot] }));
fs.writeFileSync(path.join(memoryDir, "calendar.json"), JSON.stringify({ events: [] }));
fs.writeFileSync(path.join(memoryDir, "preferences.json"), JSON.stringify({ entries: [] }));
fs.writeFileSync(path.join(memoryDir, "semester.json"), JSON.stringify({ start_date: today, end_date: lessonDate, entries: [] }));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise(resolve => server.close(resolve));
  return address.port;
}

async function waitFor(label, read, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await read();
      if (predicate(last)) return last;
    } catch (error) { last = error; }
    await wait(200);
  }
  throw new Error(`${label} timed out: ${last instanceof Error ? last.message : JSON.stringify(last)}; logs=${logs.slice(-12).join("").slice(-2500)}`);
}

function writeModelSettings(port) {
  fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
    api: "openai-completions", apiKey: "local-test-placeholder", baseUrl: `http://127.0.0.1:${port}/v1`,
    models: [{ id: "local", name: "Route1 local test", input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_000, maxTokens: 2_048 }],
  } } }), { mode: 0o600 });
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "local", defaultModel: "local" }), { mode: 0o600 });
}

async function startPackagedServer(label) {
  const port = await freePort();
  const child = spawn(nodeBinary, [serverEntry], { cwd: serverDir, detached: process.platform !== "win32", env: {
    ...process.env, HOME: homeRoot, HOSTNAME: "127.0.0.1", PORT: String(port), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    PI_CODING_AGENT_DIR: agentDir, PI_DESKTOP_STATE_DIR: stateDir, PI_DESKTOP_API_TOKEN: token,
    PI_DESKTOP_INSTANCE_ID: "route1-packaged-loop", PI_WEB_PARENT_PID: String(process.pid), PI_OFFLINE: "1",
    EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: temp,
    EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: resources, EDUPI_CORE_VALIDATION_MODE: "bundled",
    EDUPI_HOME: path.join(dataRoot, ".edupi"), EDUPI_MEMORY_DIR: memoryDir,
    EDUPI_OUTPUT_DIR: outputDir, EDUPI_LOCK_DIR: path.join(dataRoot, ".edupi", "locks"),
  }, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { logs.push(`[${label}] ${chunk.toString("utf8")}`); if (logs.length > 200) logs.shift(); });
  const server = { child, url: `http://127.0.0.1:${port}` };
  try {
    await waitFor(`${label} identity`, async () => (await fetch(`${server.url}/api/desktop/identity`, { signal: AbortSignal.timeout(2_000) })).status,
      status => status === 204, 45_000);
    await waitFor(`${label} headless Core boot`, () => fs.existsSync(runtimeDatabase), Boolean, 30_000);
    return server;
  } catch (error) { await stop(server); throw error; }
}

async function stop(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  const exited = new Promise(resolve => server.child.once("exit", resolve));
  server.child.kill("SIGTERM");
  await Promise.race([exited, wait(3_000)]);
  if (server.child.exitCode === null && server.child.signalCode === null) {
    if (process.platform !== "win32") { try { process.kill(-server.child.pid, "SIGKILL"); } catch { server.child.kill("SIGKILL"); } }
    else server.child.kill("SIGKILL");
    await Promise.race([exited, wait(3_000)]);
  }
}

async function api(server, pathname, body) {
  const response = await fetch(`${server.url}${pathname}`, { method: body === undefined ? "GET" : "POST",
    headers: { origin: server.url, "sec-fetch-site": "same-origin", "x-pi-desktop-token": token,
      ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  const value = await response.json();
  assert.equal(response.ok, true, `${pathname} ${response.status}: ${JSON.stringify(value)}`);
  return value;
}

try {
  // Seed only a synthetic, explicitly verified local excerpt. Never read the real teacher root.
  Object.assign(process.env, { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot,
    EDUPI_DATA_ALLOWED_ROOT: temp, EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: resources,
    EDUPI_CORE_VALIDATION_MODE: "bundled", EDUPI_CORE_COMMIT: compat.core_runtime.core_commit,
    PI_CODING_AGENT_DIR: agentDir, PI_DESKTOP_STATE_DIR: stateDir,
    EDUPI_HOME: path.join(dataRoot, ".edupi"), EDUPI_MEMORY_DIR: memoryDir,
    EDUPI_OUTPUT_DIR: outputDir, EDUPI_LOCK_DIR: path.join(dataRoot, ".edupi", "locks") });
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const { issueEducationIntake } = await jiti.import("../lib/edupi-education-intake.ts");
  const { stageMaterialInputs } = await jiti.import("../lib/edupi-material-staging.ts");
  const { intakeRecognizedMaterial } = await jiti.import("../lib/edupi-material-intake-flow.ts");
  const scopeTimetable = await issueEducationIntake({ command_type: "import_timetable",
    source: { source_id: "route1-canary-scope-timetable", source_kind: "teacher_message",
      source_hash: `sha256:${"c".repeat(64)}`, evidence_ids: ["route1-synthetic-scope"] },
    slots: [{ ...slot, class_id: "class-7-1",
      start_time: "09:00", time_zone: "Asia/Shanghai" }] });
  assert.equal(scopeTimetable.receipt.status, "accepted");
  const descriptor = stageMaterialInputs([{ name: "route1-scope.pdf", mimeType: "application/pdf",
    bytes: new Uint8Array(Buffer.from(`%PDF-1.4\n${materialText}\n`)) }])[0];
  materialId = `material-${descriptor.staging_id.slice("stg_".length)}`;
  const scopeMaterial = await intakeRecognizedMaterial({ descriptor, title: "七一班数学材料", materialKind: "lesson_note",
    subject: "数学", classId: "class-7-1", recognize: true }, { recognize: async () => ({ events: [], slots: [] }) });
  assert.equal(scopeMaterial.receipts[0].status, "accepted");
  const { prepareCoreRuntimeRoot } = await import(path.join(coreRoot, "scripts/core_runtime_root.mjs"));
  const { acquireCoreRuntimeWriterAdmission } = await import(path.join(coreRoot, "scripts/core_runtime_writer_admission.mjs"));
  const { reviewG1Excerpt } = await import(path.join(coreRoot, "scripts/core_runtime_g1_excerpts.mjs"));
  const admission = await acquireCoreRuntimeWriterAdmission({ root: prepareCoreRuntimeRoot(dataRoot), kind: "legacy_route1_packaged_seed", busyTimeoutMs: 1_000 });
  try { reviewG1Excerpt({ materialId, subject: "数学", classId: "class-7-1", expectedRevision: 0,
    content: materialText, reviewer: "synthetic-route1", decision: "confirm" }); }
  finally { await admission.release(); }

  modelServer = http.createServer(async (request, response) => {
    const parts = [];
    for await (const chunk of request) parts.push(chunk);
    const payload = JSON.parse(Buffer.concat(parts).toString("utf8"));
    const prompt = payload.messages.flatMap(message => typeof message.content === "string" ? [message.content]
      : Array.isArray(message.content) ? message.content.map(item => item.text).filter(Boolean) : []).join("\n");
    const fixtureLine = prompt.split("\n").find(line => line.startsWith('{"task":'));
    assert.ok(fixtureLine, "G1 model request has no bounded task/material input");
    const fixture = JSON.parse(fixtureLine);
    assert.equal(fixture.materials.length > 0, true, "G1 model request has no verified material");
    const sourceId = fixture.materials[0].source_id;
    modelCalls += 1;
    const content = JSON.stringify({ artifacts: fixture.task.deliverables.map(title => ({ title,
      content: title.includes("答案") ? "2x + 3 = 7，移项得 2x = 4，所以 x = 2；代入检验成立。" : "使用已确认材料，练习解方程 2x + 3 = 7。",
      source_ids: [sourceId] })) });
    const chunk = { id: `route1-${modelCalls}`, object: "chat.completion.chunk", created: 1, model: "local" };
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.end(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise((resolve, reject) => { modelServer.once("error", reject); modelServer.listen(0, "127.0.0.1", resolve); });
  const modelAddress = modelServer.address();
  assert.ok(modelAddress && typeof modelAddress === "object");
  writeModelSettings(modelAddress.port);

  firstServer = await startPackagedServer("first");
  const status = await api(firstServer, "/api/edupi/status?summary=1");
  assert.equal(status.core.status, "ready");
  assert.equal(status.projection.status, "ready");
  assert.equal(status.core.capabilities.g1_processor, "active");
  assert.equal(status.core.capabilities.g2_processor, "activation_pending");
  assert.equal(status.core.capabilities.g3_processor, "activation_pending");
  assert.equal(status.externalSend, false);

  const ready = await waitFor("internal G1 draft", async () => {
    const data = await api(firstServer, "/api/edupi/education");
    const taskId = data.tasks.find(item => item.sourceEventDate === lessonDate && item.trigger === "teaching_before_class")?.id;
    return { data, workCase: data.workCases.find(item => item.taskId === taskId) };
  }, value => value.workCase?.currentState === "draft_ready" || value.workCase?.currentState === "failed", 45_000);
  if (ready.workCase.currentState === "failed") {
    const execution = JSON.parse(fs.readFileSync(path.join(outputDir, "calendar_work_execution_state.json"), "utf8"));
    throw new Error(`G1 execution failed: ${JSON.stringify({ modelCalls, execution: execution.executions.find(item => item.task_id === ready.workCase.taskId) })}`);
  }
  const taskId = ready.workCase.taskId;
  assert.equal(modelCalls, 1);
  const artifactCount = ready.workCase.artifactIds.length;
  assert.equal(artifactCount, 4);
  assert.equal(ready.data.generatedArtifacts.filter(item => item.task_id === taskId && item.available).length, artifactCount);

  const repeatEnsure = await api(firstServer, "/api/edupi/preparation", { action: "ensure" });
  assert.notEqual(repeatEnsure.state, "error");
  const replay = await api(firstServer, "/api/edupi/preparation", { action: "run", taskId });
  assert.equal(replay.state, "ready");
  assert.equal((await api(firstServer, "/api/edupi/education")).tasks.filter(item => item.id === taskId).length, 1);
  assert.equal(modelCalls, 1);
  const reminders = await api(firstServer, "/api/edupi/reminders");
  const reminder = reminders.items.find(item => item.taskId === taskId && item.kind === "ready" && !item.withdrawn);
  assert.ok(reminder, "completed draft is absent from the internal reminder inbox");
  const claimed = await api(firstServer, "/api/edupi/reminders", { id: "*", type: "claim_notifications" });
  const nativeClaim = claimed.notifications.find(item => item.id === reminder.id);
  assert.ok(nativeClaim, `Core-linked G1 reminder was not admitted for native notification: ${JSON.stringify({ attention: claimed.attention,
    l4Preparation: ready.data.l4Preparation, item: claimed.items.find(item => item.id === reminder.id) })}`);
  const failed = await api(firstServer, "/api/edupi/reminders", { id: reminder.id, type: "notification_failed", attemptedAt: nativeClaim.notificationAttemptedAt });
  assert.equal(failed.items.find(item => item.id === reminder.id).notificationFailureCount, 1);
  const repeatedFailure = await api(firstServer, "/api/edupi/reminders", { id: reminder.id, type: "notification_failed", attemptedAt: nativeClaim.notificationAttemptedAt });
  assert.equal(repeatedFailure.items.find(item => item.id === reminder.id).notificationFailureCount, 1);
  assert.equal(repeatedFailure.items.find(item => item.id === reminder.id).handled, false);

  const beforeReview = await api(firstServer, "/api/edupi/education");
  const candidate = beforeReview.workCandidates.find(item => item.taskId === taskId && item.status === "pending_review");
  assert.ok(candidate, "G1 draft has no reviewable work candidate");
  const reviewed = await api(firstServer, "/api/edupi/education", { commandType: "review_work_candidate",
    candidateId: candidate.candidateId, expectedSnapshotId: candidate.snapshotId,
    expectedRevision: candidate.revision, decision: "accept" });
  assert.equal(reviewed.data.workCandidates.find(item => item.candidateId === candidate.candidateId).status, "accepted");
  const owner = await api(firstServer, "/api/edupi/teacher-feedback", { action: "bootstrap" });
  assert.equal(owner.ok, true, JSON.stringify(owner));
  const proactivity = await api(firstServer, "/api/edupi/proactivity");
  assert.equal(proactivity.scopes.some(item => item.classId === "class-7-1" && item.subject === "数学" && item.ready), true,
    JSON.stringify({ scopes: proactivity.scopes }));
  const activated = await api(firstServer, "/api/edupi/proactivity", { enabled: true,
    classId: "class-7-1", subject: "数学", expectedUpdatedAt: proactivity.activation.updatedAt });
  assert.equal(activated.activation.enabled, true);
  const targetBody = { action: "target_read", target: { kind: "work_candidate", target_id: candidate.candidateId } };
  const targetRead = await api(firstServer, "/api/edupi/teacher-feedback", targetBody);
  assert.equal(targetRead.ok, true, JSON.stringify(targetRead));
  const target = targetRead.result;
  assert.equal(target.scope?.class_id, "class-7-1");
  assert.equal(target.scope?.subject, "数学");
  const feedback = { command_id: "route1-synthetic-feedback-1", session_id: "route1-synthetic-session",
    evidence_level: "synthetic", domain: "teaching_preparation", scope: target.scope,
    signal: "surfaced", target: { kind: "work_candidate", target_id: candidate.candidateId,
      expected_revision: target.revision, expected_fingerprint: target.fingerprint },
    decision: "accept", usefulness: "useful", used: true, would_use_again: true,
    baseline_minutes: 15, review_minutes: 5, issue_codes: [], note: "隔离验收，不计入真人价值",
    evidence_ids: target.evidence_ids, occurred_at: new Date().toISOString(), supersedes_feedback_id: null };
  const feedbackRecord = await api(firstServer, "/api/edupi/teacher-feedback", { action: "record", record: feedback });
  assert.equal(feedbackRecord.ok, true);
  const feedbackId = feedbackRecord.result.feedback_id;
  const feedbackReplay = await api(firstServer, "/api/edupi/teacher-feedback", { action: "record", record: feedback });
  assert.equal(feedbackReplay.result.feedback_id, feedbackId);
  assert.equal(feedbackReplay.result.replayed, true);
  const feedbackRead = await api(firstServer, "/api/edupi/teacher-feedback");
  assert.equal(feedbackRead.result.feedback.some(item => item.feedback_id === feedbackId), true);
  assert.equal(feedbackRead.result.summary.synthetic_excluded, 1);
  assert.equal(feedbackRead.result.summary.real_teacher_current, 0);
  const deactivated = await api(firstServer, "/api/edupi/proactivity", { enabled: false,
    classId: null, subject: null, expectedUpdatedAt: activated.activation.updatedAt });
  assert.equal(deactivated.activation.enabled, false);

  await stop(firstServer);
  firstServer = undefined;
  secondServer = await startPackagedServer("restart");
  const afterRestart = await api(secondServer, "/api/edupi/education");
  assert.equal(afterRestart.tasks.filter(item => item.id === taskId).length, 1);
  assert.equal(afterRestart.generatedArtifacts.filter(item => item.task_id === taskId && item.available).length, artifactCount);
  const restartStatus = await api(secondServer, "/api/edupi/status?summary=1");
  assert.equal(restartStatus.core.capabilities.g2_processor, "activation_pending");
  assert.equal(restartStatus.core.capabilities.g3_processor, "activation_pending");
  const restartProactivity = await api(secondServer, "/api/edupi/proactivity");
  assert.equal(restartProactivity.activation.enabled, false);
  const reactivated = await api(secondServer, "/api/edupi/proactivity", { enabled: true,
    classId: "class-7-1", subject: "数学", expectedUpdatedAt: restartProactivity.activation.updatedAt });
  assert.equal(reactivated.activation.enabled, true);
  const feedbackAfterRestart = await api(secondServer, "/api/edupi/teacher-feedback");
  assert.equal(feedbackAfterRestart.result.feedback.some(item => item.feedback_id === feedbackId), true);
  const stoppedCanary = await api(secondServer, "/api/edupi/proactivity", { enabled: false,
    classId: null, subject: null, expectedUpdatedAt: reactivated.activation.updatedAt });
  assert.equal(stoppedCanary.activation.enabled, false);
  assert.equal(modelCalls, 1, "restart duplicated draft generation");
  success = true;
  console.log(JSON.stringify({ status: "passed", platform: process.platform, coreCommit: status.compatibility.actual.coreCommit,
    taskId, artifactCount, modelCalls, reminderId: reminder.id, notificationFailureDeduped: true,
    review: "accepted", syntheticFeedbackExcluded: true, restartPreserved: true, externalSend: false }));
} finally {
  await stop(firstServer);
  await stop(secondServer);
  if (modelServer) { modelServer.closeAllConnections(); await new Promise(resolve => modelServer.close(resolve)); }
  if (process.env.EDUPI_ROUTE1_KEEP === "1") console.log(JSON.stringify({ retained: temp }));
  else fs.rmSync(temp, { recursive: true, force: true });
  if (!success) process.exitCode = 1;
}
