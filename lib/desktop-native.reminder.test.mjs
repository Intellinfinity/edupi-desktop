import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { createReminderOpenDrainer } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./desktop-native.ts");
const source = await readFile(new URL("./desktop-native.ts", import.meta.url), "utf8");

test("native reminder wake and startup drain each click once even when they race", async () => {
  const pending = [{ reminderId: "r1", taskId: "task-1", kind: "ready" }];
  const opened = [];
  let calls = 0;
  const drainer = createReminderOpenDrainer(async () => {
    calls++;
    return pending.splice(0);
  }, target => opened.push(target));
  await Promise.all([drainer.request(), drainer.request()]);
  assert.equal(calls, 2);
  assert.deepEqual(opened.map(target => target?.reminderId), ["r1"]);
  pending.push({ reminderId: "r2", taskId: "task-2", kind: "failed" });
  await drainer.request();
  assert.deepEqual(opened.map(target => target?.reminderId), ["r1", "r2"]);
  drainer.stop();
  pending.push({ reminderId: "r3", taskId: "task-3", kind: "due" });
  await drainer.request();
  assert.deepEqual(opened.map(target => target?.reminderId), ["r1", "r2"]);
});

test("an in-flight native drain delivers its click even if the listener is replaced", async () => {
  let release;
  const opened = [];
  const drainer = createReminderOpenDrainer(() => new Promise(resolve => { release = resolve; }), target => opened.push(target));
  const pending = drainer.request();
  await Promise.resolve();
  drainer.stop();
  release([{ reminderId: "r1", taskId: "task-1", kind: "ready" }]);
  await pending;
  assert.deepEqual(opened.map(target => target?.reminderId), ["r1"]);
});

test("multiple queued notification clicks await each continuation in arrival order", async () => {
  const targets = [{ reminderId: "r1", taskId: "task-1", kind: "ready" },
    { reminderId: "r2", taskId: "task-2", kind: "failed" }];
  const order = [];
  let finishFirst;
  const drainer = createReminderOpenDrainer(async () => targets.splice(0), async target => {
    order.push(`${target.reminderId}:start`);
    if (target.reminderId === "r1") await new Promise(resolve => { finishFirst = resolve; });
    order.push(`${target.reminderId}:done`);
  });
  const draining = drainer.request();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(order, ["r1:start"]);
  finishFirst();
  await draining;
  assert.deepEqual(order, ["r1:start", "r1:done", "r2:start", "r2:done"]);
});

test("listener treats native event only as a wake and drains after registering", () => {
  assert.match(source, /listen<ReminderNotificationTarget \| null>\("edupi:\/\/reminder-open", \(\) => \{ void drainer\.request\(\); \}\)/u);
  assert.match(source, /void drainer\.request\(\)/u);
  assert.doesNotMatch(source, /onOpen\(event\.payload\)/u);
});
