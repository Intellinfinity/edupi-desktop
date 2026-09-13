#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HARD_TIMEOUT_MS = 60_000;
const COMPAT_MANIFEST = JSON.parse(fs.readFileSync(new URL("../contracts/edupi-core-compat.json", import.meta.url), "utf8"));
const EXPECTED_CORE_COMMIT = COMPAT_MANIFEST.core_runtime.core_commit;
const EXPECTED_COMPONENT_MANIFEST_HASH = COMPAT_MANIFEST.core_runtime.component_manifest_hash;
const EXPECTED_FIXTURE_MANIFEST_HASH = "sha256:8e95f3896b33323b4b2adeb9b6aa958abb0efdd0337cc4289c75d21fd852c912";
const EXPECTED_SCHEMA_HASH = "sha256:3116b37914b996ec90dd5da2b946798390617ffb2151c7653dbcda731e27227c";
const EXPECTED_COMMANDS = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"];
const EXPECTED_PROJECTIONS = ["education_workspace"];
const FIXED_ISSUED_AT = "2026-09-01T09:00:00.000Z";
const DECISION_STATUS = {
  accept: { receipt: "accepted", candidate: "accepted", task: "accepted", review: "accepted" },
  modify: { receipt: "modified", candidate: "modified", task: "modified", review: "modified" },
  reject: { receipt: "rejected", candidate: "rejected", task: "rejected", review: "rejected" },
  hold: { receipt: "held", candidate: "held", task: "hold", review: "held" },
  snooze: { receipt: "held", candidate: "snoozed", task: "hold", review: "held" },
  suppress: { receipt: "rejected", candidate: "suppressed", task: "rejected", review: "rejected" },
};
const TASK_STATUS_BY_CANDIDATE_STATUS = {
  pending_review: "planned",
  accepted: "accepted",
  modified: "modified",
  rejected: "rejected",
  held: "hold",
  snoozed: "hold",
  suppressed: "rejected",
};
const COMPATIBILITY_TASK_STATUS_BY_CANDIDATE_STATUS = {
  pending_review: "pending_review",
  accepted: "accepted",
  modified: "modified",
  rejected: "rejected",
  held: "held",
  snoozed: "held",
  suppressed: "rejected",
};
const ENV_KEYS = [
  "EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT",
  "EDUPI_PROJECT_ROOT", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_HOME", "HOME",
];
const previousEnvironment = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

let temporaryDataRoot = null;
let timeoutHandle = null;
let phase = "start";
let coreWriterModules = null;

async function withCoreWriterAdmission(callback) {
  const dataRoot = fs.realpathSync(process.env.EDUPI_PROJECT_ROOT);
  const root = fs.realpathSync(process.env.EDUPI_CORE_ROOT);
  coreWriterModules ||= {
    root: await import(path.join(root, "scripts", "core_runtime_root.mjs")),
    admission: await import(path.join(root, "scripts", "core_runtime_writer_admission.mjs")),
  };
  const prepared = coreWriterModules.root.prepareCoreRuntimeRoot(dataRoot);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const lease = await coreWriterModules.admission.acquireCoreRuntimeWriterAdmission({ root: prepared, kind: "legacy_c3_e2", busyTimeoutMs: 250 });
  try {
    return await callback();
  } finally {
    await lease.release();
  }
}

function restoreEnvironment() {
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function cleanup() {
  if (!temporaryDataRoot) return;
  const root = temporaryDataRoot;
  temporaryDataRoot = null;
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* do not mask verifier output */ }
}

process.once("exit", cleanup);
process.once("SIGINT", () => {
  restoreEnvironment();
  cleanup();
  process.exit(130);
});

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function snapshotPayload(result) {
  const envelope = record(result?.envelope) || record(result);
  const payload = record(envelope?.payload);
  assert.ok(envelope && payload, "Core snapshot envelope is unavailable");
  return { envelope, payload };
}

function listFiles(root) {
  const files = [];
  const walk = (current) => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else files.push(path.relative(root, fullPath).split(path.sep).join("/"));
    }
  };
  walk(root);
  return files.sort();
}

function assertExternalSendDisabled(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertExternalSendDisabled(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Object.hasOwn(value, "external_send")) assert.equal(value.external_send, false);
  if (Object.hasOwn(value, "externalSend")) assert.equal(value.externalSend, false);
  for (const child of Object.values(value)) assertExternalSendDisabled(child);
}

function assertCoreFiles(root, memoryDir, outputDir) {
  const files = listFiles(root);
  const allowed = new Set([
    ".edupi/memory/calendar.json",
    ".edupi/output/rhythm_plan.json",
    ".edupi/output/rhythm_plan.json.bak",
    ".edupi/output/teacher_review_state.json",
    ".edupi/output/teacher_review_state.json.bak",
    ".edupi/runtime/core-runtime-writer-admission-v1.sqlite",
  ]);
  assert.deepEqual(files.filter((file) => !allowed.has(file)), [], "C3 created an out-of-scope file");
  assert.deepEqual(listFiles(memoryDir), ["calendar.json"]);
  assert.ok(fs.existsSync(path.join(outputDir, "rhythm_plan.json")));
  assert.ok(fs.existsSync(path.join(outputDir, "teacher_review_state.json")));
  const forbidden = new Set(["class.json", "teaching.json", "semester.json", "preferences.json", "school.json", "auth.json", "models.json", "pushed_decisions.json"]);
  assert.deepEqual(files.filter((file) => forbidden.has(path.basename(file))), []);
}

function assertCapabilities(payload, identity) {
  assert.deepEqual(payload.capabilities?.supported_commands, EXPECTED_COMMANDS);
  assert.deepEqual(payload.capabilities?.supported_projections, EXPECTED_PROJECTIONS);
  assert.deepEqual(identity.contract.supported_commands, EXPECTED_COMMANDS);
  assert.deepEqual(identity.contract.supported_projections, EXPECTED_PROJECTIONS);
  assert.equal(payload.capabilities?.can_review_memory, true);
  assert.equal(payload.capabilities?.can_execute_actions, false);
  assert.equal(payload.capabilities?.external_send_enabled, false);
  assert.equal(payload.education_workspace?.external_send, false);
  assert.equal(payload.education_workspace?.requires_teacher_review, true);
}

function assertHeartbeatInternal(result) {
  if (result !== null) assert.deepEqual(result.proactive_entries, [], "rhythm candidates must never enter proactive delivery");
}

function expectedTask(id, sourceEventId, sourceEventName, sourceEventDate, sourceDateStatus) {
  return { id, sourceEventId, sourceEventName, sourceEventDate, sourceDateStatus };
}

const EXPECTED_TASKS = [
  expectedTask("midterm_preparation:midterm", "midterm", "期中考试", "2026-09-10", "explicit"),
  expectedTask("post_exam_support:midterm", "midterm", "期中考试", "2026-09-10", "explicit"),
  expectedTask("final_sprint:final", "final", "期末考试", "2026-09-12", "explicit"),
  expectedTask("long_holiday_safety:hold", "hold", "连休假期", "2026-09-13", "explicit"),
  expectedTask("long_holiday_safety:snooze", "snooze", "连休假期", "2026-09-14", "explicit"),
  expectedTask("festival:suppress-matching", "suppress-matching", "教师节", "2026-09-15", "explicit"),
  expectedTask("festival:matching-peer", "matching-peer", "校园节日", "2026-09-16", "explicit"),
  expectedTask("long_holiday_safety:suppress-next", "suppress-next", "连休假期", "2026-09-17", "explicit"),
  expectedTask("long_holiday_safety:held-missing-date", "held-missing-date", "待确认连休", null, "missing"),
];

function expectedTaskById(id) {
  const value = EXPECTED_TASKS.find((item) => item.id === id);
  assert.ok(value, `unexpected work candidate ${id}`);
  return value;
}

function assertWorkCandidateJoin(snapshotResult, data, id, expected = expectedTaskById(id)) {
  const { payload } = snapshotPayload(snapshotResult);
  const candidates = data.workCandidates.filter((item) => item.candidateId === id);
  assert.equal(candidates.length, 1, `one Desktop work candidate for ${id}`);
  const candidate = candidates[0];
  const tasks = data.tasks.filter((item) => item.id === id);
  assert.equal(tasks.length, 1, `one Desktop task join for ${id}`);
  const task = tasks[0];
  const target = payload.review_targets.filter((item) => item?.projection_kind === "work_candidate" && item.target?.target_id === id);
  assert.equal(target.length, 1, `one raw work target for ${id}`);
  const rawTarget = target[0];
  const compatibilityTasks = payload.tasks.filter((item) => item?.task_id === id);
  assert.equal(compatibilityTasks.length, 1, `one compatibility task join for ${id}`);
  assert.equal(candidate.candidateId, candidate.taskId);
  assert.equal(candidate.taskId, id);
  assert.deepEqual(candidate.sourceIds, [id]);
  assert.deepEqual(rawTarget.source_ids, [id]);
  assert.deepEqual(candidate.evidenceIds, rawTarget.evidence_ids);
  assert.equal(rawTarget.status, candidate.status);
  assert.equal(rawTarget.revision, candidate.revision);
  assert.deepEqual(rawTarget.teacher_review, {
    state: candidate.teacherReview.state,
    reviewer_id: candidate.teacherReview.reviewerId,
    reviewed_at: candidate.teacherReview.reviewedAt,
    note: candidate.teacherReview.note,
    revision: candidate.teacherReview.revision,
  });
  assert.equal(candidate.title, task.title);
  assert.equal(candidate.title, rawTarget.title);
  assert.equal(candidate.dueAt, task.dueDate);
  assert.equal(task.status, TASK_STATUS_BY_CANDIDATE_STATUS[candidate.status]);
  assert.equal(task.sourceEventId, expected.sourceEventId);
  assert.equal(task.sourceEventName, expected.sourceEventName);
  assert.equal(task.sourceEventDate, expected.sourceEventDate);
  assert.equal(task.evidence.source_date_status, expected.sourceDateStatus);
  assert.equal(candidate.revision, task.revision);
  assert.equal(task.reviewedAt, candidate.teacherReview.reviewedAt);
  assert.equal(task.reviewer, candidate.teacherReview.reviewerId);
  assert.equal(task.reviewNote, candidate.teacherReview.note);
  assert.equal(compatibilityTasks[0].title, task.title);
  assert.equal(compatibilityTasks[0].status, COMPATIBILITY_TASK_STATUS_BY_CANDIDATE_STATUS[candidate.status]);
  assert.equal(compatibilityTasks[0].teacher_review.revision, candidate.revision);
  assert.deepEqual(compatibilityTasks[0].teacher_review, rawTarget.teacher_review);
  assert.deepEqual(compatibilityTasks[0].evidence_ids, candidate.evidenceIds);
  assert.ok(Array.isArray(task.reviewHistory), "task review history must remain an array");
  if (candidate.teacherReview.reviewedAt && candidate.teacherReview.reviewerId) {
    const latestTaskReview = task.reviewHistory.at(-1);
    assert.ok(latestTaskReview, `a reviewed candidate must expose its task history: ${candidate.candidateId} status=${candidate.status} reviewedAt=${candidate.teacherReview.reviewedAt}`);
    assert.equal(latestTaskReview.reviewed_at, candidate.teacherReview.reviewedAt);
    assert.equal(latestTaskReview.reviewer, candidate.teacherReview.reviewerId);
    assert.equal(latestTaskReview.note, candidate.teacherReview.note);
  }
  assert.equal(task.requiresTeacherReview, true);
  assert.equal(task.scope, "teacher_internal");
  assert.equal(task.externalSend, false);
  assert.equal(candidate.externalSend, false);
  assert.equal(rawTarget.external_send, false);
  assert.equal(compatibilityTasks[0].external_send, false);
  return candidate;
}

function assertAllWorkJoins(snapshotResult, data) {
  assert.equal(data.workCandidates.length, EXPECTED_TASKS.length);
  for (const expected of EXPECTED_TASKS) assertWorkCandidateJoin(snapshotResult, data, expected.id, expected);
}

function assertReceipt(result, before, after, id, decision, patch, note) {
  const beforeParts = snapshotPayload(before.snapshot);
  const afterParts = snapshotPayload(after.snapshot);
  const receipt = result.receipt;
  const expected = DECISION_STATUS[decision];
  const beforeCandidate = before.data.workCandidates.find((item) => item.candidateId === id);
  const afterCandidate = after.data.workCandidates.find((item) => item.candidateId === id);
  assert.ok(beforeCandidate && afterCandidate);
  assert.equal(receipt.command_type, "review_work_candidate");
  assert.deepEqual(receipt.target, { target_kind: "work_candidate", target_id: id, command_type: "review_work_candidate" });
  assert.equal(receipt.decision, decision);
  assert.equal(receipt.status, expected.receipt);
  assert.equal(receipt.before_snapshot_id, beforeParts.payload.snapshot_id);
  assert.equal(receipt.before_state_hash, beforeParts.payload.state_hash);
  assert.equal(receipt.after_snapshot_id, afterParts.payload.snapshot_id);
  assert.equal(receipt.after_state_hash, afterParts.payload.state_hash);
  assert.equal(result.data.payload.snapshot_id, receipt.after_snapshot_id);
  assert.equal(result.data.payload.state_hash, receipt.after_state_hash);
  assert.deepEqual(receipt.evidence_ids, beforeCandidate.evidenceIds);
  assert.equal(receipt.external_send, false);
  assert.equal(afterCandidate.status, expected.candidate);
  assert.equal(afterCandidate.revision, beforeCandidate.revision + 1);
  assert.equal(afterCandidate.teacherReview.state, expected.review);
  assert.equal(afterCandidate.teacherReview.revision, afterCandidate.revision);
  assert.deepEqual(afterCandidate.teacherReview, {
    state: expected.review,
    reviewerId: "c3-e2-teacher",
    reviewedAt: FIXED_ISSUED_AT,
    note,
    revision: afterCandidate.revision,
  });
  const rawTarget = afterParts.payload.review_targets.find((item) => item?.projection_kind === "work_candidate" && item.target?.target_id === id);
  assert.ok(rawTarget);
  assert.equal(rawTarget.status, expected.candidate);
  assert.equal(rawTarget.revision, afterCandidate.revision);
  assert.deepEqual(rawTarget.teacher_review, {
    state: expected.review,
    reviewer_id: "c3-e2-teacher",
    reviewed_at: FIXED_ISSUED_AT,
    note,
    revision: afterCandidate.revision,
  });
  const task = after.data.tasks.find((item) => item.id === id);
  assert.ok(task);
  assert.equal(task.status, expected.task);
  assert.equal(task.revision, afterCandidate.revision);
  assert.equal(task.reviewedAt, FIXED_ISSUED_AT);
  assert.equal(task.reviewer, "c3-e2-teacher");
  assert.equal(task.reviewNote, note);
  assert.equal(task.externalSend, false);
  assert.ok(Array.isArray(task.reviewHistory));
  const latestTaskReview = task.reviewHistory.at(-1);
  assert.ok(latestTaskReview);
  assert.equal(latestTaskReview.reviewed_at, FIXED_ISSUED_AT);
  assert.equal(latestTaskReview.reviewer, "c3-e2-teacher");
  assert.equal(latestTaskReview.note, note);
  if (decision === "modify") {
    assert.equal(afterCandidate.title, patch.title);
    assert.equal(afterCandidate.summary, patch.summary);
    assert.equal(afterCandidate.dueAt, patch.dueAt);
    assert.equal(task.dueDate, patch.dueAt);
  }
  if (decision === "snooze") {
    assert.equal(afterCandidate.snoozeUntil, patch.snoozeUntil);
    assert.equal(afterCandidate.nextCycleState, "snoozed");
  }
  if (decision === "suppress") {
    assert.equal(afterCandidate.suppressionScope, patch.suppressionScope);
    assert.equal(afterCandidate.nextCycleState, `suppressed_${patch.suppressionScope}`);
    assert.deepEqual(receipt.rejected_ids, [id]);
    if (patch.suppressionScope === "matching_reason") {
      assert.equal(receipt.applied_ids.length, 2);
      assert.equal(receipt.applied_ids[0], id);
      assert.match(receipt.applied_ids[1], /^work_suppression_[a-f0-9]{32}$/);
    } else assert.deepEqual(receipt.applied_ids, [id]);
  } else {
    assert.deepEqual(receipt.applied_ids, [id]);
    assert.deepEqual(receipt.rejected_ids, decision === "reject" ? [id] : []);
  }
}

function safeError(error) {
  const code = typeof error?.code === "string" ? error.code : null;
  const reason = code === "stale_snapshot" || code === "stale_revision" ? code : "C3 E2 assertion failed";
  return { status: "RED", phase, code, reason, message: typeof error?.message === "string" ? error.message : String(error) };
}

async function run() {
  const suppliedCoreRoot = process.env.EDUPI_CORE_ROOT;
  assert.equal(typeof suppliedCoreRoot, "string", "EDUPI_CORE_ROOT is required");
  assert.equal(path.isAbsolute(suppliedCoreRoot), true, "EDUPI_CORE_ROOT must be absolute");
  const configuredCoreRoot = fs.realpathSync(suppliedCoreRoot);
  assert.equal(fs.statSync(configuredCoreRoot).isDirectory(), true, "EDUPI_CORE_ROOT must be a directory");
  assert.equal(fs.existsSync(path.join(configuredCoreRoot, "scripts", "desktop_bridge_port.mjs")), true, "fixed Core bridge entrypoint is missing");

  const temporaryParent = fs.realpathSync(os.tmpdir());
  temporaryDataRoot = fs.mkdtempSync(path.join(temporaryParent, "edupi-c3-e2-"));
  const memoryDir = path.join(temporaryDataRoot, ".edupi", "memory");
  const outputDir = path.join(temporaryDataRoot, ".edupi", "output");
  const lockDir = path.join(temporaryDataRoot, ".edupi", "locks");
  for (const directory of [memoryDir, outputDir, lockDir]) fs.mkdirSync(directory, { recursive: true });

  process.env.EDUPI_CORE_ROOT = configuredCoreRoot;
  process.env.EDUPI_CORE_ALLOWED_ROOT = path.dirname(configuredCoreRoot);
  process.env.EDUPI_DATA_ROOT = temporaryDataRoot;
  process.env.EDUPI_DATA_ALLOWED_ROOT = temporaryParent;
  process.env.EDUPI_PROJECT_ROOT = temporaryDataRoot;
  process.env.EDUPI_MEMORY_DIR = memoryDir;
  process.env.EDUPI_OUTPUT_DIR = outputDir;
  process.env.EDUPI_LOCK_DIR = lockDir;
  process.env.EDUPI_HOME = path.join(temporaryDataRoot, ".edupi");
  process.env.HOME = temporaryDataRoot;

  const calendarEvents = [
    { id: "midterm", name: "期中考试", type: "exam", date: "2026-09-10", end_date: "2026-09-10", source: "official_school_calendar", confidence: "confirmed" },
    { id: "final", name: "期末考试", type: "exam", date: "2026-09-12", source: "official_school_calendar", confidence: "confirmed" },
    { id: "hold", name: "连休假期", type: "holiday", date: "2026-09-13", end_date: "2026-09-15", holiday_days: 3, source: "official_school_calendar", confidence: "confirmed" },
    { id: "snooze", name: "连休假期", type: "holiday", date: "2026-09-14", end_date: "2026-09-16", holiday_days: 3, source: "official_school_calendar", confidence: "confirmed" },
    { id: "suppress-matching", name: "教师节", type: "festival", date: "2026-09-15", source: "official_school_calendar", confidence: "confirmed" },
    { id: "matching-peer", name: "校园节日", type: "festival", date: "2026-09-16", source: "official_school_calendar", confidence: "confirmed" },
    { id: "suppress-next", name: "连休假期", type: "holiday", date: "2026-09-17", end_date: "2026-09-19", holiday_days: 3, source: "official_school_calendar", confidence: "confirmed" },
    { id: "held-missing-date", name: "待确认连休", type: "holiday", source: "official_school_calendar", confidence: "confirmed" },
  ];
  // The calendar is the only direct fixture write. All plan/state/receipt files
  // are created by the real Core heartbeat/store runtime below.
  fs.writeFileSync(path.join(memoryDir, "calendar.json"), `${JSON.stringify({ events: calendarEvents }, null, 2)}\n`, "utf8");

  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  phase = "desktop_pin";
  const desktopSnapshot = await jiti.import("../lib/edupi-core-snapshot.ts");
  const { activeBridgeIdentity } = await jiti.import("../lib/edupi-bridge-manifest.ts");
  const identity = activeBridgeIdentity();
  const roots = desktopSnapshot.resolveEduPiBridgeRoots();
  assert.equal(roots.runtime.root, configuredCoreRoot);
  assert.equal(roots.runtime.coreCommit, EXPECTED_CORE_COMMIT);
  assert.equal(roots.runtime.componentManifestHash, EXPECTED_COMPONENT_MANIFEST_HASH);
  assert.equal(identity.contract.schema_hash, EXPECTED_SCHEMA_HASH);
  assert.equal(identity.contract.fixture_manifest_hash, EXPECTED_FIXTURE_MANIFEST_HASH);
  assert.deepEqual(identity.contract.supported_commands, EXPECTED_COMMANDS);
  assert.deepEqual(identity.contract.supported_projections, EXPECTED_PROJECTIONS);

  phase = "health";
  const health = await desktopSnapshot.readEduPiCoreHealth({ roots, requestId: "c3-e2-health" });
  assert.equal(health.health.contract_version, "1.1");
  assert.equal(health.health.schema_hash, EXPECTED_SCHEMA_HASH);
  assert.equal(health.health.fixture_manifest_hash, EXPECTED_FIXTURE_MANIFEST_HASH);
  assert.deepEqual(health.health.supported_commands, EXPECTED_COMMANDS);
  assert.deepEqual(health.health.supported_projections, EXPECTED_PROJECTIONS);

  phase = "imports";
  const { buildEducationContractFromWorkspace } = await jiti.import("../lib/edupi-education-contract.ts");
  const { callEduPiCore } = await jiti.import("../lib/edupi-core-process-client.ts");
  const { buildWorkCandidateReviewCommandEnvelope, issueWorkCandidateReview } = await jiti.import("../lib/edupi-work-candidate-review.ts");
  const heartbeat = await import(`${pathToFileURL(path.join(configuredCoreRoot, "scripts", "rhythm_heartbeat.mjs")).href}?c3e2=${Date.now()}`);

  async function readSnapshot(label) {
    phase = `snapshot_${label}`;
    const result = await desktopSnapshot.readEduPiEducationSnapshot({ roots, requestId: `c3-e2-${label}` });
    const { payload } = snapshotPayload(result);
    assertCapabilities(payload, identity);
    assertExternalSendDisabled(payload);
    const workspace = record(payload.education_workspace);
    assert.ok(workspace, "education workspace is unavailable");
    const data = buildEducationContractFromWorkspace(workspace, {
      workspacePath: roots.dataRoot.root,
      snapshotPayload: payload,
      supportedCommands: EXPECTED_COMMANDS,
    });
    return { snapshot: result, data };
  }

  phase = "initial_heartbeat";
  const firstHeartbeat = await withCoreWriterAdmission(() => heartbeat.run({ today: "2026-09-01", horizonDays: 30 }));
  assert.ok(firstHeartbeat);
  assert.deepEqual(firstHeartbeat.proactive_entries, []);
  assert.equal(firstHeartbeat.tasks.length, EXPECTED_TASKS.length);
  assert.equal(fs.existsSync(path.join(outputDir, "rhythm_plan.json")), true);
  assert.equal(fs.existsSync(path.join(outputDir, "teacher_review_state.json")), true);
  const initial = await readSnapshot("initial");
  assertAllWorkJoins(initial.snapshot, initial.data);
  const initialPayload = snapshotPayload(initial.snapshot).payload;
  assert.equal(initialPayload.review_targets.length, EXPECTED_TASKS.length);
  const missingInitial = initial.data.workCandidates.find((item) => item.candidateId === "long_holiday_safety:held-missing-date");
  assert.equal(missingInitial.status, "held");
  assert.equal(missingInitial.teacherReview.state, "pending_review");
  assert.equal(missingInitial.dueAt, null);
  assertCoreFiles(temporaryDataRoot, memoryDir, outputDir);

  async function reviewCurrent({ id, decision, patch = null, note, label, capture = false }) {
    const before = await readSnapshot(`${label}-before`);
    const candidate = before.data.workCandidates.find((item) => item.candidateId === id);
    assert.ok(candidate, `candidate ${id} is available before ${decision}`);
    const input = {
      snapshot: before.snapshot.envelope,
      targetId: candidate.candidateId,
      expectedSnapshotId: candidate.snapshotId,
      expectedRevision: candidate.revision,
      decision,
      patch,
      note,
      reviewerId: "c3-e2-teacher",
      issuedAt: FIXED_ISSUED_AT,
    };
    let result;
    let captured = null;
    if (capture) {
      captured = {};
      result = await issueWorkCandidateReview(input, {
        supportedCommands: EXPECTED_COMMANDS,
        dispatch: async (envelope) => {
          captured.command = structuredClone(envelope);
          captured.response = await callEduPiCore({ operation: "command", requestId: envelope.request_id, runtime: roots.runtime, dataRoot: roots.dataRoot, envelope });
          return captured.response;
        },
        refreshSnapshot: async () => (await desktopSnapshot.readEduPiEducationSnapshot({ roots, requestId: `c3-e2-${label}-refresh` })).envelope,
      });
    } else result = await issueWorkCandidateReview(input);
    const after = await readSnapshot(`${label}-after`);
    assertReceipt(result, before, after, id, decision, patch, note);
    return { before, after, candidate, input, result, captured };
  }

  phase = "accept";
  const accepted = await reviewCurrent({ id: "midterm_preparation:midterm", decision: "accept", note: "确认期中支持准备", label: "accept", capture: true });
  phase = "replay";
  const statePath = path.join(outputDir, "teacher_review_state.json");
  const bytesBeforeReplay = fs.readFileSync(statePath, "utf8");
  const countsBeforeReplay = {
    receipts: snapshotPayload(accepted.after.snapshot).payload.receipts.length,
    history: snapshotPayload(accepted.after.snapshot).payload.review_history.length,
  };
  assert.ok(accepted.captured?.command && accepted.captured?.response?.receipt, "accept command capture is incomplete");
  const replayResponse = await callEduPiCore({ operation: "command", requestId: "c3-e2-raw-replay", runtime: roots.runtime, dataRoot: roots.dataRoot, envelope: accepted.captured.command });
  assert.equal(replayResponse.ok, true);
  assert.equal(JSON.stringify(replayResponse.receipt), JSON.stringify(accepted.captured.response.receipt), "Core idempotent replay changes no nested receipt bytes");
  assert.equal(fs.readFileSync(statePath, "utf8"), bytesBeforeReplay);
  const replaySnapshot = await readSnapshot("replay");
  assert.equal(snapshotPayload(replaySnapshot.snapshot).payload.receipts.length, countsBeforeReplay.receipts);
  assert.equal(snapshotPayload(replaySnapshot.snapshot).payload.review_history.length, countsBeforeReplay.history);

  phase = "modify";
  await reviewCurrent({
    id: "post_exam_support:midterm",
    decision: "modify",
    patch: { title: "调整后的考后支持", summary: "根据考试节奏调整支持安排", dueAt: "2026-09-12" },
    note: "按考试节奏调整",
    label: "modify",
  });
  phase = "reject";
  await reviewCurrent({ id: "final_sprint:final", decision: "reject", note: "本次不采用", label: "reject" });
  phase = "hold";
  await reviewCurrent({ id: "long_holiday_safety:hold", decision: "hold", note: "暂缓确认", label: "hold" });
  phase = "snooze";
  await reviewCurrent({ id: "long_holiday_safety:snooze", decision: "snooze", patch: { snoozeUntil: "2026-09-15" }, note: "稍后处理", label: "snooze" });
  phase = "suppress_matching";
  await reviewCurrent({ id: "festival:suppress-matching", decision: "suppress", patch: { suppressionScope: "matching_reason" }, note: "同类节日提示暂不需要", label: "suppress-matching" });
  phase = "suppress_next";
  await reviewCurrent({ id: "long_holiday_safety:suppress-next", decision: "suppress", patch: { suppressionScope: "next_cycle" }, note: "下一周期再看", label: "suppress-next" });

  phase = "matching_policy_cycle";
    const sameCycle = await withCoreWriterAdmission(() => heartbeat.run({ today: "2026-09-01", horizonDays: 30 }));
  assertHeartbeatInternal(sameCycle);
  const afterMatching = await readSnapshot("matching-policy");
  assertAllWorkJoins(afterMatching.snapshot, afterMatching.data);
  const matchingPeer = afterMatching.data.workCandidates.find((item) => item.candidateId === "festival:matching-peer");
  assert.equal(matchingPeer.status, "suppressed");
  assert.equal(matchingPeer.suppressionScope, "matching_reason");
  assert.equal(matchingPeer.nextCycleState, "suppressed_matching_reason");

  phase = "snooze_expiry_cycle";
  const expiryHeartbeat = await withCoreWriterAdmission(() => heartbeat.run({ today: "2026-09-15", horizonDays: 0 }));
  assertHeartbeatInternal(expiryHeartbeat);
  const afterExpiry = await readSnapshot("snooze-expiry");
  const expired = afterExpiry.data.workCandidates.find((item) => item.candidateId === "long_holiday_safety:snooze");
  assert.equal(expired.status, "pending_review");
  assert.equal(expired.snoozeUntil, null);
  assert.equal(expired.nextCycleState, "reopened_snooze_expired");
  const nextConsumed = afterExpiry.data.workCandidates.find((item) => item.candidateId === "long_holiday_safety:suppress-next");
  assert.equal(nextConsumed.status, "suppressed");
  assert.equal(nextConsumed.nextCycleState, "suppressed_next_cycle");

  phase = "next_cycle_release";
  const releaseHeartbeat = await withCoreWriterAdmission(() => heartbeat.run({ today: "2026-09-22", horizonDays: 0 }));
  assertHeartbeatInternal(releaseHeartbeat);
  const afterRelease = await readSnapshot("next-cycle-release");
  const released = afterRelease.data.workCandidates.find((item) => item.candidateId === "long_holiday_safety:suppress-next");
  assert.equal(released.status, "pending_review");
  assert.equal(released.suppressionScope, null);
  assert.equal(released.nextCycleState, "awaiting_teacher");
  assert.equal(afterRelease.data.workCandidates.find((item) => item.candidateId === "festival:matching-peer").status, "suppressed");
  assertCoreFiles(temporaryDataRoot, memoryDir, outputDir);

  phase = "stale_snapshot";
  const bytesBeforeStaleSnapshot = fs.readFileSync(statePath, "utf8");
  let staleSnapshotCode = null;
  try {
    await issueWorkCandidateReview({
      snapshot: initial.snapshot.envelope,
      targetId: accepted.candidate.candidateId,
      expectedSnapshotId: accepted.candidate.snapshotId,
      expectedRevision: accepted.candidate.revision,
      decision: "hold",
      patch: null,
      note: "旧快照",
      reviewerId: "c3-e2-teacher",
      issuedAt: FIXED_ISSUED_AT,
    });
  } catch (error) {
    staleSnapshotCode = error?.code || null;
  }
  assert.equal(staleSnapshotCode, "stale_snapshot");
  assert.equal(fs.readFileSync(statePath, "utf8"), bytesBeforeStaleSnapshot);

  phase = "stale_revision";
  const current = await readSnapshot("stale-revision-current");
  const staleRevisionCandidate = current.data.workCandidates.find((item) => item.candidateId === "long_holiday_safety:suppress-next");
  assert.ok(staleRevisionCandidate.revision > 0);
  const bytesBeforeStaleRevision = fs.readFileSync(statePath, "utf8");
  const rawStaleRevisionCommand = buildWorkCandidateReviewCommandEnvelope({
    snapshot: current.snapshot.envelope,
    targetId: staleRevisionCandidate.candidateId,
    expectedSnapshotId: staleRevisionCandidate.snapshotId,
    expectedRevision: staleRevisionCandidate.revision,
    decision: "hold",
    patch: null,
    note: "旧 revision",
    reviewerId: "c3-e2-teacher",
    issuedAt: FIXED_ISSUED_AT,
  });
  rawStaleRevisionCommand.command.expected_revision = staleRevisionCandidate.revision - 1;
  const rawStaleRevision = await callEduPiCore({ operation: "command", requestId: "c3-e2-raw-stale-revision", runtime: roots.runtime, dataRoot: roots.dataRoot, envelope: rawStaleRevisionCommand });
  assert.equal(rawStaleRevision.ok, true);
  assert.equal(rawStaleRevision.receipt.payload.command_type, "review_work_candidate");
  assert.deepEqual(rawStaleRevision.receipt.payload.target, { target_kind: "work_candidate", target_id: staleRevisionCandidate.candidateId, command_type: "review_work_candidate" });
  assert.equal(rawStaleRevision.receipt.payload.status, "failed");
  assert.equal(rawStaleRevision.receipt.payload.reason_code, "stale_revision");
  assert.equal(rawStaleRevision.receipt.payload.after_snapshot_id, null);
  assert.equal(rawStaleRevision.receipt.payload.after_state_hash, null);
  assert.equal(rawStaleRevision.receipt.payload.external_send, false);
  assert.equal(fs.readFileSync(statePath, "utf8"), bytesBeforeStaleRevision);

  phase = "final";
  const final = await readSnapshot("final");
  assertAllWorkJoins(final.snapshot, final.data);
  const finalPayload = snapshotPayload(final.snapshot).payload;
  assert.equal(finalPayload.receipts.length, 7);
  assert.equal(finalPayload.review_history.length, 7);
  assert.equal(final.data.workCandidateReceipts.length, 7);
  assert.equal(final.data.workCandidateReviewHistory.length, 7);
  assert.equal(final.data.observations.length, 0);
  assert.equal(final.data.memoryCandidates.length, 0);
  assert.equal(final.data.teacherContextCandidates.length, 0);
  const finalStatus = new Map(final.data.workCandidates.map((item) => [item.candidateId, item.status]));
  assert.equal(finalStatus.get("midterm_preparation:midterm"), "accepted");
  assert.equal(finalStatus.get("post_exam_support:midterm"), "modified");
  assert.equal(finalStatus.get("final_sprint:final"), "rejected");
  assert.equal(finalStatus.get("long_holiday_safety:hold"), "held");
  assert.equal(finalStatus.get("long_holiday_safety:snooze"), "pending_review");
  assert.equal(finalStatus.get("festival:suppress-matching"), "suppressed");
  assert.equal(finalStatus.get("festival:matching-peer"), "suppressed");
  assert.equal(finalStatus.get("long_holiday_safety:suppress-next"), "pending_review");
  assert.equal(finalStatus.get("long_holiday_safety:held-missing-date"), "held");
  const decisions = finalPayload.receipts.map((receipt) => receipt.decision);
  assert.deepEqual(decisions, ["accept", "modify", "reject", "hold", "snooze", "suppress", "suppress"]);
  assert.equal(new Set(finalPayload.receipts.map((receipt) => receipt.receipt_id)).size, 7);
  assert.equal(new Set(finalPayload.review_history.map((item) => item.review_id)).size, 7);
  for (const receipt of finalPayload.receipts) {
    const history = finalPayload.review_history.find((item) => item.receipt_id === receipt.receipt_id);
    assert.ok(history, `history for ${receipt.receipt_id}`);
    assert.equal(history.command_type, "review_work_candidate");
    assert.deepEqual(history.target, receipt.target);
    assert.equal(history.revision, 1);
    assert.equal(history.revision, receipt.teacher_review.revision);
    assert.deepEqual(history.evidence_ids, receipt.evidence_ids);
    assert.deepEqual(history.teacher_review, receipt.teacher_review);
    assert.equal(history.before_snapshot_id, receipt.before_snapshot_id);
    assert.equal(history.after_snapshot_id, receipt.after_snapshot_id);
    assert.equal(history.before_state_hash, receipt.before_state_hash);
    assert.equal(history.after_state_hash, receipt.after_state_hash);
    assert.equal(history.external_send, false);
  }
  assertCapabilities(finalPayload, identity);
  assertExternalSendDisabled(finalPayload);
  assertCoreFiles(temporaryDataRoot, memoryDir, outputDir);

  return {
    status: "GREEN",
    pin: {
      core_commit: roots.runtime.coreCommit,
      component_manifest_hash: roots.runtime.componentManifestHash,
      fixture_manifest_hash: EXPECTED_FIXTURE_MANIFEST_HASH,
      schema_hash: identity.contract.schema_hash,
    },
    counts: {
      tasks: final.data.tasks.length,
      work_candidates: final.data.workCandidates.length,
      work_receipts: final.data.workCandidateReceipts.length,
      work_history: final.data.workCandidateReviewHistory.length,
    },
    decisions: ["accept", "modify", "reject", "hold", "snooze", "suppress", "suppress"],
    matching_reason_peer_suppressed: true,
    next_cycle_released: true,
    snooze_expired: true,
    missing_date_held: true,
    replay_no_write: true,
    restart_reload: true,
    stale_snapshot_no_write: true,
    stale_revision_no_write: true,
    proactive_entries_empty: true,
    external_send: false,
    canonical_store: ".edupi/output/teacher_review_state.json",
  };
}

timeoutHandle = setTimeout(() => {
  restoreEnvironment();
  cleanup();
  console.error(JSON.stringify({ status: "RED", phase: "hard_timeout", reason: "C3 E2 verifier exceeded 60 seconds" }));
  process.exit(1);
}, HARD_TIMEOUT_MS);

try {
  console.log(JSON.stringify(await run(), null, 2));
} catch (error) {
  console.error(JSON.stringify(safeError(error), null, 2));
  process.exitCode = 1;
} finally {
  if (timeoutHandle) clearTimeout(timeoutHandle);
  restoreEnvironment();
  cleanup();
}
