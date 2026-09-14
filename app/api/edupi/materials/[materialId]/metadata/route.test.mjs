import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false });
const { PUT } = await jiti.import("./route.ts");
const { parseMaterialMetadataUpdateBody } = await jiti.import("../../../../../../lib/edupi-material-metadata-request.ts");
const params = { params: Promise.resolve({ materialId: "material-1" }) };
const valid = { expectedRevision: 2, patch: { title: "移项教案", kind: "worksheet", subject: "数学", classId: "703" } };

function request(body, headers = {}) {
  return new Request("http://localhost/api/edupi/materials/material-1/metadata", { method: "PUT", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(body) });
}

test("parses only bounded material metadata updates", () => {
  assert.deepEqual(parseMaterialMetadataUpdateBody(valid), valid);
  for (const value of [{ ...valid, api_key: "secret" }, { ...valid, expectedRevision: -1 }, { ...valid, patch: {} }, { ...valid, patch: { kind: "video" } }, { ...valid, patch: { title: "x".repeat(241) } }]) assert.equal(parseMaterialMetadataUpdateBody(value), null);
});

test("material metadata update rejects malformed, cross-origin, and non-JSON requests before Core", async () => {
  assert.equal((await PUT(request({ ...valid, token: "secret" }), params)).status, 400);
  assert.equal((await PUT(request(valid, { origin: "https://untrusted.example" }), params)).status, 403);
  const nonJson = new Request("http://localhost/api/edupi/materials/material-1/metadata", { method: "PUT", headers: { host: "localhost", origin: "http://localhost", "content-type": "text/plain" }, body: JSON.stringify(valid) });
  assert.equal((await PUT(nonJson, params)).status, 415);
});

test("material metadata update delegates to Core and reconciles public values with private history", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /updateMaterialMetadata/);
  assert.match(source, /readMaterialMetadataCurrentState/);
  assert.match(source, /verifiesMaterialMetadataReceipt/);
  assert.match(source, /receipt\.replayed/);
  assert.doesNotMatch(source, /writeFile|safeSave|education_intake_state\.json/);
});
