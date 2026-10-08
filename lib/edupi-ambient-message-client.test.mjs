import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function client(fetchDesktopApi, pendingStorage = { rememberEduPiAmbientUnconfirmedDurable: async () => true,
  readEduPiAmbientUnconfirmedDurable: async () => [], clearEduPiAmbientUnconfirmedDurable: async () => true }) {
  const source = fs.readFileSync(new URL("./edupi-ambient-message.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, URLSearchParams, require(name) {
    if (name === "./desktop-native") return { fetchDesktopApi };
    if (name === "./desktop-updater") return { isTauriDesktop: () => true };
    if (name === "./edupi-ambient-client-pending") return pendingStorage;
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

test("a failed native outbox prewrite prevents the capture POST", async () => {
  let posts = 0;
  const api = client(async (_url, options) => {
    if (options.method === "POST") posts++;
    return { ok: true, json: async () => ({ status: "enabled", externalSend: false }) };
  }, { rememberEduPiAmbientUnconfirmedDurable: async () => false,
    readEduPiAmbientUnconfirmedDurable: async () => [], clearEduPiAmbientUnconfirmedDurable: async () => true });
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "unavailable");
  assert.equal(posts, 0);
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

test("a POST that never reaches the server remains locally unconfirmed after reentry", async () => {
  const local = [];
  let posts = 0;
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async value => { local.push(value); return true; },
    readEduPiAmbientUnconfirmedDurable: async sessionId => local.filter(value => value.sessionId === sessionId),
    clearEduPiAmbientUnconfirmedDurable: async () => true };
  const api = client(async (url, options) => {
    if (options.method === "POST") { posts++; throw new Error("synthetic_post_never_arrived"); }
    return { ok: true, json: async () => url.includes("sessionId=")
      ? { status: "clear", externalSend: false, pending: [], recovered: [] }
      : { status: "enabled", externalSend: false } };
  }, storage);
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "outcome_unknown");
  const afterReentry = await api.readEduPiAmbientPending(input.sessionId);
  assert.equal(afterReentry.status, "outcome_unknown");
  assert.equal(afterReentry.pending[0].messageId, input.messageId);
  assert.equal(afterReentry.pending[0].unconfirmed, true);
  assert.equal((await api.captureEduPiAmbientMessage({ ...input, messageId: "prompt-new" })).status, "verification_pending");
  assert.equal(posts, 1, "a new prompt cannot create a second Goal while capture is unconfirmed");
  assert.equal(local.some(value => Object.hasOwn(value, "text")), false);
});
