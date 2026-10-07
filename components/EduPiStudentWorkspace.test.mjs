import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { EduPiStudentWorkspace } = await jiti.import("./EduPiStudentWorkspace.tsx");
const { EduPiObjectSider } = await jiti.import("./EduPiObjectSider.tsx");
const { buildEducationContract } = await jiti.import("../lib/edupi-education-contract.ts");

const student = { student_id: "synthetic-student-a", name: "合成学生甲", class_name: "测试班", updated_at: "2026-10-07T00:00:00Z", error_patterns: [], trajectory: [] };
const createData = () => buildEducationContract({ workspace: "/tmp/edupi-student-synthetic", students: [student] });
const render = (data) => renderToStaticMarkup(React.createElement(EduPiStudentWorkspace, { mode: "homeroom", data, context: null, query: "", selectedStudentId: student.student_id, onStudent() {}, onEducation() {}, onTask() {}, onStartAgent() {}, async onDeleteEntity() { return true; } }));

test("student terms name the real records without decorative headings or zero metrics", () => {
  const html = render(createData());
  assert.match(html, /学习记录/);
  assert.match(html, /学习问题/);
  assert.match(html, /成长记录/);
  assert.match(html, /暂无学习问题记录/);
  assert.doesNotMatch(html, /学习模式|成长节点|班级工作区|观察中模式|edupi-student-drawer__metrics|0 条学习问题/);
});

test("family contacts preserve recorded labels and outcomes while leaving guardian identity unverified", () => {
  const data = createData();
  data.continuity.familyContacts = [{ id: "synthetic-contact-a", student: student.student_id, name: "合成联系人甲", relationship: "母亲", communicationStyle: ["预约沟通"], concerns: ["合成练习安排"], historyCount: 1, lastContactAt: "2026-10-06T00:00:00Z", lastTopic: "合成练习沟通", lastOutcome: "教师记录：愿意协助复习" }];
  const html = render(data);
  assert.match(html, /记录称谓：母亲/);
  assert.match(html, /监护身份待核实/);
  assert.match(html, /教师记录：愿意协助复习/);
  assert.match(html, /原始来源/);
  assert.match(html, /当前记录未提供/);
  assert.doesNotMatch(html, /已核实监护|关系良好|关系评分|is-parent/);
});

test("ambiguous name-only family contacts are not attached to a surviving namesake", () => {
  const data = createData();
  data.studentNameCounts = { [student.name]: 2 };
  data.continuity.familyContacts = [{ id: "synthetic-ambiguous-contact", student: student.name, name: "歧义联系人", relationship: "父亲", communicationStyle: [], concerns: [], historyCount: 0, lastContactAt: null, lastTopic: null, lastOutcome: null }];
  assert.doesNotMatch(render(data), /歧义联系人|记录称谓：父亲/);
  data.continuity.familyContacts[0].student = student.student_id;
  assert.match(render(data), /歧义联系人/);
});

test("the student sidebar preserves real class and observation text without zero counters", () => {
  const data = createData();
  const sidebar = () => renderToStaticMarkup(React.createElement(EduPiObjectSider, { view: "homeroom", data, context: null, memoryScopes: null, teachingSkills: { skills: [] }, query: "", selectedStudentId: student.student_id, selectedObjectId: null, selectedTaskKey: null, onQuery() {}, onStudent() {}, onObject() {}, onTask() {}, onUpload() {}, onCollapse() {} }));
  assert.match(sidebar(), /测试班/);
  assert.doesNotMatch(sidebar(), /当前模块|个模式|个节点|0 条成长记录/);
  data.students[0].error_patterns = [{ description: "合成学习观察" }];
  data.students[0].trajectory = [{ event: "合成成长观察" }];
  assert.match(sidebar(), /测试班 · 合成学习观察 · 1 条成长记录/);
});
