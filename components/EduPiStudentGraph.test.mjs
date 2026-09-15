import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const { EduPiStudentGraph } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiStudentGraph.tsx");
const records = [{ id: "event-1", kind: "interaction", students: ["张三", "张三", "李四"], student_ids: ["student-a", "student-b", "student-c"], student_labels: ["张三 · 703", "张三 · 704", "李四 · 703"], summary: "共同完成小组练习", topic: "方程讨论", observed_on: "2026-09-15", recorded_at: "2026-09-15T00:00:00.000Z", updated_at: "2026-09-15T00:00:00.000Z", revision: 0, source: { session_id: "session", message_id: "message", text: "课堂观察" }, history: [] }];

test("interaction graph uses event semantics, stable students and loaded totals", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiStudentGraph, { records, total: 45, kind: "interaction", selectedId: null, onSelect() {} }));
  assert.match(html, /互动事件/);
  assert.match(html, /活动主题/);
  assert.match(html, /学生：张三 · 703/);
  assert.match(html, /学生：张三 · 704/);
  assert.match(html, /已加载 1 \/ 45 条记录/);
  assert.doesNotMatch(html, />知识点</);
});

test("learning graph exposes zoom, reset, keyboard edge targets and source record selection", () => {
  const learning = [{ ...records[0], kind: "learning", students: ["张三"], student_ids: ["student-a"], student_labels: ["张三 · 703"] }];
  const html = renderToStaticMarkup(React.createElement(EduPiStudentGraph, { records: learning, total: 1, kind: "learning", selectedId: "event-1", onSelect() {} }));
  assert.match(html, /知识点/);
  assert.match(html, /缩小图谱/);
  assert.match(html, /放大图谱/);
  assert.match(html, />复位</);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /is-selected/);
});
