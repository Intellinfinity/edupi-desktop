import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false });
const { POST } = await jiti.import("./route.ts");
const params = { params: Promise.resolve({ factId: "fact-1" }) };
const valid = { action: "review", expectedRevision: 0, decision: "accept", reviewer: "teacher", note: null, supersedesFactId: null, supersedesFactRevision: null };

function request(body, headers = {}) {
  return new Request("http://localhost/api/edupi/facts/fact-1", { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(body) });
}

test("fact mutation route rejects untrusted and malformed requests before Core", async () => {
  assert.equal((await POST(request({ ...valid, api_key: "secret" }), params)).status, 400);
  assert.equal((await POST(request(valid, { origin: "https://untrusted.example" }), params)).status, 403);
  const text = new Request("http://localhost/api/edupi/facts/fact-1", { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "text/plain" }, body: JSON.stringify(valid) });
  assert.equal((await POST(text, params)).status, 415);
});

test("fact mutation route delegates to Core and verifies the refreshed projection", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /mutateEducationFact/);
  assert.match(source, /readEducationContract/);
  assert.match(source, /verifiesFactMutation/);
  assert.match(source, /findDeletedEducationFact/);
  assert.match(source, /verifiesDeletedFact/);
  assert.doesNotMatch(source, /writeFile|education_facts_v1\.json|AgentSession/);
});
