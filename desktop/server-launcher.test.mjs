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
