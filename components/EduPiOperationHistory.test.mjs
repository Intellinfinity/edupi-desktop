import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createJiti } from "jiti";

const { EduPiOperationHistory } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiOperationHistory.tsx");

test("renders Core operation history as an audit trail", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiOperationHistory, { rows: [{ id: "history-1", action: "写入校历", status: "modified", at: "2026-09-14T02:00:00.000Z", note: "修正日期" }] }));
  assert.match(html, /操作历史/);
  assert.match(html, /写入校历/);
  assert.match(html, /已更新/);
  assert.match(html, /修正日期/);
});
