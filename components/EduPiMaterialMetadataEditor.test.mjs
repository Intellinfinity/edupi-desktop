import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createJiti } from "jiti";

const { EduPiMaterialMetadataEditor } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiMaterialMetadataEditor.tsx");
const material = { material_id: "material-1", title: "移项教案", kind: "lesson_note", subject: "数学", class_id: "703", relative_path: ".edupi/inbox/teacher-materials/material-1.pdf", available: true, metadata_revision: 2, metadata_history_count: 2, metadata_updated_at: "2026-09-15T00:00:00.000Z", external_send: false };

test("renders direct material metadata editing, AI collaboration, and truthful history count", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiMaterialMetadataEditor, { material, classes: ["703", "704"], onEducation() {}, onStartAgent() {} }));
  assert.match(html, /材料信息/);
  assert.match(html, /修改信息/);
  assert.match(html, /AI 协作/);
  assert.match(html, /信息历史/);
  assert.match(html, />2<\/span>/);
  assert.match(html, /正在读取…/);
  assert.doesNotMatch(html, /暂无信息历史/);
});

test("material metadata editor uses only bounded Core routes and a teacher input slot", async () => {
  const [component, workspace, rows, views, css] = await Promise.all([
    readFile(new URL("./EduPiMaterialMetadataEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("./EduPiMaterialsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/edupi-material-rows.ts", import.meta.url), "utf8"),
    readFile(new URL("./EduPiWorkspaceViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/edupi-workbench.css", import.meta.url), "utf8"),
  ]);
  assert.match(component, /\/api\/edupi\/materials\/\$\{encodeURIComponent\(requestedMaterialId\)\}\/metadata/);
  assert.doesNotMatch(component, /from ["']@\/lib\/edupi-material-metadata["']/);
  assert.match(component, /AbortController/);
  assert.match(component, /恢复会同时替换名称、类型、学科和班级/);
  assert.match(component, /我要补充或修改的材料信息（在这里输入或口述）/);
  assert.match(workspace, /<EduPiMaterialMetadataEditor/);
  assert.match(workspace, /edupi-material-drawer__body/);
  assert.match(rows, /material: source/);
  assert.match(views, /onEducation=\{props\.onEducation\}/);
  assert.match(css, /\.edupi-material-metadata-history__sides/);
});
