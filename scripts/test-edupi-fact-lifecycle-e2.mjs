#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.ok(configuredCoreRoot && path.isAbsolute(configuredCoreRoot), "EDUPI_CORE_ROOT is required");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-fact-lifecycle-e2-")));
const memoryDir = path.join(root, ".edupi", "memory");
const outputDir = path.join(root, ".edupi", "output");
const lockDir = path.join(root, ".edupi", "locks");
const home = path.join(root, "profile");
for (const directory of [memoryDir, outputDir, lockDir, path.join(home, ".pi", "agent")]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
Object.assign(process.env, { HOME: home, PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"), EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot), EDUPI_CORE_VALIDATION_MODE: "external", EDUPI_PROJECT_ROOT: root, EDUPI_DATA_ROOT: root, EDUPI_DATA_ALLOWED_ROOT: path.dirname(root), EDUPI_HOME: path.join(root, ".edupi"), EDUPI_MEMORY_DIR: memoryDir, EDUPI_OUTPUT_DIR: outputDir, EDUPI_LOCK_DIR: lockDir });
const [{ prepareCoreRuntimeRoot }, { acquireCoreRuntimeWriterAdmission }, store] = await Promise.all([
  import(path.join(coreRoot, "scripts", "core_runtime_root.mjs")),
  import(path.join(coreRoot, "scripts", "core_runtime_writer_admission.mjs")),
  import(path.join(coreRoot, "scripts", "education_fact_store.mjs")),
]);
const now = "2026-09-15T02:00:00.000Z";
const rosterStudentId = "student-fact-lifecycle-e2";
let entity;
let first;

async function admitted(kind, fn) {
  const admission = await acquireCoreRuntimeWriterAdmission({ root: prepareCoreRuntimeRoot(root), kind, busyTimeoutMs: 1_000 });
  try { return await fn(); } finally { await admission.release(); }
}

function propose(sourceId, rawText, value, factKind = "error_pattern") {
  const observation = store.captureEducationObservation({ memoryDir, now, observation: { source_kind: "teacher_utterance", source_id: sourceId, source_revision: "1", raw_text: rawText, observed_at: now, actor_ref: "teacher", entity_ids: [entity.entity_id] } }).observation;
  return store.proposeEducationFact({ memoryDir, now, fact: { entity_id: entity.entity_id, fact_kind: factKind, predicate: "math.equation.transposition", value, confidence: { basis: "explicit", score: 1 }, source_ids: [sourceId], observation_ids: [observation.observation_id], subject_ref: "数学", topic_ref: "移项" } }).fact;
}

await admitted("legacy_fact_lifecycle_e2_setup", () => {
  entity = store.registerEducationEntity({ memoryDir, now, entity: { entity_kind: "student", namespace: "school-roster", external_id: rosterStudentId, canonical_name: "林晓", aliases: [] } }).entity;
  fs.writeFileSync(path.join(memoryDir, "student_profiles.json"), JSON.stringify({ students: { 林晓: { student_id: rosterStudentId, name: "林晓", class_name: "703", traits: [], parent_notes: [], error_patterns: [], trajectory: [], created_at: now, updated_at: now } }, updated_at: now }));
  first = propose("fact-e2-source-1", "林晓移项时容易忘记变号。", "移项符号仍需练习");
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false });
const factRoute = await jiti.import("../app/api/edupi/facts/[factId]/route.ts");
const deletedRoute = await jiti.import("../app/api/edupi/facts/deleted/route.ts");
const educationRoute = await jiti.import("../app/api/edupi/education/route.ts");
const params = (factId) => ({ params: Promise.resolve({ factId }) });
const request = (factId, body) => new Request(`http://localhost/api/edupi/facts/${factId}`, { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) });
const mutate = async (factId, body, expectedStatus = 200) => {
  const response = await factRoute.POST(request(factId, body), params(factId));
  const result = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(result));
  return result;
};

try {
  const initial = await (await educationRoute.GET()).json();
  assert.equal(initial.factSpine.factCandidates.some((fact) => fact.id === first.fact_id), true);
  assert.equal(initial.factSpine.studentViews[0].pendingFactIds.includes(first.fact_id), true);

  const accepted = await mutate(first.fact_id, { action: "review", expectedRevision: first.revision, decision: "accept", reviewer: "teacher", note: null, supersedesFactId: null, supersedesFactRevision: null });
  assert.equal(accepted.data.factSpine.acceptedFacts.some((fact) => fact.id === first.fact_id), true);
  assert.equal(accepted.data.factSpine.teachingView.acceptedFactIds.includes(first.fact_id), true);

  let second;
  let firstCurrent;
  await admitted("legacy_fact_lifecycle_e2_conflict", () => {
    second = propose("fact-e2-source-2", "林晓复测后已经掌握移项变号。", "移项符号已经掌握", "progress");
    firstCurrent = store.loadEducationFactState({ memoryDir }).facts.find((fact) => fact.fact_id === first.fact_id);
  });
  const stale = await mutate(second.fact_id, { action: "review", expectedRevision: second.revision, decision: "accept", reviewer: "teacher", note: null, supersedesFactId: first.fact_id, supersedesFactRevision: firstCurrent.revision - 1 }, 409);
  assert.equal(stale.code, "stale_fact");
  const replaced = await mutate(second.fact_id, { action: "review", expectedRevision: second.revision, decision: "accept", reviewer: "teacher", note: null, supersedesFactId: first.fact_id, supersedesFactRevision: firstCurrent.revision });
  assert.equal(replaced.data.factSpine.acceptedFacts.some((fact) => fact.id === second.fact_id), true);
  assert.equal(replaced.data.factSpine.acceptedFacts.some((fact) => fact.id === first.fact_id), false);

  const modified = await mutate(second.fact_id, { action: "modify", expectedRevision: replaced.result.revision, replacementValue: "移项符号基本掌握", reviewer: "teacher", note: "复测修订" });
  const modifiedId = modified.result.resultFactId;
  assert.notEqual(modifiedId, second.fact_id);
  const projected = modified.data.factSpine.acceptedFacts.find((fact) => fact.id === modifiedId);
  assert.equal(projected.value, "移项符号基本掌握");
  assert.deepEqual(projected.sourceIds, ["fact-e2-source-2"]);
  assert.equal(modified.data.factSpine.studentViews[0].acceptedFactIds.includes(modifiedId), true);
  assert.equal(modified.data.factSpine.teachingView.acceptedFactIds.includes(modifiedId), true);

  const deleted = await mutate(modifiedId, { action: "delete", expectedRevision: modified.result.revision, reviewer: "teacher" });
  assert.equal(deleted.data.factSpine.acceptedFacts.some((fact) => fact.id === modifiedId), false);
  const deletedResponse = await deletedRoute.GET(new Request("http://localhost/api/edupi/facts/deleted?offset=0&limit=20", { headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin" } }));
  const deletedPage = await deletedResponse.json();
  assert.equal(deletedResponse.status, 200, JSON.stringify(deletedPage));
  assert.equal(deletedPage.facts.some((fact) => fact.factId === modifiedId && fact.deletedPreviousStatus === "accepted"), true);

  const restored = await mutate(modifiedId, { action: "restore", expectedRevision: deleted.result.revision, reviewer: "teacher", supersedesFactId: null, supersedesFactRevision: null });
  assert.equal(restored.data.factSpine.acceptedFacts.some((fact) => fact.id === modifiedId), true);
  const reloaded = await (await educationRoute.GET()).json();
  assert.equal(reloaded.factSpine.acceptedFacts.some((fact) => fact.id === modifiedId && fact.value === "移项符号基本掌握"), true);
  assert.equal(reloaded.factSpine.observations.some((observation) => observation.sourceId === "fact-e2-source-2" && observation.text === "林晓复测后已经掌握移项变号。"), true);
  console.log(JSON.stringify({ status: "passed", candidate_review: true, stale_superseder_rejected: true, conflict_replaced: true, modified_identity: true, student_teaching_sync: true, delete_restore: true, restart_read: true, source_preserved: true, external_send: false }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
