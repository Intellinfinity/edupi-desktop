import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const { EduPiDeletedEntities } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiDeletedEntities.tsx");

test("deleted entity control exposes the Core-backed count", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiDeletedEntities, {
    activeCount: 1,
    historyCount: 1,
    onLoad: async () => ({ deletions: [], history: [] }),
    onRestore: async () => {},
  }));
  assert.match(html, />已删除 1</);
});

test("deleted entity control remains available while the summary is unavailable", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiDeletedEntities, {
    activeCount: 0,
    historyCount: 0,
    countUnavailable: true,
    onLoad: async () => ({ deletions: [], history: [] }),
    onRestore: async () => {},
  }));
  assert.match(html, />删除记录</);
});
