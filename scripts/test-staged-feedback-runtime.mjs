#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const resources = path.resolve(process.env.EDUPI_STAGED_RESOURCES || path.join(root, "src-tauri/resources"));
const coreRoot = path.join(resources, "edupi-core");
const serverDir = path.join(resources, "server");
const nodeBinary = path.join(resources, "Pi Agent Server.app/Contents/MacOS/node");
const dataRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-staged-feedback-")));
const home = path.join(dataRoot, ".edupi");
for (const directory of [path.join(home, "memory"), path.join(home, "output"), path.join(home, "locks")]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
Object.assign(process.env, { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_HOME: home, EDUPI_MEMORY_DIR: path.join(home, "memory"), EDUPI_OUTPUT_DIR: path.join(home, "output"), EDUPI_LOCK_DIR: path.join(home, "locks") });

const admissionModule = await import(path.join(coreRoot, "scripts/core_runtime_writer_admission.mjs"));
const rootModule = await import(path.join(coreRoot, "scripts/core_runtime_root.mjs"));
const planningModule = await import(path.join(coreRoot, "scripts/ambient_planning_store.mjs"));
const engine = await import(path.join(coreRoot, "scripts/ambient_planning_engine.mjs"));
const { buildRhythmPlan } = await import(path.join(coreRoot, "scripts/rhythm_planner.mjs"));
const { syncWorkCandidates, loadTeacherReviewState } = await import(path.join(coreRoot, "scripts/teacher_review_store.mjs"));
const { resolveTeacherFeedbackTargetFromStates } = await import(path.join(coreRoot, "scripts/teacher_feedback_target.mjs"));
const prepared = rootModule.prepareCoreRuntimeRoot(dataRoot);
const admission = await admissionModule.acquireCoreRuntimeWriterAdmission({ root: prepared, kind: "legacy_staged_feedback_seed" });
let workTargetId;
try {
  const planning = planningModule.createAmbientPlanningStore({ root: prepared });
  const now = new Date().toISOString();
  planning.transact((state) => engine.applyPlanningGoalCommand(state, {
    action: "create",
    goal_id: "goal-staged-feedback",
    expected_version: 0,
    at: now,
    goal: {
      id: "goal-staged-feedback",
      text: "验证教师反馈通道",
      scope: { class_id: "class-7b", subject: "math" },
      starts_at: now,
      ends_at: new Date(Date.parse(now) + 7 * 86_400_000).toISOString(),
      success_condition: "反馈可回读",
      allowed_actions: ["update"],
      budget: { max_calls: 4 },
      prepare_hours: 24,
      escalate_hours: 2,
    },
  }));
  const nextMonday = new Date();
  nextMonday.setUTCDate(nextMonday.getUTCDate() + ((8 - nextMonday.getUTCDay()) % 7 || 7));
  const lessonDate = nextMonday.toISOString().slice(0, 10);
  const slot = { id: "slot-staged-feedback", day_of_week: 1, period: 2, subject: "math", class_name: "7B", class_id: "class-7b", kind: "class" };
  fs.writeFileSync(path.join(home, "memory", "timetable.json"), `${JSON.stringify({ slots: [slot] })}\n`);
  fs.writeFileSync(path.join(home, "memory", "semester.json"), `${JSON.stringify({ start_date: lessonDate, end_date: lessonDate })}\n`);
  const task = buildRhythmPlan({ semesterStart: lessonDate, semesterEnd: lessonDate, timetableSlots: [slot] }).tasks[0];
  assert.ok(task, "a verified timetable task is required");
  syncWorkCandidates([task], { cycleToken: `cycle:${lessonDate}`, observedAt: now, authoritativeCandidateIds: [task.task_id] });
  workTargetId = task.task_id;
  assert.equal(resolveTeacherFeedbackTargetFromStates({ target: { kind: "work_candidate", target_id: workTargetId }, teacherReviewState: loadTeacherReviewState(), timetableState: { slots: [slot] }, deletionState: { records: [] } }).domain, "teaching_preparation");
} finally {
  await admission.release();
}

const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const value = address && typeof address === "object" ? address.port : null;
    server.close(() => value ? resolve(value) : reject(new Error("port unavailable")));
  });
});
const child = spawn(nodeBinary, [path.join(serverDir, "desktop-server.cjs")], {
  cwd: serverDir,
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    EDUPI_PROJECT_ROOT: dataRoot,
    EDUPI_DATA_ROOT: dataRoot,
    EDUPI_DATA_ALLOWED_ROOT: path.dirname(dataRoot),
    EDUPI_CORE_ROOT: coreRoot,
    EDUPI_CORE_ALLOWED_ROOT: resources,
    EDUPI_CORE_VALIDATION_MODE: "bundled",
    EDUPI_AMBIENT_PLANNING: "1",
    PI_DESKTOP_STATE_DIR: path.join(dataRoot, "desktop-state"),
    PI_DESKTOP_API_TOKEN: "staged-feedback-token-012345678901234567890123456789",
    PI_DESKTOP_INSTANCE_ID: "staged-feedback-instance",
    PI_WEB_PARENT_PID: String(process.pid),
    PI_OFFLINE: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk.toString("utf8"); });
child.stderr.on("data", (chunk) => { logs += chunk.toString("utf8"); });
const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
const baseUrl = `http://127.0.0.1:${port}`;
const desktopToken = "staged-feedback-token-012345678901234567890123456789";

async function stop() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
}

async function jsonFetch(url, init) {
  const response = await fetch(`${baseUrl}${url}`, { ...init, headers: { ...init?.headers, "x-pi-desktop-token": desktopToken }, signal: AbortSignal.timeout(15_000) });
  return { response, body: await response.json() };
}

try {
  const readyDeadline = Date.now() + 45_000;
  while (Date.now() < readyDeadline) {
    if (child.exitCode !== null) throw new Error(`staged server exited: ${logs.slice(-4000)}`);
    try {
      const identity = await fetch(`${baseUrl}/api/desktop/identity`, { signal: AbortSignal.timeout(2000) });
      if (identity.status === 204) break;
    } catch { /* cold start */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal((await fetch(`${baseUrl}/api/edupi/teacher-feedback`)).status, 403);
  assert.equal((await fetch(`${baseUrl}/api/edupi/teacher-feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: "null" })).status, 403);
  const bootstrap = await jsonFetch("/api/edupi/teacher-feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "bootstrap" }) });
  assert.equal(bootstrap.response.status, 200, JSON.stringify(bootstrap.body));
  const targetRead = await jsonFetch("/api/edupi/teacher-feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "target_read", target: { kind: "work_candidate", target_id: workTargetId } }) });
  assert.equal(targetRead.response.status, 200, JSON.stringify(targetRead.body));
  assert.equal(targetRead.body.ok, true, JSON.stringify(targetRead.body));
  const target = targetRead.body.result;
  assert.ok(Array.isArray(target.evidence_ids) && target.evidence_ids.length > 0);
  assert.equal(target.domain, "teaching_preparation");
  assert.deepEqual(target.scope, { class_id: "class-7b", subject: "math" });
  const recordBody = JSON.stringify({ action: "record", record: {
      command_id: "staged-feedback-record-1",
      session_id: "staged-teacher-trial",
      evidence_level: "synthetic",
      domain: "teaching_preparation",
      scope: { class_id: "class-7b", subject: "math" },
      signal: "surfaced",
      target: { kind: target.kind, target_id: target.target_id, expected_revision: target.revision, expected_fingerprint: target.fingerprint },
      decision: "accept",
      usefulness: "useful",
      used: false,
      would_use_again: null,
      baseline_minutes: null,
      review_minutes: null,
      issue_codes: [],
      note: "隔离运行时反馈回执测试",
      evidence_ids: target.evidence_ids,
      occurred_at: new Date().toISOString(),
      supersedes_feedback_id: null,
    } });
  const record = await jsonFetch("/api/edupi/teacher-feedback", { method: "POST", headers: { "content-type": "application/json" }, body: recordBody });
  if (!record.response.ok) console.error(logs.slice(-6000));
  assert.equal(record.response.status, 200, JSON.stringify(record.body));
  assert.equal(record.body.ok, true);
  const wrongScope = JSON.parse(recordBody);
  wrongScope.record.command_id = "staged-feedback-wrong-class";
  wrongScope.record.scope.class_id = "class-8a";
  const denied = await jsonFetch("/api/edupi/teacher-feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(wrongScope) });
  assert.equal(denied.body.ok, false);
  assert.equal(denied.body.errorCode, "teacher_feedback_target_stale");
  const replay = await jsonFetch("/api/edupi/teacher-feedback", { method: "POST", headers: { "content-type": "application/json" }, body: recordBody });
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.result.replayed, true);
  const read = await jsonFetch("/api/edupi/teacher-feedback", { method: "GET" });
  assert.equal(read.response.status, 200, JSON.stringify(read.body));
  assert.equal(read.body.result.feedback.length, 1);
  assert.equal(read.body.result.summary.real_teacher_current, 0);
  assert.equal(read.body.result.summary.synthetic_excluded, 1);
  assert.equal(read.body.result.summary.time_saved_minutes, 0);
  console.log(JSON.stringify({ status: "passed", owner_bootstrap: true, target_recheck: true, verified_scope: true, wrong_scope_rejected: true, bound_replay: true, feedback_recorded: true, feedback_readback: true, synthetic_excluded: 1, external_send: false }, null, 2));
} finally {
  await stop();
  fs.rmSync(dataRoot, { recursive: true, force: true });
}
