#!/usr/bin/env node

/**
 * Verify that a real source-bound Chat message reaches Core C1 through the
 * pinned perception extension, without touching the user's EduPi data.
 *
 * Run with a pinned Core checkout:
 *   EDUPI_CORE_ROOT=/absolute/path/to/edupi npm run test:edupi-chat-capture-e2
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HARD_TIMEOUT_MS = 30_000;
const EXPECTED_COMMANDS = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"];
const SOURCE_MESSAGE_ID = "chat-entry-c1-e2";
const OBSERVED_AT = "2026-08-28T09:00:00.000Z";
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
];
const previousEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

let temporaryDataRoot = null;
let writerAdmission = null;

function restoreEnvironment() {
  for (const [key, value] of previousEnv) {
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

function redactedError(error) {
  return {
    name: typeof error?.name === "string" ? error.name : "Error",
    code: typeof error?.code === "string" ? error.code : null,
  };
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

function assertNoLegacyDualWrite(memoryDir, outputDir) {
  assert.equal(fs.existsSync(path.join(outputDir, "auto_actions.json")), false);
  for (const name of ["class.json", "teaching.json", "semester.json", "preferences.json", "school.json"]) {
    assert.equal(fs.existsSync(path.join(memoryDir, name)), false, `legacy memory write: ${name}`);
  }
}

function registerPerceptionHandlers(registerExtension) {
  const handlers = new Map();
  registerExtension({
    on(name, handler) {
      handlers.set(name, handler);
    },
  });
  const context = handlers.get("context");
  const turnEnd = handlers.get("turn_end");
  assert.equal(typeof context, "function");
  assert.equal(typeof turnEnd, "function");
  return { context, turnEnd };
}

async function run() {
  const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
  assert.equal(typeof configuredCoreRoot, "string", "EDUPI_CORE_ROOT is required");
  assert.equal(path.isAbsolute(configuredCoreRoot), true, "EDUPI_CORE_ROOT must be an absolute path");

  const coreRoot = fs.realpathSync(configuredCoreRoot);
  const coreAllowedRoot = fs.realpathSync(path.dirname(coreRoot));
  const temporaryParent = fs.realpathSync(os.tmpdir());
  temporaryDataRoot = fs.mkdtempSync(path.join(temporaryParent, "edupi-chat-capture-e2-"));
  const memoryDir = path.join(temporaryDataRoot, ".edupi", "memory");
  const outputDir = path.join(temporaryDataRoot, ".edupi", "output");
  const lockDir = path.join(temporaryDataRoot, ".edupi", "locks");
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(lockDir, { recursive: true });

  // Every Core and Desktop path is explicit before either runtime is imported.
  process.env.EDUPI_CORE_ROOT = coreRoot;
  process.env.EDUPI_CORE_ALLOWED_ROOT = coreAllowedRoot;
  process.env.EDUPI_DATA_ROOT = temporaryDataRoot;
  process.env.EDUPI_DATA_ALLOWED_ROOT = temporaryParent;
  process.env.EDUPI_PROJECT_ROOT = temporaryDataRoot;
  process.env.EDUPI_MEMORY_DIR = memoryDir;
  process.env.EDUPI_OUTPUT_DIR = outputDir;
  process.env.EDUPI_LOCK_DIR = lockDir;
  process.env.EDUPI_HOME = path.join(temporaryDataRoot, ".edupi");

  const { prepareCoreRuntimeRoot } = await import(path.join(coreRoot, "scripts", "core_runtime_root.mjs"));
  const { acquireCoreRuntimeWriterAdmission } = await import(path.join(coreRoot, "scripts", "core_runtime_writer_admission.mjs"));
  const preparedRoot = prepareCoreRuntimeRoot(temporaryDataRoot);
  assert.equal(preparedRoot.ok, true, JSON.stringify(preparedRoot));
  writerAdmission = await acquireCoreRuntimeWriterAdmission({ root: preparedRoot, kind: "legacy_chat_capture_e2", busyTimeoutMs: 250 });

  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const desktopSnapshot = await jiti.import("../lib/edupi-core-snapshot.ts");

  // Resolve first: this checks the exact pinned commit and component manifest
  // before any Core extension code is loaded.
  const roots = desktopSnapshot.resolveEduPiBridgeRoots();
  assert.equal(roots.runtime.root, coreRoot);
  assert.equal(roots.dataRoot.root, temporaryDataRoot);

  const perceptionModule = await jiti.import(path.join(roots.runtime.root, "extensions", "perception_l4.ts"));
  assert.equal(typeof perceptionModule.default, "function");

  const text = "七年级二班小林连续第三次解方程时又错了移项符号，下一节课先复习再观察。";
  const chatMessage = {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: OBSERVED_AT,
    subject: "math",
    class_id: "class-7b",
  };
  const branch = [{
    type: "message",
    id: SOURCE_MESSAGE_ID,
    parentId: null,
    message: chatMessage,
  }];
  const context = {
    sessionManager: { getBranch: () => branch },
    teacher_context: { subject: "math", class_id: "class-7b" },
  };
  const contextEvent = { messages: [chatMessage], teacher_context: context.teacher_context };

  assert.equal(Object.hasOwn(chatMessage, "id"), false);
  assert.equal(branch[0].id, SOURCE_MESSAGE_ID);
  assert.equal(Object.hasOwn(branch[0].message, "id"), false);

  const firstHandlers = registerPerceptionHandlers(perceptionModule.default);

  // Repeated events in one extension instance exercise its in-memory guard.
  await firstHandlers.context(contextEvent, context);
  await firstHandlers.context(contextEvent, context);
  await firstHandlers.turnEnd({ toolResults: [] }, context);

  // A fresh registration resets the extension guard while retaining the
  // isolated on-disk store, proving restart-style capture idempotency.
  const replayHandlers = registerPerceptionHandlers(perceptionModule.default);
  await replayHandlers.context(contextEvent, context);
  await replayHandlers.turnEnd({ toolResults: [] }, context);

  const snapshotResult = await desktopSnapshot.readEduPiEducationSnapshot({
    requestId: "chat-capture-c1-e2",
    roots,
  });
  const payload = snapshotResult.payload;
  assert.equal(payload.observations.length, 1);
  assert.equal(payload.memory_candidates.length, 1);
  assert.equal(payload.memories.length, 0);
  assert.deepEqual(payload.capabilities.supported_commands, EXPECTED_COMMANDS);
  assert.equal(payload.capabilities.external_send_enabled, false);
  assert.equal(payload.education_workspace.external_send, false);
  assert.equal(payload.education_workspace.requires_teacher_review, true);
  assert.equal(payload.review_targets.length, 2);
  assert.equal(payload.review_targets.every((target) => target.status === "pending_review"), true);

  const observation = payload.observations[0];
  const candidate = payload.memory_candidates[0];
  assert.equal(observation.teacher_review.state, "pending_review");
  assert.equal(candidate.teacher_review.state, "pending_review");
  assert.equal(observation.provenance[0].source_kind, "teacher_message");
  assert.equal(observation.provenance[0].source_id, SOURCE_MESSAGE_ID);
  assert.equal(candidate.based_on_observation_ids[0], observation.observation_id);
  assertExternalSendDisabled(payload);
  assertNoLegacyDualWrite(memoryDir, outputDir);

  return {
    status: "GREEN",
    pin: {
      core_commit: roots.runtime.coreCommit.slice(0, 12),
      component_manifest_hash: roots.runtime.componentManifestHash.slice(0, 19),
    },
    counts: {
      observations: payload.observations.length,
      candidates: payload.memory_candidates.length,
      memories: payload.memories.length,
    },
    source_id: SOURCE_MESSAGE_ID,
    external_send: false,
  };
}

const timeoutHandle = setTimeout(() => {
  restoreEnvironment();
  cleanup();
  console.error(JSON.stringify({ status: "RED", error: "hard_timeout" }));
  process.exit(1);
}, HARD_TIMEOUT_MS);

try {
  console.log(JSON.stringify(await run(), null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "RED", error: redactedError(error) }, null, 2));
  process.exitCode = 1;
} finally {
  clearTimeout(timeoutHandle);
  await writerAdmission?.release().catch(() => {});
  writerAdmission = null;
  restoreEnvironment();
  cleanup();
}
