import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
const { EduPiMaterialExcerpt } = await createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true }).import("./EduPiMaterialExcerpt.tsx");
test("excerpt starts collapsed and cannot confirm before authoritative read", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiMaterialExcerpt, { materialId: "material", onPreview() {} }));
  assert.match(html, /<summary>用于备课<\/summary>/);
  assert.match(html, /edupi-material-excerpt__body/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.match(html, /预览原材料/);
  assert.match(html, /disabled=""[^>]*>确认正文/);
  assert.doesNotMatch(html, /已确认|已撤回/);
});
