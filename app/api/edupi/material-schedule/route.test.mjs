import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url), jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const security = await jiti.import("../../../../lib/request-security.ts");
const native = await jiti.import("../../../../lib/desktop-api-auth.ts");
const bounded = await jiti.import("../../../../lib/bounded-form-data.ts");
const compiled = ts.transpileModule(fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const hash = character => `sha256:${character.repeat(64)}`;
const token = "synthetic-material-schedule-token-123456789";
const url = "http://localhost:30373/api/edupi/material-schedule";
const headers = { host: "localhost:30373", origin: "http://localhost:30373", "x-pi-desktop-token": token };

function fixture() {
  const calls = [];
  const state = { metadataRevision: 2, sourceHash: hash("c"), fingerprint: hash("d"), readStatus: "ready", owner: `owner_${"b".repeat(32)}`, deleted: false, relativePath: "synthetic.ics" };
  const roots = {};
  const read = () => ({ version: 1, root_ref: hash("a"), owner_id: state.owner,
    source: { material_id: "synthetic-material", source_hash: state.sourceHash, metadata_revision: state.metadataRevision, relative_path: state.relativePath },
    options: { default_time_zone: null, window_start: null, window_end: null, max_occurrences: 200 }, status: state.readStatus,
    events: [{ event_id: "synthetic-event", date: "2026-10-15", name: "合成教研" }], issues: [], evidence: [], parse_fingerprint: state.fingerprint,
    read_only: true, automatic_import: false, external_send: false });
  const host = {
    call: async operation => { calls.push([operation]); assert.equal(operation, "health"); return { ok: true, result: { data_root_fingerprint: hash("a") } }; },
    callOwnerControl: async (operation, input) => {
      calls.push([operation, input]);
      if (operation === "owner_read") return { ok: true, result: { root_ref: hash("a"), owner: { id: state.owner } } };
      assert.equal(input.root_ref, hash("a")); assert.equal(input.expected_owner_id, state.owner);
      if (state.deleted) return { ok: false, error_code: "material_schedule_source_unavailable" };
      if (input.expected_source_hash !== state.sourceHash || input.expected_metadata_revision !== state.metadataRevision) return { ok: false, error_code: "material_schedule_stale" };
      if (operation === "material_schedule_read") return { ok: true, result: read() };
      assert.equal(operation, "material_schedule_apply"); assert.equal(input.confirm, true);
      return { ok: true, result: { version: 1, root_ref: hash("a"), owner_id: state.owner, material_id: input.material_id,
        parse_fingerprint: input.expected_parse_fingerprint, command_id: input.command_id, receipt_id: "synthetic-receipt", status: "accepted",
        reason_code: null, applied_ids: ["synthetic-event"], rejected_ids: [], replayed: false, automatic_import: false, external_send: false } };
    },
  };
  const dependencies = {
    "@/lib/request-security": security, "@/lib/desktop-api-auth": native, "@/lib/bounded-form-data": bounded,
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => roots, readEduPiEducationSnapshot: async () => {
      calls.push(["current-snapshot"]);
      return { payload: { receipts: [{ command_type: "intake_material", receipt_phase: "mutation", status: "accepted",
        applied_ids: ["synthetic-material"], target: { target_id: "synthetic-material-target", target_kind: "material_intake" } }],
      review_targets: [{ projection_kind: "material_intake", target: { target_id: "synthetic-material-target" }, source_hash: state.sourceHash }] } };
    } },
    "@/lib/edupi-material-metadata": { readMaterialMetadataHistory: async materialId => { calls.push(["current-metadata"]); return { materialId, revision: state.metadataRevision }; } },
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: async () => host },
  };
  const route = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => dependencies[name] || require(name), route, route.exports);
  return { ...route.exports, calls, state, read };
}

async function withToken(work) {
  const previous = process.env.PI_DESKTOP_API_TOKEN; process.env.PI_DESKTOP_API_TOKEN = token;
  try { await work(); } finally { if (previous === undefined) delete process.env.PI_DESKTOP_API_TOKEN; else process.env.PI_DESKTOP_API_TOKEN = previous; }
}
const applyBody = () => ({ action: "apply", materialId: "synthetic-material", expectedSourceHash: hash("c"), expectedMetadataRevision: 2,
  expectedParseFingerprint: hash("d"), commandId: "teacher-confirm-synthetic", confirm: true });
const postRequest = body => new Request(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });

test("native and origin gates reject reads and apply before Core access", async () => withToken(async () => {
  const { GET, POST, calls } = fixture();
  assert.equal((await GET(new Request(`${url}?materialId=synthetic-material`, { headers: { host: "localhost:30373" } }))).status, 403);
  assert.equal((await POST(new Request(url, { method: "POST", headers: { ...headers, origin: "https://foreign.example", "content-type": "application/json" }, body: JSON.stringify(applyBody()) }))).status, 403);
  assert.equal(calls.length, 0);
}));

test("material schedule rereads current source hash and metadata revision rather than upload cache", async () => withToken(async () => {
  const { GET, calls, state } = fixture();
  const get = () => GET(new Request(`${url}?materialId=synthetic-material`, { headers }));
  assert.equal((await get()).status, 200);
  state.metadataRevision = 3; state.sourceHash = hash("e");
  const refreshed = await get(); assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).result.source.metadata_revision, 3);
  const reads = calls.filter(item => item[0] === "material_schedule_read");
  assert.deepEqual(reads.map(item => item[1].expected_metadata_revision), [2, 3]);
  assert.equal(reads[1][1].expected_source_hash, hash("e"));
  assert.equal(calls.filter(item => item[0] === "current-snapshot").length, 2);
  assert.equal(calls.some(item => item[0] === "owner_control"), false, "no automatic owner bootstrap");
}));

test("explicit confirmation is required and changed parse proof never reaches apply", async () => withToken(async () => {
  const { POST, calls, state } = fixture();
  for (const body of [{ ...applyBody(), confirm: false }, { ...applyBody(), expected_owner_id: "forged-owner" }]) assert.equal((await POST(postRequest(body))).status, 400);
  assert.equal(calls.length, 0);
  state.fingerprint = hash("f");
  assert.equal((await POST(postRequest(applyBody()))).status, 409);
  assert.equal(calls.some(item => item[0] === "material_schedule_apply"), false);
  state.fingerprint = hash("d"); state.readStatus = "unresolved";
  assert.equal((await POST(postRequest(applyBody()))).status, 409);
  state.readStatus = "ready";
  state.relativePath = "synthetic.pdf";
  assert.equal((await POST(postRequest(applyBody()))).status, 409, "PDF still requires independent visible-content verification");
  assert.equal(calls.some(item => item[0] === "material_schedule_apply"), false);
  state.relativePath = "synthetic.ics";
  const applied = await POST(postRequest(applyBody())); assert.equal(applied.status, 200);
  assert.equal((await applied.json()).result.status, "accepted");
  assert.equal(calls.filter(item => item[0] === "material_schedule_apply").length, 1);
  state.deleted = true;
  assert.equal((await POST(postRequest(applyBody()))).status, 409);
  assert.equal(calls.filter(item => item[0] === "material_schedule_apply").length, 1, "deleted source cannot be replay-adopted");
}));
