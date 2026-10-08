import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const { EduPiDocxSourceSelection, selectableDocxSource, selectedDocxSpans } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiDocxSourceSelection.tsx");

test("DOCX selection keeps document order, cell granularity and UTF-16 offsets", () => {
  const preview = { version: 1, format: "docx", status: "ready", basis_hash: `sha256:${"a".repeat(64)}`, issues: [], blocks: [
    { path: "p-1", text: "A😀" },
    { path: "row", text: "左\t右", cells: [{ path: "row/cell-1", text: "左" }, { path: "row/cell-2", text: "右" }] },
  ] };
  assert.deepEqual(selectableDocxSource(preview).map(item => item.path), ["p-1", "row/cell-1", "row/cell-2"]);
  assert.deepEqual(selectedDocxSpans(preview, new Set(["row/cell-2", "row", "p-1"])), [
    { path: "p-1", start: 0, end: 3 }, { path: "row/cell-2", start: 0, end: 1 },
  ]);
  assert.match(renderToStaticMarkup(React.createElement(EduPiDocxSourceSelection, { materialId: "material", expectedRevision: 0, onSettled() {} })), /从 DOCX 原文选取/);
});
