import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("cached available releases remain in the startup reminder response", () => {
  assert.match(source, /const components = APP_UPDATE_PROJECTS\.map/);
  assert.match(source, /updates: getAvailableAppUpdates\(components\)/);
});

test("a manual settings check cannot be coalesced behind a routine cached check", () => {
  assert.match(source, /if \(forceRefresh\) \{\s*updateCheck = performUpdateCheck\(true\)/);
  assert.match(source, /else \{\s*if \(!globalThis\.__piWebAppUpdateCheck\)/);
});

test("failed proxy discovery keeps the old cache retryable, then refresh recovers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "edupi-update-route-proxy-"));
  const config = path.join(root, "config");
  const agent = path.join(root, "agent");
  const stateFile = path.join(agent, "edupi-desktop-update-check.json");
  const previousStateDir = process.env.PI_DESKTOP_STATE_DIR;
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousFetch = globalThis.fetch;
  const server = createServer((socket) => socket.once("data", () => socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")));
  try {
    await mkdir(config);
    await mkdir(agent);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.PI_DESKTOP_STATE_DIR = config;
    process.env.PI_CODING_AGENT_DIR = agent;
    await writeFile(path.join(config, "updater-proxy.json"), JSON.stringify({ updateProxy: `http://127.0.0.1:${server.address().port}` }));
    const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
    const { GET } = await jiti.import("./route.ts");
    const { APP_VERSION } = await jiti.import("../../../lib/branding.ts");
    const [major, minor, patch] = APP_VERSION.split(".").map(Number);
    const nextVersion = `${major}.${minor}.${patch + 1}`;
    const url = "http://localhost:30141/api/updates?refresh=1";
    const failed = await (await GET(new Request(url))).json();
    assert.equal(failed.errors?.[0]?.project, "edupi-desktop");
    assert.match(failed.errors[0].message, /更新代理连接失败/);
    assert.deepEqual(failed.updates, []);
    await assert.rejects(readFile(stateFile), { code: "ENOENT" });

    await rm(path.join(config, "updater-proxy.json"));
    globalThis.fetch = async () => new Response(JSON.stringify({ tag_name: `v${nextVersion}`, html_url: `https://github.com/Intellinfinity/edupi-desktop/releases/tag/v${nextVersion}` }), { status: 200, headers: { "content-type": "application/json" } });
    const recovered = await (await GET(new Request(url))).json();
    assert.equal(recovered.updates.length, 1);
    assert.equal(recovered.errors, undefined);
    const persisted = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(typeof persisted.lastCheckedAt["edupi-desktop"], "number");
    await writeFile(path.join(config, "updater-proxy.json"), JSON.stringify({ updateProxy: `http://127.0.0.1:${server.address().port}` }));
    const stale = await (await GET(new Request(url))).json();
    assert.equal(stale.errors?.[0]?.project, "edupi-desktop");
    assert.equal(stale.updates.length, 1);
    const unchanged = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(unchanged.lastCheckedAt["edupi-desktop"], persisted.lastCheckedAt["edupi-desktop"]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousStateDir === undefined) delete process.env.PI_DESKTOP_STATE_DIR;
    else process.env.PI_DESKTOP_STATE_DIR = previousStateDir;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
