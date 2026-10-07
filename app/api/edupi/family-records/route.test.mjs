import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, POST } = await jiti.import("./route.ts");
function request(body, headers = {}) { return new Request("http://localhost/api/edupi/family-records", { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); }
test("family endpoint rejects untrusted origins, arbitrary fields and non-JSON before invoking Core", async () => {
  assert.equal((await POST(request({}, { origin: "https://untrusted.example" }))).status, 403);
  assert.equal((await POST(request({}, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await POST(request({ token: "forged", guardian_verified: true }))).status, 400);
});
test("family list rejects ambiguous IDs, duplicate parameters and unbounded pagination", async () => {
  for (const query of ["limit=20", "student_id=a&student_id=b", "student_id=a&offset=-1", "student_id=a&limit=101", "student_id=a&api_key=forged"]) {
    assert.equal((await GET(new Request(`http://localhost/api/edupi/family-records?${query}`, { headers: { host: "localhost" } }))).status, 400);
  }
});
test("family request has a real streaming byte ceiling", async () => {
  const oversized = new Request("http://localhost/api/edupi/family-records", { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ note: "a".repeat(32768) }) });
  assert.equal((await POST(oversized)).status, 413);
});
