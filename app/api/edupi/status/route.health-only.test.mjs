import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadRoute({ failRuntime = false } = {}) {
  const calls = { runtime: 0, health: 0, snapshot: 0, kernel: 0 };
  const hash = `sha256:${"a".repeat(64)}`;
  const modules = {
    "next/server": { NextResponse: { json: value => Response.json(value) } },
    "@/lib/edupi-core-process-client": { EduPiCoreProcessError: class extends Error {} },
    "@/lib/edupi-core-snapshot": {
      EduPiSnapshotError: class extends Error {},
      resolveEduPiBridgeRoots: () => ({ dataRoot: { root: "/synthetic-teacher" }, runtime: {
        coreCommit: "a".repeat(40), componentManifestHash: hash, validationMode: "bundled" } }),
      readEduPiCoreHealth: async () => { calls.health++; throw new Error("unrelated Core health read"); },
      readEduPiEducationSnapshot: async () => { calls.snapshot++; throw new Error("unrelated education read"); },
      readEduPiKernelProjection: async () => { calls.kernel++; throw new Error("unrelated kernel read"); },
    },
    "@/lib/edupi-bridge-manifest": { loadEduPiCompatManifest: () => ({ core_runtime: {
      core_commit: "a".repeat(40), component_manifest_hash: hash, runtime_component_manifest_hash: hash },
      contract_identities: [{ contract_version: "1.1", schema_hash: hash,
        fixture_manifest_hash: hash, supported_commands: [], supported_projections: [] }],
      unsupported_command_reasons: {}, unsupported_projection_reasons: {} }) },
    "@/lib/edupi-runtime-supervisor": { describeEduPiRuntimeStartupFailure: () => null,
      g1ScopeForActivation: () => null, ensureEduPiRuntime: async () => {
        calls.runtime++;
        if (failRuntime) throw new Error("runtime unavailable");
        return { call: async () => ({ ok: true, result: { capabilities: { teacher_feedback: "active" } } }) };
      } },
    "@/lib/edupi-runtime-health": { projectCoreRuntimeHealth: () => ({ status: "ready", reason: null,
      component_manifest_hash: hash, capabilities: {}, scheduler: null, queue: null }) },
    "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: () => ({ enabled: false,
      source: "default", configurationStatus: "missing", scope: null }) },
  };
  const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const route = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected import ${name}`);
    return modules[name];
  }, route, route.exports);
  return { GET: route.exports.GET, calls };
}

test("Today feedback availability reads resident Core health without full projections", async () => {
  const { GET, calls } = loadRoute();
  const response = await GET(new Request("http://localhost/api/edupi/status?feedback-health=1"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { proactivity: { teacherFeedback: true } });
  assert.deepEqual(calls, { runtime: 1, health: 0, snapshot: 0, kernel: 0 });
});

test("Today feedback availability fails closed when resident Core is unavailable", async () => {
  const { GET, calls } = loadRoute({ failRuntime: true });
  const response = await GET(new Request("http://localhost/api/edupi/status?feedback-health=1"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { proactivity: { teacherFeedback: false } });
  assert.deepEqual(calls, { runtime: 1, health: 0, snapshot: 0, kernel: 0 });
});
