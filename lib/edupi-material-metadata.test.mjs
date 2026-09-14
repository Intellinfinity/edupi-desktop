import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const metadata = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-material-metadata.ts");
const before = { title: "第一课教案", kind: "lesson_note", subject: "数学", classId: "703" };
const after = { title: "移项教案", kind: "worksheet", subject: "数学", classId: "704" };
const changedAt = "2026-09-15T00:01:00.000Z";
const requestId = "material-metadata-update-1";
const wire = (value) => ({ title: value.title, kind: value.kind, subject: value.subject, class_id: value.classId });
const identity = JSON.stringify({ material_id: "material-1", revision: 1, before: wire(before), after: wire(after), changed_at: changedAt, source_kind: "teacher_edit", request_id: requestId });
const versionId = `material-metadata-version-${createHash("sha256").update(identity).digest("base64url")}`;
const rawVersion = { version_id: versionId, material_id: "material-1", revision: 1, before: wire(before), after: wire(after), changed_fields: ["title", "kind", "class_id"], changed_at: changedAt, source_kind: "teacher_edit", request_id: requestId };
const rawHistory = { material_id: "material-1", revision: 1, history_count: 1, versions: [rawVersion], external_send: false };

test("normalizes one content-bound material metadata version chain", () => {
  const history = metadata.normalizeMaterialMetadataHistory(rawHistory, "material-1");
  assert.equal(history.revision, 1);
  assert.equal(history.versions[0].versionId, versionId);
  assert.deepEqual(history.versions[0].beforeValues, before);
  assert.deepEqual(history.versions[0].afterValues, after);
});

test("rejects forged, reordered, oversized, and cross-material metadata histories", () => {
  for (const value of [
    { ...rawHistory, material_id: "material-2" },
    { ...rawHistory, history_count: 0 },
    { ...rawHistory, versions: [{ ...rawVersion, version_id: "forged" }] },
    { ...rawHistory, versions: [{ ...rawVersion, changed_fields: ["title"] }] },
    { ...rawHistory, versions: [{ ...rawVersion, after: { ...rawVersion.after, token: "secret" } }] },
    { ...rawHistory, history_count: 51, versions: Array.from({ length: 51 }, () => rawVersion) },
  ]) assert.throws(() => metadata.normalizeMaterialMetadataHistory(value, "material-1"));
});

test("binds update and restore request identities to every semantic field", () => {
  const update = { materialId: "material-1", expectedRevision: 1, patch: { title: "移项教案", classId: "704" } };
  assert.equal(metadata.materialMetadataUpdateRequestId(update), metadata.materialMetadataUpdateRequestId(structuredClone(update)));
  assert.notEqual(metadata.materialMetadataUpdateRequestId(update), metadata.materialMetadataUpdateRequestId({ ...update, patch: { ...update.patch, classId: "705" } }));
  const restore = { materialId: "material-1", versionId, versionSide: "before", expectedRevision: 1 };
  assert.equal(metadata.materialMetadataRestoreRequestId(restore), metadata.materialMetadataRestoreRequestId(structuredClone(restore)));
  assert.notEqual(metadata.materialMetadataRestoreRequestId(restore), metadata.materialMetadataRestoreRequestId({ ...restore, versionSide: "after" }));
});

test("submits only metadata fields changed from the editor base revision", () => {
  const base = { title: "原教案", kind: "lesson_note", subject: "数学", classId: "703" };
  assert.deepEqual(metadata.materialMetadataPatch(base, { ...base, title: "新教案" }), { title: "新教案" });
  assert.deepEqual(metadata.materialMetadataPatch(base, base), {});
});

test("accepts only exact action-bound material metadata receipts", () => {
  const raw = { ok: true, operation: "material-metadata", request_id: requestId, action: "update", material_id: "material-1", version_id: versionId, revision: 1, history_count: 1, updated_at: changedAt, replayed: false, external_send: false };
  assert.equal(metadata.normalizeMaterialMetadataReceipt(raw, { requestId, action: "update", materialId: "material-1", expectedRevision: 0 }).revision, 1);
  assert.throws(() => metadata.normalizeMaterialMetadataReceipt({ ...raw, material_id: "material-2" }, { requestId, action: "update", materialId: "material-1", expectedRevision: 0 }));
  assert.throws(() => metadata.normalizeMaterialMetadataReceipt({ ...raw, api_key: "secret" }, { requestId, action: "update", materialId: "material-1", expectedRevision: 0 }));
});
