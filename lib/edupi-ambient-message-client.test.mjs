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

test("a lost capture reply stays unknown after an acknowledged metadata arm", async () => {
  const entries = [];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push(entry); return true; },
    readEduPiAmbientUnconfirmedDurable: async () => entries,
    clearEduPiAmbientUnconfirmedDurable: async () => { entries.length = 0; return true; } };
  const actions = [];
  const api = client(async (_url, options) => {
    const body = JSON.parse(options.body);
    actions.push(body.action ?? "capture");
    if (body.action === "arm") return { ok: true, json: async () => ({ status: "armed", externalSend: false }) };
    throw new Error("synthetic_capture_reply_lost");
  }, storage);
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "armed");
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "outcome_unknown");
  assert.deepEqual(actions, ["arm", "capture"]);
  assert.equal(entries.length, 1);
});

test("a first-domain HTTP success cannot clear the native outbox while a later domain is unavailable", async () => {
  const entries = [];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push(entry); return true; },
    readEduPiAmbientUnconfirmedDurable: async sessionId => entries.filter(entry => entry.sessionId === sessionId),
    clearEduPiAmbientUnconfirmedDurable: async (_sessionId, messageId) => {
      const index = entries.findIndex(entry => entry.messageId === messageId);
      if (index >= 0) entries.splice(index, 1);
      return true;
    } };
  const api = client(async (_url, options) => ({ ok: true, json: async () => JSON.parse(options.body).action === "arm"
    ? { status: "armed", externalSend: false }
    : { status: "applied", externalSend: false, messageComplete: false,
      domainResults: [{ status: "applied" }, { status: "unavailable" }] } }), storage);
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "armed");
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "outcome_unknown");
  assert.equal(entries.length, 1);
});

test("read-only recovery of one domain keeps the outbox until the whole message is complete", async () => {
  const entries = [{ sessionId: input.sessionId, messageId: input.messageId, occurredAt: input.occurredAt }];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async () => true,
    readEduPiAmbientUnconfirmedDurable: async () => entries,
    clearEduPiAmbientUnconfirmedDurable: async () => { entries.length = 0; return true; } };
  const api = client(async () => ({ ok: true, json: async () => ({ status: "outcome_unknown", externalSend: false,
    pending: [{ messageId: input.messageId, occurredAt: input.occurredAt }],
    recovered: [{ messageId: input.messageId, goalId: "goal-1", workCaseId: "work-1" }], settled: [] }) }), storage);
  const state = await api.readEduPiAmbientPending(input.sessionId, true);
  assert.equal(state.status, "outcome_unknown");
  assert.equal(entries.length, 1);
});

test("an old settled row leaves its native identity unproven while a new capture can proceed", async () => {
  const old = { sessionId: input.sessionId, messageId: "legacy-settled", occurredAt: "2026-10-07T00:00:00.000Z" };
  const entries = [old];
  let captures = 0;
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push(entry); return true; },
    readEduPiAmbientUnconfirmedDurable: async () => entries,
    clearEduPiAmbientUnconfirmedDurable: async () => { assert.fail("no old outbox identity may be cleared"); } };
  const api = client(async (_url, options) => {
    if (options.method === "GET") return { ok: true, json: async () => ({ status: "outcome_unknown", externalSend: false,
      pending: [{ messageId: input.messageId, occurredAt: input.occurredAt, nonBlocking: false }], recovered: [], settled: [],
      legacySettled: [{ messageId: old.messageId, occurredAt: old.occurredAt }] }) };
    if (JSON.parse(options.body).action === "arm") return { ok: true, json: async () => ({ status: "armed", externalSend: false }) };
    captures++;
    return { ok: true, json: async () => ({ status: "outcome_unknown", messageComplete: false, externalSend: false }) };
  }, storage);
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "armed");
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "outcome_unknown");
  assert.equal(captures, 1);
  assert.equal(entries.some(item => item.messageId === old.messageId), true);
});

test("an old unknown native identity still blocks a newer Core write", async () => {
  const old = { sessionId: input.sessionId, messageId: "legacy-unknown", occurredAt: "2026-10-07T00:00:00.000Z" };
  const entries = [old];
  let captures = 0;
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push(entry); return true; },
    readEduPiAmbientUnconfirmedDurable: async () => entries,
    clearEduPiAmbientUnconfirmedDurable: async () => true };
  const api = client(async (_url, options) => {
    if (options.method === "GET") return { ok: true, json: async () => ({ status: "outcome_unknown", externalSend: false,
      pending: [{ messageId: old.messageId, occurredAt: old.occurredAt, nonBlocking: false },
        { messageId: input.messageId, occurredAt: input.occurredAt, nonBlocking: false }], recovered: [], settled: [] }) };
    if (JSON.parse(options.body).action === "arm") return { ok: true, json: async () => ({ status: "armed", externalSend: false }) };
    captures++;
    return { ok: true, json: async () => ({ status: "captured", externalSend: false }) };
  }, storage);
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "armed");
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "verification_pending");
  assert.equal(captures, 0);
});

test("a failed native outbox prewrite prevents the capture POST", async () => {
  let posts = 0;
  const api = client(async (_url, options) => {
    if (options.method === "POST") posts++;
    return { ok: true, json: async () => ({ status: "enabled", externalSend: false }) };
  }, { rememberEduPiAmbientUnconfirmedDurable: async () => false,
    readEduPiAmbientUnconfirmedDurable: async () => [], clearEduPiAmbientUnconfirmedDurable: async () => true });
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "unavailable");
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
    if (options.method === "POST" && JSON.parse(options.body).action === "arm") {
      return { ok: true, json: async () => ({ status: "armed", externalSend: false }) };
    }
    if (options.method === "POST") { posts++; throw new Error("synthetic_post_never_arrived"); }
    return { ok: true, json: async () => url.includes("sessionId=")
      ? { status: "clear", externalSend: false, pending: [], recovered: [] }
      : { status: "enabled", externalSend: false } };
  }, storage);
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "armed");
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "outcome_unknown");
  const afterReentry = await api.readEduPiAmbientPending(input.sessionId);
  assert.equal(afterReentry.status, "outcome_unknown");
  assert.equal(afterReentry.pending[0].messageId, input.messageId);
  assert.equal(afterReentry.pending[0].unconfirmed, true);
  assert.equal((await api.armEduPiAmbientMessage({ ...input, messageId: "prompt-new" })).status, "armed");
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
    return { ok: true, json: async () => options.method === "POST" && JSON.parse(options.body).action === "arm"
      ? { status: "armed", externalSend: false }
      : { status: "clear", externalSend: false, pending: [], recovered: [] } };
  };
  const beforePi = client(fetchDesktopApi, storage);
  assert.equal((await beforePi.armEduPiAmbientMessage(input)).status, "armed");
  assert.equal(posts, 1, "only the metadata arm was posted before Pi");
  assert.deepEqual(JSON.parse(JSON.stringify(entries)), [{ sessionId: input.sessionId, messageId: input.messageId, occurredAt: input.occurredAt }]);
  const afterColdRestart = client(fetchDesktopApi, storage);
  const pending = await afterColdRestart.readEduPiAmbientPending(input.sessionId);
  assert.equal(pending.status, "outcome_unknown");
  assert.equal(pending.pending[0].unconfirmed, true);
  assert.equal((await afterColdRestart.captureEduPiAmbientMessage(input)).status, "outcome_unknown");
  assert.equal(posts, 1, "a lost Pi response cannot trigger a speculative Core write after restart");
});

test("a malformed arm reply cannot erase a pre-Pi capture intent", async () => {
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
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "outcome_unknown");
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "outcome_unknown");
  assert.equal(entries.length, 1);
  assert.equal(posts, 1, "only a metadata arm was attempted");
});

test("the armed Pi message makes one bounded Core capture after its prompt reply", async () => {
  const entries = [];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push(entry); return true; },
    readEduPiAmbientUnconfirmedDurable: async sessionId => entries.filter(entry => entry.sessionId === sessionId),
    clearEduPiAmbientUnconfirmedDurable: async (_sessionId, messageId) => { const index = entries.findIndex(entry => entry.messageId === messageId);
      if (index >= 0) entries.splice(index, 1); return true; } };
  const actions = [];
  const api = client(async (_url, options) => {
    const body = JSON.parse(options.body);
    actions.push(body.action ?? "capture");
    return { ok: true, json: async () => body.action === "arm" ? { status: "armed", externalSend: false }
      : body.action === "ack" ? { status: "acknowledged", externalSend: false }
        : { status: "captured", messageComplete: true, messageId: input.messageId,
          occurredAt: input.occurredAt, externalSend: false } };
  }, storage);
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "armed");
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "captured");
  assert.deepEqual(actions, ["arm", "capture", "ack"]);
  assert.deepEqual(entries, []);
});

test("a complete Core receipt cannot be acknowledged when native outbox clearing fails", async () => {
  const entries = [];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push(entry); return true; },
    readEduPiAmbientUnconfirmedDurable: async () => entries,
    clearEduPiAmbientUnconfirmedDurable: async () => false };
  const actions = [];
  const api = client(async (_url, options) => {
    const body = JSON.parse(options.body);
    actions.push(body.action ?? "capture");
    return { ok: true, json: async () => body.action === "arm" ? { status: "armed", externalSend: false }
      : { status: "applied", messageComplete: true, messageId: input.messageId,
        occurredAt: input.occurredAt, externalSend: false } };
  }, storage);
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "armed");
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "outcome_unknown");
  assert.deepEqual(actions, ["arm", "capture"]);
  assert.equal(entries.length, 1);
});

test("a definitely unsent Pi prompt clears only its own armed identity", async () => {
  const entries = [];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push(entry); return true; },
    readEduPiAmbientUnconfirmedDurable: async sessionId => entries.filter(entry => entry.sessionId === sessionId),
    markEduPiAmbientCancelRequestedDurable: async () => true,
    clearEduPiAmbientUnconfirmedDurable: async (_sessionId, messageId) => { const index = entries.findIndex(entry => entry.messageId === messageId);
      if (index >= 0) entries.splice(index, 1); return true; } };
  const actions = [];
  const api = client(async (_url, options) => {
    actions.push(JSON.parse(options.body).action);
    return { ok: true, json: async () => ({ status: JSON.parse(options.body).action === "arm" ? "armed" : "cancelled", externalSend: false }) };
  }, storage);
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "armed");
  await api.cancelEduPiAmbientArm(input);
  assert.deepEqual(entries, []);
  assert.deepEqual(actions, ["arm", "cancel", "ack"]);
});

test("a cancel 503 preserves native unsent evidence and a cold client can retry the exact cancellation", async () => {
  const entries = [];
  let available = false;
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push({ ...entry, cancelRequested: false }); return true; },
    readEduPiAmbientUnconfirmedDurable: async () => entries,
    markEduPiAmbientCancelRequestedDurable: async identity => {
      const entry = entries.find(item => item.messageId === identity.messageId && item.occurredAt === identity.occurredAt);
      if (!entry) return false;
      entry.cancelRequested = true;
      return true;
    },
    clearEduPiAmbientUnconfirmedDurable: async (_sessionId, messageId) => {
      const index = entries.findIndex(item => item.messageId === messageId);
      if (index >= 0) entries.splice(index, 1);
      return true;
    } };
  const actions = [];
  const fetchDesktopApi = async (_url, options) => {
    if (options.method === "GET") return { ok: true, json: async () => ({ status: "clear", pending: [], recovered: [], settled: [], externalSend: false }) };
    const action = JSON.parse(options.body).action ?? "capture";
    actions.push(action);
    if (action === "cancel" && !available) return { ok: false, json: async () => ({ status: "unavailable", externalSend: false }) };
    return { ok: true, json: async () => ({ status: action === "arm" ? "armed" : action === "cancel" ? "cancelled" : "acknowledged",
      externalSend: false }) };
  };
  const before = client(fetchDesktopApi, storage);
  assert.equal((await before.armEduPiAmbientMessage(input)).status, "armed");
  await before.cancelEduPiAmbientArm(input);
  assert.equal(entries.length, 1, "server 503 must not erase the native identity");
  assert.equal(entries[0].cancelRequested, true);
  available = true;
  const after = client(fetchDesktopApi, storage);
  await after.readEduPiAmbientPending(input.sessionId);
  assert.equal(entries.length, 0);
  assert.equal((await after.armEduPiAmbientMessage({ ...input, messageId: "prompt-next" })).status, "armed");
  assert.deepEqual(actions, ["arm", "cancel", "cancel", "ack", "arm"]);
});

test("a server-cancelled plan is ACKed after a restart even when native clear already succeeded", async () => {
  let clears = 0, acks = 0;
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async () => true,
    readEduPiAmbientUnconfirmedDurable: async () => [],
    clearEduPiAmbientUnconfirmedDurable: async () => { clears++; return true; } };
  const api = client(async (_url, options) => {
    if (options.method === "GET") return { ok: true, json: async () => ({ status: "clear", externalSend: false,
      pending: [], recovered: [], settled: [], cancelled: [{ messageId: input.messageId, occurredAt: input.occurredAt }] }) };
    assert.equal(JSON.parse(options.body).action, "ack");
    acks++;
    return { ok: true, json: async () => ({ status: "acknowledged", externalSend: false }) };
  }, storage);
  assert.equal((await api.readEduPiAmbientPending(input.sessionId)).status, "clear");
  assert.equal(clears, 1);
  assert.equal(acks, 1);
});

test("a previous pending prompt keeps a later Pi message durable without a Core write", async () => {
  const entries = [];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push(entry); return true; },
    readEduPiAmbientUnconfirmedDurable: async sessionId => entries.filter(entry => entry.sessionId === sessionId),
    clearEduPiAmbientUnconfirmedDurable: async () => true };
  let posts = 0;
  const api = client(async (_url, options) => {
    if (options.method === "POST") {
      const action = JSON.parse(options.body).action;
      if (action !== "arm") posts++;
      return { ok: true, json: async () => ({ status: action === "arm" ? "armed" : "unavailable", externalSend: false }) };
    }
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

test("capture 503 preserves the single armed Pi identity", async () => {
  const entries = [];
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async entry => { entries.push(entry); return true; },
    readEduPiAmbientUnconfirmedDurable: async sessionId => entries.filter(entry => entry.sessionId === sessionId),
    clearEduPiAmbientUnconfirmedDurable: async () => true };
  let posts = 0;
  const api = client(async (_url, options) => {
    if (options.method === "POST" && JSON.parse(options.body).action === "arm") {
      return { ok: true, json: async () => ({ status: "armed", externalSend: false }) };
    }
    if (options.method === "POST") posts++;
    return { ok: false, json: async () => ({ status: "unavailable", externalSend: false }) };
  }, storage);
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "armed");
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "outcome_unknown");
  assert.equal(entries.length, 1);
  assert.equal(posts, 1);
});

test("a disabled pre-Pi plan clears the native intent without a Core capture", async () => {
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
  assert.equal((await api.armEduPiAmbientMessage(input)).status, "disabled");
  assert.equal((await api.captureEduPiAmbientMessage(input)).status, "unavailable");
  assert.deepEqual(entries, []);
  assert.equal(posts, 1);
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
    pending: [], recovered: [{ messageId: input.messageId, goalId: "goal-1", followUpId: "followup-1", executionId: "execution-1" }],
    settled: [{ messageId: input.messageId, occurredAt: input.occurredAt }] }) }), storage);
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

test("reentry after one hundred already-ACKed plans issues no native clear or privileged POST", async () => {
  let clears = 0, posts = 0;
  const storage = { rememberEduPiAmbientUnconfirmedDurable: async () => true,
    readEduPiAmbientUnconfirmedDurable: async () => [],
    clearEduPiAmbientUnconfirmedDurable: async () => { clears++; return true; } };
  const api = client(async (_url, options) => {
    if (options.method === "POST") posts++;
    return { ok: true, json: async () => ({ status: "clear", pending: [], recovered: [], settled: [], cancelled: [], externalSend: false }) };
  }, storage);
  assert.equal((await api.readEduPiAmbientPending(input.sessionId)).status, "clear");
  assert.equal(clears, 0);
  assert.equal(posts, 0);
});
