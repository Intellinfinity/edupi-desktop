import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const versions = await createJiti(import.meta.url, { interopDefault: true, moduleCache: false }).import("./edupi-teacher-context-versions.ts");

const first = {
  version_id: "review-1",
  context_id: "context_teacher",
  revision: 1,
  before_values: {},
  after_values: { name: "李老师", grade: "七年级" },
  changed_fields: ["name", "grade"],
  reviewed_at: "2026-09-14T00:00:00.000Z",
  reviewer_id: "teacher",
  note: "首次保存",
  receipt_id: "receipt-1",
  external_send: false,
};

const second = {
  ...first,
  version_id: "review-2",
  revision: 3,
  before_values: { name: "李老师", grade: "七年级" },
  after_values: { name: "李老师", grade: "八年级" },
  changed_fields: ["grade"],
  reviewed_at: "2026-09-14T01:00:00.000Z",
  note: null,
  receipt_id: "receipt-2",
};

test("normalizes bounded Core teacher-context field versions", () => {
  const result = versions.normalizeTeacherContextVersions([first, second]);
  assert.deepEqual(result[0].beforeValues, {});
  assert.deepEqual(result[1].changedFields, ["grade"]);
  assert.equal(result[1].revision, 3);
  assert.equal(result[1].externalSend, false);
});

test("rejects forged, inconsistent and reordered version history", () => {
  const invalid = [
    [{ ...first, api_key: "secret" }],
    [{ ...first, changed_fields: ["name"] }],
    [{ ...first, after_values: { name: "x".repeat(121) } }],
    [first, { ...second, version_id: first.version_id }],
    [second, first],
  ];
  for (const candidate of invalid) assert.throws(() => versions.normalizeTeacherContextVersions(candidate), /版本/);
});

test("derives stable restore request ids from the complete restore identity", () => {
  const input = { versionId: "review-2", versionSide: "before", fieldKey: "grade", expectedRevision: 3, expectedSourceId: "source-3" };
  const id = versions.teacherContextRestoreRequestId(input);
  assert.equal(versions.teacherContextRestoreRequestId({ ...input }), id);
  for (const changed of [
    { ...input, versionId: "review-1" },
    { ...input, versionSide: "after" },
    { ...input, fieldKey: "name" },
    { ...input, expectedRevision: 4 },
    { ...input, expectedSourceId: "source-4" },
  ]) assert.notEqual(versions.teacherContextRestoreRequestId(changed), id);
});

test("reconciliation accepts only the one requested field change", () => {
  const [normalized] = versions.normalizeTeacherContextVersions([{
    ...second,
    revision: 4,
    before_values: { name: "李老师", grade: "八年级", class_name: "703" },
    after_values: { name: "李老师", grade: "八年级" },
    changed_fields: ["class_name"],
  }]);
  const expected = { contextId: "context_teacher", revision: 4, fieldKey: "class_name", desiredValue: null };
  assert.equal(versions.confirmsTeacherContextFieldRestore([normalized], expected), true);
  assert.equal(versions.confirmsTeacherContextFieldRestore([{ ...normalized, changedFields: ["grade", "class_name"] }], expected), false);
  assert.equal(versions.confirmsTeacherContextFieldRestore([normalized, { ...normalized, versionId: "review-other" }], expected), false);
  assert.equal(versions.confirmsTeacherContextFieldRestore([normalized], { ...expected, desiredValue: "703" }), false);
});
