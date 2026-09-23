import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { GET, POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const source = await fs.readFile(new URL("./route.ts", import.meta.url), "utf8");
const url = "http://localhost:30141/api/edupi/schedule-conflicts";

test("conflict reads and decisions require the native process token before Core access", async () => {
  const previousToken = process.env.PI_DESKTOP_API_TOKEN;
  process.env.PI_DESKTOP_API_TOKEN = "x".repeat(64);
  try {
    const headers = { host: "localhost:30141", origin: "http://localhost:30141" };
    assert.equal((await GET(new Request(url, { headers }))).status, 403);
    assert.equal((await POST(new Request(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" }))).status, 403);
    assert.equal((await GET(new Request(url, { headers: { ...headers, "x-pi-desktop-token": "wrong" } }))).status, 403);
    assert.equal((await GET(new Request(url, { headers: { ...headers, origin: "https://attacker.example", "x-pi-desktop-token": "x".repeat(64) } }))).status, 403);
  } finally {
    if (previousToken === undefined) delete process.env.PI_DESKTOP_API_TOKEN;
    else process.env.PI_DESKTOP_API_TOKEN = previousToken;
  }
});

test("conflict owner reads stay behind the persistent owner credential", () => {
  assert.match(source, /callOwnerControl\("owner_read", \{\}\)/);
  assert.doesNotMatch(source, /\.call\("owner_read", \{\}\)/);
});

test("malformed conflict decisions fail before starting Core", async () => {
  const previousToken = process.env.PI_DESKTOP_API_TOKEN;
  const previousCore = process.env.EDUPI_CORE_ROOT;
  process.env.PI_DESKTOP_API_TOKEN = "x".repeat(64);
  process.env.EDUPI_CORE_ROOT = "/definitely/missing/conflict-core";
  try {
    const headers = { host: "localhost:30141", origin: "http://localhost:30141", "x-pi-desktop-token": "x".repeat(64), "content-type": "application/json" };
    for (const body of [null, { action: "bootstrap", owner_id: "forged" }, { action: "resolve", decision: "send" }, { action: "resolve", commandId: "bad", conflictId: "missing", kind: "calendar", canonicalId: "item", expectedRevision: 1, expectedContentHash: "wrong", expectedConflictHash: "wrong", decision: "keep_existing" }]) {
      const response = await POST(new Request(url, { method: "POST", headers, body: JSON.stringify(body) }));
      assert.equal(response.status, 400);
    }
  } finally {
    if (previousToken === undefined) delete process.env.PI_DESKTOP_API_TOKEN;
    else process.env.PI_DESKTOP_API_TOKEN = previousToken;
    if (previousCore === undefined) delete process.env.EDUPI_CORE_ROOT;
    else process.env.EDUPI_CORE_ROOT = previousCore;
  }
});
