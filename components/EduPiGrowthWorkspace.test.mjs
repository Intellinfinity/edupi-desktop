import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const { EduPiGrowthWorkspace } = await jiti.import("./EduPiGrowthWorkspace.tsx");
const { EduPiTeachingMethodEditor } = await jiti.import("./EduPiTeachingMethodEditor.tsx");

const task = { id: "task-1", title: "703班单元检测", trigger: "teacher_created", status: "planned", contentStatus: null, deliveryStatus: null, deliverables: [], evidence: {}, boardStage: "done" };
const data = { continuity: { documents: [{ id: "weekly", kind: "weekly", title: "教学复盘", excerpt: "复盘", path: ".edupi/output/weekly/a.md", date: "2026-09-09" }, { id: "insight", kind: "insight", title: "观察分析报告", excerpt: "观察", path: ".edupi/output/insight/a.md" }] }, tasks: [task], dataSources: { growth: { present: true } }, workspace: "/isolated" };
const managedSkill = { skillId: "method-1", title: "错因分组讲评", lifecycleState: "trial", trialCount: 1, evidenceIds: ["evidence"], updatedAt: "2026-09-15T01:00:00.000Z", canReuse: false, origin: "managed", revision: 1, contentRevision: 1, availableActions: ["update", "record_trial", "validate", "retire"], details: { content: "先独立作答，再按错因分组。", truncated: false, retirementReason: null, approval: null, evaluation: null, trials: [{ trialId: "trial-1", contentRevision: 1, taskId: "task-1", taskTitle: "703班单元检测", at: "2026-09-15T01:00:00.000Z", outcome: "helpful", feedback: "讲评更集中。", evidence: [], artifactIds: [] }], files: [] } };
const growth = { growthId: "growth-1", methodId: "method-1", methodTitle: "错因分组讲评", contentRevision: 1, taskId: "task-1", taskTitle: "703班单元检测", outcome: "helpful", feedback: "讲评更集中。", evidenceIds: [], artifactIds: [], recordedAt: "2026-09-15T01:00:00.000Z" };
const render = (teachingSkills, selectedObjectId = "growth:edupi") => renderToStaticMarkup(React.createElement(EduPiGrowthWorkspace, { data, teachingSkills, query: "", selectedObjectId, onOpenFile() {}, onTask() {}, onStartAgent() {}, onTeachingSkills() {} }));

test("teacher growth lists real method feedback and reflections without reclassifying insight reports", () => {
  const html = render({ status: "ready", skills: [managedSkill], mutationEnabled: true, teacherGrowth: [growth], mutationReceipts: [], generatedAt: null }, "growth:teacher");
  assert.match(html, /方法试用/);
  assert.match(html, /讲评更集中/);
  assert.match(html, /查看任务/);
  assert.match(html, /教学复盘/);
  assert.doesNotMatch(html, /观察分析报告/);
});

test("managed growth shows direct lifecycle actions while legacy methods stay read only", () => {
  const managed = render({ status: "ready", skills: [managedSkill], mutationEnabled: true, teacherGrowth: [], mutationReceipts: [], generatedAt: null });
  for (const label of ["修订", "记录试用", "验证", "停用"]) assert.match(managed, new RegExp(label));
  assert.match(managed, /先独立作答/);
  assert.match(managed, /查看任务/);

  const legacy = render({ status: "ready", skills: [{ ...managedSkill, skillId: "legacy", origin: "legacy_read_only", revision: null, contentRevision: null, availableActions: [] }], mutationEnabled: true, teacherGrowth: [], mutationReceipts: [], generatedAt: null });
  assert.match(legacy, /历史方法只读保留/);
  assert.doesNotMatch(legacy, />记录试用</);
});

test("frozen lifecycle renders evidence without mutation controls", () => {
  const html = render({ status: "ready", skills: [{ ...managedSkill, availableActions: [] }], mutationEnabled: false, teacherGrowth: [], mutationReceipts: [], generatedAt: null });
  assert.match(html, /先独立作答/);
  assert.match(html, /当前版本不能修改/);
  assert.doesNotMatch(html, /新增教学方法/);
});

test("method editor requires managed mutation capability and renders task-bound feedback fields", () => {
  const frozen = renderToStaticMarkup(React.createElement(EduPiTeachingMethodEditor, { mode: "create", onSaved() {} }));
  assert.match(frozen, /当前教学方法不可编辑/);
  assert.doesNotMatch(frozen, /<form|<button/);
  const trial = renderToStaticMarkup(React.createElement(EduPiTeachingMethodEditor, { mode: "record_trial", method: managedSkill, tasks: [{ ...task, id: "auto", title: "自动待确认任务", trigger: "teaching_before_class" }, task], mutationEnabled: true, onSaved() {} }));
  assert.match(trial, /教学任务/);
  assert.match(trial, /703班单元检测/);
  assert.match(trial, /实际效果/);
  assert.match(trial, /课堂反馈/);
  assert.doesNotMatch(trial, /自动待确认任务/);
});
