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
