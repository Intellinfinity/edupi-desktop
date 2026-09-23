import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { GET } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

test("timetable source listing rejects cross-site reads before Core", async () => {
  const forbidden = await GET(new Request("http://localhost/api/edupi/timetable-sources", {
    headers: { host: "localhost", origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  }));
  assert.equal(forbidden.status, 403);
});

test("timetable source listing is read-only and exposes only bounded source options", async () => {
  const source = await fs.readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /readCoreCalendarSources/);
  assert.match(source, /projectTimetableSourceOptions/);
  assert.match(source, /Cache-Control["']:\s*["']no-store/);
  assert.doesNotMatch(source, /occurrenceEvents|material\.staging_path|PI_DESKTOP_STATE_DIR/u);
});
