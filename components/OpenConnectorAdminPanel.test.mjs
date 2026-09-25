import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createJiti } from "jiti";

const { OpenConnectorAdminPanel, isCatalogResult } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./OpenConnectorAdminPanel.tsx");

test("admin accepts only bounded projected provider, action and inspect results", () => {
  const provider = { service: "npm", displayName: "npm", categories: ["Developer Tools"], authTypes: ["no_auth"], scenario: "development" };
  const action = { id: "npm.get_package", service: "npm", name: "get_package", description: "Read package" };
  assert.equal(isCatalogResult({ kind: "providers", providers: [provider], total: 1, limited: false }), true);
  assert.equal(isCatalogResult({ kind: "providers", providers: [{ ...provider, authTypes: "unsafe" }], total: 1, limited: false }), false);
  assert.equal(isCatalogResult({ kind: "actions", service: "npm", actions: [action], total: 1, limited: false }), true);
  assert.equal(isCatalogResult({ kind: "actions", service: "npm", actions: [{ ...action, service: "github" }], total: 1, limited: false }), false);
  assert.equal(isCatalogResult({ kind: "inspect", action, fields: [{ name: "packageName", type: "string", description: "Name", required: true }], limited: false }), true);
  assert.equal(isCatalogResult({ kind: "inspect", action, fields: [{ name: "packageName", type: { html: "bad" } }], limited: false }), false);
});

test("separate OpenConnector admin exposes provider browsing and action search without execution", async () => {
  const html = renderToStaticMarkup(React.createElement(OpenConnectorAdminPanel));
  const admin = await readFile(new URL("./EduPiAdminPanel.tsx", import.meta.url), "utf8");
  assert.match(html, /aria-label="OpenConnector 管理后台"/);
  assert.match(html, /搜索服务/);
  assert.match(html, /搜索操作/);
  assert.match(html, /账号与执行未接入/);
  assert.doesNotMatch(html, /<button[^>]*>执行<\/button>/);
  assert.match(admin, /\{ id: "openconnector", label: "OpenConnector" \}/);
  assert.match(admin, /<OpenConnectorAdminPanel \/>/);
  assert.doesNotMatch(admin, /OpenConnectorCatalogCard/);
});

test("admin reads only desktop-token-gated catalog operations and aborts stale calls", async () => {
  const source = await readFile(new URL("./OpenConnectorAdminPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /fetchDesktopApi\("\/api\/desktop\/openconnector\/catalog"/);
  for (const op of ["providers", "actions", "search", "inspect"]) assert.match(source, new RegExp(`op: "${op}"`));
  assert.match(source, /controllerRef\.current\?\.abort\(\)/);
  assert.match(source, /if \(controller\.signal\.aborted\) return/);
  assert.match(source, /isTauriDesktop\(\)/);
  assert.doesNotMatch(source, /op: "execute"|<input[^>]*type="password"|fetch\("https?:\/\//);
});
