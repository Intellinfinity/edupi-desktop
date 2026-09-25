import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createJiti } from "jiti";

const { OpenConnectorConsolePanel, isSafeConsoleUrl } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./OpenConnectorConsolePanel.tsx");

test("Console URL is exact loopback and cannot point an iframe at a foreign origin", () => {
  assert.equal(isSafeConsoleUrl("http://127.0.0.1:43219/"), true);
  for (const value of ["https://127.0.0.1:43219/", "http://localhost:43219/", "http://127.0.0.1:43219/api", "http://127.0.0.1:43219/?token=x", "http://attacker.example/", "http://127.0.0.1@attacker.example/"]) {
    assert.equal(isSafeConsoleUrl(value), false, value);
  }
});

test("console panel launches a separate native window with no privileged iframe", async () => {
  const html = renderToStaticMarkup(React.createElement(OpenConnectorConsolePanel, { onBack: () => {} }));
  const source = await readFile(new URL("./OpenConnectorConsolePanel.tsx", import.meta.url), "utf8");
  assert.match(html, /返回管理中心/u);
  assert.match(html, /OpenConnector/u);
  assert.doesNotMatch(html, /type="password"|apiKey|runtimeToken/u);
  assert.match(source, /showOpenConnectorConsole/u);
  assert.doesNotMatch(source, /<iframe/u);
});
