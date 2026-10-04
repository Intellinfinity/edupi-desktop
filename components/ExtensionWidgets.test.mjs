import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
import fs from "node:fs";
import ts from "typescript";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ExtensionWidgets } = await jiti.import("./ChatWindow.tsx");
const layers = { key: "edupi-layers", lines: ["感知 → 记忆 → (潜意识…) → 意识 → 能力 → 交付"] };
const warning = { key: "extension-warning", lines: ["需要教师处理的提示"] };
const render = (widgets, teacherMode) => renderToStaticMarkup(React.createElement(ExtensionWidgets, { widgets, teacherMode }));

test("teacher chat removes the redundant layer widget without hiding other extensions", () => {
  const html = render([layers, warning], true);
  assert.doesNotMatch(html, /edupi-layers|潜意识/);
  assert.match(html, /extension-warning/);
  assert.match(html, /需要教师处理的提示/);
});

test("a lone layer widget leaves no empty teacher-chat container", () => {
  assert.equal(render([layers], true), "");
});

test("ordinary Pi chat still renders the original extension widgets", () => {
  assert.match(render([layers, warning], false), /edupi-layers/);
  assert.match(render([layers]), /潜意识/);
  assert.equal(render([], true), "");
});

test("only the teacher shell opts into teacher-mode widget presentation", () => {
  const source = ts.createSourceFile("AppShell.tsx", fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const callers = [];
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "ChatWindow") callers.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(callers.length, 2);
  for (const caller of callers) {
    const attributes = caller.attributes.properties.filter(ts.isJsxAttribute);
    const key = attributes.find(attribute => attribute.name.getText(source) === "key").initializer.getText(source);
    assert.equal(attributes.some(attribute => attribute.name.getText(source) === "teacherMode"), key.includes("edupi-chat-"));
  }
});
