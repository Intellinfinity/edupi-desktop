import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { recallQueueWithBackup } = await createJiti(import.meta.url).import("./queue-recovery.ts");

test("queue data is staged before clear and a session switch routes the result to its origin", async () => {
  const calls = [];
  let current = true;
  let finishClear;
  const result = recallQueueWithBackup({
    recoveryId: "11111111-1111-4111-8111-111111111111",
    read: async () => ({ steering: [], followUp: ["A 后续消息"] }),
    stage: (messages) => { calls.push(["stage", ...messages]); return []; },
    clear: () => { calls.push(["clear"]); return new Promise(resolve => { finishClear = resolve; }); },
    isCurrent: () => current,
    finalizeCurrent: () => { calls.push(["finalize-current"]); return current; },
    persistInactive: (previous, messages) => { calls.push(["persist-A", ...previous, ...messages]); return true; },
    markUncertain: () => false,
    acknowledge: async () => { calls.push(["ack"]); },
    clearVisible: () => { calls.push(["clear-visible"]); },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [["stage", "A 后续消息"], ["clear"]]);
  current = false;
  finishClear({ steering: [], followUp: ["A 后续消息"], recoveryId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(await result, "restored");
  assert.deepEqual(calls.at(-2), ["persist-A", "A 后续消息"]);
  assert.deepEqual(calls.at(-1), ["ack"]);
  assert.equal(calls.some(([name]) => name === "clear-visible"), false);
});

test("a failed local stage never clears the remote queue", async () => {
  let cleared = false;
  const result = await recallQueueWithBackup({
    recoveryId: "11111111-1111-4111-8111-111111111111",
    read: async () => ({ steering: ["需要保留"], followUp: [] }),
    stage: () => null,
    clear: async () => { cleared = true; return { steering: [], followUp: [] }; },
    isCurrent: () => true,
    finalizeCurrent: () => false,
    persistInactive: () => false,
    markUncertain: () => false,
    acknowledge: async () => {},
    clearVisible: () => {},
  });
  assert.equal(result, "storage_failed");
  assert.equal(cleared, false);
});

test("a lost clear response retains the staged copy", async () => {
  const saved = [];
  const result = await recallQueueWithBackup({
    recoveryId: "11111111-1111-4111-8111-111111111111",
    read: async () => ({ steering: [], followUp: ["待核对"] }),
    stage: messages => { saved.push(...messages); return []; },
    clear: async () => { throw new Error("response lost"); },
    isCurrent: () => true,
    finalizeCurrent: () => false,
    persistInactive: () => false,
    markUncertain: () => false,
    acknowledge: async () => {},
    clearVisible: () => {},
  });
  assert.equal(result, "uncertain");
  assert.deepEqual(saved, ["待核对"]);
});

test("a late enqueue is recovered from the server's idempotent clear record", async () => {
  const id = "44444444-4444-4444-8444-444444444444";
  let clears = 0;
  let finalMessages = [];
  let acknowledged = false;
  const result = await recallQueueWithBackup({
    recoveryId: id,
    read: async () => ({ steering: [], followUp: ["原消息"] }),
    stage: messages => { assert.deepEqual(messages, ["原消息"]); return []; },
    clear: async recoveryId => {
      assert.equal(recoveryId, id);
      clears += 1;
      if (clears === 1) throw new Error("response lost after server saved 原消息 + 新消息");
      return { steering: [], followUp: ["原消息", "新消息"], recoveryId: id };
    },
    isCurrent: () => true,
    finalizeCurrent: (_previous, messages) => { finalMessages = messages; return true; },
    persistInactive: () => false,
    markUncertain: () => false,
    acknowledge: async () => { acknowledged = true; },
    clearVisible: () => {},
  });
  assert.equal(result, "restored");
  assert.equal(clears, 2);
  assert.deepEqual(finalMessages, ["原消息", "新消息"]);
  assert.equal(acknowledged, true);
});

test("ACK failure leaves a durable local copy marked for retry", async () => {
  const id = "88888888-8888-4888-8888-888888888888";
  const result = await recallQueueWithBackup({
    recoveryId: id,
    read: async () => ({ steering: [], followUp: ["已保存"] }),
    stage: () => [],
    clear: async () => ({ steering: [], followUp: ["已保存"], recoveryId: id }),
    isCurrent: () => true,
    finalizeCurrent: () => true,
    persistInactive: () => false,
    markUncertain: () => false,
    acknowledge: async () => { throw new Error("ack response lost"); },
    clearVisible: () => {},
  });
  assert.equal(result, "ack_pending");
});

test("an empty clear after server restart keeps the staged copy for teacher verification", async () => {
  const id = "99999999-9999-4999-8999-999999999999";
  let uncertain = false;
  const result = await recallQueueWithBackup({
    recoveryId: id,
    read: async () => ({ steering: [], followUp: ["可能未送达"] }),
    stage: () => [],
    clear: async () => ({ steering: [], followUp: [], recoveryId: id }),
    isCurrent: () => true,
    finalizeCurrent: () => { throw new Error("must not clear staged copy"); },
    persistInactive: () => false,
    markUncertain: () => { uncertain = true; return true; },
    acknowledge: async () => { throw new Error("must not acknowledge"); },
    clearVisible: () => {},
  });
  assert.equal(result, "uncertain_empty");
  assert.equal(uncertain, true);
});

test("prepared server state stops retries and requires an explicit teacher resolution", async () => {
  let clearCalls = 0;
  const result = await recallQueueWithBackup({
    recoveryId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    read: async () => ({ steering: [], followUp: ["待核对"] }),
    stage: () => [],
    clear: async () => { clearCalls += 1; throw new Error("QUEUE_RECOVERY_MANUAL_REVIEW"); },
    isCurrent: () => true,
    finalizeCurrent: () => false,
    persistInactive: () => false,
    markUncertain: () => false,
    acknowledge: async () => {},
    clearVisible: () => {},
  });
  assert.equal(result, "manual_review");
  assert.equal(clearCalls, 1);
});
