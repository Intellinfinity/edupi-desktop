import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

test("persisted G1 intent is paused, not active, when Windows normal mode starts no G1", async () => {
  const hash = `sha256:${"a".repeat(64)}`;
  const activation = { enabled: true, source: "desktop_canary", configurationStatus: "ready",
    scope: { classId: "class-7-1", subject: "数学" }, updatedAt: "2026-09-27T00:00:00.000Z" };
  const capabilities = { ambient_planning: "activation_pending", g1_processor: "activation_pending",
    attention_delivery: "activation_pending", teacher_feedback: "activation_pending" };
  const modules = {
    "next/server": { NextResponse: { json: (body) => Response.json(body) } },
    "@/lib/edupi-core-process-client": { EduPiCoreProcessError: class extends Error {} },
    "@/lib/edupi-core-snapshot": {
      EduPiSnapshotError: class extends Error {},
      resolveEduPiBridgeRoots: () => ({ dataRoot: { root: "/isolated-teacher" }, runtime: {
        coreCommit: "a".repeat(40), componentManifestHash: hash, validationMode: "bundled" } }),
      readEduPiCoreHealth: async () => ({ health: { contract_version: "1.1", schema_hash: hash,
        fixture_manifest_hash: hash, supported_commands: [], supported_projections: [] } }),
      readEduPiEducationSnapshot: async () => ({ workspace: { students: [], timetable: [], calendar: [], tasks: [] } }),
      readEduPiKernelProjection: async () => ({ projection: { projection_kind: "proactive_work_kernel", state_version: 1,
        updated_at: "2026-09-27T00:00:00.000Z", summary: { total: 0, running: 0, failed: 0,
          needs_review: 0, succeeded: 0, skipped: 0 }, runs: [] } }),
    },
    "@/lib/edupi-bridge-manifest": { loadEduPiCompatManifest: () => ({ core_runtime: { core_commit: "a".repeat(40),
      component_manifest_hash: hash, runtime_component_manifest_hash: hash },
    contract_identities: [{ contract_version: "1.1", schema_hash: hash,
      fixture_manifest_hash: hash, supported_commands: [], supported_projections: [] }],
    unsupported_command_reasons: {}, unsupported_projection_reasons: {} }) },
    "@/lib/edupi-runtime-supervisor": { describeEduPiRuntimeStartupFailure: () => null,
      g1ScopeForActivation: () => null, ensureEduPiRuntime: async () => ({ call: async () => ({ ok: true,
        result: { capabilities } }) }) },
    "@/lib/edupi-runtime-health": { projectCoreRuntimeHealth: () => ({ status: "ready", reason: null,
      component_manifest_hash: hash, capabilities: {}, scheduler: null, queue: null }) },
    "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: () => activation },
  };
  const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const route = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (!Object.hasOwn(modules, name)) throw new Error(`unexpected dependency ${name}`);
    return modules[name];
  }, route, route.exports);
  const paused = await (await route.exports.GET(new Request("http://localhost/api/edupi/status?summary=1"))).json();
  assert.equal(paused.core.status, "ready");
  assert.equal(paused.proactivity.status, "paused");
  assert.equal(paused.proactivity.configuredEnabled, true);
  assert.equal(paused.proactivity.ambientPlanning, false);
  activation.enabled = false;
  const disabled = await (await route.exports.GET(new Request("http://localhost/api/edupi/status?summary=1"))).json();
  assert.equal(disabled.proactivity.status, "disabled");
});
