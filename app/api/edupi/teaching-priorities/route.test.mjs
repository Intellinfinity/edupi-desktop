import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false });
const { POST, PUT } = await jiti.import("./route.ts");
const { parseTeachingPriorityCreateBody, parseTeachingPriorityUpdateBody } = await jiti.import("../../../../lib/edupi-teaching-priority-request.ts");
const validCreate = { subject: "数学", className: "703", topic: "移项", note: "先补变号" };
const validUpdate = { priorityId: "priority-1", expectedRevision: 2, patch: { note: "先讲等式性质", status: "paused" } };

function request(method, body, headers = {}) {
  return new Request("http://localhost/api/edupi/teaching-priorities", { method, headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(body) });
}

test("parses only bounded teaching priority create and update intents", () => {
  assert.deepEqual(parseTeachingPriorityCreateBody(validCreate), validCreate);
  assert.deepEqual(parseTeachingPriorityUpdateBody(validUpdate), validUpdate);
  for (const value of [{ ...validCreate, api_key: "secret" }, { ...validCreate, subject: "" }, { ...validCreate, topic: "x".repeat(241) }, { ...validCreate, className: false }]) assert.equal(parseTeachingPriorityCreateBody(value), null);
  for (const value of [{ ...validUpdate, token: "secret" }, { ...validUpdate, priorityId: "" }, { ...validUpdate, expectedRevision: -1 }, { ...validUpdate, patch: {} }, { ...validUpdate, patch: { state: "done" } }, { ...validUpdate, patch: { status: "deleted" } }]) assert.equal(parseTeachingPriorityUpdateBody(value), null);
});

test("teaching priority mutations reject malformed, cross-origin, and non-JSON requests before Core", async () => {
  assert.equal((await POST(request("POST", { ...validCreate, api_key: "secret" }))).status, 400);
  assert.equal((await PUT(request("PUT", { ...validUpdate, patch: {} }))).status, 400);
  assert.equal((await POST(request("POST", validCreate, { origin: "https://untrusted.example" }))).status, 403);
  const nonJson = new Request("http://localhost/api/edupi/teaching-priorities", { method: "PUT", headers: { host: "localhost", origin: "http://localhost", "content-type": "text/plain" }, body: JSON.stringify(validUpdate) });
  assert.equal((await PUT(nonJson)).status, 415);
});

test("teaching priority route delegates all writes to Core and verifies the refreshed projection", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /createTeachingPriority/);
  assert.match(source, /updateTeachingPriority/);
  assert.match(source, /readEducationContract/);
  assert.match(source, /verifyCurrent/);
  assert.match(source, /receipt\.replayed/);
  assert.match(source, /priority_conflict/);
  assert.doesNotMatch(source, /writeFile|safeSave|teaching_priorities\.json/);
});
