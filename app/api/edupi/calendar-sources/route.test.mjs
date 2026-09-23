import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { GET } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

test("calendar source listing rejects cross-site reads before Core", async () => {
  const forbidden = await GET(new Request("http://localhost/api/edupi/calendar-sources", {
    headers: { host: "localhost", origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  }));
  assert.equal(forbidden.status, 403);
});

test("calendar source listing is no-store, Core-owned, and exposes no private occurrence rows", async () => {
  const source = await fs.readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /readCoreCalendarSources/);
  assert.match(source, /Cache-Control["']:\s*["']no-store/);
  assert.match(source, /sourceId:\s*source\.sourceId/);
  assert.match(source, /fingerprint:\s*source\.fingerprint/);
  assert.doesNotMatch(source, /PI_DESKTOP_STATE_DIR|calendar-sources\.json|occurrences:\s*source\.occurrences|source_hash/);
});
