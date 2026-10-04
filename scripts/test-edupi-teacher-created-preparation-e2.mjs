#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { createJiti } from "jiti";

const uiCheckpoint = process.argv.includes("--ui-checkpoint");
const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.ok(configuredCoreRoot && path.isAbsolute(configuredCoreRoot), "EDUPI_CORE_ROOT is required");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-teacher-created-e2-")));
const dataRoot = path.join(temporaryRoot, "teacher-data");
const homeRoot = path.join(temporaryRoot, "home");
const agentDir = path.join(homeRoot, ".pi", "agent");
const stateDir = path.join(temporaryRoot, "desktop-state");
const memoryDir = path.join(dataRoot, ".edupi", "memory");
const outputDir = path.join(dataRoot, ".edupi", "output");
const lockDir = path.join(dataRoot, ".edupi", "locks");
const materialDir = path.join(dataRoot, ".edupi", "inbox", "teacher-materials");
for (const directory of [agentDir, stateDir, memoryDir, outputDir, lockDir, materialDir]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

const dateInShanghai = (value = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
const today = dateInShanghai();
const lessonDate = dateInShanghai(new Date(new Date(`${today}T12:00:00+08:00`).getTime() + 86_400_000));
const lessonDay = new Date(`${lessonDate}T12:00:00+08:00`).getUTCDay() || 7;
const slot = { slot_id: "teacher-created-slot-e2", subject: "数学", class_id: "703", class_name: "703", day_of_week: lessonDay, period: 2, start_time: "09:00", time_zone: "Asia/Shanghai", kind: "class", notes: "一元一次方程" };
let materialId;
const materialText = "一元一次方程单元检测范围：移项、合并同类项和解的检验。";
const timetablePath = path.join(memoryDir, "timetable.json");
const intakeStatePath = path.join(outputDir, "education_intake_state.json");
fs.writeFileSync(timetablePath, JSON.stringify({ slots: [slot] }));
fs.writeFileSync(path.join(memoryDir, "calendar.json"), JSON.stringify({ events: [] }));
fs.writeFileSync(path.join(memoryDir, "preferences.json"), JSON.stringify({ entries: [] }));
fs.writeFileSync(path.join(memoryDir, "semester.json"), JSON.stringify({ start_date: today, end_date: lessonDate, entries: [] }));

const desktopToken = crypto.randomBytes(32).toString("hex");
Object.assign(process.env, {
  HOME: homeRoot,
  PI_CODING_AGENT_DIR: agentDir,
  PI_DESKTOP_STATE_DIR: stateDir,
  PI_DESKTOP_API_TOKEN: desktopToken,
  PI_OFFLINE: "1",
  EDUPI_DESKTOP_ISOLATED_CANARY: "1",
  EDUPI_CORE_ROOT: coreRoot,
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_CORE_VALIDATION_MODE: "external",
  EDUPI_PROJECT_ROOT: dataRoot,
  EDUPI_DATA_ROOT: dataRoot,
  EDUPI_DATA_ALLOWED_ROOT: temporaryRoot,
  EDUPI_HOME: path.join(dataRoot, ".edupi"),
  EDUPI_MEMORY_DIR: memoryDir,
  EDUPI_OUTPUT_DIR: outputDir,
  EDUPI_LOCK_DIR: lockDir,
});

let modelCalls = 0, expectedTaskId = null;
const deliverables = ["检测卷", "参考答案"];
const modelServer = http.createServer(async (request, response) => {
  try {
    const parts = [];
    for await (const chunk of request) parts.push(chunk);
    modelCalls += 1;
    const payload = JSON.parse(Buffer.concat(parts).toString("utf8"));
    const prompt = payload.messages.flatMap(message => typeof message.content === "string" ? [message.content]
      : Array.isArray(message.content) ? message.content.map(item => item.text).filter(Boolean) : []).join("\n");
    const fixtureLine = prompt.split("\n").find(line => line.startsWith('{"task":'));
    assert.ok(fixtureLine, "G1 model request has no bounded task/material input");
    const fixture = JSON.parse(fixtureLine);
    assert.ok(expectedTaskId, "The synthetic task must exist before model execution");
    assert.equal(fixture.task.task_id, expectedTaskId, "The model may only serve this synthetic teacher task");
    assert.deepEqual(fixture.task.deliverables, deliverables);
    assert.equal(fixture.materials.length, 1, "The model may only use the single confirmed 703 mathematics material");
    assert.equal(fixture.materials[0].content, materialText);
    const sourceId = fixture.materials[0].source_id;
    assert.equal(typeof sourceId, "string");
    assert.ok(sourceId.length > 0);
    const content = JSON.stringify({ artifacts: fixture.task.deliverables.map(title => ({ title,
      content: title === "参考答案" ? "# 参考答案\n\n移项得 2x = 4，所以 x = 2；代入检验成立。" : "# 检测卷\n\n1. 解方程 2x + 3 = 7。",
      source_ids: [sourceId] })) });
    const base = { id: `teacher-created-${modelCalls}`, object: "chat.completion.chunk", created: 1, model: "local" };
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.end(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});
await new Promise((resolve, reject) => { modelServer.once("error", reject); modelServer.listen(0, "127.0.0.1", resolve); });
const modelAddress = modelServer.address();
assert.ok(modelAddress && typeof modelAddress === "object");
const modelUrl = `http://127.0.0.1:${modelAddress.port}/v1`;
fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: { local: { api: "openai-completions", apiKey: "local-test-placeholder", baseUrl: modelUrl, models: [{ id: "local", name: "Local teacher-created E2", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_000, maxTokens: 2_048 }] } } }));
fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "local", defaultModel: "local" }));

const { prepareCoreRuntimeRoot } = await import(path.join(coreRoot, "scripts", "core_runtime_root.mjs"));
const { acquireCoreRuntimeWriterAdmission } = await import(path.join(coreRoot, "scripts", "core_runtime_writer_admission.mjs"));
const { reviewG1Excerpt } = await import(path.join(coreRoot, "scripts", "core_runtime_g1_excerpts.mjs"));

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const taskRoute = await jiti.import("../app/api/edupi/tasks/route.ts");
const preparationRoute = await jiti.import("../app/api/edupi/preparation/route.ts");
const educationRoute = await jiti.import("../app/api/edupi/education/route.ts");
const feedbackRoute = await jiti.import("../app/api/edupi/teacher-feedback/route.ts");
const proactivityRoute = await jiti.import("../app/api/edupi/proactivity/route.ts");
const { issueEducationIntake } = await jiti.import("../lib/edupi-education-intake.ts");
const { stageMaterialInputs } = await jiti.import("../lib/edupi-material-staging.ts");
const { intakeRecognizedMaterial } = await jiti.import("../lib/edupi-material-intake-flow.ts");
const { closeAllEduPiRuntimes } = await jiti.import("../lib/edupi-runtime-supervisor.ts");
const { getAllowedFileRoots, isFilePathAllowed, isExistingFilePathAllowed } = await jiti.import("../lib/file-access.ts");
const apiRequest = (pathname, body) => new Request(`http://localhost${pathname}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin", "x-pi-desktop-token": desktopToken },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const readEducation = async () => { const response = await educationRoute.GET(); const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body; };
const waitForReady = async (taskId, context = null) => {
  const deadline = Date.now() + 30_000;
  let latest;
  while (Date.now() < deadline) {
    latest = await readEducation();
    const workCase = latest.workCases.find((item) => item.taskId === taskId);
    if (workCase?.currentState === "draft_ready") return { data: latest, workCase };
    if (workCase?.currentState === "failed") {
      const raw = JSON.parse(fs.readFileSync(path.join(outputDir, "calendar_work_execution_state.json"), "utf8"));
      throw new Error(`teacher-created preparation failed: ${JSON.stringify({ modelCalls, execution: raw.executions.find((item) => item.task_id === taskId) })}`);
    }
    await sleep(100);
  }
  const teacherReview = JSON.parse(fs.readFileSync(path.join(outputDir, "teacher_review_state.json"), "utf8"));
  const execution = JSON.parse(fs.readFileSync(path.join(outputDir, "calendar_work_execution_state.json"), "utf8"));
  throw new Error(`teacher-created preparation timed out: ${JSON.stringify({ context, candidate: teacherReview.work_candidates.find((item) => item.task_id === taskId), execution: execution.executions.find((item) => item.task_id === taskId), workCases: latest?.workCases })}`);
};
const waitForUiCheckpoint = () => new Promise(resolve => {
  const input = createInterface({ input: process.stdin });
  let finished = false;
  const finish = reason => {
    if (finished) return;
    finished = true;
    process.off("SIGINT", interrupt);
    input.off("SIGINT", interrupt);
    input.close();
    process.stdin.pause();
    resolve(reason);
  };
  const interrupt = () => finish("interrupted");
  process.once("SIGINT", interrupt);
  input.once("SIGINT", interrupt);
  input.on("line", line => { if (line.trim() === "done") finish("done"); });
});

let succeeded = false;
try {
  const importTimetable = sourceId => issueEducationIntake({ command_type: "import_timetable",
    source: { source_id: sourceId, source_kind: "teacher_message",
      source_hash: `sha256:${crypto.createHash("sha256").update(JSON.stringify(slot)).digest("hex")}`, evidence_ids: ["synthetic-teacher-created-scope"] },
    slots: [slot],
  });
  const timetableImport = await importTimetable("teacher-created-scope-e2");
  assert.equal(timetableImport.receipt.status, "accepted");
  const descriptor = stageMaterialInputs([{ name: "teacher-created-scope.pdf", mimeType: "application/pdf",
    bytes: new Uint8Array(Buffer.from(`%PDF-1.4\n${materialText}\n`)) }])[0];
  materialId = `material-${descriptor.staging_id.slice("stg_".length)}`;
  const materialImport = await intakeRecognizedMaterial({ descriptor, title: "方程单元材料", materialKind: "assessment",
    subject: "数学", classId: "703", recognize: false });
  assert.equal(materialImport.receipts[0].status, "accepted");
  const admission = await acquireCoreRuntimeWriterAdmission({ root: prepareCoreRuntimeRoot(dataRoot), kind: "legacy_teacher_created_e2", busyTimeoutMs: 1_000 });
  try {
    reviewG1Excerpt({ materialId, subject: "数学", classId: "703", expectedRevision: 0, content: materialText, reviewer: "synthetic-e2-teacher", decision: "confirm" });
  } finally { await admission.release(); }
  // Fault injection removes both sources in this synthetic root; restoration uses public intake and authorization.
  const removeTimetableFixture = () => {
    const intake = JSON.parse(fs.readFileSync(intakeStatePath, "utf8"));
    intake.timetable_slots = [];
    fs.writeFileSync(intakeStatePath, JSON.stringify(intake));
    fs.writeFileSync(timetablePath, JSON.stringify({ slots: [] }));
  };
  const createInput = { clientRequestId: "22222222-2222-4222-8222-222222222222", title: "教师自建单元检测", dueDate: today, note: "重点检查移项", preparationSource: { kind: "teaching_before_class", timetableSlotId: slot.slot_id, lessonDate, materialIds: [materialId], deliverables } };
  const createResponse = await taskRoute.POST(apiRequest("/api/edupi/tasks", createInput));
  const created = await createResponse.json();
  assert.equal(createResponse.status, 200, JSON.stringify(created));
  const taskId = created.receipt.target.target_id;
  expectedTaskId = taskId;
  const createdTask = created.data.tasks.find((item) => item.id === taskId);
  assert.equal(createdTask.trigger, "teaching_before_class");
  assert.equal(createdTask.sourceEventDate, lessonDate);
  assert.equal(createdTask.materialId, materialId);
  assert.deepEqual(createdTask.deliverables, deliverables);
  assert.equal(created.preparation.state, "error", "Creating a task must not bypass the default-off G1 gate");
  assert.match(created.preparation.error, /自动运行/);
  assert.equal(modelCalls, 0, "Default-off task creation must not call the model");

  const ownerResponse = await feedbackRoute.POST(apiRequest("/api/edupi/teacher-feedback", { action: "bootstrap" }));
  const owner = await ownerResponse.json();
  assert.equal(ownerResponse.status, 200, JSON.stringify(owner));
  assert.equal(owner.ok, true, JSON.stringify(owner));
  const proactivityResponse = await proactivityRoute.GET(apiRequest("/api/edupi/proactivity"));
  const proactivity = await proactivityResponse.json();
  assert.equal(proactivityResponse.status, 200, JSON.stringify(proactivity));
  assert.equal(proactivity.activation.enabled, false);
  assert.equal(modelCalls, 0, "Owner bootstrap must not activate G1");
  assert.deepEqual(proactivity.scopes.map(({ classId, subject }) => ({ classId, subject })), [{ classId: "703", subject: "数学" }], JSON.stringify({ synthetic: true, scopes: proactivity.scopes }));
  assert.equal(proactivity.scopes[0].ready, true, JSON.stringify({ synthetic: true, scopes: proactivity.scopes }));
  assert.equal(proactivity.scopes[0].slotCount, 1);
  assert.equal(proactivity.scopes[0].materialCount, 1);
  const activationResponse = await proactivityRoute.POST(apiRequest("/api/edupi/proactivity", {
    enabled: true, classId: "703", subject: "数学", expectedUpdatedAt: proactivity.activation.updatedAt,
  }));
  const activated = await activationResponse.json();
  assert.equal(activationResponse.status, 200, JSON.stringify(activated));
  assert.equal(activated.activation.enabled, true);
  assert.deepEqual(activated.activation.scope, { classId: "703", subject: "数学" });
  assert.equal(activated.externalSend, false);
  const runResponse = await preparationRoute.POST(apiRequest("/api/edupi/preparation", { action: "run", taskId }));
  const running = await runResponse.json();
  assert.equal(runResponse.status, 200, JSON.stringify(running));
  assert.ok(["running", "ready"].includes(running.state), JSON.stringify(running));

  const ready = await waitForReady(taskId);
  assert.equal(modelCalls, 1);
  assert.equal(ready.workCase.artifactIds.length, 2);
  assert.equal(ready.data.tasks.filter((item) => item.id === taskId).length, 1);
  assert.equal(ready.data.tasks.filter((item) => item.sourceEventId === createdTask.sourceEventId).length, 1, "the explicit task replaces the automatic task for the same lesson");
  const artifacts = ready.data.generatedArtifacts.filter((item) => item.task_id === taskId);
  assert.deepEqual(artifacts.map((item) => item.title).sort(), ["参考答案", "检测卷"]);
  assert.equal(artifacts.every((item) => item.available), true);
  const allowedRoots = await getAllowedFileRoots();
  assert.equal(allowedRoots.has(dataRoot), false, "the general Core data root is not exposed to the file API");
  assert.ok(allowedRoots.has(path.join(dataRoot, ".edupi", "output")));
  assert.ok(allowedRoots.has(path.join(dataRoot, ".edupi", "inbox", "teacher-materials")));
  assert.equal(isExistingFilePathAllowed(path.join(dataRoot, artifacts[0].relative_path), allowedRoots), true);
  assert.equal(isFilePathAllowed(path.join(dataRoot, "ordinary.txt"), allowedRoots), false);
  const createReplayResponse = await taskRoute.POST(apiRequest("/api/edupi/tasks", createInput));
  const createReplay = await createReplayResponse.json();
  assert.equal(createReplayResponse.status, 200, JSON.stringify(createReplay));
  assert.equal(createReplay.taskId, taskId);
  assert.equal(createReplay.replayed, true);
  assert.equal(createReplay.data.tasks.filter((item) => item.id === taskId).length, 1);
  assert.equal(modelCalls, 1, "replaying the create request cannot duplicate the task or generation");

  const changedMaterialsResponse = await taskRoute.POST(apiRequest("/api/edupi/tasks", { ...createInput, preparationSource: { ...createInput.preparationSource, materialIds: [materialId, "changed-second-material"] } }));
  const changedMaterials = await changedMaterialsResponse.json();
  assert.equal(changedMaterialsResponse.status, 409, JSON.stringify(changedMaterials));
  assert.equal(changedMaterials.code, "idempotency_conflict");
  assert.equal((await readEducation()).tasks.filter((item) => item.id === taskId).length, 1);
  assert.equal(modelCalls, 1, "a changed later material cannot be treated as an exact replay");

  const wrongLessonDate = dateInShanghai(new Date(new Date(`${lessonDate}T12:00:00+08:00`).getTime() + 86_400_000));
  const wrongDateResponse = await taskRoute.POST(apiRequest("/api/edupi/tasks", { ...createInput, clientRequestId: "22222222-2222-4222-8222-222222222223", preparationSource: { ...createInput.preparationSource, lessonDate: wrongLessonDate } }));
  const wrongDate = await wrongDateResponse.json();
  assert.equal(wrongDateResponse.status, 409, JSON.stringify(wrongDate));
  assert.equal(wrongDate.code, "invalid_preparation_context");

  const replayResponse = await preparationRoute.POST(apiRequest("/api/edupi/preparation", { action: "run", taskId }));
  const replay = await replayResponse.json();
  assert.equal(replay.state, "ready");
  assert.equal(modelCalls, 1, "replay must not call the model again");

  if (uiCheckpoint) {
    await closeAllEduPiRuntimes();
    console.log(JSON.stringify({ status: "ui-checkpoint", synthetic: true, dataRoot, temporaryRoot, agentDir, stateDir, coreRoot, taskId, artifactId: artifacts[0].artifact_id, modelUrl, modelPort: modelAddress.port }));
    console.error("仅保留合成 fixture 供页面验证。先停止使用此 fixture 的 Next/Core，再输入 done 或按 Ctrl+C；随后会删除此脚本创建的临时数据。");
    const reason = await waitForUiCheckpoint();
    succeeded = true;
    if (reason === "interrupted") process.exitCode = 130;
    console.log(JSON.stringify({ status: "ui-checkpoint-closed", reason, synthetic: true, source_negative_checks: "not_run" }));
  } else {
    const materialRecord = JSON.parse(fs.readFileSync(intakeStatePath, "utf8")).materials.find(item => item.material_id === materialId);
    const materialFile = path.join(dataRoot, materialRecord.relative_path);
    const originalMaterial = fs.readFileSync(materialFile);
    fs.writeFileSync(materialFile, Buffer.concat([originalMaterial, Buffer.from("\nsynthetic source integrity failure")]));
    const changedSourceResponse = await preparationRoute.POST(apiRequest("/api/edupi/preparation", { action: "run", taskId }));
    const changedSource = await changedSourceResponse.json();
    assert.equal(changedSource.state, "error");
    assert.equal(changedSource.error, "材料或课程已变化，请重新核对");
    assert.equal(modelCalls, 1, "Changed material fails before the model");
    const statusRequest = () => apiRequest(`/api/edupi/preparation?taskId=${encodeURIComponent(taskId)}`);
    assert.equal((await (await preparationRoute.GET(statusRequest())).json()).error, changedSource.error, "Core preflight failure survives a status reread");
    await closeAllEduPiRuntimes();
    assert.equal((await (await preparationRoute.GET(statusRequest())).json()).error, changedSource.error, "Core preflight failure survives a Runtime restart");
    assert.equal(modelCalls, 1);
    fs.writeFileSync(materialFile, originalMaterial);

    removeTimetableFixture();
    const missingSourceResponse = await preparationRoute.POST(apiRequest("/api/edupi/preparation", { action: "run", taskId }));
    const missingSource = await missingSourceResponse.json();
    assert.equal(missingSource.state, "error");
    assert.equal(missingSource.error, "请检查主动运行授权", "Removing the granted course must fail its scope check before model execution");
    assert.equal(modelCalls, 1, "missing source fails before the model");
    await closeAllEduPiRuntimes();
    const missingAfterRestart = await (await preparationRoute.POST(apiRequest("/api/edupi/preparation", { action: "run", taskId }))).json();
    assert.equal(missingAfterRestart.state, "error");
    assert.equal(missingAfterRestart.error, missingSource.error, "Removed course authorization must remain denied after restart");
    assert.equal(modelCalls, 1);

    const beforeStop = await (await proactivityRoute.GET(apiRequest("/api/edupi/proactivity"))).json();
    const stopResponse = await proactivityRoute.POST(apiRequest("/api/edupi/proactivity", {
      enabled: false, classId: null, subject: null, expectedUpdatedAt: beforeStop.activation.updatedAt,
    }));
    const stopped = await stopResponse.json();
    assert.equal(stopResponse.status, 200, JSON.stringify(stopped));
    assert.equal(stopped.activation.enabled, false);
    await closeAllEduPiRuntimes();
    assert.equal((await importTimetable("teacher-created-restored-scope-e2")).receipt.status, "accepted");
    const beforeRestore = await (await proactivityRoute.GET(apiRequest("/api/edupi/proactivity"))).json();
    assert.equal(beforeRestore.activation.enabled, false);
    assert.equal(beforeRestore.scopes.some(item => item.classId === "703" && item.subject === "数学" && item.ready), true, JSON.stringify({ synthetic: true, scopes: beforeRestore.scopes }));
    const reactivationResponse = await proactivityRoute.POST(apiRequest("/api/edupi/proactivity", {
      enabled: true, classId: "703", subject: "数学", expectedUpdatedAt: beforeRestore.activation.updatedAt,
    }));
    const reactivated = await reactivationResponse.json();
    assert.equal(reactivationResponse.status, 200, JSON.stringify(reactivated));
    assert.equal(reactivated.activation.enabled, true);
    assert.deepEqual(reactivated.activation.scope, { classId: "703", subject: "数学" });
    const restoredResponse = await preparationRoute.POST(apiRequest("/api/edupi/preparation", { action: "run", taskId }));
    const restored = await restoredResponse.json();
    assert.ok(["running", "ready"].includes(restored.state), JSON.stringify(restored));
    await waitForReady(taskId, { phase: "restored", response: restored, modelCalls });
    assert.equal(modelCalls, 2, "restoring a source regenerates artifacts under the new source revision");

    await closeAllEduPiRuntimes();
    const restartedResponse = await preparationRoute.POST(apiRequest("/api/edupi/preparation", { action: "run", taskId }));
    const restarted = await restartedResponse.json();
    assert.equal(restarted.state, "ready");
    assert.equal(modelCalls, 2, "runtime restart replays the same task without duplicate generation");
    removeTimetableFixture();
    const replayAfterSourceRemovalResponse = await taskRoute.POST(apiRequest("/api/edupi/tasks", createInput));
    const replayAfterSourceRemoval = await replayAfterSourceRemovalResponse.json();
    assert.equal(replayAfterSourceRemovalResponse.status, 200, JSON.stringify(replayAfterSourceRemoval));
    assert.equal(replayAfterSourceRemoval.replayed, true, "a durable create replays before current source validation");
    assert.equal(replayAfterSourceRemoval.taskId, taskId);
    assert.equal(replayAfterSourceRemoval.preparation.state, "error");
    assert.equal(replayAfterSourceRemoval.preparation.error, "请检查主动运行授权");
    assert.equal(modelCalls, 2);
    succeeded = true;
    console.log(JSON.stringify({ status: "passed", synthetic: true, task_id: taskId, work_case_id: ready.workCase.id, artifacts: artifacts.length, model_calls: modelCalls, source_failure_before_model: true, source_authorization_denied: true, explicit_reauthorization: true, restart_replay: true, external_send: false }));
  }
} finally {
  await closeAllEduPiRuntimes();
  modelServer.closeAllConnections();
  await new Promise(resolve => modelServer.close(resolve));
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  if (!succeeded) process.exitCode = 1;
}
