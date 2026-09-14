#!/usr/bin/env node

/**
 * Real paired C2 verifier.
 *
 * Core capture is driven by the pinned onboarding extension and its real
 * outer Pi branch entry.  Desktop then reads and reviews that state through
 * its validated snapshot and fixed child-process bridge.  No canonical JSON
 * is seeded by this verifier.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HARD_TIMEOUT_MS = 60_000;
const COMPAT_MANIFEST = JSON.parse(fs.readFileSync(new URL("../contracts/edupi-core-compat.json", import.meta.url), "utf8"));
const EXPECTED_CORE_COMMIT = COMPAT_MANIFEST.core_runtime.core_commit;
const EXPECTED_COMPONENT_MANIFEST_HASH = COMPAT_MANIFEST.core_runtime.component_manifest_hash;
const EXPECTED_SCHEMA_HASH = "sha256:190f2673a1c36d00cd52b0c7887d0bfa7bb0ffb7ca739eb4b5e443255858b0d5";
const EXPECTED_COMMANDS = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"];
const EXPECTED_PROJECTIONS = ["education_workspace"];
const REVIEW_STATUS = { accept: "accepted", hold: "held", reject: "rejected", modify: "modified" };
const FIXED_ISSUED_AT = "2026-08-28T09:00:00.000Z";
const SOURCE_TEXT = "我是一名七年级数学老师，主要带七年级二班。";
const INITIAL_VALUES = {
  name: "李老师",
  role: "班主任",
  subject: "数学",
  grade: "七年级",
  class_name: "七年级二班",
};
const ENV_KEYS = [
  "EDUPI_CORE_ROOT",
  "EDUPI_CORE_ALLOWED_ROOT",
  "EDUPI_DATA_ROOT",
  "EDUPI_DATA_ALLOWED_ROOT",
  "EDUPI_PROJECT_ROOT",
  "EDUPI_MEMORY_DIR",
  "EDUPI_OUTPUT_DIR",
  "EDUPI_LOCK_DIR",
  "EDUPI_HOME",
  "HOME",
];
const previousEnvironment = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

let temporaryDataRoot = null;
let timeoutHandle = null;
let phase = "start";
let coreWriterModules = null;

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
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // Cleanup must not mask the verifier result.
  }
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

function listFiles(root) {
  const result = [];
  const walk = (current) => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else result.push(path.relative(root, fullPath));
    }
  };
  walk(root);
  return result.sort();
}

function snapshotPayload(result) {
  const envelope = record(result?.envelope) || record(result);
  const payload = record(envelope?.payload);
  assert.ok(envelope && payload, "Core snapshot envelope is unavailable");
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

function assertCanonicalStorage(dataRoot, memoryDir, outputDir) {
  const outputFiles = listFiles(outputDir);
  assert.ok(outputFiles.includes("teacher_review_state.json"));
  assert.ok(outputFiles.every((file) => file === "teacher_review_state.json" || file === "teacher_review_state.json.bak"), "C2 must keep one canonical state file");
  const legacyNames = new Set(["class.json", "teaching.json", "semester.json", "preferences.json", "school.json", "auth.json", "models.json"]);
  const allFiles = listFiles(dataRoot);
  assert.deepEqual(allFiles.filter((file) => legacyNames.has(path.basename(file))), [], "C2 must not write legacy/auth/model JSON");
  assert.deepEqual(listFiles(memoryDir), [], "C2 must not create a second memory store");
}

function sourceEntry(sourceId, text, index) {
  return {
    type: "message",
    id: sourceId,
    parentId: null,
    timestamp: `2026-08-28T09:0${index}:00.000Z`,
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  };
}

function registerOnboarding(registerExtension) {
  const tools = new Map();
  const events = new Map();
  registerExtension({
    on(name, handler) {
      events.set(name, handler);
    },
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
  });
  const setup = tools.get("setup_complete");
  assert.equal(typeof setup?.execute, "function", "pinned onboarding setup_complete is unavailable");
  return { setup, events };
}

async function captureSetup(registerExtension, sourceId, values, preferences, index) {
  const entry = sourceEntry(sourceId, SOURCE_TEXT, index);
  const context = { sessionManager: { getBranch: () => [entry] } };
  const { setup } = registerOnboarding(registerExtension);
  const params = { ...values };
  if (preferences !== undefined) params.preferences = preferences;
  const result = await withCoreWriterAdmission(() => setup.execute(`synthetic-tool-call-${sourceId}`, params, null, null, context));
  assert.equal(Object.hasOwn(entry.message, "id"), false, "UserMessage must remain ID-free");
  assert.equal(entry.id, sourceId, "source ID must remain on the outer branch entry");
  assert.equal(result.details?.context_id, "context_teacher");
  return { result, entry };
}

async function withCoreWriterAdmission(callback) {
  const dataRoot = fs.realpathSync(process.env.EDUPI_PROJECT_ROOT);
  const root = fs.realpathSync(process.env.EDUPI_CORE_ROOT);
  coreWriterModules ||= {
    root: await import(path.join(root, "scripts", "core_runtime_root.mjs")),
    admission: await import(path.join(root, "scripts", "core_runtime_writer_admission.mjs")),
  };
  const prepared = coreWriterModules.root.prepareCoreRuntimeRoot(dataRoot);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const lease = await coreWriterModules.admission.acquireCoreRuntimeWriterAdmission({ root: prepared, kind: "legacy_c2_e2", busyTimeoutMs: 250 });
  try {
    return await callback();
  } finally {
    await lease.release();
  }
}

function projectSnapshot(snapshot, buildEducationContractFromWorkspace, supportedCommands, dataRoot) {
  const { payload } = snapshotPayload(snapshot);
  const workspace = record(payload.education_workspace);
  assert.ok(workspace, "education workspace is unavailable");
  return buildEducationContractFromWorkspace(workspace, {
    workspacePath: dataRoot,
    snapshotPayload: payload,
    supportedCommands,
  });
}

function contextCandidate(data) {
  assert.equal(data.teacherContextCandidates.length, 1, "expected one teacher-context candidate");
  return data.teacherContextCandidates[0];
}

function assertActiveSource(snapshot, candidate, expectedSourceId) {
  assert.deepEqual(candidate.sourceIds, [expectedSourceId]);
  const { envelope } = snapshotPayload(snapshot);
  const sources = (Array.isArray(envelope.provenance) ? envelope.provenance : [])
    .filter((entry) => entry?.source_kind === "teacher_message" && entry?.source_id === expectedSourceId);
  assert.equal(sources.length, 1, "active teacher-message provenance must be unique");
  assert.match(sources[0].source_hash, /^sha256:[A-Za-z0-9_-]+$/);
  assert.equal(sources[0].observed_at.startsWith("2026-08-28T09:"), true);
  assert.deepEqual(sources[0].evidence_ids, candidate.evidenceIds);
  return sources[0];
}

function assertContextProjection(data, expectedCurrent, expectedProposal, expectedStatus) {
  const candidate = contextCandidate(data);
  assert.deepEqual(candidate.currentValues, expectedCurrent);
  assert.deepEqual(candidate.proposedValues, expectedProposal);
  assert.equal(candidate.status, expectedStatus);
  assert.equal(candidate.teacherReview.state, expectedStatus);
  assert.equal(candidate.externalSend, false);
  return candidate;
}

function assertReceipt(result, before, after, decision, candidate) {
  const receipt = result.receipt;
  const expectedStatus = REVIEW_STATUS[decision];
  assert.equal(receipt.command_type, "review_teacher_context");
  assert.deepEqual(receipt.target, { target_kind: "teacher_context", target_id: candidate.contextId, command_type: "review_teacher_context" });
  assert.equal(receipt.decision, decision);
  assert.equal(receipt.status, expectedStatus);
  assert.equal(receipt.before_snapshot_id, snapshotPayload(before.snapshot).payload.snapshot_id);
  assert.equal(receipt.before_state_hash, snapshotPayload(before.snapshot).payload.state_hash);
  assert.equal(receipt.after_snapshot_id, snapshotPayload(after.snapshot).payload.snapshot_id);
  assert.equal(receipt.after_state_hash, snapshotPayload(after.snapshot).payload.state_hash);
  assert.equal(receipt.external_send, false);
  assert.equal(receipt.evidence_ids.includes(candidate.evidenceIds[0]), true);
}

function safeError(error) {
  const code = typeof error?.code === "string" ? error.code : null;
  const reason = code === "stale_snapshot" || code === "stale_revision"
    ? code
    : code === "configuration"
      ? "invalid bridge configuration"
      : "C2 E2 assertion failed";
  return { name: typeof error?.name === "string" ? error.name : "Error", code, phase, reason };
}

async function run() {
  const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
  assert.equal(typeof configuredCoreRoot, "string", "EDUPI_CORE_ROOT is required");
  assert.equal(path.isAbsolute(configuredCoreRoot), true, "EDUPI_CORE_ROOT must be an absolute path");
  const configuredRoot = fs.realpathSync(configuredCoreRoot);
  assert.equal(fs.statSync(configuredRoot).isDirectory(), true, "EDUPI_CORE_ROOT must be a directory");
  assert.equal(fs.statSync(path.join(configuredRoot, "scripts", "desktop_bridge_port.mjs")).isFile(), true, "fixed Core bridge entrypoint is missing");

  const temporaryParent = fs.realpathSync(os.tmpdir());
  temporaryDataRoot = fs.mkdtempSync(path.join(temporaryParent, "edupi-c2-e2-"));
  const memoryDir = path.join(temporaryDataRoot, ".edupi", "memory");
  const outputDir = path.join(temporaryDataRoot, ".edupi", "output");
  const lockDir = path.join(temporaryDataRoot, ".edupi", "locks");
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(lockDir, { recursive: true });

  // Set every Core/Desktop root before importing either runtime.
  process.env.EDUPI_CORE_ROOT = configuredRoot;
  process.env.EDUPI_CORE_ALLOWED_ROOT = path.dirname(configuredRoot);
  process.env.EDUPI_DATA_ROOT = temporaryDataRoot;
  process.env.EDUPI_DATA_ALLOWED_ROOT = temporaryParent;
  process.env.EDUPI_PROJECT_ROOT = temporaryDataRoot;
  process.env.EDUPI_MEMORY_DIR = memoryDir;
  process.env.EDUPI_OUTPUT_DIR = outputDir;
  process.env.EDUPI_LOCK_DIR = lockDir;
  process.env.EDUPI_HOME = path.join(temporaryDataRoot, ".edupi");
  process.env.HOME = temporaryDataRoot;

  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const desktopSnapshot = await jiti.import("../lib/edupi-core-snapshot.ts");
  const { activeBridgeIdentity } = await jiti.import("../lib/edupi-bridge-manifest.ts");
  phase = "desktop_pin";
  const identity = activeBridgeIdentity();
  const roots = desktopSnapshot.resolveEduPiBridgeRoots();
  assert.equal(roots.runtime.root, configuredRoot);
  assert.equal(roots.runtime.coreCommit, EXPECTED_CORE_COMMIT);
  assert.equal(roots.runtime.componentManifestHash, EXPECTED_COMPONENT_MANIFEST_HASH);
  assert.equal(identity.contract.schema_hash, EXPECTED_SCHEMA_HASH);
  assert.deepEqual(identity.contract.supported_commands, EXPECTED_COMMANDS);
  assert.deepEqual(identity.contract.supported_projections, EXPECTED_PROJECTIONS);

  const health = await desktopSnapshot.readEduPiCoreHealth({ roots, requestId: "c2-e2-health" });
  phase = "health";
  assert.equal(health.health.contract_version, "1.1");
  assert.equal(health.health.schema_hash, EXPECTED_SCHEMA_HASH);
  assert.deepEqual(health.health.supported_commands, EXPECTED_COMMANDS);
  assert.deepEqual(health.health.supported_projections, EXPECTED_PROJECTIONS);
  assert.equal(health.health.fixture_manifest_hash, identity.contract.fixture_manifest_hash);

  // Core producer import happens only after Desktop has validated the pin.
  const onboardingModule = await jiti.import(path.join(roots.runtime.root, "extensions", "onboarding.ts"));
  const { buildEducationContractFromWorkspace } = await jiti.import("../lib/edupi-education-contract.ts");
  const { buildTeacherContextReviewCommandEnvelope, issueTeacherContextReview } = await jiti.import("../lib/edupi-teacher-context-review.ts");
  const { callEduPiCore } = await jiti.import("../lib/edupi-core-process-client.ts");
  phase = "producer";
  const registerExtension = onboardingModule.default;

  // Same source/values: same instance and fresh extension registration are idempotent.
  phase = "capture_initial";
  const firstRegistration = registerOnboarding(registerExtension);
  const firstEntry = sourceEntry("c2-source-1", SOURCE_TEXT, 0);
  const firstContext = { sessionManager: { getBranch: () => [firstEntry] } };
  const firstParams = { ...INITIAL_VALUES, preferences: ["回答简洁", "保留来源"] };
  const firstCapture = await withCoreWriterAdmission(() => firstRegistration.setup.execute("synthetic-tool-call-1", firstParams, null, null, firstContext));
  const statePath = path.join(outputDir, "teacher_review_state.json");
  const bytesAfterInitialCapture = fs.readFileSync(statePath, "utf8");
  phase = "capture_initial_replay_same_instance";
  const sameInstanceReplay = await withCoreWriterAdmission(() => firstRegistration.setup.execute("synthetic-tool-call-1-replay", firstParams, null, null, firstContext));
  phase = "capture_initial_assertions";
  phase = "capture_initial_created";
  assert.equal(firstCapture.details?.context_id, "context_teacher");
  phase = "capture_initial_same_instance_idempotency";
  assert.equal(sameInstanceReplay.details?.context_id, "context_teacher");
  assert.equal(fs.readFileSync(statePath, "utf8"), bytesAfterInitialCapture);
  const freshCapture = await captureSetup(registerExtension, "c2-source-1", INITIAL_VALUES, ["回答简洁", "保留来源"], 0);
  phase = "capture_initial_fresh_registration_idempotency";
  assert.equal(freshCapture.result.details?.context_id, "context_teacher");
  assert.equal(fs.readFileSync(statePath, "utf8"), bytesAfterInitialCapture);
  phase = "capture_initial_source_shape";
  assert.equal(Object.hasOwn(firstEntry.message, "id"), false);
  assert.equal(firstEntry.id, "c2-source-1");

  async function readSnapshot(label) {
    phase = `snapshot_${label}`;
    const result = await desktopSnapshot.readEduPiEducationSnapshot({ roots, requestId: `c2-e2-${label}` });
    const data = projectSnapshot(result, buildEducationContractFromWorkspace, EXPECTED_COMMANDS, roots.dataRoot.root);
    assertCapabilities(result.payload);
    assertExternalSendDisabled(result.payload);
    return { snapshot: result, data };
  }

  let initial = await readSnapshot("initial");
  phase = "initial_counts_observations";
  assert.equal(initial.snapshot.payload.observations.length, 1);
  phase = "initial_counts_candidates";
  assert.equal(initial.snapshot.payload.memory_candidates.length, 1);
  phase = "initial_counts_memories";
  assert.equal(initial.snapshot.payload.memories.length, 0);
  phase = "initial_counts_receipts";
  assert.equal(initial.snapshot.payload.receipts.length, 0);
  phase = "initial_counts_history";
  assert.equal(initial.snapshot.payload.review_history.length, 0);
  phase = "initial_counts_targets";
  assert.equal(initial.snapshot.payload.review_targets.length, 3);
  assert.deepEqual(initial.snapshot.payload.review_targets.map((target) => target?.target?.target_kind).sort(), ["memory_candidate", "observation", "teacher_context"]);
  phase = "initial_preferences_category";
  assert.equal(initial.snapshot.payload.memory_candidates[0].category, "preferences");
  phase = "initial_context_projection";
  assertContextProjection(initial.data, {}, INITIAL_VALUES, "pending_review");
  phase = "initial_source_projection";
  const initialCandidate = contextCandidate(initial.data);
  assertActiveSource(initial.snapshot, initialCandidate, "c2-source-1");
  assertCanonicalStorage(temporaryDataRoot, memoryDir, outputDir);

  async function reviewCurrent(decision, patch, label) {
    const before = await readSnapshot(`${label}-before`);
    const candidate = contextCandidate(before.data);
    const input = {
      snapshot: before.snapshot.envelope,
      targetId: candidate.contextId,
      expectedSnapshotId: candidate.snapshotId,
      expectedRevision: candidate.revision,
      decision,
      patch,
      reviewerId: "c2-e2-teacher",
      issuedAt: FIXED_ISSUED_AT,
    };
    const result = await issueTeacherContextReview(input);
    const after = await readSnapshot(`${label}-after`);
    assertReceipt(result, before, after, decision, candidate);
    return { before, after, candidate, input, result };
  }

  phase = "accept";
  const accepted = await reviewCurrent("accept", null, "accept");
  const acceptedValues = { ...INITIAL_VALUES };
  assertContextProjection(accepted.after.data, acceptedValues, acceptedValues, "accepted");
  assertActiveSource(accepted.after.snapshot, contextCandidate(accepted.after.data), "c2-source-1");

  const bytesBeforeReplay = fs.readFileSync(path.join(outputDir, "teacher_review_state.json"), "utf8");
  phase = "replay";
  const replay = await issueTeacherContextReview(accepted.input);
  assert.equal(replay.receipt.receipt_id, accepted.result.receipt.receipt_id);
  assert.equal(fs.readFileSync(path.join(outputDir, "teacher_review_state.json"), "utf8"), bytesBeforeReplay);
  const replaySnapshot = await readSnapshot("replay");
  assert.deepEqual(replaySnapshot.data.teacherContextCandidates, accepted.after.data.teacherContextCandidates);

  phase = "hold_capture";
  await captureSetup(registerExtension, "c2-source-2", { subject: "科学" }, undefined, 1);
  phase = "hold";
  const held = await reviewCurrent("hold", null, "hold");
  const heldProposal = { ...acceptedValues, subject: "科学" };
  assertContextProjection(held.after.data, acceptedValues, heldProposal, "held");
  assertActiveSource(held.after.snapshot, contextCandidate(held.after.data), "c2-source-2");

  phase = "reject_capture";
  await captureSetup(registerExtension, "c2-source-3", { grade: "八年级" }, undefined, 2);
  phase = "reject";
  const rejected = await reviewCurrent("reject", null, "reject");
  const rejectedProposal = { ...acceptedValues, grade: "八年级" };
  assertContextProjection(rejected.after.data, acceptedValues, rejectedProposal, "rejected");
  assertActiveSource(rejected.after.snapshot, contextCandidate(rejected.after.data), "c2-source-3");

  phase = "modify_capture";
  await captureSetup(registerExtension, "c2-source-4", { name: "王老师" }, undefined, 3);
  phase = "modify";
  const modified = await reviewCurrent("modify", { name: "赵老师" }, "modify");
  const finalValues = { ...acceptedValues, name: "赵老师" };
  assertContextProjection(modified.after.data, finalValues, finalValues, "modified");
  assertActiveSource(modified.after.snapshot, contextCandidate(modified.after.data), "c2-source-4");

  // Stale snapshot and stale revision are rejected before a durable write.
  phase = "stale_snapshot";
  const bytesBeforeStaleSnapshot = fs.readFileSync(statePath, "utf8");
  let staleSnapshotCode = null;
  try {
    await issueTeacherContextReview({
      snapshot: initial.snapshot.envelope,
      targetId: initialCandidate.contextId,
      expectedSnapshotId: initialCandidate.snapshotId,
      expectedRevision: initialCandidate.revision,
      decision: "hold",
      patch: null,
      reviewerId: "c2-e2-teacher",
      issuedAt: FIXED_ISSUED_AT,
    });
  } catch (error) {
    staleSnapshotCode = error?.code || null;
  }
  phase = "stale_snapshot_code";
  assert.equal(staleSnapshotCode, "stale_snapshot");
  phase = "stale_snapshot_no_write";
  assert.equal(fs.readFileSync(statePath, "utf8"), bytesBeforeStaleSnapshot);

  phase = "restart";
  const final = await readSnapshot("restart");
  const finalCandidate = contextCandidate(final.data);
  phase = "stale_revision";
  const bytesBeforeStaleRevision = fs.readFileSync(statePath, "utf8");
  const rawStaleRevisionCommand = buildTeacherContextReviewCommandEnvelope({
    snapshot: final.snapshot.envelope,
    targetId: finalCandidate.contextId,
    expectedSnapshotId: finalCandidate.snapshotId,
    expectedRevision: finalCandidate.revision,
    decision: "hold",
    patch: null,
    reviewerId: "c2-e2-teacher",
    issuedAt: FIXED_ISSUED_AT,
  });
  rawStaleRevisionCommand.command.expected_revision = finalCandidate.revision > 0 ? finalCandidate.revision - 1 : finalCandidate.revision + 1;
  const rawStaleRevision = await callEduPiCore({
    operation: "command",
    requestId: "c2-e2-raw-stale-revision",
    runtime: roots.runtime,
    dataRoot: roots.dataRoot,
    envelope: rawStaleRevisionCommand,
  });
  assert.equal(rawStaleRevision.ok, true);
  assert.equal(rawStaleRevision.receipt.payload.command_type, "review_teacher_context");
  assert.deepEqual(rawStaleRevision.receipt.payload.target, { target_kind: "teacher_context", target_id: finalCandidate.contextId, command_type: "review_teacher_context" });
  assert.equal(rawStaleRevision.receipt.payload.status, "failed");
  assert.equal(rawStaleRevision.receipt.payload.reason_code, "stale_revision");
  assert.equal(rawStaleRevision.receipt.payload.before_snapshot_id, final.snapshot.payload.snapshot_id);
  assert.equal(rawStaleRevision.receipt.payload.before_state_hash, final.snapshot.payload.state_hash);
  assert.equal(rawStaleRevision.receipt.payload.after_snapshot_id, null);
  assert.equal(rawStaleRevision.receipt.payload.after_state_hash, null);
  assert.equal(rawStaleRevision.receipt.payload.external_send, false);
  assert.equal(rawStaleRevision.receipt.payload.evidence_ids.includes(finalCandidate.evidenceIds[0]), true);
  assert.equal(fs.readFileSync(statePath, "utf8"), bytesBeforeStaleRevision);
  let staleRevisionCode = null;
  try {
    await issueTeacherContextReview({
      snapshot: final.snapshot.envelope,
      targetId: finalCandidate.contextId,
      expectedSnapshotId: finalCandidate.snapshotId,
      expectedRevision: finalCandidate.revision + 1,
      decision: "hold",
      patch: null,
      reviewerId: "c2-e2-teacher",
      issuedAt: FIXED_ISSUED_AT,
    });
  } catch (error) {
    staleRevisionCode = error?.code || null;
  }
  assert.equal(staleRevisionCode, "stale_revision");
  assert.equal(fs.readFileSync(statePath, "utf8"), bytesBeforeStaleRevision);

  phase = "final_assertions";
  assert.equal(final.snapshot.payload.observations.length, 1);
  assert.equal(final.snapshot.payload.memory_candidates.length, 1);
  assert.equal(final.snapshot.payload.memory_candidates[0].category, "preferences");
  assert.equal(final.snapshot.payload.review_targets.length, 3);
  assert.deepEqual(final.snapshot.payload.review_targets.map((target) => target?.target?.target_kind).sort(), ["memory_candidate", "observation", "teacher_context"]);
  assert.equal(final.snapshot.payload.memories.length, 0);
  assert.equal(final.snapshot.payload.receipts.length, 4);
  assert.equal(final.snapshot.payload.review_history.length, 4);
  assert.equal(final.data.teacherContextCandidates.length, 1);
  assert.equal(final.data.teacherContextReceipts.length, 4);
  assert.equal(final.data.teacherContextReviewHistory.length, 4);
  assert.equal(final.data.receipts.length, 0);
  assert.equal(final.data.reviewHistory.length, 0);
  assert.deepEqual(finalCandidate.currentValues, finalValues);
  assert.deepEqual(finalCandidate.proposedValues, finalValues);
  assert.equal(finalCandidate.status, "modified");
  assert.equal(final.data.memoryCandidates.length, 1);
  assert.equal(final.data.memoryCandidates[0].category, "preferences");
  assert.equal(final.data.memoryCandidates[0].externalSend, false);
  assertActiveSource(final.snapshot, finalCandidate, "c2-source-4");
  assertExternalSendDisabled(final.snapshot.payload);
  assertCanonicalStorage(temporaryDataRoot, memoryDir, outputDir);

  return {
    status: "GREEN",
    pin: {
      core_commit: roots.runtime.coreCommit,
      component_manifest_hash: roots.runtime.componentManifestHash,
      schema_hash: identity.contract.schema_hash,
    },
    counts: {
      context_targets: final.data.teacherContextCandidates.length,
      preference_candidates: final.data.memoryCandidates.filter((item) => item.category === "preferences").length,
      context_receipts: final.data.teacherContextReceipts.length,
      context_history: final.data.teacherContextReviewHistory.length,
      memories: final.snapshot.payload.memories.length,
    },
    decisions: ["accept", "hold", "reject", "modify"],
    final_canonical: finalCandidate.currentValues,
    active_source_id: finalCandidate.sourceIds[0],
    idempotency_replay: true,
    restart_reload: true,
    stale_snapshot_no_write: true,
    stale_revision_no_write: true,
    raw_stale_revision_bridge: true,
    external_send: false,
    canonical_store: ".edupi/output/teacher_review_state.json",
  };
}

timeoutHandle = setTimeout(() => {
  restoreEnvironment();
  cleanup();
  console.error(JSON.stringify({ status: "RED", phase: "hard_timeout", reason: "C2 E2 verifier exceeded 60 seconds" }));
  process.exit(1);
}, HARD_TIMEOUT_MS);

try {
  console.log(JSON.stringify(await run(), null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "RED", error: safeError(error) }, null, 2));
  process.exitCode = 1;
} finally {
  if (timeoutHandle) clearTimeout(timeoutHandle);
  restoreEnvironment();
  cleanup();
}
