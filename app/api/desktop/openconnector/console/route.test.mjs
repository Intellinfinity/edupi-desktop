import assert from "node:assert/strict";
import { copyFile, cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("./route.ts");
const { closeOpenConnectorConsole } = await jiti.import("../../../../../lib/openconnector-console-manager.ts");
const route = "http://localhost:30141/api/desktop/openconnector/console";
const token = "c".repeat(64);
const headers = { host: "localhost:30141", origin: "http://localhost:30141", "x-pi-desktop-token": token };

test("console start requires the desktop token and same-origin loopback", async () => {
  const previous = process.env.PI_DESKTOP_API_TOKEN;
  process.env.PI_DESKTOP_API_TOKEN = token;
  try {
    for (const requestHeaders of [
      { host: "localhost:30141", origin: "http://localhost:30141" },
      { ...headers, "x-pi-desktop-token": "wrong" },
      { ...headers, origin: "https://attacker.example" },
      { ...headers, host: "attacker.example" },
    ]) {
      const response = await GET(new Request(route, { headers: requestHeaders }));
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_API_TOKEN;
    else process.env.PI_DESKTOP_API_TOKEN = previous;
  }
});

test("authorized desktop opens the packaged official UI on loopback without enabling account writes or Actions", async () => {
  const previousToken = process.env.PI_DESKTOP_API_TOKEN;
  const previousRoot = process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT;
  const root = await mkdtemp(path.join(tmpdir(), "edupi-console-package-"));
  await copyFile(path.resolve("desktop/open-connector-console-host.mjs"), path.join(root, "console-host.mjs"));
  await cp(path.resolve("desktop/open-connector-console-assets"), path.join(root, "web"), { recursive: true });
  await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
  process.env.PI_DESKTOP_API_TOKEN = token;
  process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT = root;
  try {
    const response = await GET(new Request(route, { headers }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.match(body.url, /^http:\/\/127\.0\.0\.1:[1-9][0-9]*\/$/u);
    assert.match(await (await fetch(body.url)).text(), /EduPi Connect/u);
    assert.deepEqual(await (await fetch(new URL("api/auth/session", body.url))).json(), { adminAuthConfigured: false, authenticated: true });
    const providers = await (await fetch(new URL("api/providers", body.url))).json();
    assert.ok(Array.isArray(providers) && providers.length > 1_000);
    const blockedAccount = await fetch(new URL("api/connections/github", body.url), { method: "PUT", body: "{}" });
    const blockedAction = await fetch(new URL("v1/actions/hackernews.get_top_stories", body.url), { method: "POST", body: "{}" });
    assert.equal(blockedAccount.status, 403);
    assert.equal(blockedAction.status, 403);
    const second = await GET(new Request(route, { headers }));
    assert.equal((await second.json()).url, body.url, "one managed console host is reused");
  } finally {
    await closeOpenConnectorConsole();
    await rm(root, { recursive: true, force: true });
    if (previousToken === undefined) delete process.env.PI_DESKTOP_API_TOKEN;
    else process.env.PI_DESKTOP_API_TOKEN = previousToken;
    if (previousRoot === undefined) delete process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT;
    else process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT = previousRoot;
  }
});

test("desktop development opens the pinned Console source assets without a staged package", async () => {
  const previousToken = process.env.PI_DESKTOP_API_TOKEN;
  const previousRoot = process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT;
  const previousMode = process.env.NODE_ENV;
  process.env.PI_DESKTOP_API_TOKEN = token;
  process.env.NODE_ENV = "development";
  delete process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT;
  try {
    const response = await GET(new Request(route, { headers }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(await (await fetch(body.url)).text(), /EduPi Connect/u);
    assert.equal((await fetch(new URL("api/providers", body.url))).status, 200);
  } finally {
    await closeOpenConnectorConsole();
    if (previousToken === undefined) delete process.env.PI_DESKTOP_API_TOKEN;
    else process.env.PI_DESKTOP_API_TOKEN = previousToken;
    if (previousRoot === undefined) delete process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT;
    else process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT = previousRoot;
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
  }
});
