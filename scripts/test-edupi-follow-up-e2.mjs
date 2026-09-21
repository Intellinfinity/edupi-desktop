#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const coreRootValue = process.env.EDUPI_CORE_ROOT;
if (typeof coreRootValue !== "string" || !path.isAbsolute(coreRootValue)) throw new Error("EDUPI_CORE_ROOT must be an absolute Core checkout");
const coreRoot = fs.realpathSync(coreRootValue);
const desktopRoot = path.resolve(new URL("..", import.meta.url).pathname);
const dataRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-desktop-follow-up-e2-")));
const home = path.join(dataRoot, ".edupi");
const memoryDir = path.join(home, "memory");
const outputDir = path.join(home, "output");
const lockDir = path.join(home, "locks");
for (const directory of [memoryDir, outputDir, lockDir]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

const environmentKeys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_CORE_ALLOWED_ROOT", "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT"];
const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  EDUPI_PROJECT_ROOT: dataRoot,
  EDUPI_DATA_ROOT: dataRoot,
  EDUPI_DATA_ALLOWED_ROOT: path.dirname(dataRoot),
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: memoryDir,
  EDUPI_OUTPUT_DIR: outputDir,
  EDUPI_LOCK_DIR: lockDir,
  EDUPI_CORE_COMMIT: "368bcd8b6fbe04d78860c96c37f27bec312c8e4c",
});

let admission;
try {
  const admissionModule = await import(path.join(coreRoot, "scripts/core_runtime_writer_admission.mjs"));
  const rootModule = await import(path.join(coreRoot, "scripts/core_runtime_root.mjs"));
  admission = await admissionModule.acquireCoreRuntimeWriterAdmission({ root: rootModule.prepareCoreRuntimeRoot(dataRoot), kind: "legacy_desktop_followup_e2e" });
  const factStore = await import(`${pathToFile(coreRoot, "scripts/education_fact_store.mjs")}?followup-e2e=${Date.now()}`);
  const compiler = await import(`${pathToFile(coreRoot, "scripts/g2_fact_compiler.mjs")}?followup-e2e=${Date.now()}`);
  const planner = await import(`${pathToFile(coreRoot, "scripts/student_followup_planner.mjs")}?followup-e2e=${Date.now()}`);
  const now = "2026-09-20T03:00:00.000Z";
  const student = factStore.registerEducationEntity({
    memoryDir,
    now,
    entity: { entity_kind: "student", namespace: "school-roster", external_id: "desktop-e2e-student", canonical_name: "林晓", aliases: [] },
  }).entity;
  const roster = [{ student_id: student.entity_id, name: student.canonical_name, aliases: [] }];
  const compilation = compiler.compileG2Utterance({
    memoryDir,
    now,
    message: { source_id: "desktop-followup-e2e", source_revision: "1", raw_text: "林晓移项时仍会漏写负号。", observed_at: now, actor_ref: "teacher-e2e" },
    roster,
    model_result: {
      status: "ok",
      candidates: [{ mention: "林晓", fact_kind: "error_pattern", predicate: "observed_sign_error", value: "移项漏写负号", evidence_quote: "林晓移项时仍会漏写负号", confidence: 1 }],
      unresolved: [],
      external_send: false,
    },
  });
  const planned = planner.planStudentFollowUps({ compilation, roster, scope: { class_id: "class-7b", subject: "math" }, source_ref: "owner_message:desktop-followup-e2e", source_revision: "1", audience: "teacher_internal", now });
  assert.equal(planned.follow_ups.length, 1);
  await admission.release();
  admission = null;

  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const snapshot = await jiti.import(path.join(desktopRoot, "lib/edupi-core-snapshot.ts"));
  const review = await jiti.import(path.join(desktopRoot, "lib/edupi-follow-up-review.ts"));
  const before = await snapshot.readEduPiEducationSnapshot({ requestId: "desktop-followup-e2-before" });
  const target = before.payload.review_targets.find((item) => item?.projection_kind === "follow_up");
  assert.ok(target, "Core snapshot must expose the follow-up target");
  const result = await review.issueFollowUpReview({
    snapshot: before.envelope,
    targetId: target.target.target_id,
    expectedSnapshotId: before.payload.snapshot_id,
    expectedRevision: target.revision,
    decision: "accept",
    reviewerId: "teacher-e2",
    issuedAt: "2026-09-20T04:00:00.000Z",
  });
  assert.equal(result.receipt.command_type, "review_follow_up");
  assert.equal(result.receipt.status, "accepted");
  assert.equal(result.receipt.external_send, false);
  const after = await snapshot.readEduPiEducationSnapshot({ requestId: "desktop-followup-e2-after" });
  const accepted = after.payload.review_targets.find((item) => item?.target?.target_id === target.target.target_id);
  assert.equal(accepted?.status, "accepted");
  assert.equal(accepted?.external_send, false);
  console.log(JSON.stringify({ status: "passed", target_id: target.target.target_id, initial_status: target.status, final_status: accepted.status, external_send: false, core_commit: after.payload.core_commit }, null, 2));
} finally {
  if (admission) await admission.release().catch(() => {});
  fs.rmSync(dataRoot, { recursive: true, force: true });
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function pathToFile(root, relative) {
  return new URL(relative, `file://${root}/`).href;
}
