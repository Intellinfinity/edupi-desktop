import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const { EduPiDeletedEntities, deletedHistoryBadgeCount } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiDeletedEntities.tsx");

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

test("loaded history replaces a missing summary count without reducing a known total", () => {
  assert.equal(deletedHistoryBadgeCount(0, 3), 3);
  assert.equal(deletedHistoryBadgeCount(18, 10), 18);
});
