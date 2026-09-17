import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const { EduPiDeletedEntities, deletedHistoryBadgeCount } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiDeletedEntities.tsx");

test("deleted entities render as an embedded management surface", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiDeletedEntities, {
    activeCount: 1,
    historyCount: 1,
    onLoad: async () => ({ deletions: [], history: [] }),
    onRestore: async () => {},
  }));
  assert.match(html, /class="edupi-admin-recycle"/);
  assert.match(html, /aria-label="回收站"/);
  assert.match(html, />1 项可恢复</);
  assert.match(html, /aria-label="刷新回收站"/);
  assert.doesNotMatch(html, /createPortal|edupi-deleted-entities-backdrop/);
});

test("recycle bin remains available while the summary is unavailable", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiDeletedEntities, {
    activeCount: 0,
    historyCount: 0,
    countUnavailable: true,
    onLoad: async () => ({ deletions: [], history: [] }),
    onRestore: async () => {},
  }));
  assert.match(html, /aria-label="回收站"/);
  assert.match(html, />数量暂不可用</);
});

test("loaded history replaces a missing summary count without reducing a known total", () => {
  assert.equal(deletedHistoryBadgeCount(0, 3), 3);
  assert.equal(deletedHistoryBadgeCount(18, 10), 18);
});
