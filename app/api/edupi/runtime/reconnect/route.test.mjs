import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Core reconnect route restarts the supervised runtime without exposing raw failures", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /isApiRequestAllowed\(request\)/);
  assert.match(source, /restartEduPiRuntime\(roots\)/);
  assert.match(source, /host\.call\("health", null\)/);
  assert.match(source, /health\.status !== "ready"/);
  assert.match(source, /describeEduPiRuntimeStartupFailure\(error\) \|\| "Core 重新连接失败"/);
  assert.doesNotMatch(source, /String\(error\)|error instanceof Error \? error\.message/);
});
