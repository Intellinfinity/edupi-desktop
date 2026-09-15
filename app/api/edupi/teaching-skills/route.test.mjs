import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false }).import("./route.ts");
const valid = { action: "create", title: "错因分组讲评", content: "先独立作答，再按错因分组。" };

function request(body, headers = {}) {
  return new Request("http://localhost/api/edupi/teaching-skills", { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(body) });
}

test("teaching method route rejects cross-site, non-JSON, unknown and oversized input before Core", async () => {
  assert.equal((await POST(request({ ...valid, api_key: "secret" }))).status, 400);
  assert.equal((await POST(request(valid, { origin: "https://untrusted.example" }))).status, 403);
  assert.equal((await POST(request(valid, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await POST(request({ ...valid, content: "字".repeat(12_001) }))).status, 413);
});

test("teaching method route is a bounded Core adapter with deterministic receipt reconciliation", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /teachingMethodMutationRequestId/);
  assert.match(source, /validateTeachingMethodMutationResponse/);
  assert.match(source, /runCoreProcess/);
  assert.doesNotMatch(source, /randomUUID|writeFile|safeSave|AgentSession/);
});
