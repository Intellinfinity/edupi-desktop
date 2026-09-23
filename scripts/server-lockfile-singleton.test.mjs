import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

test("server routes share the native lockfile module and its signal handlers", async () => {
  const jiti = createJiti(import.meta.url);
  const { default: config } = await jiti.import("../next.config.ts");
  assert.ok(config.serverExternalPackages.includes("proper-lockfile"));
  assert.ok(config.serverExternalPackages.includes("node-ical"));
  assert.ok(config.serverExternalPackages.includes("temporal-polyfill"));
  assert.ok(config.outputFileTracingIncludes["/*"].includes("./lib/edupi-ics-worker.cjs"));
  for (const name of ["node-ical", "rrule-temporal", "temporal-polyfill", "temporal-spec", "temporal-utils"]) {
    assert.ok(config.outputFileTracingIncludes["/*"].includes(`./node_modules/${name}/**/*`));
  }
});
