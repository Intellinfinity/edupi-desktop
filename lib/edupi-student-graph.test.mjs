import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const graphModule = await createJiti(import.meta.url).import("./edupi-student-graph.ts");
const { buildStudentGraph, STUDENT_GRAPH_RECORD_LIMIT } = graphModule;

test("namesakes remain separate graph nodes through student IDs", () => {
  const graph = buildStudentGraph([{ id: "namesakes", kind: "interaction", students: ["张三", "张三"], student_ids: ["student-a", "student-b"], student_labels: ["张三 · A", "张三 · B"], summary: "共同讨论移项", topic: "移项" }]);
  const students = graph.nodes.filter((node) => node.kind === "student");
  assert.equal(students.length, 2);
  assert.deepEqual(students.map((node) => node.id), ["student:student-a", "student:student-b"]);
  assert.deepEqual(students.map((node) => node.label), ["张三 · A", "张三 · B"]);
});

test("shared interactions use one event node instead of inventing pairwise friendships", () => {
  const graph = buildStudentGraph([{ id: "one", kind: "interaction", students: ["甲", "乙", "丙"], summary: "共同完成小组练习", topic: "移项" }]);
  assert.equal(graph.nodes.filter((node) => node.kind === "record").length, 1);
  assert.equal(graph.edges.length, 4);
  assert.ok(graph.edges.every((edge) => edge.from.startsWith("record:") || edge.to.startsWith("record:")));
  assert.ok(graph.edges.every((edge) => edge.recordId === "one"));
});

test("duplicate participants do not create duplicate nodes or edges", () => {
  const graph = buildStudentGraph([{ id: "duplicate", kind: "interaction", students: ["甲", "甲", "乙"], student_ids: ["student-a", "student-a", "student-b"], summary: "小组讨论", topic: null }]);
  assert.equal(graph.nodes.filter((node) => node.kind === "student").length, 2);
  assert.equal(graph.edges.length, 2);
});

test("large graphs use a sixty-record window and never split an included event", () => {
  const records = Array.from({ length: 75 }, (_, index) => ({ id: String(index), kind: "learning", students: [`学生${index}`], summary: `学习记录${index}`, topic: "移项" }));
  const graph = buildStudentGraph(records);
  assert.equal(graph.records.length, STUDENT_GRAPH_RECORD_LIMIT);
  assert.equal(graph.omittedRecordCount, 15);
  assert.equal(graph.nodes.filter((node) => node.kind === "student").length, STUDENT_GRAPH_RECORD_LIMIT);

  const overLimit = buildStudentGraph([
    { id: "first", kind: "interaction", students: Array.from({ length: 80 }, (_, index) => `甲${index}`), summary: "第一组" },
    { id: "whole-event", kind: "interaction", students: Array.from({ length: 30 }, (_, index) => `乙${index}`), summary: "第二组" },
  ]);
  assert.deepEqual(overLimit.records.map((record) => record.id), ["first"]);
  assert.equal(overLimit.participantLimitReached, true);
  assert.equal(overLimit.nodes.filter((node) => node.kind === "student").length, 80);
});
