import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const { EduPiReceivedLessonProposal } = await createJiti(import.meta.url, {
  tsconfigPaths: true, jsx: { runtime: "automatic" },
}).import("./EduPiMaterialsWorkspace.tsx");

const material = { material_id: "material-synthetic", title: "合成教案", subject: "数学", class_id: "703",
  metadata_revision: 1, available: true };
const task = { id: "lesson-task", title: "合成课次" };
const proposal = { status: "proposed", material_id: material.material_id, source_hash: `sha256:${"a".repeat(64)}`,
  metadata_revision: 1, lesson_date: "2035-10-12", lesson_date_path: "word/document.xml/w:p[0]",
  lesson: { slot_id: "lesson-slot", task_id: task.id, source_event_date: "2035-10-12",
    starts_at: "2035-10-12T01:00:00.000Z", time_zone: "Asia/Shanghai" },
  basis_hash: `sha256:${"b".repeat(64)}`, reason_code: null,
  read_only: true, automatic_prepare: false, external_send: false };
const render = (value, data) => renderToStaticMarkup(React.createElement(EduPiReceivedLessonProposal,
  { title: "合成教案.docx", proposal: value, data, onTask() { throw new Error("render must not open task"); } }));

test("DOCX lesson suggestion stays collapsed, review-only and bound to the current material revision", () => {
  const data = { teacherMaterials: [material], tasks: [task] };
  const current = render(proposal, data);
  assert.match(current, /<summary>备课建议 <span>待核对<\/span><\/summary>/);
  assert.match(current, /2035-10-12/);
  assert.match(current, /查看课次任务/);
  assert.match(current, /未启动备课/);
  assert.doesNotMatch(current, /<details[^>]*open|确认采用|自动备课|已完成/);

  const stale = render(proposal, { ...data, teacherMaterials: [{ ...material, metadata_revision: 2 }] });
  assert.match(stale, /已失效/);
  assert.doesNotMatch(stale, /查看课次任务|对应课次：/);
  const absent = render(proposal, { ...data, teacherMaterials: [] });
  assert.match(absent, /已失效/);
  assert.doesNotMatch(absent, /查看课次任务/);
});

test("held and unavailable DOCX proposals never expose a lesson or adoption control", () => {
  const data = { teacherMaterials: [material], tasks: [task] };
  for (const status of ["held", "unavailable"]) {
    const html = render({ status, material_id: material.material_id, lesson: null, reason_code: "lesson_date_required",
      read_only: true, automatic_prepare: false, external_send: false }, data);
    assert.match(html, /授课日期待核对/);
    assert.doesNotMatch(html, /查看课次任务|确认采用|自动备课/);
  }
});
