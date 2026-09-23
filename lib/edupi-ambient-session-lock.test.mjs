import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const lock = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-session-lock.ts");

test("capture and deletion operations for one session are serialized while other sessions remain independent", async () => {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = lock.withEduPiAmbientSessionLock("session-1", async () => { order.push("capture:start"); await firstGate; order.push("capture:end"); });
  const second = lock.withEduPiAmbientSessionLock("session-1", async () => { order.push("delete"); });
  const other = lock.withEduPiAmbientSessionLock("session-2", async () => { order.push("other"); });
  await other;
  assert.deepEqual(order, ["capture:start", "other"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["capture:start", "other", "capture:end", "delete"]);
});

test("a failed operation releases the session lock", async () => {
  await assert.rejects(lock.withEduPiAmbientSessionLock("session-1", async () => { throw new Error("failed"); }));
  assert.equal(await lock.withEduPiAmbientSessionLock("session-1", async () => "recovered"), "recovered");
});
