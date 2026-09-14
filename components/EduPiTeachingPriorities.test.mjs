import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createJiti } from "jiti";

const { EduPiTeachingPriorities } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiTeachingPriorities.tsx");
const priority = { id: "priority-1", subject: "数学", className: "703", topic: "移项", note: "先补变号", status: "active", revision: 2, historyCount: 2, createdAt: "2026-09-15T00:00:00.000Z", updatedAt: "2026-09-15T01:00:00.000Z", externalSend: false };
const props = { priorities: [priority], defaultSubject: "数学", defaultClassName: "703", query: "", onEducation() {}, onStartAgent() {}, async onDeleteEntity() { return true; } };

test("renders teacher priorities separately with direct lifecycle actions", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiTeachingPriorities, props));
  assert.match(html, /教师维护的重点/);
  assert.match(html, /新增重点/);
  assert.match(html, /移项/);
  assert.match(html, /先补变号/);
  assert.match(html, /703/);
  assert.match(html, /进行中/);
  assert.match(html, /正在读取…/);
  assert.doesNotMatch(html, /暂无历史版本/);
  for (const label of ["修改", "AI 协作", "暂停", "完成", "删除", "历史"]) assert.match(html, new RegExp(label));
});

test("shows a truthful empty state and keeps AI drafting available", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiTeachingPriorities, { ...props, priorities: [] }));
  assert.match(html, /还没有教师维护的教学重点/);
  assert.match(html, /对话整理重点/);
});

test("teaching priority UI uses Core APIs, full restore wording, and unified deletion", async () => {
  const [component, workspace, views, css] = await Promise.all([
    readFile(new URL("./EduPiTeachingPriorities.tsx", import.meta.url), "utf8"),
    readFile(new URL("./EduPiTeachingWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("./EduPiWorkspaceViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/edupi-workbench.css", import.meta.url), "utf8"),
  ]);
  assert.match(component, /\/api\/edupi\/teaching-priorities/);
  assert.match(component, /onEducation\(result\.data\)/);
  assert.match(component, /method: editor\.mode === "create" \? "POST" : "PUT"/);
  assert.match(component, /恢复会同时替换学科、班级、主题、说明和状态/);
  assert.match(component, />重试<\/button>/);
  assert.match(component, /onDeleteEntity\("teaching_priority"/);
  assert.match(component, /我最近要补充或修改的教学重点（在这里输入或口述）/);
  assert.match(workspace, /continuity\.teachingPriorities/);
  assert.match(workspace, /<EduPiTeachingPriorities/);
  assert.match(views, /onDeleteEntity=\{props\.onDeleteEntity\}/);
  assert.match(css, /\.edupi-teaching-priorities/);
  assert.match(css, /\.edupi-priority-history__sides/);
});
