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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-entity-delete-e2-"));
const memoryDir = path.join(temp, ".edupi", "memory");
const outputDir = path.join(temp, ".edupi", "output");
const lockDir = path.join(temp, ".edupi", "locks");
for (const directory of [memoryDir, outputDir, lockDir]) fs.mkdirSync(directory, { recursive: true });

const sources = {
  preferences: path.join(memoryDir, "preferences.json"),
  students: path.join(memoryDir, "student_profiles.json"),
  calendar: path.join(memoryDir, "calendar.json"),
  timetable: path.join(memoryDir, "timetable.json"),
  tasks: path.join(outputDir, "rhythm_plan.json"),
  intake: path.join(outputDir, "education_intake_state.json"),
};
fs.writeFileSync(sources.preferences, JSON.stringify({ entries: [{ id: "memory-delete-1", content: "称呼我为吴老师", tags: ["称呼"], count: 1 }] }));
fs.writeFileSync(sources.students, JSON.stringify({ students: { 李四: { name: "李四", traits: ["认真"], parent_notes: [], error_patterns: [], trajectory: [], created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" } }, updated_at: "2026-09-01T00:00:00.000Z" }));
fs.writeFileSync(sources.calendar, JSON.stringify({ events: [{ id: "calendar-delete-1", date: "2026-09-01", name: "开学", type: "custom", source: "teacher", confidence: "teacher_confirmed" }] }));
fs.writeFileSync(sources.timetable, JSON.stringify({ slots: [{ id: "slot-delete-1", day_of_week: 1, period: 1, subject: "数学", class_name: "703", kind: "class" }] }));
fs.writeFileSync(sources.tasks, JSON.stringify({ tasks: [{ id: "task-delete-1", title: "准备第一课", status: "planned", scope: "teacher_internal", requires_teacher_review: true, external_send: false }] }));
const materialBytes = Buffer.from("%PDF-1.4\nEduPi entity restore E2\n", "utf8");
const materialHash = `sha256:${crypto.createHash("sha256").update(materialBytes).digest("hex")}`;
const materialDirectory = path.join(temp, ".edupi", "inbox", "teacher-materials");
const materialPath = path.join(materialDirectory, "material-1.pdf");
fs.mkdirSync(materialDirectory, { recursive: true });
fs.writeFileSync(materialPath, materialBytes);
fs.writeFileSync(sources.intake, JSON.stringify({ schema_version: 1, updated_at: "2026-09-01T00:00:00.000Z", calendar_events: [], timetable_slots: [], materials: [{ material_id: "material-1", staging_id: "stg_00000000000000000000000000000001", source_hash: materialHash, expected_size_bytes: materialBytes.length, kind: "lesson_note", title: "第一课教案", subject: "数学", class_id: "703", relative_path: ".edupi/inbox/teacher-materials/material-1.pdf", intake_state: "accepted" }], receipts: [], review_history: [], review_targets: [{ projection_kind: "material_intake", target: { target_kind: "material_intake", target_id: "material-target-1", command_type: "intake_material" }, revision: 1, title: "第一课教案", summary: "已接收材料：第一课教案", status: "accepted", source_ids: ["material-source-1"], evidence_ids: ["material-evidence-1"], teacher_review: { state: "accepted", reviewer_id: "teacher", reviewed_at: "2026-09-01T00:00:00.000Z", note: null, revision: 1 }, external_send: false, staging_id: "stg_00000000000000000000000000000001", source_hash: materialHash, expected_size_bytes: materialBytes.length, intake_state: "accepted" }], idempotency_records: [] }));
const originalSources = Object.fromEntries(Object.entries(sources).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]));

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

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { DELETE, POST } = await jiti.import("../app/api/edupi/entities/[kind]/[id]/route.ts");
const { GET: GET_DELETIONS } = await jiti.import("../app/api/edupi/entities/route.ts");
const { GET } = await jiti.import("../app/api/edupi/education/route.ts");
const { readEduPiEducationSnapshot } = await jiti.import("../lib/edupi-core-snapshot.ts");

function request(kind, id, method = "DELETE", restoreRequestId = null) {
  return new Request(`http://localhost/api/edupi/entities/${kind}/${encodeURIComponent(id)}`, {
    method,
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ note: null, ...(method === "POST" ? { restoreRequestId } : {}) }),
  });
}

function listRequest() {
  return new Request("http://localhost/api/edupi/entities", { headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin" } });
}

function hasTarget(data, kind, id) {
  if (kind === "calendar") return data.calendar.some((item) => item.id === id);
  if (kind === "timetable") return data.timetable.some((item) => String(item.slot_id ?? item.id) === id);
  if (kind === "memory") return data.continuity.memories.some((item) => item.id === id);
  if (kind === "student") return data.students.some((item) => item.student_id === id || item.name === id);
  if (kind === "material") return (data.teacherMaterials || []).some((item) => item.material_id === id);
  return data.tasks.some((item) => item.id === id);
}

try {
  await readEduPiEducationSnapshot();
  const initialResponse = await GET();
  let data = await initialResponse.json();
  assert.equal(initialResponse.status, 200, JSON.stringify(data));
  const studentId = data.students.find((item) => item.name === "李四")?.student_id;
  assert.ok(studentId);
  const targets = [
    { kind: "calendar", id: "calendar-delete-1" },
    { kind: "timetable", id: "slot-delete-1" },
    { kind: "memory", id: "memory-delete-1" },
    { kind: "student", id: studentId },
    { kind: "task", id: "task-delete-1" },
    { kind: "material", id: "material-1" },
  ];
  for (const target of targets) {
    assert.equal(hasTarget(data, target.kind, target.id), true, `${target.kind} fixture should exist before deletion`);
    const response = await DELETE(request(target.kind, target.id), { params: Promise.resolve(target) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    data = result.data;
    target.id = result.target.id;
    assert.equal(hasTarget(data, target.kind, target.id), false, `${target.kind} should disappear from the refreshed projection`);
    assert.equal(data.entityDeletionCount, targets.indexOf(target) + 1);
  }
  const retryResponse = await DELETE(request("calendar", "calendar-delete-1"), { params: Promise.resolve({ kind: "calendar", id: "calendar-delete-1" }) });
  const retryResult = await retryResponse.json();
  assert.equal(retryResponse.status, 200, JSON.stringify(retryResult));
  assert.equal(hasTarget(retryResult.data, "calendar", "calendar-delete-1"), false);
  for (const [key, file] of Object.entries(sources)) assert.equal(fs.readFileSync(file, "utf8"), originalSources[key], `${key} source bytes must remain recoverable`);
  assert.deepEqual(fs.readFileSync(materialPath), materialBytes);
  let audit = JSON.parse(fs.readFileSync(path.join(outputDir, "entity_delete_state.json"), "utf8"));
  assert.equal(audit.records.length, 6);
  assert.equal(audit.history.length, 6);
  const deletedLedger = await (await GET_DELETIONS(listRequest())).json();
  assert.equal(deletedLedger.deletions.length, 6);
  assert.equal(deletedLedger.deletions.some((item) => item.kind === "material" && item.label === "第一课教案"), true);
  const restoreRecords = new Map(deletedLedger.deletions.map((item) => [`${item.kind}:${item.id}`, item]));

  for (const target of targets) {
    const restoreRecord = restoreRecords.get(`${target.kind}:${target.id}`);
    assert.match(restoreRecord.restoreRequestId, /^entity-restore-[A-Za-z0-9_-]{43}$/);
    const response = await POST(request(target.kind, target.id, "POST", restoreRecord.restoreRequestId), { params: Promise.resolve(target) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    data = result.data;
    assert.equal(hasTarget(data, target.kind, result.target.id), true, `${target.kind} should return to the refreshed projection`);
  }
  const restarted = await (await GET()).json();
  for (const target of targets) assert.equal(hasTarget(restarted, target.kind, target.id), true, `${target.kind} should survive restart readback`);
  assert.equal(restarted.entityDeletionCount, 0);
  assert.equal(restarted.entityDeletionHistoryCount, 12);
  const restoredLedger = await (await GET_DELETIONS(listRequest())).json();
  assert.equal(restoredLedger.deletions.length, 0);
  assert.equal(restoredLedger.history.length, 12);
  const restoredTask = restarted.tasks.find((item) => item.id === "task-delete-1");
  assert.equal(restoredTask.status, "planned", "restoring a task must not auto-complete it");
  const replayedCalendarRestore = await POST(request("calendar", "calendar-delete-1", "POST", restoreRecords.get("calendar:calendar-delete-1").restoreRequestId), { params: Promise.resolve({ kind: "calendar", id: "calendar-delete-1" }) });
  assert.equal(replayedCalendarRestore.status, 200, JSON.stringify(await replayedCalendarRestore.clone().json()));
  audit = JSON.parse(fs.readFileSync(path.join(outputDir, "entity_delete_state.json"), "utf8"));
  assert.equal(audit.records.length, 0);
  assert.equal(audit.next_tombstone_revision, 7);
  assert.equal(audit.history.length, 12);

  const deletedCalendarAgain = await DELETE(request("calendar", "calendar-delete-1"), { params: Promise.resolve({ kind: "calendar", id: "calendar-delete-1" }) });
  assert.equal(deletedCalendarAgain.status, 200, JSON.stringify(await deletedCalendarAgain.clone().json()));
  audit = JSON.parse(fs.readFileSync(path.join(outputDir, "entity_delete_state.json"), "utf8"));
  assert.equal(audit.records.find((item) => item.target_kind === "calendar").tombstone_revision, 7);
  const calendarAgainLedger = await (await GET_DELETIONS(listRequest())).json();
  const calendarAgainRestoreId = calendarAgainLedger.deletions.find((item) => item.kind === "calendar" && item.id === "calendar-delete-1").restoreRequestId;
  const restoredCalendarAgain = await POST(request("calendar", "calendar-delete-1", "POST", calendarAgainRestoreId), { params: Promise.resolve({ kind: "calendar", id: "calendar-delete-1" }) });
  assert.equal(restoredCalendarAgain.status, 200, JSON.stringify(await restoredCalendarAgain.clone().json()));

  const deletedMaterialAgain = await DELETE(request("material", "material-1"), { params: Promise.resolve({ kind: "material", id: "material-1" }) });
  assert.equal(deletedMaterialAgain.status, 200, JSON.stringify(await deletedMaterialAgain.clone().json()));
  const materialAgainLedger = await (await GET_DELETIONS(listRequest())).json();
  const materialAgainRestoreId = materialAgainLedger.deletions.find((item) => item.kind === "material" && item.id === "material-1").restoreRequestId;
  fs.writeFileSync(materialPath, Buffer.alloc(materialBytes.length, 0x78));
  const rejectedMaterialRestore = await POST(request("material", "material-1", "POST", materialAgainRestoreId), { params: Promise.resolve({ kind: "material", id: "material-1" }) });
  const rejectedMaterialResult = await rejectedMaterialRestore.json();
  assert.equal(rejectedMaterialRestore.status, 409, JSON.stringify(rejectedMaterialResult));
  assert.equal(rejectedMaterialResult.code, "material_unavailable");
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, "entity_delete_state.json"), "utf8")).records.some((item) => item.target_kind === "material"), true);
  fs.writeFileSync(materialPath, materialBytes);
  const repairedMaterialRestore = await POST(request("material", "material-1", "POST", materialAgainRestoreId), { params: Promise.resolve({ kind: "material", id: "material-1" }) });
  assert.equal(repairedMaterialRestore.status, 200, JSON.stringify(await repairedMaterialRestore.clone().json()));
  for (const [key, file] of Object.entries(sources)) assert.equal(fs.readFileSync(file, "utf8"), originalSources[key], `${key} source bytes must remain unchanged after restore`);
  assert.deepEqual(fs.readFileSync(materialPath), materialBytes);
  audit = JSON.parse(fs.readFileSync(path.join(outputDir, "entity_delete_state.json"), "utf8"));
  assert.equal(audit.records.length, 0);
  assert.equal(audit.next_tombstone_revision, 9, "the bounded global generation advances without retaining one row per historical target");
  console.log(JSON.stringify({ status: "passed", deleted_and_restored: targets.length, history: audit.history.length, retry_reconciled: true, source_bytes_preserved: true, material_drift_rejected: true }));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
