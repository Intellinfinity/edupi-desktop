import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const { PUT } = await createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false }).import("./[name]/route.ts");
const params = { params: Promise.resolve({ name: "李四" }) };
const valid = { studentId: "student-1", className: "703", traits: ["认真"], parentNotes: [], expectedUpdatedAt: "2026-09-15T00:00:00.000Z", expectedRevision: 1 };

function request(body, headers = {}) {
  return new Request("http://localhost/api/edupi/students/%E6%9D%8E%E5%9B%9B", { method: "PUT", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(body) });
}

test("student profile update route is strict, bounded and Core-owned", async () => {
  const [route, server] = await Promise.all([
    read("./[name]/route.ts"),
    read("../../../../lib/edupi-student-roster-server.ts"),
  ]);
  assert.match(route, /export async function PUT/);
  assert.match(route, /isApiRequestAllowed/);
  assert.match(route, /hasJsonContentType/);
  assert.match(route, /parseJsonWithinLimit/);
  assert.match(route, /BODY_KEYS/);
  assert.match(route, /updateStudentProfile/);
  assert.match(route, /stale_student[\s\S]*409/);
  assert.doesNotMatch(route, /writeFile|safeSave|student_profiles\.json/);
  assert.match(server, /action: "update"/);
  assert.match(server, /expected_updated_at/);
  assert.match(server, /expected_revision/);
  assert.match(server, /external_send !== false/);
});

test("student profile update requires stable identity and both concurrency tokens", async () => {
  for (const body of [
    { ...valid, studentId: undefined },
    { ...valid, expectedRevision: undefined },
    { ...valid, expectedRevision: -1 },
    { ...valid, expectedUpdatedAt: "invalid" },
    { ...valid, credential: "secret" },
  ]) {
    const response = await PUT(request(body), params);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_request");
  }
});

test("student profile update blocks cross-origin and non-JSON writes", async () => {
  assert.equal((await PUT(request(valid, { origin: "https://untrusted.example" }), params)).status, 403);
  const nonJson = new Request("http://localhost/api/edupi/students/%E6%9D%8E%E5%9B%9B", { method: "PUT", headers: { host: "localhost", origin: "http://localhost", "content-type": "text/plain" }, body: JSON.stringify(valid) });
  assert.equal((await PUT(nonJson, params)).status, 415);
});
