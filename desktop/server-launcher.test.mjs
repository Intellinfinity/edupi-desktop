import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { shouldWakeCoreAtPackagedStart, wakePackagedCoreAtStartup } = require("./server-launcher.cjs");

const packaged = {
  NODE_ENV: "production",
  EDUPI_CORE_VALIDATION_MODE: "bundled",
  HOSTNAME: "127.0.0.1",
  PORT: "38472",
  PI_WEB_PARENT_PID: "12345",
  PI_DESKTOP_INSTANCE_ID: "isolated-instance",
};

test("headless G1 boot is limited to an identified packaged server with bundled Core", () => {
  assert.equal(shouldWakeCoreAtPackagedStart(packaged), true);
  for (const changed of [
    { NODE_ENV: "development" },
    { EDUPI_CORE_VALIDATION_MODE: "external" },
    { HOSTNAME: "0.0.0.0" },
    { PORT: "0" },
    { PI_WEB_PARENT_PID: "" },
    { PI_DESKTOP_INSTANCE_ID: "" },
  ]) assert.equal(shouldWakeCoreAtPackagedStart({ ...packaged, ...changed }), false);
});

test("headless G1 boot verifies the exact child identity before one preparation wake", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ path: new URL(url).pathname, method: options?.method || "GET" });
    if (new URL(url).pathname === "/api/desktop/identity") return new Response(null, { status: 204, headers: { "x-pi-desktop-instance": packaged.PI_DESKTOP_INSTANCE_ID } });
    return Response.json({ state: "idle" });
  };
  assert.equal(await wakePackagedCoreAtStartup(packaged, fetcher), "ready");
  assert.deepEqual(calls, [
    { path: "/api/desktop/identity", method: "GET" },
    { path: "/api/edupi/preparation", method: "POST" },
  ]);

  const rejected = [];
  assert.equal(await wakePackagedCoreAtStartup(packaged, async (url) => {
    rejected.push(new URL(url).pathname);
    return new Response(null, { status: 204, headers: { "x-pi-desktop-instance": "other-process" } });
  }), "identity_mismatch");
  assert.deepEqual(rejected, ["/api/desktop/identity"]);
});

test("headless G1 boot keeps probing after the original twelve-probe window", async () => {
  let identityProbes = 0;
  let preparationWakes = 0;
  const delays = [];
  const result = await wakePackagedCoreAtStartup(packaged, async (url) => {
    if (new URL(url).pathname === "/api/desktop/identity") {
      identityProbes++;
      return identityProbes <= 14
        ? new Response(null, { status: 503 })
        : new Response(null, { status: 204, headers: { "x-pi-desktop-instance": packaged.PI_DESKTOP_INSTANCE_ID } });
    }
    preparationWakes++;
    return Response.json({ state: "idle" });
  }, { sleep: async (delay) => { delays.push(delay); return true; } });
  assert.equal(result, "ready");
  assert.equal(identityProbes, 15);
  assert.equal(preparationWakes, 1);
  assert.equal(delays.length, 14);
  assert.ok(delays.every((delay) => delay > 0 && delay <= 30_000));
});

test("a late identity mismatch fails closed without calling Core preparation", async () => {
  let identityProbes = 0;
  let preparationWakes = 0;
  const result = await wakePackagedCoreAtStartup(packaged, async (url) => {
    if (new URL(url).pathname === "/api/desktop/identity") {
      identityProbes++;
      return identityProbes <= 14
        ? new Response(null, { status: 503 })
        : new Response(null, { status: 204, headers: { "x-pi-desktop-instance": "another-instance" } });
    }
    preparationWakes++;
    return Response.json({ state: "idle" });
  }, { sleep: async () => true });
  assert.equal(result, "identity_mismatch");
  assert.equal(identityProbes, 15);
  assert.equal(preparationWakes, 0);
});

test("a failed preparation wake is retried only after revalidating the child identity", async () => {
  let identityProbes = 0;
  let preparationWakes = 0;
  const result = await wakePackagedCoreAtStartup(packaged, async (url) => {
    if (new URL(url).pathname === "/api/desktop/identity") {
      identityProbes++;
      return new Response(null, { status: 204, headers: { "x-pi-desktop-instance": packaged.PI_DESKTOP_INSTANCE_ID } });
    }
    preparationWakes++;
    return preparationWakes < 3
      ? new Response(null, { status: 503 })
      : Response.json({ state: "idle" });
  }, { sleep: async () => true });
  assert.equal(result, "ready");
  assert.equal(identityProbes, 3);
  assert.equal(preparationWakes, 3);
});

test("repeated Core preparation errors stop after a bounded readiness retry budget", async () => {
  let preparationWakes = 0;
  const result = await wakePackagedCoreAtStartup(packaged, async (url) => {
    if (new URL(url).pathname === "/api/desktop/identity") {
      return new Response(null, { status: 204, headers: { "x-pi-desktop-instance": packaged.PI_DESKTOP_INSTANCE_ID } });
    }
    preparationWakes++;
    return Response.json({ state: "error", error: "native_attestation_required" });
  }, { sleep: async () => true });
  assert.equal(result, "degraded");
  assert.equal(preparationWakes, 3);
});

test("a transient Core preparation error can recover after revalidating the same instance", async () => {
  let preparationWakes = 0;
  let identityProbes = 0;
  const result = await wakePackagedCoreAtStartup(packaged, async (url) => {
    if (new URL(url).pathname === "/api/desktop/identity") {
      identityProbes++;
      return new Response(null, { status: 204, headers: { "x-pi-desktop-instance": packaged.PI_DESKTOP_INSTANCE_ID } });
    }
    preparationWakes++;
    return Response.json({ state: preparationWakes === 1 ? "error" : "idle" });
  }, { sleep: async () => true });
  assert.equal(result, "ready");
  assert.equal(preparationWakes, 2);
  assert.equal(identityProbes, 2);
});

test("readiness retry uses capped backoff and can be cancelled", async () => {
  const controller = new AbortController();
  const delays = [];
  let identityProbes = 0;
  const result = await wakePackagedCoreAtStartup(packaged, async () => {
    identityProbes++;
    return new Response(null, { status: 503 });
  }, {
    signal: controller.signal,
    sleep: async (delay) => {
      delays.push(delay);
      if (delays.length === 22) controller.abort();
      return !controller.signal.aborted;
    },
  });
  assert.equal(result, "cancelled");
  assert.equal(identityProbes, 22);
  assert.equal(delays[0], 250);
  assert.equal(delays[11], 250);
  assert.equal(delays[12], 500);
  assert.equal(delays.at(-1), 30_000);
  assert.ok(delays.every((delay) => delay <= 30_000));
});

test("readiness retry cancels a pending real sleep promptly", async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const pending = wakePackagedCoreAtStartup(packaged, async () => new Response(null, { status: 503 }), {
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 20);
  assert.equal(await pending, "cancelled");
  assert.ok(Date.now() - startedAt < 500);
});
