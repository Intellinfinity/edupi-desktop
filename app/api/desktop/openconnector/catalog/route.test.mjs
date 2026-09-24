import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const url = "http://localhost:30141/api/desktop/openconnector/catalog";
const token = "x".repeat(64);
const baseHeaders = { host: "localhost:30141", origin: "http://localhost:30141", "content-type": "application/json" };

test("catalog route is desktop-token protected before touching the child", async () => {
  const previous = process.env.PI_DESKTOP_API_TOKEN;
  process.env.PI_DESKTOP_API_TOKEN = token;
  try {
    const body = JSON.stringify({ op: "search", query: "calendar" });
    for (const headers of [baseHeaders, { ...baseHeaders, "x-pi-desktop-token": "wrong" }, { ...baseHeaders, origin: "https://attacker.example", "x-pi-desktop-token": token }]) {
      const response = await POST(new Request(url, { method: "POST", headers, body }));
      assert.equal(response.status, 403);
    }
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_API_TOKEN;
    else process.env.PI_DESKTOP_API_TOKEN = previous;
  }
});

test("catalog route rejects Action requests and fails closed when the package is unavailable", async () => {
  const previousToken = process.env.PI_DESKTOP_API_TOKEN;
  const previousRoot = process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT;
  process.env.PI_DESKTOP_API_TOKEN = token;
  process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT = "/definitely/missing/catalog";
  const headers = { ...baseHeaders, "x-pi-desktop-token": token };
  try {
    for (const body of [{ op: "execute", actionId: "npm.get_package" }, { op: "search", query: "" }, { op: "inspect", actionId: "npm.get_package", token: "forged" }]) {
      const response = await POST(new Request(url, { method: "POST", headers, body: JSON.stringify(body) }));
      assert.equal(response.status, 400);
    }
    assert.equal((await POST(new Request(url, { method: "POST", headers, body: JSON.stringify({ op: "search", query: "x".repeat(2_000) }) }))).status, 413);
    assert.equal((await POST(new Request(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "calendar" }))).status, 415);
    const unavailable = await POST(new Request(url, { method: "POST", headers, body: JSON.stringify({ op: "search", query: "calendar" }) }));
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { ok: false, code: "catalog_unavailable" });
  } finally {
    if (previousToken === undefined) delete process.env.PI_DESKTOP_API_TOKEN;
    else process.env.PI_DESKTOP_API_TOKEN = previousToken;
    if (previousRoot === undefined) delete process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT;
    else process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT = previousRoot;
  }
});
