import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false });
const { GET, POST } = await jiti.import("./route.ts");
const { parseMaterialMetadataRestoreBody } = await jiti.import("../../../../../../../lib/edupi-material-metadata-request.ts");
const params = { params: Promise.resolve({ materialId: "material-1" }) };
const valid = { versionId: "material-metadata-version-1", versionSide: "before", expectedRevision: 2 };

function request(body, headers = {}) {
  return new Request("http://localhost/api/edupi/materials/material-1/metadata/versions", { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(body) });
}

test("parses only one exact material metadata restore intent", () => {
  assert.deepEqual(parseMaterialMetadataRestoreBody(valid), valid);
  for (const value of [{ ...valid, token: "secret" }, { ...valid, versionId: "" }, { ...valid, versionSide: "latest" }, { ...valid, expectedRevision: -1 }]) assert.equal(parseMaterialMetadataRestoreBody(value), null);
});

test("material history and restore reject untrusted requests before Core", async () => {
  assert.equal((await POST(request({ ...valid, token: "secret" }), params)).status, 400);
  assert.equal((await POST(request(valid, { origin: "https://untrusted.example" }), params)).status, 403);
  const invalidGet = new Request("http://localhost/api/edupi/materials//metadata/versions", { headers: { host: "localhost" } });
  assert.equal((await GET(invalidGet, { params: Promise.resolve({ materialId: "" }) })).status, 400);
});

test("material history reconciles the public material and private version chain", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /readMaterialMetadataCurrentState/);
  assert.match(source, /restoreMaterialMetadataVersion/);
  assert.match(source, /materialMetadataRestoreRequestId/);
  assert.match(source, /isOwnedMaterialMetadataRestore/);
  assert.match(source, /verifiesMaterialMetadataReceipt/);
  assert.doesNotMatch(source, /writeFile|safeSave|education_intake_state\.json/);
});
