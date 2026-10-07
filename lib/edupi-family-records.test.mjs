import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { parseFamilyCaptureInput, familyQualityLabel } = await jiti.import("./edupi-family-record-model.ts");
const { familyCaptureRequest } = await jiti.import("./edupi-family-records.ts");
const { buildFamilyGraph } = await jiti.import("./edupi-family-graph.ts");
const input = { studentId: "student-a", parentEntityId: null, parent: { external_id: "family-local-person-0001", label: "测试联系人" },
  record: { recorded_relationship: "母亲", teacher_explicit_quality: "supportive", observed_on: null, note: "教师明确记录配合" },
  source: { source_id: "manual-source-1", source_revision: "1", raw_text: "老师原文，日期未知。", observed_at: "2026-10-08T01:00:00.000Z", actor_ref: "desktop-teacher" } };

test("family form permits unknown date but refuses inferred identity and guardian claims", () => {
  assert.deepEqual(parseFamilyCaptureInput(input), input);
  for (const patch of [
    { studentId: "" }, { parentEntityId: "entity_" + "1".repeat(32) },
    { parent: { ...input.parent, namespace: "arbitrary" } }, { parent: { external_id: "测试联系人", label: "测试联系人" } },
    { record: { ...input.record, guardian_verification: "verified" } }, { record: { ...input.record, observed_on: "2026-02-30" } },
    { source: { ...input.source, token: "forged" } }, { confidence: { basis: "explicit", score: 1 } },
  ]) assert.equal(parseFamilyCaptureInput({ ...input, ...patch }), null);
  assert.equal(parseFamilyCaptureInput({ ...input, parent: null, parentEntityId: "entity_" + "1".repeat(32) }).parentEntityId, "entity_" + "1".repeat(32));
  assert.equal(parseFamilyCaptureInput({ ...input, source: { ...input.source, raw_text: " 原文：Ａ、全角标点。\n " } }).source.raw_text, " 原文：Ａ、全角标点。\n ", "raw source is not normalized into another teacher statement");
});
test("capture wire matches the actual Core golden request ID regardless of property order", () => {
  // Golden emitted by Core educationFactRequestId, not another local hash helper.
  const golden = "education-fact-capture_family_record-Cf55IK657Y9B-fUgMVo3HyR9HseNWJ03Jc3EsqgFpXk";
  assert.equal(familyCaptureRequest(input).request_id, golden);
  const reverse = (value) => Object.fromEntries(Object.entries(value).reverse());
  assert.equal(familyCaptureRequest({ ...input, parent: reverse(input.parent), record: reverse(input.record), source: reverse(input.source) }).request_id, golden);
  assert.notEqual(familyCaptureRequest({ ...input, source: { ...input.source, source_id: "separate-event" } }).request_id, golden);
  assert.notEqual(familyCaptureRequest({ ...input, source: { ...input.source, source_revision: "2" } }).request_id, golden);
  assert.notEqual(familyCaptureRequest({ ...input, studentId: "different-class-student" }).request_id, golden);
});

const student = { id: "student-entity-a", label: "同名学生" };
const parentA = { entity_id: "parent-entity-a", entity_kind: "parent", canonical_name: "同名联系人", status: "active" };
const parentB = { ...parentA, entity_id: "parent-entity-b" };
const row = { fact_id: "family-fact-a", student_entity_id: student.id, parent_entity_id: parentA.entity_id, status: "accepted", display_quality: "supportive", mutation_allowed: true,
  record: { ...input.record, guardian_verification: "unknown" }, source: { status: "active" } };

test("family graph binds people by endpoint IDs and never merges names or classes", () => {
  const graph = buildFamilyGraph(student, [parentA, parentB], [row, { ...row, fact_id: "family-fact-b", parent_entity_id: parentB.entity_id }, { ...row, fact_id: "wrong-class", student_entity_id: "student-entity-other" }]);
  assert.equal(graph.nodes.filter((node) => node.kind === "topic").length, 2);
  assert.deepEqual(graph.records.map((record) => record.id), ["family-fact-a", "family-fact-b"]);
  assert.equal(graph.edges.every((edge) => edge.tone === "supportive"), true);
  assert.equal(graph.nodes.find((node) => node.id === "record:family-fact-a").label, "日期未记录 · 配合");
  assert.equal(graph.nodes.some((node) => /已核实|已验证|好坏|评分/.test(node.label)), false);
});
test("pending, deleted and source-stale events never become confirmed relationship quality", () => {
  for (const patch of [{ status: "pending_review" }, { status: "deleted" }, { source: { status: "stale" } }, { display_quality: "unknown", mutation_allowed: false }]) {
    const graph = buildFamilyGraph(student, [parentA], [{ ...row, ...patch }]);
    assert.equal(graph.edges.every((edge) => edge.tone === "unknown"), true);
  }
  assert.equal(familyQualityLabel("unknown"), "未判断");
});
test("deleted, rejected, superseded and source-unavailable records leave the current graph but remain in history", () => {
  for (const patch of [{ status: "deleted" }, { status: "rejected" }, { status: "superseded" }, { status: "stale" }, { source: { status: "stale" } }, { mutation_allowed: false }]) {
    const record = { ...row, ...patch };
    const graph = buildFamilyGraph(student, [parentA], [record]);
    assert.equal(graph.edges.length, 0);
    assert.equal(graph.nodes.length, 0);
    assert.equal(record.fact_id, row.fact_id);
  }
});
test("family graph caps visible records without removing the complete history object", () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({ ...row, fact_id: `family-fact-${index}` }));
  const graph = buildFamilyGraph(student, [parentA], rows);
  assert.equal(graph.records.length, 60);
  assert.equal(graph.omittedRecordCount, 40);
  assert.equal(rows.length, 100);
});
