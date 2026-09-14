import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

const valid = {
  targetId: "context_teacher",
  versionId: "review-1",
  versionSide: "before",
  fieldKey: "grade",
  expectedSnapshotId: "snapshot-1",
  expectedRevision: 2,
  expectedSourceId: "source-2",
};

function request(body, headers = {}) {
  return new Request("http://localhost/api/edupi/onboarding/versions", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
    body: JSON.stringify(body),
  });
}

test("rejects malformed teacher-context restore intent before Core", async () => {
  for (const body of [
    { ...valid, api_key: "secret" },
    { ...valid, fieldKey: "credential" },
    { ...valid, versionSide: "latest" },
    { ...valid, expectedRevision: -1 },
    { ...valid, expectedSourceId: "" },
  ]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_request");
  }
});

test("blocks cross-origin and non-JSON restore requests", async () => {
  const crossOrigin = await POST(request(valid, { origin: "https://untrusted.example" }));
  assert.equal(crossOrigin.status, 403);
  const nonJson = await POST(new Request("http://localhost/api/edupi/onboarding/versions", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "text/plain" },
    body: JSON.stringify(valid),
  }));
  assert.equal(nonJson.status, 403);
});

test("route delegates old values and mutation authority to Core", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /readTeacherContextVersions/);
  assert.match(source, /captureTeacherContextFieldRestore/);
  assert.match(source, /reviewTeacherContextCandidate/);
  assert.match(source, /expectedSourceId/);
  assert.doesNotMatch(source, /readFile|writeFile|teacher_review_state\.json|_context_before_values|_context_after_values/);
});
