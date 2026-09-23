import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

function request(body, headers = {}) {
  return new Request("http://localhost/api/edupi/document-pairings", {
    method: "POST", headers: { host: "localhost", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const valid = {
  stagingId: `stg_${"1".repeat(32)}`,
  sourceId: `document-source-${"2".repeat(32)}`,
  sourceFingerprint: `sha256:${"3".repeat(64)}`,
};

test("document pairing preview rejects cross-site and non-JSON requests", async () => {
  assert.equal((await POST(request(valid, { origin: "https://attacker.example", "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await POST(request(valid, { "content-type": "text/plain" }))).status, 415);
});

test("document pairing preview accepts only bounded exact identities before recognition", async () => {
  for (const body of [
    { ...valid, secret: "not allowed" },
    { ...valid, stagingId: "bad" },
    { ...valid, sourceId: `calendar-source-${"2".repeat(32)}` },
    { ...valid, sourceFingerprint: "not-a-hash" },
    { ...valid, stagingId: "stg_" + "1".repeat(5_000) },
  ]) {
    const response = await POST(request(body));
    assert.ok(response.status === 400 || response.status === 413);
    assert.match((await response.json()).code, /invalid_envelope|too_large/u);
  }
  const stateDir = mkdtempSync(join(tmpdir(), "edupi-pairing-route-"));
  const previous = process.env.PI_DESKTOP_STATE_DIR;
  try {
    process.env.PI_DESKTOP_STATE_DIR = stateDir;
    const missing = await POST(request(valid));
    assert.equal(missing.status, 409);
    assert.equal((await missing.json()).code, "staging_missing");
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_STATE_DIR;
    else process.env.PI_DESKTOP_STATE_DIR = previous;
    rmSync(stateDir, { recursive: true, force: true });
  }
});
