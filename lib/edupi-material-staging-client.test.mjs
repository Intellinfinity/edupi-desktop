import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const client = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-material-staging-client.ts");

const descriptor = {
  staging_id: "stg_00000000000000000000000000000001",
  staging_path: "/desktop-state/material-staging/stg_00000000000000000000000000000001/material.pdf",
  expected_size_bytes: 12,
  source_hash: `sha256:${"a".repeat(64)}`,
  kind: "pdf",
  original_name: "notice.pdf",
  source_scope: "desktop_staging",
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("browser staging sends only multipart files and returns strict descriptors", async () => {
  const calls = [];
  const files = [new File([Buffer.from("%PDF-1.7\n")], "notice.pdf", { type: "application/pdf" })];
  const result = await client.stageBrowserMaterialFiles(files, async (url, init) => {
    calls.push({ url, init });
    return response({ staged: [descriptor] }, 201);
  });
  assert.deepEqual(result, [descriptor]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/edupi/materials/staging");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers, undefined);
  assert.deepEqual([...calls[0].init.body.keys()], ["files"]);
  assert.equal(calls[0].init.body.get("files").name, "notice.pdf");
});

test("desktop-authorized file staging forwards only the token header for multipart", async () => {
  const calls = [];
  const headers = new Headers({ "x-pi-desktop-token": "token" });
  const files = [new File([Buffer.from("%PDF-1.7\n")], "notice.pdf", { type: "application/pdf" })];
  await client.stageBrowserMaterialFiles(files, async (url, init) => {
    calls.push({ url, init });
    return response({ staged: [descriptor] }, 201);
  }, headers);
  assert.equal(calls[0].init.headers, headers);
  assert.equal(new Headers(calls[0].init.headers).has("content-type"), false);
  assert.equal(calls[0].init.body instanceof FormData, true);
});

test("native path staging sends exact JSON with caller-supplied desktop headers", async () => {
  const calls = [];
  const headers = new Headers({ "x-pi-desktop-token": "token" });
  const result = await client.stageNativeMaterialPaths(["/teacher/notice.pdf"], headers, async (url, init) => {
    calls.push({ url, init });
    return response({ staged: [descriptor] }, 201);
  });
  assert.deepEqual(result, [descriptor]);
  assert.equal(calls[0].init.headers, headers);
  assert.deepEqual(JSON.parse(calls[0].init.body), { sourcePaths: ["/teacher/notice.pdf"] });
});

test("listing is no-store and malformed or failed responses never become staged state", async () => {
  const calls = [];
  assert.deepEqual(await client.loadStagedMaterials(undefined, async (url, init) => {
    calls.push({ url, init });
    return response({ staged: [descriptor] });
  }), [descriptor]);
  assert.equal(calls[0].init.cache, "no-store");

  for (const body of [
    { staged: [{ ...descriptor, source_scope: "core" }] },
    { staged: [{ ...descriptor, source_hash: "bad" }] },
    { staged: [{ ...descriptor, extra: true }] },
    { staged: "bad" },
  ]) {
    await assert.rejects(client.loadStagedMaterials(undefined, async () => response(body)), /暂存响应无效/);
  }
  await assert.rejects(client.loadStagedMaterials(undefined, async () => response({ error: "no" }, 503)), /暂存服务暂不可用/);
  await assert.rejects(client.loadStagedMaterials(undefined, async () => response({ code: "unsupported_type" }, 415)), /不支持这类文件/);
});

test("accepts a strict staged calendar descriptor", async () => {
  const calendar = { ...descriptor, staging_path: descriptor.staging_path.replace(".pdf", ".ics"), original_name: "calendar.ics", kind: "calendar" };
  assert.deepEqual(await client.loadStagedMaterials(undefined, async () => response({ staged: [calendar] })), [calendar]);
});

test("pending staging cleanup uses exact JSON and preserves desktop authorization", async () => {
  const calls = [];
  const headers = new Headers({ "x-pi-desktop-token": "token" });
  const result = await client.removeStagedMaterial(descriptor.staging_id, headers, async (url, init) => {
    calls.push({ url, init });
    return response({ staged: [] });
  });
  assert.deepEqual(result, []);
  assert.equal(calls[0].url, "/api/edupi/materials/staging");
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(new Headers(calls[0].init.headers).get("x-pi-desktop-token"), "token");
  assert.equal(new Headers(calls[0].init.headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), { stagingId: descriptor.staging_id });
});
