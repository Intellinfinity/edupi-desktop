#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.ok(configuredCoreRoot && path.isAbsolute(configuredCoreRoot), "EDUPI_CORE_ROOT is required");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-material-metadata-e2-")));
const home = path.join(temp, ".edupi");
const memoryDir = path.join(home, "memory");
const outputDir = path.join(home, "output");
const lockDir = path.join(home, "locks");
const materialDir = path.join(home, "inbox", "teacher-materials");
for (const directory of [memoryDir, outputDir, lockDir, materialDir]) fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(memoryDir, "timetable.json"), JSON.stringify({ slots: [{ slot_id: "material-metadata-slot", day_of_week: 2, period: 1, subject: "数学", class_name: "703", kind: "class" }] }));
fs.writeFileSync(path.join(memoryDir, "semester.json"), JSON.stringify({ start_date: "2026-09-14", end_date: "2026-09-20", entries: [] }));
const bytes = Buffer.from("%PDF-1.4\nDesktop material metadata fixture\n", "utf8");
const sourceHash = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
const materialPath = path.join(materialDir, "material-1.pdf");
fs.writeFileSync(materialPath, bytes);
fs.writeFileSync(path.join(outputDir, "education_intake_state.json"), JSON.stringify({
  schema_version: 1,
  updated_at: "2026-09-15T00:00:00.000Z",
  calendar_events: [], timetable_slots: [],
  materials: [{ material_id: "material-1", staging_id: "stg_00000000000000000000000000000001", source_hash: sourceHash, expected_size_bytes: bytes.length, kind: "lesson_note", title: "第一课教案", subject: "数学", class_id: "703", relative_path: ".edupi/inbox/teacher-materials/material-1.pdf", source_id: "material-source-1", evidence_ids: ["material-evidence-1"], intake_state: "accepted", created_at: "2026-09-15T00:00:00.000Z" }],
  receipts: [], review_history: [],
  review_targets: [{ projection_kind: "material_intake", target: { target_kind: "material_intake", target_id: "material-target-1", command_type: "intake_material" }, revision: 1, title: "第一课教案", summary: "已接收材料：第一课教案", status: "accepted", source_ids: ["material-source-1"], evidence_ids: ["material-evidence-1"], teacher_review: { state: "accepted", reviewer_id: "teacher", reviewed_at: "2026-09-15T00:00:00.000Z", note: null, revision: 1 }, external_send: false, staging_id: "stg_00000000000000000000000000000001", source_hash: sourceHash, expected_size_bytes: bytes.length, intake_state: "accepted" }],
  idempotency_records: [],
}));

Object.assign(process.env, {
  EDUPI_CORE_ROOT: coreRoot,
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_DATA_ROOT: temp,
  EDUPI_DATA_ALLOWED_ROOT: path.dirname(temp),
  EDUPI_PROJECT_ROOT: temp,
  EDUPI_MEMORY_DIR: memoryDir,
  EDUPI_OUTPUT_DIR: outputDir,
  EDUPI_LOCK_DIR: lockDir,
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false });
const metadataRoute = await jiti.import("../app/api/edupi/materials/[materialId]/metadata/route.ts");
const versionsRoute = await jiti.import("../app/api/edupi/materials/[materialId]/metadata/versions/route.ts");
const entitiesRoute = await jiti.import("../app/api/edupi/entities/[kind]/[id]/route.ts");
const { GET: GET_ENTITIES } = await jiti.import("../app/api/edupi/entities/route.ts");
const { GET: GET_EDUCATION } = await jiti.import("../app/api/edupi/education/route.ts");
const routeParams = { params: Promise.resolve({ materialId: "material-1" }) };

function jsonRequest(url, method, body) {
  return new Request(url, { method, headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) });
}

function getRequest(url) {
  return new Request(url, { headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin" } });
}

function material(data) {
  return data.teacherMaterials?.find((item) => item.material_id === "material-1");
}

function rawTask() {
  return JSON.parse(fs.readFileSync(path.join(outputDir, "rhythm_plan.json"), "utf8")).tasks.find((item) => item.source_event_id === "timetable:material-metadata-slot:2026-09-15");
}

async function update(body, expectedStatus = 200) {
  const response = await metadataRoute.PUT(jsonRequest("http://localhost/api/edupi/materials/material-1/metadata", "PUT", body), routeParams);
  const result = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(result));
  return result;
}

async function history(expectedStatus = 200) {
  const response = await versionsRoute.GET(getRequest("http://localhost/api/edupi/materials/material-1/metadata/versions"), routeParams);
  const result = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(result));
  return result;
}

try {
  const initial = await (await GET_EDUCATION()).json();
  assert.deepEqual({ title: material(initial).title, revision: material(initial).metadata_revision, history: material(initial).metadata_history_count }, { title: "第一课教案", revision: 0, history: 0 });
  const firstBody = { expectedRevision: 0, patch: { title: "移项专项教案", kind: "worksheet" } };
  const edited = await update(firstBody);
  assert.deepEqual({ title: material(edited.data).title, kind: material(edited.data).kind, revision: material(edited.data).metadata_revision, history: edited.history.historyCount }, { title: "移项专项教案", kind: "worksheet", revision: 1, history: 1 });
  assert.match(rawTask().summary, /可用材料：移项专项教案/u);
  const replay = await update(firstBody);
  assert.equal(replay.result.replayed, true);
  assert.equal(replay.history.historyCount, 1);
  const stale = await update({ expectedRevision: 0, patch: { title: "过期页面" } }, 409);
  assert.equal(stale.code, "stale_material_metadata");

  const firstHistory = await history();
  assert.equal(firstHistory.history.revision, 1);
  assert.equal(material(firstHistory.data).metadata_revision, 1);
  const firstVersion = firstHistory.history.versions[0];
  const restoreBody = { versionId: firstVersion.versionId, versionSide: "before", expectedRevision: 1 };
  const restored = await versionsRoute.POST(jsonRequest("http://localhost/api/edupi/materials/material-1/metadata/versions", "POST", restoreBody), routeParams);
  const restoredResult = await restored.json();
  assert.equal(restored.status, 200, JSON.stringify(restoredResult));
  assert.deepEqual({ title: material(restoredResult.data).title, kind: material(restoredResult.data).kind, revision: material(restoredResult.data).metadata_revision, history: restoredResult.history.historyCount }, { title: "第一课教案", kind: "lesson_note", revision: 2, history: 2 });
  const restoreReplay = await versionsRoute.POST(jsonRequest("http://localhost/api/edupi/materials/material-1/metadata/versions", "POST", restoreBody), routeParams);
  assert.equal(restoreReplay.status, 200);
  assert.equal((await restoreReplay.json()).reconciled, true);

  const moved = await update({ expectedRevision: 2, patch: { classId: "704" } });
  assert.equal(material(moved.data).metadata_revision, 3);
  assert.match(rawTask().summary, /可用材料：尚未关联/u);
  const beforeDeleteBytes = fs.readFileSync(materialPath);
  const deleteResponse = await entitiesRoute.DELETE(jsonRequest("http://localhost/api/edupi/entities/material/material-1", "DELETE", { note: null }), { params: Promise.resolve({ kind: "material", id: "material-1" }) });
  const deleted = await deleteResponse.json();
  assert.equal(deleteResponse.status, 200, JSON.stringify(deleted));
  assert.equal(material(deleted.data), undefined);
  assert.equal((await history(410)).code, "material_deleted");
  const ledger = await (await GET_ENTITIES(getRequest("http://localhost/api/edupi/entities"))).json();
  const tombstone = ledger.deletions.find((item) => item.kind === "material" && item.id === "material-1");
  const restoreEntityResponse = await entitiesRoute.POST(jsonRequest("http://localhost/api/edupi/entities/material/material-1", "POST", { note: null, restoreRequestId: tombstone.restoreRequestId }), { params: Promise.resolve({ kind: "material", id: "material-1" }) });
  const restoredEntity = await restoreEntityResponse.json();
  assert.equal(restoreEntityResponse.status, 200, JSON.stringify(restoredEntity));
  assert.deepEqual({ classId: material(restoredEntity.data).class_id, revision: material(restoredEntity.data).metadata_revision, history: material(restoredEntity.data).metadata_history_count }, { classId: "704", revision: 3, history: 3 });
  const moveHistory = await history();
  const moveVersion = moveHistory.history.versions.find((version) => version.revision === 3);
  const restoreScopeResponse = await versionsRoute.POST(jsonRequest("http://localhost/api/edupi/materials/material-1/metadata/versions", "POST", { versionId: moveVersion.versionId, versionSide: "before", expectedRevision: 3 }), routeParams);
  const restoredScope = await restoreScopeResponse.json();
  assert.equal(restoreScopeResponse.status, 200, JSON.stringify(restoredScope));
  assert.deepEqual({ classId: material(restoredScope.data).class_id, revision: material(restoredScope.data).metadata_revision, history: restoredScope.history.historyCount }, { classId: "703", revision: 4, history: 4 });
  assert.match(rawTask().summary, /可用材料：第一课教案/u);
  assert.deepEqual(fs.readFileSync(materialPath), beforeDeleteBytes);

  console.log(JSON.stringify({ status: "passed", revision: 4, history: 4, update_replay: true, restore_reconciled: true, stale_rejected: true, tombstone_restore: true, preparation_refresh: true, bytes_preserved: true }));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
