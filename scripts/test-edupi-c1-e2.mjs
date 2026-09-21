#!/usr/bin/env node

/**
 * Real cross-repository C1 verifier.
 *
 * This script deliberately runs against a caller-supplied Core checkout and
 * uses Desktop's production snapshot/command consumers.  It never seeds the
 * canonical review JSON itself: capture goes through Core's teacher
 * observation adapter and every review crosses the fixed child-process bridge.
 *
 * Run after pairing a Core checkout with Desktop's pinned identity:
 *   EDUPI_CORE_ROOT=/absolute/path/to/edupi npm run test:edupi-c1-e2
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HARD_TIMEOUT_MS = 60_000;
const EXPECTED_COMMANDS = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"];
const EXPECTED_PROJECTIONS = ["education_workspace"];
const FIXED_ISSUED_AT = "2026-08-27T09:00:00.000Z";

let temporaryDataRoot = null;
let timeoutHandle = null;
let expectedCoreIdentity = null;
let actualCoreIdentity = null;
let writerAdmission = null;

function cleanup() {
  if (!temporaryDataRoot) return;
  try {
    fs.rmSync(temporaryDataRoot, { recursive: true, force: true });
  } catch {
    // The verifier must not mask the result with a cleanup error.
  }
  temporaryDataRoot = null;
}

process.once("exit", cleanup);
process.once("SIGINT", () => {
  cleanup();
  process.exit(130);
});

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function coreIdentity(coreRoot) {
  const manifestPath = path.join(coreRoot, "contracts", "edupi-desktop-component-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const commit = execFileSync("git", ["-C", coreRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return {
    core_commit: commit,
    component_manifest_hash: manifest.component_manifest_hash,
  };
}

function snapshotPayload(result) {
  const envelope = record(result?.envelope) || record(result);
  const payload = record(envelope?.payload);
  assert.ok(payload, "Core snapshot payload is unavailable");
  return { envelope, payload };
}

function assertCapabilities(payload) {
  assert.deepEqual(payload.capabilities?.supported_commands, EXPECTED_COMMANDS);
  assert.deepEqual(payload.capabilities?.supported_projections, EXPECTED_PROJECTIONS);
  assert.equal(payload.capabilities?.can_review_memory, true);
  assert.equal(payload.capabilities?.can_execute_actions, false);
  assert.equal(payload.capabilities?.external_send_enabled, false);
  assert.equal(payload.education_workspace?.external_send, false);
  assert.equal(payload.education_workspace?.requires_teacher_review, true);
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

function snapshotCounts(payload) {
  return {
    observations: Array.isArray(payload.observations) ? payload.observations.length : 0,
    candidates: Array.isArray(payload.memory_candidates) ? payload.memory_candidates.length : 0,
    memories: Array.isArray(payload.memories) ? payload.memories.length : 0,
    receipts: Array.isArray(payload.receipts) ? payload.receipts.length : 0,
    history: Array.isArray(payload.review_history) ? payload.review_history.length : 0,
  };
}

function listFiles(root) {
  const result = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else result.push(path.relative(root, fullPath));
    }
  };
  walk(root);
  return result.sort();
}

function assertCanonicalStorage(outputDir, memoryDir) {
  const outputFiles = listFiles(outputDir);
  assert.deepEqual(
    outputFiles.filter((file) => path.basename(file) === "teacher_review_state.json"),
    ["teacher_review_state.json"],
  );
  const legacyMemoryNames = new Set([
    "class.json",
    "teaching.json",
    "semester.json",
    "preferences.json",
    "school.json",
  ]);
  assert.deepEqual(
    listFiles(memoryDir).filter((file) => legacyMemoryNames.has(path.basename(file))),
    [],
    "C1 capture/review must not dual-write legacy memory JSON",
  );
}

function safeError(error) {
  const message = typeof error?.message === "string" ? error.message : String(error || "unknown error");
  const reason = message.includes("Core commit mismatch") || message.includes("manifest hash mismatch")
    ? "pinned Core identity mismatch"
    : message.includes("EDUPI_CORE_ROOT") || message.includes("absolute path") || message.includes("fixed bridge entrypoint")
      ? "invalid E2 root configuration"
    : message.includes("stale snapshot")
      ? "Core rejected stale snapshot"
      : "verification assertion failed";
  return {
    name: typeof error?.name === "string" ? error.name : "Error",
    code: typeof error?.code === "string" ? error.code : null,
    reason,
  };
}

async function run() {
  const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
  assert.equal(typeof configuredCoreRoot, "string", "EDUPI_CORE_ROOT is required");
  assert.equal(path.isAbsolute(configuredCoreRoot), true, "EDUPI_CORE_ROOT must be an absolute path");
  const coreRoot = fs.realpathSync(configuredCoreRoot);
  assert.equal(fs.statSync(coreRoot).isDirectory(), true, "EDUPI_CORE_ROOT must be a directory");
  assert.equal(fs.statSync(path.join(coreRoot, "scripts", "desktop_bridge_port.mjs")).isFile(), true, "Core fixed bridge entrypoint is missing");

  // Resolve and expose the Core identity before importing Desktop's pinned
  // consumer.  The comparison makes the pre-repin RED explicit while the
  // actual snapshot call below remains the production identity-gated path.
  actualCoreIdentity = coreIdentity(coreRoot);
  const coreAllowedRoot = fs.realpathSync(path.dirname(coreRoot));
  process.env.EDUPI_CORE_ROOT = coreRoot;
  process.env.EDUPI_CORE_ALLOWED_ROOT = coreAllowedRoot;

  const temporaryParent = fs.realpathSync(os.tmpdir());
  temporaryDataRoot = fs.mkdtempSync(path.join(temporaryParent, "edupi-c1-e2-"));
  assert.equal(isInside(temporaryParent, temporaryDataRoot), true);
  assert.equal(isInside(coreAllowedRoot, coreRoot), true);
  const memoryDir = path.join(temporaryDataRoot, ".edupi", "memory");
  const outputDir = path.join(temporaryDataRoot, ".edupi", "output");
  const lockDir = path.join(temporaryDataRoot, ".edupi", "locks");
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(lockDir, { recursive: true });
  process.env.EDUPI_DATA_ROOT = temporaryDataRoot;
  process.env.EDUPI_DATA_ALLOWED_ROOT = temporaryParent;
  process.env.EDUPI_PROJECT_ROOT = temporaryDataRoot;
  process.env.EDUPI_MEMORY_DIR = memoryDir;
  process.env.EDUPI_OUTPUT_DIR = outputDir;
  process.env.EDUPI_LOCK_DIR = lockDir;
  process.env.EDUPI_HOME = path.join(temporaryDataRoot, ".edupi");

  // The current Core Runtime serializes every canonical education mutation
  // behind one root-bound writer admission.  Hold it across capture, review,
  // replay, and stale-snapshot checks so this verifier exercises the same
  // admitted production path as the other cross-repository E2 checks.
  const { prepareCoreRuntimeRoot } = await import(path.join(coreRoot, "scripts", "core_runtime_root.mjs"));
  const { acquireCoreRuntimeWriterAdmission } = await import(path.join(coreRoot, "scripts", "core_runtime_writer_admission.mjs"));
  const preparedRoot = prepareCoreRuntimeRoot(temporaryDataRoot);
  assert.equal(preparedRoot.ok, true, JSON.stringify(preparedRoot));
  writerAdmission = await acquireCoreRuntimeWriterAdmission({
    root: preparedRoot,
    kind: "legacy_c1_e2",
    busyTimeoutMs: 250,
  });

  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const { activeBridgeIdentity } = await jiti.import("../lib/edupi-bridge-manifest.ts");
  const { readEduPiEducationSnapshot } = await jiti.import("../lib/edupi-core-snapshot.ts");
  const { issueC1Review } = await jiti.import("../lib/edupi-c1-review.ts");
  expectedCoreIdentity = activeBridgeIdentity().runtime;

  // Use Core's real TypeScript adapter and store export.  This is the only
  // C1 capture write; the canonical state JSON is never hand-authored here.
  const { captureTeacherObservation } = await jiti.import(path.join(coreRoot, "extensions", "teacher_observation.ts"));
  let captured;
  try {
    captured = captureTeacherObservation({
      source_message_id: "e2e-teacher-message-2026-08-27",
      text: "七年级二班本周解方程练习中出现同类移项符号错误，需要下一节课先复习再观察。",
      observed_at: FIXED_ISSUED_AT,
      subject: "math",
      class_id: "class-7b",
      category: "teaching",
      matched_rules: ["e2e-observation-rule"],
      tags: ["移项", "课堂观察"],
    });
  } finally {
    // Review commands use Desktop's one-shot bridge, which acquires its own
    // child-process admission. Do not hold the capture lease across them.
    await writerAdmission?.release();
    writerAdmission = null;
  }
  assert.equal(captured.created, true);
  assert.ok(captured.observation_id);
  assert.ok(captured.candidate_id);
  assert.equal(captured.observation.inference_status, "observed");
  assert.equal(captured.candidate.inference_status, "candidate_only");
  assert.equal(captured.candidate.external_send, false);
  assert.ok(captured.observation.evidence_ids.length > 0);
  assert.deepEqual(captured.candidate.evidence_ids, captured.observation.evidence_ids);
  assert.deepEqual(captured.candidate.based_on_observation_ids, [captured.observation_id]);
  assert.equal(captured.observation.provenance[0].source_id, "e2e-teacher-message-2026-08-27");
  const observationSource = captured.observation.provenance[0];

  const initialResult = await readEduPiEducationSnapshot({ requestId: "e2e-c1-initial" });
  const initial = snapshotPayload(initialResult);
  assertCapabilities(initial.payload);
  assert.equal(initial.payload.observations.length, 1);
  assert.equal(initial.payload.memory_candidates.length, 1);
  assert.equal(initial.payload.memories.length, 0);
  assert.equal(initial.payload.receipts.length, 0);
  assert.equal(initial.payload.review_history.length, 0);
    assert.equal(initial.payload.observations[0].observation_id, captured.observation_id);
  assert.equal(initial.payload.memory_candidates[0].candidate_id, captured.candidate_id);
  assertExternalSendDisabled(initial.payload);

  const observationInput = {
    snapshot: initial.envelope,
    targetKind: "observation",
    targetId: captured.observation_id,
    decision: "accept",
    reviewerId: "e2e-teacher-reviewer",
    issuedAt: FIXED_ISSUED_AT,
  };
  const observationReview = await issueC1Review(observationInput);
  assert.equal(observationReview.receipt.command_type, "review_observation");
  assert.equal(observationReview.receipt.status, "accepted");
  assert.equal(observationReview.receipt.external_send, false);
  assert.equal(observationReview.receipt.before_snapshot_id, initial.payload.snapshot_id);
  assert.equal(observationReview.receipt.after_snapshot_id, observationReview.data.payload.snapshot_id);
  assert.equal(observationReview.receipt.after_state_hash, observationReview.data.payload.state_hash);
  const afterObservation = snapshotPayload(observationReview.data);
  assertCapabilities(afterObservation.payload);
  assert.equal(afterObservation.payload.observations[0].teacher_review.state, "accepted");
  assert.equal(afterObservation.payload.observations[0].teacher_review.revision, 1);
  assert.equal(afterObservation.payload.receipts.length, 1);
  assert.equal(afterObservation.payload.review_history.length, 1);
  assertExternalSendDisabled(afterObservation.payload);

  const candidateInput = {
    snapshot: observationReview.data,
    targetKind: "memory_candidate",
    targetId: captured.candidate_id,
    decision: "modify",
    patch: { proposed_content: "七年级二班解方程：下一节课先复习移项符号，再观察练习表现。" },
    reviewerId: "e2e-teacher-reviewer",
    issuedAt: FIXED_ISSUED_AT,
  };
  const candidateReview = await issueC1Review(candidateInput);
  assert.equal(candidateReview.receipt.command_type, "review_memory_candidate");
  assert.equal(candidateReview.receipt.status, "modified");
  assert.equal(candidateReview.receipt.external_send, false);
  assert.equal(candidateReview.receipt.before_snapshot_id, afterObservation.payload.snapshot_id);
  assert.equal(candidateReview.receipt.after_snapshot_id, candidateReview.data.payload.snapshot_id);
  assert.equal(candidateReview.receipt.after_state_hash, candidateReview.data.payload.state_hash);
  const afterCandidate = snapshotPayload(candidateReview.data);
  assertCapabilities(afterCandidate.payload);
  assert.equal(afterCandidate.payload.memory_candidates[0].teacher_review.state, "modified");
  assert.equal(afterCandidate.payload.memory_candidates[0].proposed_content, candidateInput.patch.proposed_content);
  assert.equal(afterCandidate.payload.memories.length, 1);
  const memory = afterCandidate.payload.memories[0];
  assert.equal(memory.state, "active");
  assert.equal(memory.accepted_from_candidate_id, captured.candidate_id);
  assert.ok(Array.isArray(memory.provenance) && memory.provenance.length > 0);
  assert.equal(memory.provenance.some((item) => item.source_id === observationSource.source_id), true);
  assert.equal(memory.evidence_ids.some((id) => captured.candidate.evidence_ids.includes(id)), true);
  assert.equal(afterCandidate.payload.receipts.length, 2);
  assert.equal(afterCandidate.payload.review_history.length, 2);
  assertExternalSendDisabled(afterCandidate.payload);

  // Replaying the same semantic review through the production path must
  // return the stored Core receipt and must not append another transaction.
  const stateBytesBeforeReplay = fs.readFileSync(path.join(outputDir, "teacher_review_state.json"), "utf8");
  const replay = await issueC1Review(candidateInput);
  assert.equal(replay.receipt.receipt_id, candidateReview.receipt.receipt_id);
  assert.deepEqual(snapshotPayload(replay.data).payload, afterCandidate.payload);
  assert.equal(fs.readFileSync(path.join(outputDir, "teacher_review_state.json"), "utf8"), stateBytesBeforeReplay);

  // A stale snapshot is a real Core no-write result.  Keep the old snapshot,
  // invoke the same Desktop command route, then prove canonical bytes and
  // revision-bearing projection identity did not move.
  const stateBytesBeforeStale = fs.readFileSync(path.join(outputDir, "teacher_review_state.json"), "utf8");
  let staleCode = null;
  try {
    await issueC1Review({
      snapshot: initial.envelope,
      targetKind: "memory_candidate",
      targetId: captured.candidate_id,
      decision: "hold",
      reviewerId: "e2e-teacher-reviewer",
      issuedAt: FIXED_ISSUED_AT,
    });
  } catch (error) {
    staleCode = error?.code || null;
  }
  assert.equal(staleCode, "stale_snapshot");
  assert.equal(fs.readFileSync(path.join(outputDir, "teacher_review_state.json"), "utf8"), stateBytesBeforeStale);
  const afterStaleResult = await readEduPiEducationSnapshot({ requestId: "e2e-c1-after-stale" });
  const afterStale = snapshotPayload(afterStaleResult);
  assert.equal(afterStale.payload.snapshot_id, afterCandidate.payload.snapshot_id);
  assert.equal(afterStale.payload.state_hash, afterCandidate.payload.state_hash);
  assert.equal(afterStale.payload.memory_candidates[0].teacher_review.revision, 1);

  // A fresh child-process snapshot is the restart/reload check.  No in-memory
  // Desktop object is reused by this call.
  const restartedResult = await readEduPiEducationSnapshot({ requestId: "e2e-c1-restart" });
  const restarted = snapshotPayload(restartedResult);
  assertCapabilities(restarted.payload);
  assert.deepEqual(snapshotCounts(restarted.payload), {
    observations: 1,
    candidates: 1,
    memories: 1,
    receipts: 2,
    history: 2,
  });
  assert.equal(restarted.payload.observations[0].observation_id, captured.observation_id);
  assert.equal(restarted.payload.memory_candidates[0].candidate_id, captured.candidate_id);
  assert.equal(restarted.payload.memories[0].accepted_from_candidate_id, captured.candidate_id);
  assert.equal(restarted.payload.receipts.every((receipt) => receipt.external_send === false), true);
  assert.equal(restarted.payload.review_history.every((entry) => entry.external_send === false), true);
  assertExternalSendDisabled(restarted.payload);
  assertCanonicalStorage(outputDir, memoryDir);

  return {
    status: "GREEN",
    core_commit: actualCoreIdentity.core_commit,
    component_manifest_hash: actualCoreIdentity.component_manifest_hash,
    expected_core_commit: expectedCoreIdentity.core_commit,
    counts: snapshotCounts(restarted.payload),
    snapshot_id: restarted.payload.snapshot_id,
    receipt_ids: [observationReview.receipt.receipt_id, candidateReview.receipt.receipt_id],
    canonical_store: "teacher_review_state.json",
    idempotency_replay: true,
    stale_no_write: true,
    external_send: false,
  };
}

timeoutHandle = setTimeout(() => {
  console.error(JSON.stringify({ status: "RED", phase: "hard_timeout", message: "C1 E2 verifier exceeded 60 seconds" }));
  process.exitCode = 1;
  process.exit(1);
}, HARD_TIMEOUT_MS);

try {
  const summary = await run();
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  const isIdentityMismatch = Boolean(actualCoreIdentity && expectedCoreIdentity && (
    actualCoreIdentity.core_commit !== expectedCoreIdentity.core_commit
    || actualCoreIdentity.component_manifest_hash !== expectedCoreIdentity.component_manifest_hash
  ));
  const detail = safeError(error);
  console.error(JSON.stringify({
    status: "RED",
    phase: isIdentityMismatch ? "desktop_identity_gate" : "c1_e2",
    reason: isIdentityMismatch ? "pinned Core identity/capability mismatch; re-pin Desktop before GREEN" : "C1 E2 verifier failed",
    error: detail,
    ...(actualCoreIdentity ? {
      actual_core_commit: actualCoreIdentity.core_commit,
      actual_component_manifest_hash: actualCoreIdentity.component_manifest_hash,
    } : {}),
    ...(expectedCoreIdentity ? {
      expected_core_commit: expectedCoreIdentity.core_commit,
      expected_component_manifest_hash: expectedCoreIdentity.component_manifest_hash,
    } : {}),
  }, null, 2));
  process.exitCode = 1;
} finally {
  if (timeoutHandle) clearTimeout(timeoutHandle);
  await writerAdmission?.release().catch(() => {});
  writerAdmission = null;
  cleanup();
}
