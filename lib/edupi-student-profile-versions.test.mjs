import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const profileVersions = await createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false }).import("./edupi-student-profile-versions.ts");

const before = { class_name: "703", traits: ["认真"], parent_notes: ["保持沟通"] };
const after = { class_name: "704", traits: ["认真", "主动提问"], parent_notes: ["本周已沟通"] };

function version({ revision, beforeValues, afterValues, sourceKind = "teacher_edit", requestId = `request-${revision}`, changedAt = `2026-09-14T0${revision}:00:00.000Z` }) {
  const changedFields = ["class_name", "traits", "parent_notes"].filter((field) => JSON.stringify(beforeValues[field]) !== JSON.stringify(afterValues[field]));
  const identity = { student_id: "student-1", revision, before: beforeValues, after: afterValues, changed_at: changedAt, source_kind: sourceKind, request_id: requestId };
  return { version_id: `student-profile-${createHash("sha256").update(JSON.stringify(identity)).digest("base64url")}`, ...identity, changed_fields: changedFields };
}

const first = version({ revision: 1, beforeValues: before, afterValues: after });
const restored = { class_name: "703", traits: ["认真"], parent_notes: ["保持沟通"] };
const second = version({ revision: 2, beforeValues: after, afterValues: restored, sourceKind: "restore", requestId: "restore-2" });
const history = { student_id: "student-1", student_name: "李四", profile_revision: 2, profile_history_count: 2, versions: [first, second], external_send: false };

test("normalizes a bounded, content-bound student profile version chain", () => {
  const normalized = profileVersions.normalizeStudentProfileVersionHistory(history, "student-1");
  assert.equal(normalized.profileRevision, 2);
  assert.equal(normalized.profileHistoryCount, 2);
  assert.deepEqual(normalized.versions[0].changedFields, ["class_name", "traits", "parent_notes"]);
  assert.deepEqual(normalized.versions[1].afterValues, { className: "703", traits: ["认真"], parentNotes: ["保持沟通"] });
  assert.equal(normalized.versions[1].sourceKind, "restore");
});

test("rejects forged identities, broken chains, count mismatches, and cross-student history", () => {
  const invalid = [
    { ...history, credential: "secret" },
    { ...history, profile_history_count: 1 },
    { ...history, versions: [{ ...first, version_id: "student-profile-forged" }, second] },
    { ...history, versions: [{ ...first, changed_fields: ["traits"] }, second] },
    { ...history, versions: [first, { ...second, before: before }] },
    { ...history, versions: [first, { ...second, student_id: "student-2" }] },
    { ...history, versions: [second, first] },
  ];
  for (const value of invalid) assert.throws(() => profileVersions.normalizeStudentProfileVersionHistory(value, "student-1"), /学生档案版本/);
  assert.throws(() => profileVersions.normalizeStudentProfileVersionHistory(history, "student-2"), /学生档案版本/);
});

test("derives a stable restore identity and emits one exact Core restore request", () => {
  const input = { studentId: "student-1", versionId: first.version_id, versionSide: "before", expectedRevision: 2 };
  const requestId = profileVersions.studentProfileRestoreRequestId(input);
  assert.equal(profileVersions.studentProfileRestoreRequestId({ ...input }), requestId);
  for (const changed of [
    { ...input, studentId: "student-2" },
    { ...input, versionId: second.version_id },
    { ...input, versionSide: "after" },
    { ...input, expectedRevision: 3 },
  ]) assert.notEqual(profileVersions.studentProfileRestoreRequestId(changed), requestId);
  assert.deepEqual(profileVersions.buildStudentProfileRestoreRequest(input, requestId), {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation: "students",
    request_id: requestId,
    action: "restore",
    student_id: "student-1",
    version_id: first.version_id,
    version_side: "before",
    expected_revision: 2,
  });
});

test("accepts only an exactly bound mutation receipt", () => {
  const expected = { requestId: "restore-request", action: "restore", studentId: "student-1", studentName: "李四", expectedRevision: 2 };
  const receipt = { ok: true, operation: "students", request_id: "restore-request", action: "restore", updated: 1, student_id: "student-1", student_name: "李四", version_id: "student-profile-restored", profile_revision: 3, profile_history_count: 3, updated_at: "2026-09-14T04:00:00.000Z", total: 1, replayed: false, external_send: false };
  assert.equal(profileVersions.normalizeStudentProfileMutationReceipt(receipt, expected).profileRevision, 3);
  for (const value of [
    { ...receipt, api_key: "secret" },
    { ...receipt, student_id: "student-2" },
    { ...receipt, profile_revision: 2 },
    { ...receipt, version_id: null },
    { ...receipt, external_send: true },
  ]) assert.throws(() => profileVersions.normalizeStudentProfileMutationReceipt(value, expected), /响应无效/);
});
