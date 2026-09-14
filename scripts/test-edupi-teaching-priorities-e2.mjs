#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.ok(configuredCoreRoot && path.isAbsolute(configuredCoreRoot), "EDUPI_CORE_ROOT is required");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-teaching-priorities-e2-")));
const memoryDir = path.join(temp, ".edupi", "memory");
const outputDir = path.join(temp, ".edupi", "output");
const lockDir = path.join(temp, ".edupi", "locks");
for (const directory of [memoryDir, outputDir, lockDir]) fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(memoryDir, "timetable.json"), JSON.stringify({ slots: [{ slot_id: "priority-slot", day_of_week: 2, period: 1, subject: "数学", class_name: "703", kind: "class" }] }));
fs.writeFileSync(path.join(memoryDir, "semester.json"), JSON.stringify({ start_date: "2026-09-14", end_date: "2026-09-20", entries: [] }));

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
const prioritiesRoute = await jiti.import("../app/api/edupi/teaching-priorities/route.ts");
const versionsRoute = await jiti.import("../app/api/edupi/teaching-priorities/[priorityId]/versions/route.ts");
const entitiesRoute = await jiti.import("../app/api/edupi/entities/[kind]/[id]/route.ts");
const { GET: GET_ENTITIES } = await jiti.import("../app/api/edupi/entities/route.ts");
const { GET: GET_EDUCATION } = await jiti.import("../app/api/edupi/education/route.ts");

function jsonRequest(url, method, body) {
  return new Request(url, { method, headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) });
}

function getRequest(url) {
  return new Request(url, { headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin" } });
}

function priority(data, id) {
  return data.continuity.teachingPriorities.find((item) => item.id === id);
}

function rawTask() {
  return JSON.parse(fs.readFileSync(path.join(outputDir, "rhythm_plan.json"), "utf8")).tasks.find((item) => item.trigger === "teaching_before_class" && item.source_event_id === "timetable:priority-slot:2026-09-15");
}

async function mutate(method, body) {
  const response = await prioritiesRoute[method](jsonRequest("http://localhost/api/edupi/teaching-priorities", method, body));
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}

async function history(priorityId) {
  const response = await versionsRoute.GET(getRequest(`http://localhost/api/edupi/teaching-priorities/${priorityId}/versions`), { params: Promise.resolve({ priorityId }) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(priority(result.data, priorityId).revision, result.history.revision);
  assert.equal(priority(result.data, priorityId).historyCount, result.history.historyCount);
  return result.history;
}

try {
  const createBody = { subject: "数学", className: "703", topic: "移项", note: "先补变号" };
  const created = await mutate("POST", createBody);
  const priorityId = created.result.priorityId;
  assert.deepEqual(priority(created.data, priorityId), { id: priorityId, subject: "数学", className: "703", topic: "移项", note: "先补变号", status: "active", revision: 0, historyCount: 0, createdAt: created.result.updatedAt, updatedAt: created.result.updatedAt, externalSend: false });
  const firstTask = rawTask();
  assert.match(firstTask.summary, /移项：先补变号/);
  const createBytes = fs.readFileSync(path.join(memoryDir, "teaching_priorities.json"), "utf8");
  const createReplay = await mutate("POST", createBody);
  assert.equal(createReplay.result.replayed, true);
  assert.equal(createReplay.result.priorityId, priorityId);
  assert.equal(fs.readFileSync(path.join(memoryDir, "teaching_priorities.json"), "utf8"), createBytes);
  const otherClass = await mutate("POST", { ...createBody, className: "704" });
  assert.notEqual(otherClass.result.priorityId, priorityId);
  assert.equal(otherClass.data.continuity.teachingPriorities.length, 2);

  const edited = await mutate("PUT", { priorityId, expectedRevision: 0, patch: { note: "先讲等式性质" } });
  assert.equal(priority(edited.data, priorityId).revision, 1);
  const editedTask = rawTask();
  assert.equal(editedTask.task_id, firstTask.task_id);
  assert.notEqual(editedTask.source_semantic_fingerprint, firstTask.source_semantic_fingerprint);
  assert.match(editedTask.summary, /移项：先讲等式性质/);
  const editBytes = fs.readFileSync(path.join(memoryDir, "teaching_priorities.json"), "utf8");
  const editReplay = await mutate("PUT", { priorityId, expectedRevision: 0, patch: { note: "先讲等式性质" } });
  assert.equal(editReplay.result.replayed, true);
  assert.equal(fs.readFileSync(path.join(memoryDir, "teaching_priorities.json"), "utf8"), editBytes);
  const duplicateCreateResponse = await prioritiesRoute.POST(jsonRequest("http://localhost/api/edupi/teaching-priorities", "POST", createBody));
  assert.equal(duplicateCreateResponse.status, 409);
  assert.equal((await duplicateCreateResponse.json()).code, "priority_conflict");

  const paused = await mutate("PUT", { priorityId, expectedRevision: 1, patch: { status: "paused" } });
  assert.equal(priority(paused.data, priorityId).status, "paused");
  assert.doesNotMatch(rawTask().summary, /移项：先讲等式性质/);
  const pausedHistory = await history(priorityId);
  assert.equal(pausedHistory.historyCount, 2);
  const pauseVersion = pausedHistory.versions.find((item) => item.revision === 2);
  const restoreResponse = await versionsRoute.POST(jsonRequest(`http://localhost/api/edupi/teaching-priorities/${priorityId}/versions`, "POST", { versionId: pauseVersion.versionId, versionSide: "before", expectedRevision: 2 }), { params: Promise.resolve({ priorityId }) });
  const restoredVersion = await restoreResponse.json();
  assert.equal(restoreResponse.status, 200, JSON.stringify(restoredVersion));
  assert.equal(priority(restoredVersion.data, priorityId).status, "active");
  assert.equal(priority(restoredVersion.data, priorityId).revision, 3);
  assert.match(rawTask().summary, /移项：先讲等式性质/);

  const completed = await mutate("PUT", { priorityId, expectedRevision: 3, patch: { status: "completed" } });
  assert.equal(priority(completed.data, priorityId).status, "completed");
  assert.doesNotMatch(rawTask().summary, /移项：先讲等式性质/);

  const deleteRequest = jsonRequest(`http://localhost/api/edupi/entities/teaching_priority/${priorityId}`, "DELETE", { note: null });
  const deletedResponse = await entitiesRoute.DELETE(deleteRequest, { params: Promise.resolve({ kind: "teaching_priority", id: priorityId }) });
  const deleted = await deletedResponse.json();
  assert.equal(deletedResponse.status, 200, JSON.stringify(deleted));
  assert.equal(priority(deleted.data, priorityId), undefined);
  assert.doesNotMatch(rawTask().summary, /移项：先讲等式性质/);
  const ledger = await (await GET_ENTITIES(getRequest("http://localhost/api/edupi/entities"))).json();
  const tombstone = ledger.deletions.find((item) => item.kind === "teaching_priority" && item.id === priorityId);
  assert.ok(tombstone);
  const entityRestoreRequest = jsonRequest(`http://localhost/api/edupi/entities/teaching_priority/${priorityId}`, "POST", { note: null, restoreRequestId: tombstone.restoreRequestId });
  const entityRestoreResponse = await entitiesRoute.POST(entityRestoreRequest, { params: Promise.resolve({ kind: "teaching_priority", id: priorityId }) });
  const restoredEntity = await entityRestoreResponse.json();
  assert.equal(entityRestoreResponse.status, 200, JSON.stringify(restoredEntity));
  assert.equal(priority(restoredEntity.data, priorityId).status, "completed");

  const completedHistory = await history(priorityId);
  const completionVersion = completedHistory.versions.find((item) => item.revision === 4);
  const reactivateResponse = await versionsRoute.POST(jsonRequest(`http://localhost/api/edupi/teaching-priorities/${priorityId}/versions`, "POST", { versionId: completionVersion.versionId, versionSide: "before", expectedRevision: 4 }), { params: Promise.resolve({ priorityId }) });
  const reactivated = await reactivateResponse.json();
  assert.equal(reactivateResponse.status, 200, JSON.stringify(reactivated));
  assert.equal(priority(reactivated.data, priorityId).status, "active");
  assert.equal(priority(reactivated.data, priorityId).revision, 5);
  assert.match(rawTask().summary, /移项：先讲等式性质/);

  const staleResponse = await prioritiesRoute.PUT(jsonRequest("http://localhost/api/edupi/teaching-priorities", "PUT", { priorityId, expectedRevision: 4, patch: { note: "过期页面" } }));
  assert.equal(staleResponse.status, 409);
  assert.equal((await staleResponse.json()).code, "stale_priority");
  const persisted = await (await GET_EDUCATION()).json();
  assert.deepEqual({ status: priority(persisted, priorityId).status, revision: priority(persisted, priorityId).revision, note: priority(persisted, priorityId).note }, { status: "active", revision: 5, note: "先讲等式性质" });
  assert.equal((await history(priorityId)).historyCount, 5);

  console.log(JSON.stringify({ status: "passed", priorities: 2, revision: 5, create_and_edit_replay: true, duplicate_create_conflict: true, history_restore: true, tombstone_restore: true, stale_rejected: true, lesson_refresh: true }));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
