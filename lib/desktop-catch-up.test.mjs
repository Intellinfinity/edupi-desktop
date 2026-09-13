import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createDesktopCatchUpCoordinator } = await createJiti(import.meta.url).import("./desktop-catch-up.ts");
const flush = () => new Promise(resolve => setImmediate(resolve));

test("a forced trigger that overlaps a catch-up runs once immediately afterward", async () => {
  let release;
  let calls = 0;
  const first = new Promise(resolve => { release = resolve; });
  const coordinator = createDesktopCatchUpCoordinator(async () => {
    calls += 1;
    if (calls === 1) await first;
  }, { cooldownMs: 30_000, now: () => 0 });

  coordinator.trigger(true);
  await flush();
  coordinator.trigger(true);
  assert.equal(calls, 1);
  release();
  await flush();
  await flush();
  assert.equal(calls, 2);
  coordinator.dispose();
});

test("a visible trigger inside the cooldown is delayed instead of lost", async () => {
  let current = 0;
  let calls = 0;
  let scheduled;
  let delay;
  const coordinator = createDesktopCatchUpCoordinator(async () => { calls += 1; }, {
    cooldownMs: 30_000,
    now: () => current,
    setTimer: (callback, milliseconds) => { scheduled = callback; delay = milliseconds; return 1; },
    clearTimer: () => { scheduled = undefined; },
  });

  coordinator.trigger(true);
  await flush();
  current = 10_000;
  coordinator.trigger();
  assert.equal(calls, 1);
  assert.equal(delay, 20_000);
  current = 30_000;
  scheduled();
  await flush();
  assert.equal(calls, 2);
  coordinator.dispose();
});

test("a forced trigger bypasses and clears a scheduled cooldown run", async () => {
  let current = 0;
  let calls = 0;
  let scheduled;
  let cleared = 0;
  const coordinator = createDesktopCatchUpCoordinator(async () => { calls += 1; }, {
    cooldownMs: 30_000,
    now: () => current,
    setTimer: (callback) => { scheduled = callback; return 1; },
    clearTimer: () => { cleared += 1; scheduled = undefined; },
  });

  coordinator.trigger(true);
  await flush();
  current = 5_000;
  coordinator.trigger();
  coordinator.trigger(true);
  await flush();
  assert.equal(calls, 2);
  assert.equal(cleared, 1);
  assert.equal(scheduled, undefined);
  coordinator.dispose();
});
