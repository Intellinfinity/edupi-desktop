import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function client(fetchDesktopApi) {
  const source = fs.readFileSync(new URL("./edupi-ambient-message.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, URLSearchParams, require(name) {
    if (name === "./desktop-native") return { fetchDesktopApi };
    if (name === "./desktop-updater") return { isTauriDesktop: () => true };
    throw new Error(`unexpected import ${name}`);
  } });
  return exports;
}

const input = { sessionId: "session-1", messageId: "prompt-stable", text: "合成备课请求",
  occurredAt: "2026-10-08T00:00:00.000Z" };

test("a lost POST reply is unknown while a failed availability read made no write attempt", async () => {
  let calls = 0;
  const dropped = client(async (_url, options) => {
    calls++;
    if (options.method === "GET") return { ok: true, json: async () => ({ status: "enabled", externalSend: false }) };
    throw new Error("synthetic_lost_post_reply");
  });
  assert.equal((await dropped.captureEduPiAmbientMessage(input)).status, "outcome_unknown");
  assert.equal(calls, 2);
  const unavailable = client(async () => { throw new Error("synthetic_preflight_unavailable"); });
  assert.equal((await unavailable.captureEduPiAmbientMessage(input)).status, "unavailable");
});

test("session reentry reads the durable pending identity without private text", async () => {
  const urls = [];
  const api = client(async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ status: "outcome_unknown", externalSend: false,
      pending: [{ messageId: input.messageId, occurredAt: input.occurredAt }], recovered: [] }) };
  });
  const result = await api.readEduPiAmbientPending(input.sessionId, true);
  assert.equal(result.status, "outcome_unknown");
  assert.equal(result.pending[0].messageId, input.messageId);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /sessionId=session-1&verify=1/);
});
