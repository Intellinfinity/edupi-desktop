import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createJiti } from "jiti";

const { UpdateProxySettingsCard, parseUpdateProxyInput } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./UpdateProxySettingsCard.tsx");

test("update proxy is a persisted loopback HTTP setting, never a credential URL", () => {
  assert.equal(parseUpdateProxyInput(""), null);
  assert.equal(parseUpdateProxyInput(" http://127.0.0.1:7897 "), "http://127.0.0.1:7897");
  for (const invalid of ["https://127.0.0.1:7897", "http://localhost:7897", "http://user:pass@127.0.0.1:7897", "http://127.0.0.1:7897/path", "http://127.0.0.1:7897?", "http://127.0.0.1:7897#", "http://127.0.0.1:0", "http://192.168.1.2:7897"]) {
    assert.throws(() => parseUpdateProxyInput(invalid), /本机 HTTP 代理/);
  }
});

test("desktop settings expose a small optional update proxy control", async () => {
  const html = renderToStaticMarkup(React.createElement(UpdateProxySettingsCard));
  const settings = await readFile(new URL("./AppSettings.tsx", import.meta.url), "utf8");
  const source = await readFile(new URL("./UpdateProxySettingsCard.tsx", import.meta.url), "utf8");
  assert.match(html, /<summary>更新代理<\/summary>/);
  assert.match(html, /http:\/\/127\.0\.0\.1:7897/);
  assert.match(html, /留空使用系统网络/);
  assert.match(html, /disabled=""[^>]*>保存<\/button>/);
  assert.match(settings, /\{desktop && <UpdateProxySettingsCard onSaved=\{\(\) => void checkForUpdates\(\)\} \/>\}/);
  assert.match(source, /async function retryRead\(/);
  assert.match(source, /setUpdateProxyNative\(""\)/);
  assert.match(source, /aria-invalid=\{!valid && Boolean\(draft\.trim\(\)\)\}/);
  assert.match(source, /aria-describedby=\{/);
});
