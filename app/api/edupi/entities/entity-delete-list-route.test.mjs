import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { GET } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

test("deletion ledger read rejects cross-site requests before Core", async () => {
  const response = await GET(new Request("http://localhost/api/edupi/entities", { headers: { host: "localhost", origin: "https://evil.example", "sec-fetch-site": "cross-site" } }));
  assert.equal(response.status, 403);
});

test("deletion ledger read reaches only the pinned Core boundary", async () => {
  const previousCore = process.env.EDUPI_CORE_ROOT;
  const previousData = process.env.EDUPI_DATA_ROOT;
  process.env.EDUPI_CORE_ROOT = "/missing/core";
  process.env.EDUPI_DATA_ROOT = "/missing/data";
  try {
    const response = await GET(new Request("http://localhost/api/edupi/entities", { headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin" } }));
    assert.equal(response.status, 503);
  } finally {
    if (previousCore === undefined) delete process.env.EDUPI_CORE_ROOT; else process.env.EDUPI_CORE_ROOT = previousCore;
    if (previousData === undefined) delete process.env.EDUPI_DATA_ROOT; else process.env.EDUPI_DATA_ROOT = previousData;
  }
});
