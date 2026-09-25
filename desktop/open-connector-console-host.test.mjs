import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createConsoleHttpServer } from "./open-connector-console-host.mjs";

test("official console assets and bounded catalog GETs are served on a dedicated loopback origin", async () => {
  const assetRoot = await mkdtemp(join(tmpdir(), "edupi-console-assets-"));
  await mkdir(join(assetRoot, "assets"));
  await writeFile(join(assetRoot, "index.html"), "<!doctype html><title>OpenConnector</title>");
  await writeFile(join(assetRoot, "assets", "app.js"), "export const consoleReady = true;");
  const forwarded = [];
  const runtime = { fetch: async (request) => {
    forwarded.push(request.url);
    return Response.json({ authenticated: true, adminAuthConfigured: false });
  } };
  const server = await createConsoleHttpServer({ assetRoot, runtime });
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:[1-9][0-9]*\/$/u);
    const page = await fetch(server.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /OpenConnector/u);
    assert.match(page.headers.get("content-security-policy") || "", /connect-src 'self'/u);
    const route = await fetch(new URL("providers/npm", server.url));
    assert.equal(route.status, 200);
    assert.match(await route.text(), /OpenConnector/u);
    const asset = await fetch(new URL("assets/app.js", server.url));
    assert.equal(asset.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.match(await asset.text(), /consoleReady/u);
    const api = await fetch(new URL("api/auth/session", server.url));
    assert.deepEqual(await api.json(), { authenticated: true, adminAuthConfigured: false });
    const details = await fetch(new URL("api/actions/npm.get_package", server.url));
    assert.equal(details.status, 200);
    assert.deepEqual(forwarded.map((url) => new URL(url).pathname), ["/api/auth/session", "/api/actions/npm.get_package"]);
  } finally {
    await server.close();
    await rm(assetRoot, { recursive: true, force: true });
  }
});

test("console HTTP boundary rejects account writes, Action execution, spoofed hosts, and unknown GETs", async () => {
  const assetRoot = await mkdtemp(join(tmpdir(), "edupi-console-assets-"));
  await writeFile(join(assetRoot, "index.html"), "<!doctype html><title>OpenConnector</title>");
  let runtimeCalls = 0;
  const server = await createConsoleHttpServer({ assetRoot, runtime: { fetch: async () => { runtimeCalls++; return Response.json({}); } } });
  try {
    for (const path of ["api/connections/github", "api/oauth/authorizations", "api/runtime-tokens", "v1/actions/hackernews.get_top_stories"]) {
      const response = await fetch(new URL(path, server.url), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      assert.equal(response.status, 403, path);
    }
    assert.equal((await fetch(new URL("api/unknown", server.url))).status, 404);
    assert.equal((await fetch(new URL("v1/actions/hackernews.get_top_stories", server.url))).status, 404);
    const spoofed = await new Promise((resolve, reject) => {
      const req = httpRequest(server.url, { headers: { Host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.once("error", reject);
      req.end();
    });
    assert.equal(spoofed, 403);
    assert.equal(runtimeCalls, 0);
  } finally {
    await server.close();
    await rm(assetRoot, { recursive: true, force: true });
  }
});
