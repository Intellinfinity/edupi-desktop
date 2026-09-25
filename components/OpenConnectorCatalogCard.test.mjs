import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createJiti } from "jiti";

const { OpenConnectorCatalogCard, isCatalogResult } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./OpenConnectorCatalogCard.tsx");

test("catalog UI rejects malformed server data before rendering", () => {
  assert.equal(isCatalogResult({ kind: "search", actions: [{ id: "npm.get_package", name: "get_package", service: "npm", description: "Safe" }], limited: false }), true);
  assert.equal(isCatalogResult({ kind: "search", actions: [{ id: "npm.get_package", name: { html: "bad" } }], limited: false }), false);
  assert.equal(isCatalogResult({ kind: "inspect", action: { id: "npm.get_package", name: "get_package", service: "npm", description: "Safe" }, fields: [{ name: "packageName", type: "string", description: "Name", required: true }], limited: false }), true);
  assert.equal(isCatalogResult({ kind: "inspect", action: { id: "npm.get_package" }, fields: "bad" }), false);
});

test("management center exposes a read-only connector catalog without an execute action", async () => {
  const html = renderToStaticMarkup(React.createElement(OpenConnectorCatalogCard));
  const admin = await readFile(new URL("./EduPiAdminPanel.tsx", import.meta.url), "utf8");
  assert.match(html, /<h2>OpenConnector<\/h2><span>只读目录<\/span>/);
  assert.match(html, /<form role="search"/);
  assert.match(html, /<label[^>]*><span[^>]*>搜索连接器操作<\/span>/);
  assert.match(html, /disabled=""[^>]*>查找<\/button>/);
  assert.doesNotMatch(html, /<button[^>]*>执行<\/button>/);
  assert.match(admin, /<OpenConnectorCatalogCard \/>/);
});

test("catalog UI uses only the privileged desktop API and inspects a selected result", async () => {
  const source = await readFile(new URL("./OpenConnectorCatalogCard.tsx", import.meta.url), "utf8");
  assert.match(source, /fetchDesktopApi\("\/api\/desktop\/openconnector\/catalog"/);
  assert.match(source, /op: "search"/);
  assert.match(source, /op: "inspect"/);
  assert.match(source, /setActions\(\[\]\);[\s\S]*setSearched\(false\)/);
  assert.match(source, /disabled=\{!desktop\} readOnly=\{Boolean\(busy\)\} maxLength=\{200\}/);
  assert.match(source, /onChange=\{\(event\) => \{ setQuery\(event\.target\.value\); setActions\(\[\]\); setSelected\(null\); setSearched\(false\);/);
  assert.match(source, /aria-disabled=\{Boolean\(busy\)\} onClick=\{\(\) => void inspect\(action\.id\)\}/);
  assert.match(source, /async function inspect[\s\S]*setSelected\(null\)[\s\S]*requestCatalog/);
  assert.match(source, /type="submit" disabled=\{!desktop \|\| !query\.trim\(\) \|\| Boolean\(busy\)\}/);
  assert.match(source, /if \(!isTauriDesktop\(\)\) throw/);
  assert.match(source, /type="button"[^>]*disabled=\{Boolean\(busy\)\}[^>]*aria-pressed/);
  assert.match(source, /inspectHeadingRef\.current\?\.focus\(\)/);
  assert.match(source, /<h4 ref=\{inspectHeadingRef\} tabIndex=\{-1\}>/);
  assert.doesNotMatch(source, /op: "execute"|fetch\("https?:\/\//);
});
