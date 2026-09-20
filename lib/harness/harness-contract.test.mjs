import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const routeUrls = [
  new URL("../../app/api/agent/new/route.ts", import.meta.url),
  new URL("../../app/api/agent/[id]/route.ts", import.meta.url),
  new URL("../../app/api/agent/[id]/events/route.ts", import.meta.url),
  new URL("../../app/api/sessions/[id]/auto-name/route.ts", import.meta.url),
  new URL("../../app/api/mobile/sessions/[id]/messages/route.ts", import.meta.url),
];

async function listRouteFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await listRouteFiles(path));
    else if (entry.name === "route.ts") paths.push(path);
  }
  return paths;
}

test("all five production session-start routes use the harness runtime without changing the client contract", async () => {
  const sources = await Promise.all(routeUrls.map((url) => readFile(url, "utf8")));
  const allRouteFiles = await listRouteFiles(fileURLToPath(new URL("../../app/api/", import.meta.url)));
  const allRouteSources = await Promise.all(allRouteFiles.map((path) => readFile(path, "utf8")));

  for (const source of sources) {
    assert.match(source, /from "@\/lib\/harness\/runtime"/);
    assert.match(source, /startHarnessSession\(/);
    assert.doesNotMatch(source, /\bstartRpcSession\b/);
    assert.doesNotMatch(source, /harnessId/);
  }
  assert.equal(allRouteSources.filter((source) => /\bstartHarnessSession\b/.test(source)).length, 5);
  for (const source of allRouteSources) assert.doesNotMatch(source, /\bstartRpcSession\b/);
});

test("the harness runtime is the sole direct owner of startRpcSession", async () => {
  const runtime = await readFile(new URL("./runtime.ts", import.meta.url), "utf8");
  const piHarness = await readFile(new URL("./pi-harness.ts", import.meta.url), "utf8");

  assert.match(runtime, /import \{ startRpcSession \} from "\.\.\/rpc-manager\.ts"/);
  assert.equal((runtime.match(/import \{ startRpcSession \}/g) ?? []).length, 1);
  assert.match(runtime, /createPiHarness\(\{ startRpcSession \}\)/);
  assert.doesNotMatch(piHarness, /import \{ startRpcSession \}/);
});
