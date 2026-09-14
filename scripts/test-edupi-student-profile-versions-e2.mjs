#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.equal(typeof configuredCoreRoot, "string", "EDUPI_CORE_ROOT is required");
assert.equal(path.isAbsolute(configuredCoreRoot), true, "EDUPI_CORE_ROOT must be absolute");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-student-profile-versions-e2-"));
const memoryDir = path.join(temp, ".edupi", "memory");
const outputDir = path.join(temp, ".edupi", "output");
const lockDir = path.join(temp, ".edupi", "locks");
for (const directory of [memoryDir, outputDir, lockDir]) fs.mkdirSync(directory, { recursive: true });

const profileFile = path.join(memoryDir, "student_profiles.json");
fs.writeFileSync(profileFile, `${JSON.stringify({ students: { 李四: { name: "李四", class_name: "703", traits: ["认真"], parent_notes: ["保持沟通"], error_patterns: [{ description: "移项", status: "active" }], trajectory: [{ date: "2026-08-20", event: "进步" }], created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-09-01T07:00:00.000Z" } }, updated_at: "2026-09-01T07:00:00.000Z" }, null, 2)}\n`);

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
const { PUT } = await jiti.import("../app/api/edupi/students/[name]/route.ts");
const { GET: GET_VERSIONS, POST: POST_VERSIONS } = await jiti.import("../app/api/edupi/students/[name]/versions/route.ts");
const { GET: GET_EDUCATION } = await jiti.import("../app/api/edupi/education/route.ts");
const routeParams = { params: Promise.resolve({ name: "李四" }) };

function jsonRequest(url, method, body) {
  return new Request(url, { method, headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) });
}

function historyRequest(studentId, name = "李四") {
  return new Request(`http://localhost/api/edupi/students/${encodeURIComponent(name)}/versions?studentId=${encodeURIComponent(studentId)}`, { headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin" } });
}

try {
  const initialResponse = await GET_EDUCATION();
  const initial = await initialResponse.json();
  assert.equal(initialResponse.status, 200, JSON.stringify(initial));
  const before = initial.students.find((student) => student.name === "李四");
  assert.equal(before.profile_revision, 0);
  assert.equal(before.profile_history_count, 0);
  assert.equal(before.class_name, "703");

  const updateBody = {
    studentId: before.student_id,
    className: "704",
    traits: ["主动提问"],
    parentNotes: ["本周已沟通"],
    expectedUpdatedAt: before.updated_at,
    expectedRevision: before.profile_revision,
  };
  const updateResponse = await PUT(jsonRequest("http://localhost/api/edupi/students/%E6%9D%8E%E5%9B%9B", "PUT", updateBody), routeParams);
  const update = await updateResponse.json();
  assert.equal(updateResponse.status, 200, JSON.stringify(update));
  const changed = update.data.students.find((student) => student.student_id === before.student_id);
  assert.equal(changed.profile_revision, 1);
  assert.equal(changed.profile_history_count, 1);
  assert.equal(changed.class_name, "704");
  const updateBytes = fs.readFileSync(profileFile, "utf8");
  const updateReplayResponse = await PUT(jsonRequest("http://localhost/api/edupi/students/%E6%9D%8E%E5%9B%9B", "PUT", updateBody), routeParams);
  const updateReplay = await updateReplayResponse.json();
  assert.equal(updateReplayResponse.status, 200, JSON.stringify(updateReplay));
  assert.equal(updateReplay.result.replayed, true);
  assert.equal(updateReplay.data.students.find((student) => student.student_id === before.student_id).profile_revision, 1);
  assert.equal(fs.readFileSync(profileFile, "utf8"), updateBytes, "idempotent edit replay must not append another version");

  const historyResponse = await GET_VERSIONS(historyRequest(before.student_id), routeParams);
  const firstHistory = await historyResponse.json();
  assert.equal(historyResponse.status, 200, JSON.stringify(firstHistory));
  assert.equal(firstHistory.history.profileRevision, 1);
  assert.equal(firstHistory.history.profileHistoryCount, 1);
  const version = firstHistory.history.versions[0];
  assert.deepEqual(version.beforeValues, { className: "703", traits: ["认真"], parentNotes: ["保持沟通"] });
  assert.deepEqual(version.afterValues, { className: "704", traits: ["主动提问"], parentNotes: ["本周已沟通"] });

  const restoreBody = { studentId: before.student_id, versionId: version.versionId, versionSide: "before", expectedRevision: 1 };
  const restoreResponse = await POST_VERSIONS(jsonRequest("http://localhost/api/edupi/students/%E6%9D%8E%E5%9B%9B/versions", "POST", restoreBody), routeParams);
  const restored = await restoreResponse.json();
  assert.equal(restoreResponse.status, 200, JSON.stringify(restored));
  assert.equal(restored.reconciled, false);
  const restoredStudent = restored.data.students.find((student) => student.student_id === before.student_id);
  assert.equal(restoredStudent.profile_revision, 2);
  assert.equal(restoredStudent.profile_history_count, 2);
  assert.equal(restoredStudent.class_name, "703");
  assert.deepEqual(restoredStudent.traits, ["认真"]);
  assert.deepEqual(restoredStudent.parent_notes, ["保持沟通"]);
  assert.deepEqual(restoredStudent.error_patterns.map(({ description, status }) => ({ description, status })), [{ description: "移项", status: "active" }]);
  assert.deepEqual(restoredStudent.trajectory.map(({ date, event }) => ({ date, event })), [{ date: "2026-08-20", event: "进步" }]);

  const afterBytes = fs.readFileSync(profileFile, "utf8");
  const replayResponse = await POST_VERSIONS(jsonRequest("http://localhost/api/edupi/students/%E6%9D%8E%E5%9B%9B/versions", "POST", restoreBody), routeParams);
  const replay = await replayResponse.json();
  assert.equal(replayResponse.status, 200, JSON.stringify(replay));
  assert.equal(replay.reconciled, true);
  assert.equal(replay.data.students.find((student) => student.student_id === before.student_id).profile_revision, 2);
  assert.equal(fs.readFileSync(profileFile, "utf8"), afterBytes, "idempotent replay must not append another version");

  const staleResponse = await POST_VERSIONS(jsonRequest("http://localhost/api/edupi/students/%E6%9D%8E%E5%9B%9B/versions", "POST", { ...restoreBody, versionSide: "after" }), routeParams);
  assert.equal(staleResponse.status, 409);
  assert.equal((await staleResponse.json()).code, "stale_student");

  const persisted = await (await GET_EDUCATION()).json();
  const persistedStudent = persisted.students.find((student) => student.student_id === before.student_id);
  assert.deepEqual({ className: persistedStudent.class_name, traits: persistedStudent.traits, parentNotes: persistedStudent.parent_notes, revision: persistedStudent.profile_revision }, { className: "703", traits: ["认真"], parentNotes: ["保持沟通"], revision: 2 });
  const persistedHistory = await (await GET_VERSIONS(historyRequest(before.student_id), routeParams)).json();
  assert.equal(persistedHistory.history.versions.at(-1).sourceKind, "restore");

  const wrongNameResponse = await GET_VERSIONS(historyRequest(before.student_id, "同名错误"), { params: Promise.resolve({ name: "同名错误" }) });
  assert.equal(wrongNameResponse.status, 404);
  console.log(JSON.stringify({ status: "passed", update_revision: 1, restore_revision: 2, persisted: true, edit_and_restore_replayed_without_duplicate: true, stale_rejected: true, system_records_preserved: true }));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
