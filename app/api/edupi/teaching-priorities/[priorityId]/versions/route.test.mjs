import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false });
const { GET, POST } = await jiti.import("./route.ts");
const { parseTeachingPriorityRestoreBody } = await jiti.import("../../../../../../lib/edupi-teaching-priority-request.ts");
const params = { params: Promise.resolve({ priorityId: "priority-1" }) };
const valid = { versionId: "teaching-priority-version-1", versionSide: "before", expectedRevision: 2 };

function request(body, headers = {}) {
  return new Request("http://localhost/api/edupi/teaching-priorities/priority-1/versions", { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(body) });
}

test("parses only one exact teaching priority restore intent", () => {
  assert.deepEqual(parseTeachingPriorityRestoreBody(valid), valid);
  for (const value of [{ ...valid, token: "secret" }, { ...valid, versionId: "" }, { ...valid, versionSide: "latest" }, { ...valid, expectedRevision: -1 }]) assert.equal(parseTeachingPriorityRestoreBody(value), null);
});

test("history and restore routes reject untrusted requests before Core", async () => {
  assert.equal((await POST(request({ ...valid, token: "secret" }), params)).status, 400);
  assert.equal((await POST(request(valid, { origin: "https://untrusted.example" }), params)).status, 403);
  const invalidGet = new Request("http://localhost/api/edupi/teaching-priorities//versions", { headers: { host: "localhost" } });
  assert.equal((await GET(invalidGet, { params: Promise.resolve({ priorityId: "" }) })).status, 400);
});

test("history route reads and restores only through Core with post-write reconciliation", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /readTeachingPriorityHistory/);
  assert.match(source, /NextResponse\.json\(\{ history: state\.history, data: state\.data \}\)/);
  assert.match(source, /history\.versions\.at\(-1\).*afterValues/);
  assert.match(source, /restoreTeachingPriorityVersion/);
  assert.match(source, /teachingPriorityRestoreRequestId/);
  assert.match(source, /ownedRestore/);
  assert.match(source, /verifiesReceipt/);
  assert.doesNotMatch(source, /writeFile|safeSave|teaching_priorities\.json/);
});
