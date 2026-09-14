import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const priorities = await createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false }).import("./edupi-teaching-priorities.ts");
const before = { subject: "数学", class_name: "703", topic: "一元一次方程", note: "先补移项", status: "active" };
const after = { ...before, note: "先讲等式性质", status: "paused" };

function version({ revision, beforeValues, afterValues, sourceKind = "teacher_edit", requestId = `priority-request-${revision}`, changedAt = `2026-09-15T0${revision}:00:00.000Z` }) {
  const changedFields = ["subject", "class_name", "topic", "note", "status"].filter((field) => JSON.stringify(beforeValues[field]) !== JSON.stringify(afterValues[field]));
  const identity = { priority_id: "priority-1", revision, before: beforeValues, after: afterValues, changed_at: changedAt, source_kind: sourceKind, request_id: requestId };
  return { version_id: `teaching-priority-version-${createHash("sha256").update(JSON.stringify(identity)).digest("base64url")}`, ...identity, changed_fields: changedFields };
}

const first = version({ revision: 1, beforeValues: before, afterValues: after });
const restored = version({ revision: 2, beforeValues: after, afterValues: before, sourceKind: "restore", requestId: "restore-request" });
const history = { priority_id: "priority-1", revision: 2, history_count: 2, versions: [first, restored], external_send: false };

test("normalizes a content-bound teaching priority version chain", () => {
  const normalized = priorities.normalizeTeachingPriorityHistory(history, "priority-1");
  assert.equal(normalized.revision, 2);
  assert.deepEqual(normalized.versions[0].changedFields, ["note", "status"]);
  assert.deepEqual(normalized.versions[1].afterValues, { subject: "数学", className: "703", topic: "一元一次方程", note: "先补移项", status: "active" });
});

test("rejects forged, reordered, broken, and cross-priority histories", () => {
  const invalid = [
    { ...history, api_key: "secret" },
    { ...history, history_count: 1 },
    { ...history, versions: [{ ...first, version_id: "forged" }, restored] },
    { ...history, versions: [{ ...first, changed_fields: ["note"] }, restored] },
    { ...history, versions: [first, { ...restored, before }] },
    { ...history, versions: [first, { ...restored, priority_id: "priority-2" }] },
    { ...history, versions: [restored, first] },
  ];
  for (const value of invalid) assert.throws(() => priorities.normalizeTeachingPriorityHistory(value, "priority-1"), /教学重点/);
  assert.throws(() => priorities.normalizeTeachingPriorityHistory(history, "priority-2"), /教学重点/);
});

test("request identities bind every create, update, and restore semantic", () => {
  const create = { subject: "数学", className: "703", topic: "移项", note: "先补变号" };
  assert.equal(priorities.teachingPriorityCreateRequestId({ ...create }), priorities.teachingPriorityCreateRequestId(create));
  assert.notEqual(priorities.teachingPriorityCreateRequestId({ ...create, className: "704" }), priorities.teachingPriorityCreateRequestId(create));
  const update = { priorityId: "priority-1", expectedRevision: 2, patch: { note: "新说明", status: "paused" } };
  assert.equal(priorities.teachingPriorityUpdateRequestId({ ...update, patch: { status: "paused", note: "新说明" } }), priorities.teachingPriorityUpdateRequestId(update));
  assert.notEqual(priorities.teachingPriorityUpdateRequestId({ ...update, expectedRevision: 3 }), priorities.teachingPriorityUpdateRequestId(update));
  const restore = { priorityId: "priority-1", versionId: first.version_id, versionSide: "before", expectedRevision: 2 };
  assert.equal(priorities.teachingPriorityRestoreRequestId({ ...restore }), priorities.teachingPriorityRestoreRequestId(restore));
  assert.notEqual(priorities.teachingPriorityRestoreRequestId({ ...restore, versionSide: "after" }), priorities.teachingPriorityRestoreRequestId(restore));
});

test("accepts only exact action-bound Core receipts", () => {
  const receipt = { ok: true, operation: "teaching-priorities", request_id: "update-request", action: "update", priority_id: "priority-1", version_id: "teaching-priority-version-next", revision: 3, history_count: 3, updated_at: "2026-09-15T03:00:00.000Z", total: 2, replayed: false, external_send: false };
  const expected = { requestId: "update-request", action: "update", priorityId: "priority-1", expectedRevision: 2 };
  assert.equal(priorities.normalizeTeachingPriorityReceipt(receipt, expected).revision, 3);
  for (const value of [
    { ...receipt, token: "secret" },
    { ...receipt, request_id: "other" },
    { ...receipt, priority_id: "priority-2" },
    { ...receipt, revision: 2 },
    { ...receipt, external_send: true },
  ]) assert.throws(() => priorities.normalizeTeachingPriorityReceipt(value, expected), /响应无效/);
});
