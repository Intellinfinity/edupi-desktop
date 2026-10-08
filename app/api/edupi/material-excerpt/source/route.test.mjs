import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const security = await jiti.import("../../../../../lib/request-security.ts");
const bounded = await jiti.import("../../../../../lib/bounded-form-data.ts");
const compiled = ts.transpileModule(fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const hash = value => `sha256:${value.repeat(64)}`;
const path = "word/document.xml/w:document[0]/w:body[0]/w:p[0]";

function fixture() {
  const calls = [];
  const material = { material_id: "material", subject: "数学", class_id: "703", available: true };
  const preview = { version: 1, format: "docx", status: "ready", material_id: "material", source_hash: hash("a"), record_hash: hash("b"), basis_hash: hash("c"),
    blocks: [{ path, text: "核对原文" }], issues: [], read_only: true, external_send: false };
  let excerpt = null, reviewError = null, readbackError = null, sourceChangeAfterReview = false, managedRuntimeReady = false;
  const dependencies = {
    "@/lib/edupi-education-server": { readEducationContract: async () => ({ teacherMaterials: [material] }) },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({}) },
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: async () => { managedRuntimeReady = true; return {}; } },
    "@/lib/request-security": security,
    "@/lib/bounded-form-data": bounded,
    "@/lib/edupi-core-process-client": { runCoreProcess: async ({ request, timeoutMs }) => {
      assert.equal(managedRuntimeReady, true, "DOCX proof requires the managed Core owner");
      calls.push(request);
      assert.equal(timeoutMs >= 16_000, true);
      assert.equal(request.input.subject, "数学"); assert.equal(request.input.classId, "703");
      if (request.action === "source_preview") return { ok: true, excerpt: preview };
      if (request.action === "review_source") {
        if (reviewError) return { ok: false, code: reviewError };
        assert.equal(request.input.reviewer, "teacher");
        excerpt = { material_id: "material", revision: request.input.expectedRevision + 1, status: "confirmed", content: "核对原文",
          source_kind: "docx_parsed_fragment", basis_hash: request.input.expectedBasisHash,
          source_hash: preview.source_hash, record_hash: preview.record_hash, source_spans: request.input.sourceSpans };
        if (sourceChangeAfterReview) preview.basis_hash = hash("d");
      }
      if (request.action === "read" && excerpt && readbackError) return { ok: false, code: readbackError };
      return { ok: true, excerpt };
    } },
  };
  const route = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => dependencies[name] || require(name), route, route.exports);
  const post = body => route.exports.POST(new Request("http://localhost/api/edupi/material-excerpt/source", { method: "POST", headers: { "Content-Type": "application/json", host: "localhost" }, body: JSON.stringify(body) }));
  const get = () => route.exports.GET(new Request("http://localhost/api/edupi/material-excerpt/source?materialId=material", { headers: { host: "localhost" } }));
  return { ...route.exports, post, get, calls, material, preview,
    setReviewError: value => { reviewError = value; }, setReadbackError: value => { readbackError = value; },
    setSourceChangeAfterReview: value => { sourceChangeAfterReview = value; } };
}

test("DOCX preview is read-only and selected UTF-16 spans are confirmed only after Core readback", async () => {
  const { post, get, calls, preview } = fixture();
  assert.equal((await get()).status, 200);
  const selected = [{ path, start: 0, end: 4 }];
  const response = await post({ materialId: "material", expectedRevision: 0, expectedBasisHash: preview.basis_hash, sourceSpans: selected });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).excerpt.source_kind, "docx_parsed_fragment");
  assert.deepEqual(calls.map(call => call.action), ["source_preview", "read", "review_source", "read", "source_preview"]);
  assert.deepEqual(calls[2].input.sourceSpans, selected);
  assert.equal(calls[0].input.external_send, undefined);
});

test("post-write source drift and uncertain readback never report confirmation", async () => {
  const changed = fixture();
  const basis = changed.preview.basis_hash;
  changed.setSourceChangeAfterReview(true);
  const body = { materialId: "material", expectedRevision: 0, expectedBasisHash: basis, sourceSpans: [{ path, start: 0, end: 4 }] };
  const stale = await changed.post(body);
  assert.equal(stale.status, 409); assert.equal((await stale.json()).conflict, true);
  const uncertain = fixture();
  uncertain.setReadbackError("unavailable");
  const response = await uncertain.post(body);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /未核实/);
  assert.deepEqual(uncertain.calls.map(call => call.action), ["read", "review_source", "read"]);
});

test("rejects caller authority, malformed selection, stale basis and foreign origins", async () => {
  const { post, get, calls, material, preview, setReviewError, GET } = fixture();
  const base = { materialId: "material", expectedRevision: 0, expectedBasisHash: preview.basis_hash, sourceSpans: [{ path, start: 0, end: 4 }] };
  for (const extra of [{ reviewer: "other" }, { content: "invented" }, { sourceSpans: [{ path, start: 4, end: 4 }] }, { expectedBasisHash: "wrong" }]) {
    assert.equal((await post({ ...base, ...extra })).status, 400);
  }
  assert.equal(calls.length, 0);
  setReviewError("stale_source");
  const stale = await post(base);
  assert.equal(stale.status, 409); assert.equal((await stale.json()).conflict, true);
  material.available = false;
  assert.equal((await get()).status, 404);
  assert.equal((await GET(new Request("http://localhost/api/edupi/material-excerpt/source?materialId=material", { headers: { origin: "https://foreign.example" } }))).status, 403);
});

test("a DOCX with unresolved parse issues stays held and cannot be confirmed", async () => {
  const { get, post, preview, setReviewError } = fixture();
  preview.status = "held"; preview.issues.push({ code: "unsupported_content" });
  const read = await get();
  assert.equal(read.status, 200); assert.equal((await read.json()).preview.status, "held");
  setReviewError("docx_fragment_held");
  assert.equal((await post({ materialId: "material", expectedRevision: 0, expectedBasisHash: preview.basis_hash,
    sourceSpans: [{ path, start: 0, end: 4 }] })).status, 409);
  preview.status = "ready";
  assert.equal((await get()).status, 503, "a contradictory ready/issue response must fail closed");
});
