import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { abandonPreparedQueueRecovery, acknowledgeQueueRecovery, clearQueueRecoverably } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./queue-recovery-server.ts");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "edupi-queue-recovery-"));
  const steering = ["先核对教学重点"];
  const followUp = ["后续再看练习"];
  let clears = 0;
  const queue = {
    getSteeringMessages: () => steering,
    getFollowUpMessages: () => followUp,
    clearQueue: () => {
      clears += 1;
      const removed = { steering: [...steering], followUp: [...followUp] };
      steering.length = 0;
      followUp.length = 0;
      return removed;
    },
  };
  return { root, queue, get clears() { return clears; }, dispose() { rmSync(root, { recursive: true, force: true }); } };
}

test("the exact queue is privately persisted before clear and a response retry is idempotent", () => {
  const f = fixture();
  const sid = "11111111-1111-4111-8111-111111111111";
  const id = "22222222-2222-4222-8222-222222222222";
  try {
    const first = clearQueueRecoverably(sid, id, f.queue, f.root);
    assert.deepEqual(first.steering, ["先核对教学重点"]);
    assert.deepEqual(first.followUp, ["后续再看练习"]);
    assert.equal(f.clears, 1);
    const dir = join(f.root, "edupi-desktop", "queue-recovery");
    const [name] = readdirSync(dir);
    assert.equal(name, `${id}.json`);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, name), "utf8")), first);
    if (process.platform !== "win32") assert.equal(statSync(join(dir, name)).mode & 0o777, 0o600);
    assert.deepEqual(clearQueueRecoverably(sid, id, f.queue, f.root), first);
    assert.equal(f.clears, 1);
    assert.throws(() => acknowledgeQueueRecovery("other-session", id, f.root), /mismatch/);
    assert.equal(acknowledgeQueueRecovery(sid, id, f.root), true);
    assert.equal(acknowledgeQueueRecovery(sid, id, f.root), true);
    const tombstone = JSON.parse(readFileSync(join(dir, name), "utf8"));
    assert.equal(tombstone.status, "acknowledged");
    assert.deepEqual(tombstone.followUp, []);
    assert.doesNotMatch(JSON.stringify(tombstone), /教学重点|后续再看练习/);
    f.queue.getFollowUpMessages = () => ["新入队消息"];
    assert.equal(clearQueueRecoverably(sid, id, f.queue, f.root).status, "acknowledged");
    assert.equal(f.clears, 1);
  } finally { f.dispose(); }
});

test("invalid ids or oversized queues fail before any destructive clear", () => {
  const f = fixture();
  try {
    assert.throws(() => clearQueueRecoverably("session", "../escape", f.queue, f.root));
    assert.equal(f.clears, 0);
    const id = "33333333-3333-4333-8333-333333333333";
    f.queue.getFollowUpMessages = () => Array.from({ length: 51 }, (_, index) => `message-${index}`);
    assert.throws(() => clearQueueRecoverably("session", id, f.queue, f.root), /exceeds local storage limit/);
    assert.equal(f.clears, 0);
    f.queue.getFollowUpMessages = () => [];
    f.queue.getSteeringMessages = () => ["中".repeat(1_010_000)];
    assert.throws(() => clearQueueRecoverably("session", id, f.queue, f.root), /exceeds local storage limit/);
    assert.equal(f.clears, 0);
  } finally { f.dispose(); }
});

test("a prepared record never masquerades as a completed clear after SDK failure", () => {
  const f = fixture();
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  try {
    f.queue.clearQueue = () => { throw new Error("SDK clear failed"); };
    assert.throws(() => clearQueueRecoverably("session-A", id, f.queue, f.root), /SDK clear failed/);
    const file = join(f.root, "edupi-desktop", "queue-recovery", `${id}.json`);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).status, "prepared");
    assert.throws(() => clearQueueRecoverably("session-A", id, f.queue, f.root), /QUEUE_RECOVERY_MANUAL_REVIEW/);
    assert.throws(() => acknowledgeQueueRecovery("session-A", id, f.root), /QUEUE_RECOVERY_MANUAL_REVIEW/);
    assert.equal(abandonPreparedQueueRecovery("session-A", id, f.root), true);
    const resolved = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(resolved.status, "acknowledged");
    assert.deepEqual(resolved.followUp, []);
    assert.equal(f.queue.getSteeringMessages().length, 1);
  } finally { f.dispose(); }
});
