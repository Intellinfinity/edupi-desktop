import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createJiti } from "jiti";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const { EduPiIconButton, EduPiPagination } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiActionIcon.tsx");

test("icon actions keep their names in accessibility and tooltips without visible labels", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiIconButton, { icon: "preview", label: "预览材料" }));
  assert.match(html, /aria-label="预览材料"/);
  assert.match(html, /title="预览材料"/);
  assert.doesNotMatch(html, />预览材料</);
  assert.match(html, /aria-hidden="true"/);
});

test("database pagination uses named arrow controls", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiPagination, { label: "材料分页", page: 1, pages: 3, previousDisabled: false, nextDisabled: false, onPrevious() {}, onNext() {} }));
  assert.match(html, /aria-label="材料分页"/);
  assert.match(html, /aria-label="上一页"/);
  assert.match(html, /aria-label="下一页"/);
  assert.match(html, />2 \/ 3</);
  assert.doesNotMatch(html, />上一页</);
  assert.doesNotMatch(html, />下一页</);
});

test("student and material drawers use icon actions for direct operations", async () => {
  const [panel, students, materials, metadata, css] = await Promise.all([read("./EduPiEducationPanel.tsx"), read("./EduPiStudentWorkspace.tsx"), read("./EduPiMaterialsWorkspace.tsx"), read("./EduPiMaterialMetadataEditor.tsx"), read("../app/edupi-workbench.css")]);
  for (const label of ["手动修改", "AI 协作", "删除学生档案", "关闭学生档案"]) assert.match(students, new RegExp(`label=(?:\\{[^}]*\\}|\")?[^\\n]*${label}`));
  assert.doesNotMatch(students, /icon="records"/);
  for (const label of ["关闭材料详情", "预览材料", "打开文件", "显示所在文件夹", "打开关联任务", "删除材料", "补充或修订材料"]) assert.match(materials, new RegExp(label));
  assert.match(metadata, /EduPiIconButton[^>]+label="修改材料信息"/);
  assert.match(css, /\.edupi-icon-action:focus-visible/);
  assert.match(css, /\.edupi-material-drawer > footer \.edupi-icon-action/);
  assert.match(css, /\.edupi-material-drawer__facts dd \{[^}]*overflow-wrap: anywhere;[^}]*white-space: pre-wrap;/);
  assert.match(css, /\.edupi-teacher-body\.has-body-controls \.edupi-module-heading/);
  assert.match(css, /padding-right: calc\(12px \+ var\(--edupi-body-controls-width, 0px\)\)/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.edupi-teacher-app \{ grid-column: 1; grid-row: 1; \}/);
  assert.match(panel, /education\.students\.some\(\(student, index\) => studentRecordKey\(student, index\) === selectedStudentId\)/);
  assert.match(panel, /const detailSurfaceOpen = Boolean\(drawer \|\| taskDetail \|\| calendarSelection \|\| studentDetailOpen/);
  assert.match(panel, /bodyControlCount > 0 && !detailSurfaceOpen/);
  assert.match(panel, /detailSurfaceOpen \? " has-detail-surface"/);
  assert.match(css, /\.edupi-teacher-body\.has-detail-surface > \.edupi-content-sider/);
});
