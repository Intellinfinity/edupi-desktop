import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { after, test } from "node:test";

const require = createRequire(import.meta.url);
const { createMobileGateway } = require("./mobile-gateway.cjs");

const upstreamRequests = [];
const upstream = http.createServer((request, response) => {
  upstreamRequests.push({ url: request.url, host: request.headers.host, origin: request.headers.origin, desktopToken: request.headers["x-pi-desktop-token"] });
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ path: request.url }));
});

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

const upstreamPort = await listen(upstream);
const gateway = createMobileGateway({ upstreamPort });
const gatewayPort = await listen(gateway);
after(async () => {
  await close(gateway);
  await close(upstream);
});

test("LAN requests cannot reach desktop APIs or pairing administration by spoofing Host", async () => {
  const forbidden = ["/", "/api/sessions", "/api/agent/new", "/api/mobile/pairing", "/api/mobile/pairing/123"];
  for (const path of forbidden) {
    const response = await fetch(`http://127.0.0.1:${gatewayPort}${path}`, {
      headers: { Host: `127.0.0.1:${upstreamPort}`, "x-pi-desktop-token": "forged" },
    });
    assert.equal(response.status, 403, path);
  }
  assert.deepEqual(upstreamRequests, []);
});

test("LAN gateway passes only the phone page, public assets, and scoped mobile routes", async () => {
  for (const path of ["/mobile", "/_next/static/chunks/app/mobile/page.js", "/manifest.webmanifest", "/icons/icon-192.png", "/sw.js", "/api/mobile/sessions", "/api/mobile/sessions/session-id"]) {
    const response = await fetch(`http://127.0.0.1:${gatewayPort}${path}`);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("x-edupi-mobile-gateway"), "1");
    assert.equal((await response.json()).path, path);
  }
  const origin = `http://127.0.0.1:${gatewayPort}`;
  const pair = await fetch(`${origin}/api/mobile/pair`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "x-pi-desktop-token": "forged" },
    body: JSON.stringify({ code: "TESTCODE" }),
  });
  assert.equal(pair.status, 200);
  assert.equal(upstreamRequests.at(-1).origin, `http://127.0.0.1:${upstreamPort}`);
  assert.equal(upstreamRequests.at(-1).desktopToken, undefined);
  assert.ok(upstreamRequests.every((request) => request.host === `127.0.0.1:${upstreamPort}`));
});

test("LAN gateway rejects cross-site, encoded, absolute, and unsupported requests", async () => {
  const origin = `http://127.0.0.1:${gatewayPort}`;
  const crossSite = await fetch(`${origin}/api/mobile/pair`, {
    method: "POST", headers: { Origin: "https://attacker.example", "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(crossSite.status, 403);
  const encoded = await fetch(`${origin}/api/mobile/%70airing`);
  assert.equal(encoded.status, 403);
  const unsupported = await fetch(`${origin}/api/mobile/sessions`, { method: "DELETE" });
  assert.equal(unsupported.status, 403);
  const absolute = await new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port: gatewayPort, path: `http://127.0.0.1:${upstreamPort}/api/mobile/sessions` }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
    request.end();
  });
  assert.equal(absolute, 403);
});
