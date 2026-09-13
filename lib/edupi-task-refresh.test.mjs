import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { hasEveryTrackedTask, refreshUntilTaskVisible } = await createJiti(import.meta.url).import("./edupi-task-refresh.ts");

test("rejects a stale workspace that omits an already accepted task", () => {
  const tracked = new Set(["task-new"]);
  assert.equal(hasEveryTrackedTask({ tasks: [{ id: "task-old" }] }, tracked), false);
  assert.equal(hasEveryTrackedTask({ tasks: [{ id: "task-old" }, { id: "task-new" }] }, tracked), true);
  tracked.delete("task-new");
  assert.equal(hasEveryTrackedTask({ tasks: [{ id: "task-old" }] }, tracked), true);
});

test("retries a committed task refresh with bounded backoff until the task is visible", async () => {
  const delays = [], controller = new AbortController();
  let reads = 0;
  const visible = await refreshUntilTaskVisible({
    taskId: "task-1",
    signal: controller.signal,
    delays: [0, 10, 20, 40],
    wait: async (delay) => { delays.push(delay); },
    read: async () => {
      reads += 1;
      if (reads === 1) throw new Error("Core still warming");
      return { tasks: reads < 3 ? [] : [{ id: "task-1" }] };
    },
  });
  assert.equal(visible, true);
  assert.equal(reads, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("stops refresh retries after cancellation", async () => {
  const controller = new AbortController();
  let reads = 0;
  const visible = await refreshUntilTaskVisible({
    taskId: "task-1",
    signal: controller.signal,
    delays: [0, 10],
    wait: async () => controller.abort(),
    read: async () => { reads += 1; return { tasks: [] }; },
  });
  assert.equal(visible, false);
  assert.equal(reads, 1);
});

test("keeps retrying at the capped delay instead of silently abandoning a durable task", async () => {
  const delays = [], controller = new AbortController();
  let reads = 0;
  const visible = await refreshUntilTaskVisible({
    taskId: "task-1",
    signal: controller.signal,
    delays: [0, 10, 20],
    wait: async (delay) => { delays.push(delay); },
    read: async () => ({ tasks: ++reads < 6 ? [] : [{ id: "task-1" }] }),
  });
  assert.equal(visible, true);
  assert.equal(reads, 6);
  assert.deepEqual(delays, [10, 20, 20, 20, 20]);
});
