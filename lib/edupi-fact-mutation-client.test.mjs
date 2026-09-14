import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { runSerializedFactMutation } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-fact-mutation-client.ts");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("serializes fact mutations so older snapshots cannot arrive after newer ones", async () => {
  const gate = deferred();
  const order = [];
  const first = runSerializedFactMutation(async () => { order.push("first:start"); await gate.promise; order.push("first:end"); return 1; });
  const second = runSerializedFactMutation(async () => { order.push("second:start"); return 2; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["first:start"]);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ["first:start", "first:end", "second:start"]);
});

test("a failed fact mutation does not block the queue", async () => {
  await assert.rejects(runSerializedFactMutation(async () => { throw new Error("expected"); }), /expected/);
  assert.equal(await runSerializedFactMutation(async () => "continued"), "continued");
});
