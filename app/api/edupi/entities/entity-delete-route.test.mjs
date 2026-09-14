import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { DELETE, POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./[kind]/[id]/route.ts");

const context = (kind, id) => ({ params: Promise.resolve({ kind, id }) });
const restoreRequestId = `entity-restore-${"a".repeat(43)}`;
const request = (body, headers = {}, method = "DELETE") => new Request("http://localhost/api/edupi/entities/calendar/calendar-1", {
  method,
  headers: { host: "localhost", "content-type": "application/json", origin: "http://localhost", "sec-fetch-site": "same-origin", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

test("entity DELETE rejects cross-site, malformed, unknown fields and unknown targets before Core", async () => {
  const crossSite = await DELETE(request({ note: null }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }), context("calendar", "calendar-1"));
  assert.equal(crossSite.status, 403);
  const malformed = await DELETE(request("{"), context("calendar", "calendar-1"));
  assert.equal(malformed.status, 400);
  const unknown = await DELETE(request({ note: null, force: true }), context("calendar", "calendar-1"));
  assert.equal(unknown.status, 400);
  const unknownTarget = await DELETE(request({ note: null }), context("unknown-kind", "unknown-1"));
  assert.equal(unknownTarget.status, 400);
  const invalidId = await DELETE(request({ note: null }), context("calendar", "bad\ncalendar"));
  assert.equal(invalidId.status, 400);
});

test("entity restore rejects cross-site and caller-supplied tombstone state before Core", async () => {
  const crossSite = await POST(request({ note: null }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }, "POST"), context("calendar", "calendar-1"));
  assert.equal(crossSite.status, 403);
  const suppliedState = await POST(request({ note: null, expected_tombstone_revision: 1 }, {}, "POST"), context("calendar", "calendar-1"));
  assert.equal(suppliedState.status, 400);
  const missingRequestId = await POST(request({ note: null }, {}, "POST"), context("calendar", "calendar-1"));
  assert.equal(missingRequestId.status, 400);
  const malformedRequestId = await POST(request({ note: null, restoreRequestId: "entity-restore-invalid" }, {}, "POST"), context("calendar", "calendar-1"));
  assert.equal(malformedRequestId.status, 400);
  const restoreIdOnDelete = await DELETE(request({ note: null, restoreRequestId }), context("calendar", "calendar-1"));
  assert.equal(restoreIdOnDelete.status, 400);
});

test("valid-shaped entity deletion and restore reach only the Core boundary", async () => {
  const previousCore = process.env.EDUPI_CORE_ROOT;
  const previousData = process.env.EDUPI_DATA_ROOT;
  process.env.EDUPI_CORE_ROOT = "/missing/core";
  process.env.EDUPI_DATA_ROOT = "/missing/data";
  try {
    const response = await DELETE(request({ note: null }), context("calendar", "calendar-1"));
    assert.equal(response.status, 503);
    const restoreResponse = await POST(request({ note: null, restoreRequestId }, {}, "POST"), context("calendar", "calendar-1"));
    assert.equal(restoreResponse.status, 503);
  } finally {
    if (previousCore === undefined) delete process.env.EDUPI_CORE_ROOT; else process.env.EDUPI_CORE_ROOT = previousCore;
    if (previousData === undefined) delete process.env.EDUPI_DATA_ROOT; else process.env.EDUPI_DATA_ROOT = previousData;
  }
});

test("entity mutation route has no direct filesystem writer or Agent fallback", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("./[kind]/[id]/route.ts", import.meta.url), "utf8"));
  assert.match(source, /deleteEducationEntity/);
  assert.match(source, /restoreEducationEntity/);
  assert.doesNotMatch(source, /writeFile|unlink|rmSync|localStorage|sessionStorage|\/api\/agent/);
});
