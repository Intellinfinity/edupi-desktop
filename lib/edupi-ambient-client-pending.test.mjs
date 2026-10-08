import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

test("unconfirmed capture identity survives a new client read without storing message text", async () => {
  const values = new Map();
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } } };
  try {
    const storage = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-client-pending.ts");
    const input = { sessionId: "session-1", messageId: "prompt-stable", occurredAt: "2026-10-08T00:00:00.000Z" };
    assert.equal(storage.rememberEduPiAmbientUnconfirmed(input), true);
    assert.deepEqual(storage.readEduPiAmbientUnconfirmed("session-1"), [input]);
    assert.equal([...values.values()].some(value => value.includes("合成备课请求")), false);
    assert.equal(storage.rememberEduPiAmbientUnconfirmed({ ...input, occurredAt: "2026-10-08T00:00:01.000Z" }), false);
    storage.clearEduPiAmbientUnconfirmed(input.sessionId, input.messageId);
    assert.deepEqual(storage.readEduPiAmbientUnconfirmed(input.sessionId), []);
  } finally { globalThis.window = originalWindow; }
});

test("native app-config outbox survives a new WebView origin", async () => {
  const originalWindow = globalThis.window;
  const local = new Map();
  const nativeEntries = [];
  const native = { readAmbientCaptureOutboxNative: async () => nativeEntries.map(item => ({ ...item })),
    rememberAmbientCaptureNative: async item => { nativeEntries.push({ ...item }); },
    clearAmbientCaptureNative: async (sessionId, messageId) => {
      const index = nativeEntries.findIndex(item => item.sessionId === sessionId && item.messageId === messageId);
      if (index >= 0) nativeEntries.splice(index, 1);
    } };
  const setWindow = values => { globalThis.window = { localStorage: { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } } }; };
  try {
    setWindow(local);
    const storage = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-client-pending.ts");
    const input = { sessionId: "session-port-change", messageId: "prompt-stable", occurredAt: "2026-10-08T00:00:00.000Z" };
    assert.equal(await storage.rememberEduPiAmbientUnconfirmedDurable(input, native), true);
    setWindow(new Map());
    assert.deepEqual(await storage.readEduPiAmbientUnconfirmedDurable(input.sessionId, native), [input]);
    assert.equal(await storage.clearEduPiAmbientUnconfirmedDurable(input.sessionId, input.messageId, native), true);
    assert.deepEqual(await storage.readEduPiAmbientUnconfirmedDurable(input.sessionId, native), []);
  } finally { globalThis.window = originalWindow; }
});

test("native outbox write failure cannot authorize a capture POST", async () => {
  const originalWindow = globalThis.window;
  const values = new Map();
  globalThis.window = { localStorage: { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } } };
  try {
    const storage = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-client-pending.ts");
    const input = { sessionId: "session-1", messageId: "prompt-stable", occurredAt: "2026-10-08T00:00:00.000Z" };
    const failingNative = { readAmbientCaptureOutboxNative: async () => [],
      rememberAmbientCaptureNative: async () => { throw new Error("synthetic_native_disk_failure"); },
      clearAmbientCaptureNative: async () => {} };
    assert.equal(await storage.rememberEduPiAmbientUnconfirmedDurable(input, failingNative), false);
    assert.deepEqual(storage.readEduPiAmbientUnconfirmed(input.sessionId), []);
  } finally { globalThis.window = originalWindow; }
});

test("native pending remains visible when the origin localStorage is corrupt", async () => {
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => "{broken", setItem: () => {}, removeItem: () => {} } };
  try {
    const storage = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-client-pending.ts");
    const input = { sessionId: "session-1", messageId: "prompt-stable", occurredAt: "2026-10-08T00:00:00.000Z" };
    const native = { readAmbientCaptureOutboxNative: async () => [input],
      rememberAmbientCaptureNative: async () => {}, clearAmbientCaptureNative: async () => {} };
    assert.deepEqual(await storage.readEduPiAmbientUnconfirmedDurable(input.sessionId, native), [input]);
  } finally { globalThis.window = originalWindow; }
});

test("localStorage clearing cannot acknowledge a failed native outbox removal", async () => {
  const originalWindow = globalThis.window;
  const values = new Map();
  globalThis.window = { localStorage: { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } } };
  try {
    const storage = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-client-pending.ts");
    const input = { sessionId: "session-native-clear", messageId: "prompt-stable", occurredAt: "2026-10-08T00:00:00.000Z" };
    const nativeEntries = [input];
    const native = { rememberAmbientCaptureNative: async () => {},
      readAmbientCaptureOutboxNative: async () => nativeEntries,
      clearAmbientCaptureNative: async () => { throw new Error("synthetic_native_clear_unknown"); } };
    assert.equal(await storage.rememberEduPiAmbientUnconfirmedDurable(input, native), true);
    assert.equal(await storage.clearEduPiAmbientUnconfirmedDurable(input.sessionId, input.messageId, native), false);
    assert.deepEqual(await storage.readEduPiAmbientUnconfirmedDurable(input.sessionId, native), [input]);
  } finally { globalThis.window = originalWindow; }
});

test("only a native unsent-cancel mark survives an origin change as cancellation evidence", async () => {
  const originalWindow = globalThis.window;
  const firstOrigin = new Map();
  const setOrigin = values => { globalThis.window = { localStorage: { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } } }; };
  setOrigin(firstOrigin);
  try {
    const storage = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-client-pending.ts");
    const input = { sessionId: "session-1", messageId: "prompt-stable", occurredAt: "2026-10-08T00:00:00.000Z" };
    const nativeEntries = [{ ...input }];
    const native = { readAmbientCaptureOutboxNative: async () => nativeEntries.map(item => ({ ...item })),
      rememberAmbientCaptureNative: async () => {}, clearAmbientCaptureNative: async () => {},
      markAmbientCaptureCancelRequestedNative: async (sessionId, messageId, occurredAt) => {
        const matched = nativeEntries.find(item => item.sessionId === sessionId && item.messageId === messageId
          && item.occurredAt === occurredAt);
        if (!matched) throw new Error("identity_conflict");
        matched.cancelRequested = true;
      } };
    assert.equal((await storage.readEduPiAmbientUnconfirmedDurable(input.sessionId, native))[0].cancelRequested, undefined,
      "a legacy three-field record is never an unsent-cancel intent");
    assert.equal(await storage.markEduPiAmbientCancelRequestedDurable(input, native), true);
    setOrigin(new Map());
    assert.equal((await storage.readEduPiAmbientUnconfirmedDurable(input.sessionId, native))[0].cancelRequested, true);
    assert.equal([...firstOrigin.values()].some(value => value.includes("cancelRequested")), false);
  } finally { globalThis.window = originalWindow; }
});

test("a native definite-rejection clear marker is distinct from both legacy identity and cancellation", async () => {
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
  try {
    const storage = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-client-pending.ts");
    const input = { sessionId: "session-1", messageId: "prompt-stable", occurredAt: "2026-10-08T00:00:00.000Z" };
    const entries = [{ ...input }];
    const native = { readAmbientCaptureOutboxNative: async () => entries.map(item => ({ ...item })),
      rememberAmbientCaptureNative: async () => {}, clearAmbientCaptureNative: async () => {},
      markAmbientCaptureCancelRequestedNative: async () => { throw new Error("not_cancelled"); },
      markAmbientCaptureRejectedClearRequestedNative: async (sessionId, messageId, occurredAt) => {
        const row = entries.find(item => item.sessionId === sessionId && item.messageId === messageId && item.occurredAt === occurredAt);
        if (!row) throw new Error("identity_conflict");
        row.rejectedClearRequested = true;
      } };
    assert.equal((await storage.readEduPiAmbientUnconfirmedDurable(input.sessionId, native))[0].rejectedClearRequested, undefined);
    assert.equal(await storage.markEduPiAmbientRejectedClearDurable(input, native), true);
    const cold = (await storage.readEduPiAmbientUnconfirmedDurable(input.sessionId, native))[0];
    assert.equal(cold.rejectedClearRequested, true);
    assert.equal(cold.cancelRequested, undefined);
    assert.equal(await storage.markEduPiAmbientCancelRequestedDurable(cold, native), false);
  } finally { globalThis.window = originalWindow; }
});
