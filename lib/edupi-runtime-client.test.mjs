import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Core reconnect client calls only the bounded runtime recovery endpoint", async () => {
  const source = await readFile(new URL("./edupi-runtime-client.ts", import.meta.url), "utf8");
  assert.match(source, /fetch\("\/api\/edupi\/runtime\/reconnect"/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /body: "\{\}"/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|Authorization/);
});
