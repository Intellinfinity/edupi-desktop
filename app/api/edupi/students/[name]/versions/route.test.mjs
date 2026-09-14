import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { GET, POST } = await createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false }).import("./route.ts");
const params = { params: Promise.resolve({ name: "李四" }) };
const valid = { studentId: "student-1", versionId: "student-profile-version-1", versionSide: "before", expectedRevision: 2 };

function request(body, headers = {}) {
  return new Request("http://localhost/api/edupi/students/%E6%9D%8E%E5%9B%9B/versions", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
    body: JSON.stringify(body),
  });
}

test("rejects malformed student profile restore intent before Core", async () => {
  for (const body of [
    { ...valid, api_key: "secret" },
    { ...valid, studentId: "" },
    { ...valid, versionId: "" },
    { ...valid, versionSide: "latest" },
    { ...valid, expectedRevision: -1 },
  ]) {
    const response = await POST(request(body), params);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_request");
  }
});

test("blocks cross-origin, non-JSON, and incomplete history requests", async () => {
  assert.equal((await POST(request(valid, { origin: "https://untrusted.example" }), params)).status, 403);
  const nonJson = new Request("http://localhost/api/edupi/students/%E6%9D%8E%E5%9B%9B/versions", { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "text/plain" }, body: JSON.stringify(valid) });
  assert.equal((await POST(nonJson, params)).status, 415);
  const incomplete = new Request("http://localhost/api/edupi/students/%E6%9D%8E%E5%9B%9B/versions", { headers: { host: "localhost" } });
  assert.equal((await GET(incomplete, params)).status, 400);
});

test("route delegates history and restore authority to Core and verifies refreshed state", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /readStudentProfileVersions/);
  assert.match(source, /restoreStudentProfileVersion/);
  assert.match(source, /readEducationContract/);
  assert.match(source, /studentProfileRestoreRequestId/);
  assert.match(source, /verifiesReceipt/);
  assert.doesNotMatch(source, /readFile|writeFile|student_profiles\.json|_profile_versions/);
});
