import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function fixture() {
  const source = fs.readFileSync(new URL("./desktop-native.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function fetchDesktopApi"),
    source.indexOf("export type AmbientCaptureIdentity"));
  const code = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [];
  const exports = {};
  vm.runInNewContext(code, { exports, URLSearchParams,
    desktopApiHeaders: async () => ({ "x-desktop-token": "synthetic-token" }),
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true }; } });
  return { api: exports.fetchDesktopApi, calls };
}

test("a bounded URLSearchParams query reaches only the local desktop API path", async () => {
  const f = fixture();
  const query = new URLSearchParams({ sessionId: "session-1", verify: "1" });
  await f.api(`/api/edupi/proactivity/messages?${query}`, { method: "GET" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/api/edupi/proactivity/messages?sessionId=session-1&verify=1");
  assert.equal(f.calls[0].options.headers["x-desktop-token"], "synthetic-token");
});

test("external origins, path traversal, fragments, double slashes, and long queries never receive a token", async () => {
  const f = fixture();
  for (const path of ["https://example.com/api/edupi/proactivity/messages", "//example.com/api/foo",
    "/api//edupi/messages", "/api/../edupi/messages", "/api/edupi/messages#fragment",
    "/api/edupi/messages?sessionId=session-1#fragment", "/api/edupi/messages?x=//example.com",
    `/api/edupi/messages?x=${"a".repeat(4096)}`]) {
    await assert.rejects(f.api(path), /Desktop API path is invalid/u);
  }
  assert.equal(f.calls.length, 0);
});
