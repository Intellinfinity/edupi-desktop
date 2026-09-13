#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.ok(configuredCoreRoot && path.isAbsolute(configuredCoreRoot), "EDUPI_CORE_ROOT is required");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-fact-identity-e2-")));
const memoryDir = path.join(root, ".edupi", "memory");
const outputDir = path.join(root, ".edupi", "output");
const lockDir = path.join(root, ".edupi", "locks");
const home = path.join(root, "home");
for (const directory of [memoryDir, outputDir, lockDir, path.join(home, ".pi", "agent")]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
Object.assign(process.env, { HOME: home, PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"), EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot), EDUPI_CORE_VALIDATION_MODE: "external", EDUPI_PROJECT_ROOT: root, EDUPI_DATA_ROOT: root, EDUPI_DATA_ALLOWED_ROOT: path.dirname(root), EDUPI_HOME: path.join(root, ".edupi"), EDUPI_MEMORY_DIR: memoryDir, EDUPI_OUTPUT_DIR: outputDir, EDUPI_LOCK_DIR: lockDir });
const { prepareCoreRuntimeRoot } = await import(path.join(coreRoot, "scripts", "core_runtime_root.mjs"));
const { acquireCoreRuntimeWriterAdmission } = await import(path.join(coreRoot, "scripts", "core_runtime_writer_admission.mjs"));
const store = await import(path.join(coreRoot, "scripts", "education_fact_store.mjs"));
const now = "2026-09-14T03:00:00.000Z";
const rosterStudentId = "student-roster-e2";
const admission = await acquireCoreRuntimeWriterAdmission({ root: prepareCoreRuntimeRoot(root), kind: "legacy_fact_identity_e2", busyTimeoutMs: 1_000 });
let entity;
try {
  entity = store.registerEducationEntity({ memoryDir, now, entity: { entity_kind: "student", namespace: "school-roster", external_id: rosterStudentId, canonical_name: "林晓", aliases: [] } }).entity;
  fs.writeFileSync(path.join(memoryDir, "student_profiles.json"), JSON.stringify({ students: { 林晓: { student_id: rosterStudentId, name: "林晓", class_name: "703", traits: [], parent_notes: [], error_patterns: [], trajectory: [], created_at: now, updated_at: now } }, updated_at: now }));
  const observation = store.captureEducationObservation({ memoryDir, now, observation: { source_kind: "teacher_utterance", source_id: "fact-identity-session", source_revision: "message-1", raw_text: "林晓移项时容易忘记变号。", observed_at: now, actor_ref: "teacher", entity_ids: [entity.entity_id] } }).observation;
  const candidate = store.proposeEducationFact({ memoryDir, now, fact: { entity_id: entity.entity_id, fact_kind: "error_pattern", predicate: "math.equation.transposition", value: "移项符号仍需练习", confidence: { basis: "explicit", score: 1 }, source_ids: [observation.source_id], observation_ids: [observation.observation_id], subject_ref: "数学", topic_ref: "方程", review_required: false } }).fact;
  store.reviewEducationFact({ memoryDir, now, fact_id: candidate.fact_id, expected_revision: candidate.revision, decision: "accept", reviewer: "teacher" });
} finally { await admission.release(); }

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const { GET } = await jiti.import("../app/api/edupi/education/route.ts");
const { factEntityIdForRosterStudent } = await jiti.import("../lib/edupi-education-contract.ts");
const { EduPiStudentFacts } = await jiti.import("../components/EduPiStudentFacts.tsx");
try {
  const response = await GET();
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.students[0].student_id, rosterStudentId);
  assert.notEqual(entity.entity_id, rosterStudentId);
  assert.equal(factEntityIdForRosterStudent(data.factSpine, rosterStudentId), entity.entity_id);
  assert.deepEqual(data.factSpine.entities.find((item) => item.id === entity.entity_id).externalRefs, [{ namespace: "school-roster", externalId: rosterStudentId }]);
  const html = renderToStaticMarkup(React.createElement(EduPiStudentFacts, { factSpine: data.factSpine, studentId: rosterStudentId }));
  assert.match(html, /移项符号仍需练习/);
  assert.match(html, /林晓移项时容易忘记变号/);
  console.log(JSON.stringify({ status: "passed", roster_student_id: rosterStudentId, fact_entity_id: entity.entity_id, ids_are_distinct: true, fact_visible: true, external_send: false }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
