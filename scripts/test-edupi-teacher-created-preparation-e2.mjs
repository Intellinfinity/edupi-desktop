#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.ok(configuredCoreRoot && path.isAbsolute(configuredCoreRoot), "EDUPI_CORE_ROOT is required");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-teacher-created-e2-")));
const dataRoot = path.join(temporaryRoot, "teacher-data");
const homeRoot = path.join(temporaryRoot, "home");
const agentDir = path.join(homeRoot, ".pi", "agent");
const memoryDir = path.join(dataRoot, ".edupi", "memory");
const outputDir = path.join(dataRoot, ".edupi", "output");
const lockDir = path.join(dataRoot, ".edupi", "locks");
const materialDir = path.join(dataRoot, ".edupi", "inbox", "teacher-materials");
for (const directory of [agentDir, memoryDir, outputDir, lockDir, materialDir]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

const dateInShanghai = (value = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
const today = dateInShanghai();
const lessonDate = dateInShanghai(new Date(new Date(`${today}T12:00:00+08:00`).getTime() + 86_400_000));
const lessonDay = new Date(`${lessonDate}T12:00:00+08:00`).getUTCDay() || 7;
const slot = { slot_id: "teacher-created-slot-e2", subject: "数学", class_name: "703", day_of_week: lessonDay, period: 2, kind: "class", notes: "一元一次方程" };
const materialId = "teacher-created-material-e2";
const materialText = "一元一次方程单元检测范围：移项、合并同类项和解的检验。";
const materialPath = path.join(materialDir, "unit-test.txt");
fs.writeFileSync(materialPath, materialText);
const materialHash = `sha256:${crypto.createHash("sha256").update(materialText).digest("hex")}`;
const timetablePath = path.join(memoryDir, "timetable.json");
fs.writeFileSync(timetablePath, JSON.stringify({ slots: [slot] }));
fs.writeFileSync(path.join(memoryDir, "calendar.json"), JSON.stringify({ events: [] }));
fs.writeFileSync(path.join(memoryDir, "preferences.json"), JSON.stringify({ entries: [] }));
fs.writeFileSync(path.join(memoryDir, "semester.json"), JSON.stringify({ start_date: today, end_date: lessonDate, entries: [] }));
fs.writeFileSync(path.join(outputDir, "material_candidates.json"), JSON.stringify({ entries: [{ id: materialId, title: "方程单元材料", subject: "数学", class_id: "703", file_path: ".edupi/inbox/teacher-materials/unit-test.txt" }] }));
fs.writeFileSync(path.join(outputDir, "education_intake_state.json"), JSON.stringify({ schema_version: 1, updated_at: `${today}T00:00:00.000Z`, calendar_events: [], timetable_slots: [], materials: [{ material_id: materialId, relative_path: ".edupi/inbox/teacher-materials/unit-test.txt", source_hash: materialHash, expected_size_bytes: Buffer.byteLength(materialText), intake_state: "accepted", subject: "数学", class_id: "703" }], receipts: [], review_history: [], review_targets: [], idempotency_records: [] }));

Object.assign(process.env, {
  HOME: homeRoot,
  PI_CODING_AGENT_DIR: agentDir,
  PI_DESKTOP_STATE_DIR: path.join(temporaryRoot, "desktop-state"),
  PI_OFFLINE: "1",
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

let modelCalls = 0;
const modelServer = http.createServer(async (request, response) => {
  try {
    for await (const chunk of request) void chunk;
    modelCalls += 1;
    const content = JSON.stringify({ artifacts: [
      { title: "检测卷", content: "# 检测卷\n\n1. 解方程 2x + 3 = 7。", source_ids: [materialId] },
      { title: "参考答案", content: "# 参考答案\n\n移项得 2x = 4，所以 x = 2；代入检验成立。", source_ids: [materialId] },
    ] });
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
fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: { local: { api: "openai-completions", apiKey: "local-test-placeholder", baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`, models: [{ id: "local", name: "Local teacher-created E2", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_000, maxTokens: 2_048 }] } } }));
fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "local", defaultModel: "local" }));

const { prepareCoreRuntimeRoot } = await import(path.join(coreRoot, "scripts", "core_runtime_root.mjs"));
const { acquireCoreRuntimeWriterAdmission } = await import(path.join(coreRoot, "scripts", "core_runtime_writer_admission.mjs"));
const { reviewG1Excerpt } = await import(path.join(coreRoot, "scripts", "core_runtime_g1_excerpts.mjs"));
const admission = await acquireCoreRuntimeWriterAdmission({ root: prepareCoreRuntimeRoot(dataRoot), kind: "legacy_teacher_created_e2", busyTimeoutMs: 1_000 });
try {
  reviewG1Excerpt({ materialId, subject: "数学", classId: "703", expectedRevision: 0, content: materialText, reviewer: "e2-teacher", decision: "confirm" });
} finally { await admission.release(); }

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const taskRoute = await jiti.import("../app/api/edupi/tasks/route.ts");
const preparationRoute = await jiti.import("../app/api/edupi/preparation/route.ts");
const educationRoute = await jiti.import("../app/api/edupi/education/route.ts");
const { closeAllEduPiRuntimes } = await jiti.import("../lib/edupi-runtime-supervisor.ts");
const apiRequest = (pathname, body) => new Request(`http://localhost${pathname}`, { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) });
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

let succeeded = false;
try {
  const createResponse = await taskRoute.POST(apiRequest("/api/edupi/tasks", { title: "教师自建单元检测", dueDate: today, note: "重点检查移项", preparationSource: { kind: "teaching_before_class", timetableSlotId: slot.slot_id, lessonDate, materialIds: [materialId], deliverables: ["检测卷", "参考答案"] } }));
  const created = await createResponse.json();
  assert.equal(createResponse.status, 200, JSON.stringify(created));
  const taskId = created.receipt.target.target_id;
  const createdTask = created.data.tasks.find((item) => item.id === taskId);
  assert.equal(createdTask.trigger, "teaching_before_class");
  assert.equal(createdTask.sourceEventDate, lessonDate);
  assert.equal(createdTask.materialId, materialId);
  assert.deepEqual(createdTask.deliverables, ["检测卷", "参考答案"]);

  const startResponse = await preparationRoute.POST(apiRequest("/api/edupi/preparation", { action: "run", taskId }));
  const started = await startResponse.json();
  assert.equal(startResponse.status, 200, JSON.stringify(started));
  assert.equal(started.taskId, taskId);
  assert.ok(["running", "ready"].includes(started.state), JSON.stringify(started));
  const ready = await waitForReady(taskId);
  assert.equal(modelCalls, 1);
  assert.equal(ready.workCase.artifactIds.length, 2);
  assert.equal(ready.data.tasks.filter((item) => item.id === taskId).length, 1);
  assert.equal(ready.data.tasks.filter((item) => item.sourceEventId === createdTask.sourceEventId).length, 1, "the explicit task replaces the automatic task for the same lesson");
  const artifacts = ready.data.generatedArtifacts.filter((item) => item.task_id === taskId);
  assert.deepEqual(artifacts.map((item) => item.title).sort(), ["参考答案", "检测卷"]);
  assert.equal(artifacts.every((item) => item.available), true);

  const replayResponse = await preparationRoute.POST(apiRequest("/api/edupi/preparation", { action: "run", taskId }));
  const replay = await replayResponse.json();
  assert.equal(replay.state, "ready");
  assert.equal(modelCalls, 1, "replay must not call the model again");

  fs.writeFileSync(timetablePath, JSON.stringify({ slots: [] }));
  const missingSourceResponse = await preparationRoute.POST(apiRequest("/api/edupi/preparation", { action: "run", taskId }));
  const missingSource = await missingSourceResponse.json();
  assert.equal(missingSource.state, "error");
  assert.match(missingSource.error, /材料|准备|课程|关联/);
  assert.equal(modelCalls, 1, "missing source fails before the model");

  fs.writeFileSync(timetablePath, JSON.stringify({ slots: [slot] }));
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
  succeeded = true;
  console.log(JSON.stringify({ status: "passed", task_id: taskId, work_case_id: ready.workCase.id, artifacts: artifacts.length, model_calls: modelCalls, source_failure_before_model: true, restart_replay: true, external_send: false }));
} finally {
  await closeAllEduPiRuntimes();
  modelServer.closeAllConnections();
  await new Promise(resolve => modelServer.close(resolve));
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  if (!succeeded) process.exitCode = 1;
}
