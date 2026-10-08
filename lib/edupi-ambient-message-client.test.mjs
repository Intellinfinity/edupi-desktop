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

test("an intent armed before Pi submission survives a lost Pi reply without Core replay", async () => {
  const entries = [];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push(entry); return true; },
    readEduPiAmbientUnconfirmedDurable: async sessionId => entries.filter(entry => entry.sessionId === sessionId),
    clearEduPiAmbientUnconfirmedDurable: async () => true };
  let posts = 0;
  const fetchDesktopApi = async (_url, options) => {
    if (options.method === "POST") posts++;
    return { ok: true, json: async () => ({ status: "clear", externalSend: false, pending: [], recovered: [] }) };
  };
  const beforePi = client(fetchDesktopApi, storage);
  assert.equal((await beforePi.armEduPiAmbientMessage(input)).status, "armed");
  assert.equal(posts, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(entries)), [{ sessionId: input.sessionId, messageId: input.messageId, occurredAt: input.occurredAt }]);
  const afterColdRestart = client(fetchDesktopApi, storage);
  const pending = await afterColdRestart.readEduPiAmbientPending(input.sessionId);
  assert.equal(pending.status, "outcome_unknown");
  assert.equal(pending.pending[0].unconfirmed, true);
  assert.equal((await afterColdRestart.captureEduPiAmbientMessage(input)).status, "outcome_unknown");
  assert.equal(posts, 0, "a lost Pi response cannot trigger a speculative Core write after restart");
});

test("a malformed availability read cannot erase a pre-Pi capture intent", async () => {
  const entries = [];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push(entry); return true; },
    readEduPiAmbientUnconfirmedDurable: async sessionId => entries.filter(entry => entry.sessionId === sessionId),
    clearEduPiAmbientUnconfirmedDurable: async (_sessionId, messageId) => { const index = entries.findIndex(entry => entry.messageId === messageId);
      if (index >= 0) entries.splice(index, 1); return true; } };
  let posts = 0;
  const api = client(async (_url, options) => {
    if (options.method === "POST") posts++;
    return { ok: true, json: async () => ({ status: "unexpected", externalSend: false }) };
  }, storage);
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "armed");
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "outcome_unknown");
  assert.equal(entries.length, 1);
  assert.equal(posts, 0);
});

test("the armed Pi message makes one bounded Core capture after its prompt reply", async () => {
  const entries = [];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push(entry); return true; },
    readEduPiAmbientUnconfirmedDurable: async sessionId => entries.filter(entry => entry.sessionId === sessionId),
    clearEduPiAmbientUnconfirmedDurable: async (_sessionId, messageId) => { const index = entries.findIndex(entry => entry.messageId === messageId);
      if (index >= 0) entries.splice(index, 1); return true; } };
  let posts = 0;
  const api = client(async (_url, options) => {
    if (options.method === "POST") { posts++; return { ok: true, json: async () => ({ status: "ignored" }) }; }
    return { ok: true, json: async () => ({ status: "enabled", externalSend: false }) };
  }, storage);
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "armed");
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "ignored");
  assert.equal(posts, 1);
  assert.deepEqual(entries, []);
});

test("a definitely unsent Pi prompt clears only its own armed identity", async () => {
  const entries = [];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push(entry); return true; },
    readEduPiAmbientUnconfirmedDurable: async sessionId => entries.filter(entry => entry.sessionId === sessionId),
    clearEduPiAmbientUnconfirmedDurable: async (_sessionId, messageId) => { const index = entries.findIndex(entry => entry.messageId === messageId);
      if (index >= 0) entries.splice(index, 1); return true; } };
  const api = client(async () => { throw new Error("no Core request is expected"); }, storage);
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "armed");
  await api.cancelEduPiAmbientArm(input);
  assert.deepEqual(entries, []);
});

test("a previous pending prompt keeps a later Pi message durable without a Core write", async () => {
  const entries = [];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push(entry); return true; },
    readEduPiAmbientUnconfirmedDurable: async sessionId => entries.filter(entry => entry.sessionId === sessionId),
    clearEduPiAmbientUnconfirmedDurable: async () => true };
  let posts = 0;
  const api = client(async (_url, options) => {
    if (options.method === "POST") posts++;
    return { ok: false, json: async () => ({ status: "unavailable", externalSend: false }) };
  }, storage);
  const next = { ...input, messageId: "prompt-next" };
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "armed");
  assert.equal((await api.armEduPiAmbientMessage(next)).status, "armed");
  assert.equal((await api.captureEduPiAmbientMessage(next)).status, "verification_pending");
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "verification_pending");
  const pending = await api.readEduPiAmbientPending(input.sessionId);
  assert.deepEqual(pending.pending.map(item => item.messageId).sort(), [input.messageId, next.messageId].sort());
  assert.equal(posts, 0);
});

test("availability 503 preserves the single armed Pi identity", async () => {
  const entries = [];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push(entry); return true; },
    readEduPiAmbientUnconfirmedDurable: async sessionId => entries.filter(entry => entry.sessionId === sessionId),
    clearEduPiAmbientUnconfirmedDurable: async () => true };
  let posts = 0;
  const api = client(async (_url, options) => {
    if (options.method === "POST") posts++;
    return { ok: false, json: async () => ({ status: "unavailable", externalSend: false }) };
  }, storage);
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "armed");
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "outcome_unknown");
  assert.equal(entries.length, 1);
  assert.equal(posts, 0);
});

test("only an explicit disabled availability response clears the armed identity", async () => {
  const entries = [];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push(entry); return true; },
    readEduPiAmbientUnconfirmedDurable: async sessionId => entries.filter(entry => entry.sessionId === sessionId),
    clearEduPiAmbientUnconfirmedDurable: async (_sessionId, messageId) => { const index = entries.findIndex(entry => entry.messageId === messageId);
      if (index >= 0) entries.splice(index, 1); return true; } };
  let posts = 0;
  const api = client(async (_url, options) => {
    if (options.method === "POST") posts++;
    return { ok: true, json: async () => ({ status: "disabled", externalSend: false }) };
  }, storage);
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "armed");
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "disabled");
  assert.deepEqual(entries, []);
  assert.equal(posts, 0);
});

test("a G2 exact read receipt clears pending without inventing a work case", async () => {
  const api = client(async () => ({ ok: true, json: async () => ({ status: "applied", externalSend: false,
    pending: [], recovered: [{ messageId: "g2_synthetic", goalId: "goal-1", followUpId: "followup-1", executionId: "execution-1" }] }) }));
  const result = await api.readEduPiAmbientPending(input.sessionId, true);
  assert.equal(result.status, "applied");
  assert.equal(result.recovered.length, 1);
  assert.equal(result.recovered[0].followUpId, "followup-1");
  assert.equal(Object.hasOwn(result.recovered[0], "workCaseId"), false);
});

test("a recovered G2 domain receipt clears the original Pi outbox identity after reentry", async () => {
  const entries = [{ sessionId: input.sessionId, messageId: input.messageId, occurredAt: input.occurredAt }];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async () => true,
    readEduPiAmbientUnconfirmedDurable: async sessionId => entries.filter(entry => entry.sessionId === sessionId),
    clearEduPiAmbientUnconfirmedDurable: async (_sessionId, messageId) => {
      const index = entries.findIndex(entry => entry.messageId === messageId);
      if (index >= 0) entries.splice(index, 1);
      return true;
    } };
  const api = client(async () => ({ ok: true, json: async () => ({ status: "applied", externalSend: false,
    pending: [], recovered: [{ messageId: input.messageId, goalId: "goal-1", followUpId: "followup-1", executionId: "execution-1" }] }) }), storage);
  const recovered = await api.readEduPiAmbientPending(input.sessionId, true);
  assert.equal(recovered.status, "applied");
  assert.equal(recovered.pending.length, 0);
  assert.deepEqual(entries, []);
});

test("a lost POST response clears only an exact server-settled Pi outbox identity", async () => {
  const entries = [{ sessionId: input.sessionId, messageId: input.messageId, occurredAt: input.occurredAt }];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async () => true,
    readEduPiAmbientUnconfirmedDurable: async sessionId => entries.filter(entry => entry.sessionId === sessionId),
    clearEduPiAmbientUnconfirmedDurable: async (_sessionId, messageId) => {
      const index = entries.findIndex(entry => entry.messageId === messageId);
      if (index >= 0) entries.splice(index, 1);
      return true;
    } };
  const api = client(async () => ({ ok: true, json: async () => ({ status: "clear", externalSend: false,
    pending: [], recovered: [], settled: [{ messageId: input.messageId, occurredAt: input.occurredAt }] }) }), storage);
  const clear = await api.readEduPiAmbientPending(input.sessionId);
  assert.equal(clear.status, "clear");
  assert.deepEqual(entries, []);
  entries.push({ sessionId: input.sessionId, messageId: input.messageId, occurredAt: "2026-10-08T00:00:01.000Z" });
  const conflict = await api.readEduPiAmbientPending(input.sessionId);
  assert.equal(conflict.status, "outcome_unknown");
  assert.equal(entries.length, 1, "a different occurrence must not clear the native outbox");
});
