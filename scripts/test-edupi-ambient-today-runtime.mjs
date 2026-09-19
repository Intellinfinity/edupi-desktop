#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
if (!configuredCoreRoot || !path.isAbsolute(configuredCoreRoot)) {
  console.log(JSON.stringify({ status: "skipped", reason: "EDUPI_CORE_ROOT is not configured" }));
  process.exit(0);
}

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const requestedDataRoot = process.env.EDUPI_AMBIENT_TODAY_RUNTIME_DATA_ROOT;
const temporaryRoot = requestedDataRoot
  ? path.resolve(requestedDataRoot)
  : fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-ambient-today-runtime-")));
fs.mkdirSync(temporaryRoot, { recursive: true });
const dataRootPath = path.join(temporaryRoot, "data");
for (const directory of [".edupi/memory", ".edupi/output", ".edupi/locks"]) {
  fs.mkdirSync(path.join(dataRootPath, directory), { recursive: true });
}

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { activeBridgeIdentity } = await jiti.import(path.join(desktopRoot, "lib", "edupi-bridge-manifest.ts"));
const { resolveEduPiCoreRoot, resolveEduPiDataRoot } = await jiti.import(path.join(desktopRoot, "lib", "edupi-core-root.ts"));
const { ensureEduPiRuntime } = await jiti.import(path.join(desktopRoot, "lib", "edupi-runtime-supervisor.ts"));
const { prepareCoreRuntimeRoot } = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_root.mjs")));
const { acquireCoreRuntimeWriterAdmission } = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_writer_admission.mjs")));
const { createAmbientPlanningStore } = await import(pathToFileURL(path.join(coreRoot, "scripts/ambient_planning_store.mjs")));
const { applyPlanningGoalCommand, applyPlanningEvent, initializePlanningState } = await import(pathToFileURL(path.join(coreRoot, "scripts/ambient_planning_engine.mjs")));

const now = new Date().toISOString();
const scope = { class_id: "class-7-1", subject: "math" };
const goal = {
  id: "goal-ambient-today", text: "Ambient preparation goal", scope,
  starts_at: new Date(Date.now() - 3_600_000).toISOString(),
  ends_at: new Date(Date.now() + 86_400_000).toISOString(),
  success_condition: "Materials are ready", allowed_actions: ["prepare", "update"],
  budget: { max_calls: 12 }, prepare_hours: 24, escalate_hours: 2,
};
const lesson = {
  id: "event-ambient-lesson", source_id: "source-ambient-lesson", revision: 1,
  occurred_at: now, received_at: now, kind: "lesson", scope,
  payload: { lesson_id: "ambient-lesson", starts_at: new Date(Date.now() + 7_200_000).toISOString(), status: "scheduled", material_id: "ambient-material" },
};
const material = {
  ...lesson, id: "event-ambient-material", source_id: "source-ambient-material", kind: "material",
  payload: { lesson_id: "ambient-lesson", material_id: "ambient-material", status: "accepted" },
};

let handle;
try {
  const preparedDataRoot = prepareCoreRuntimeRoot(dataRootPath);
  const admission = await acquireCoreRuntimeWriterAdmission({ root: preparedDataRoot, kind: "legacy_ambient_today_runtime_test" });
  try {
    const planningStore = createAmbientPlanningStore({ root: preparedDataRoot });
    let state = applyPlanningGoalCommand(initializePlanningState(), { action: "create", goal_id: goal.id, goal, at: now });
    state = applyPlanningEvent(state, lesson);
    state = applyPlanningEvent(state, material);
    planningStore.transact(() => state);
  } finally {
    await admission.release();
  }

  process.env.EDUPI_AMBIENT_PLANNING = "1";
  const identity = activeBridgeIdentity();
  const runtime = resolveEduPiCoreRoot({
    configuredRoot: coreRoot,
    allowedRoot: path.dirname(coreRoot),
    runtimeIdentity: identity.runtime,
    validationMode: "external",
  });
  const dataRoot = resolveEduPiDataRoot({ configuredRoot: dataRootPath, allowedRoot: temporaryRoot });
  handle = await ensureEduPiRuntime({ runtime, dataRoot });
  const response = await handle.callBridge({
    protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop",
    request_id: "ambient-today-runtime", operation: "snapshot",
  });
  const bridge = JSON.parse(response.result.bridge_frame);
  const preparation = bridge.envelope.payload.education_workspace.l4_preparation;
  assert.equal(bridge.ok, true);
  assert.equal(preparation.goals[0].id, goal.id);
  assert.equal(preparation.opportunities.length, 1);
  assert.equal(preparation.opportunities[0].action, "act");
  assert.equal(preparation.decisions[0].apply, false);
  assert.equal(preparation.external_send, false);
  console.log(JSON.stringify({
    status: "passed", core_commit: runtime.coreCommit, goals: preparation.goals.length,
    opportunities: preparation.opportunities.length, external_send: false,
  }, null, 2));
} finally {
  delete process.env.EDUPI_AMBIENT_PLANNING;
  await handle?.close();
  if (!requestedDataRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
