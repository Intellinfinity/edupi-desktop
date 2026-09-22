import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Core repair is desktop-token protected, bounded, and health checked", async () => {
  const [route, client, native] = await Promise.all([
    readFile(new URL("./route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../../lib/edupi-runtime-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../../lib/desktop-native.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /isDesktopApiRequestAllowed\(request\)/);
  assert.doesNotMatch(route, /isApiRequestAllowed\(request\)/);
  assert.match(route, /await repairEduPiRuntimeState/);
  assert.match(route, /repaired\.repaired \? await restartEduPiRuntime\(roots\) : await ensureEduPiRuntime\(roots\)/);
  assert.match(route, /host\.call\("health", null\)/);
  assert.doesNotMatch(route, /error instanceof Error \? error\.message|String\(error\)/);
  assert.match(client, /fetchDesktopApi\("\/api\/edupi\/runtime\/repair"/);
  assert.match(native, /headers\.set\(DESKTOP_API_TOKEN_HEADER/);
  assert.match(native, /\^\\\/api\\\//);
});
