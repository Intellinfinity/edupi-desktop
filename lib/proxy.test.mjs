import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("LAN mode gates every non-mobile surface behind the mobile boundary", () => {
  const source = fs.readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(source, /EDUPI_MOBILE_BRIDGE_ENABLED/);
  assert.match(source, /pathname === "\/mobile"/);
  assert.match(source, /pathname\.startsWith\("\/api\/mobile\/"\)/);
  assert.match(source, /loopback-only/);
});
