import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import ts from "typescript";

const configured = process.env.EDUPI_CORE_CACHE_TEST_ROOT;
const expectedCommit = process.env.EDUPI_CORE_CACHE_TEST_COMMIT;
const digest = value => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;

function coreFixture(parent, name, content = "export const ready = true;\n") {
  const root = path.join(parent, name);
  const scripts = path.join(root, "scripts"), contracts = path.join(root, "contracts");
  fs.mkdirSync(scripts, { recursive: true }); fs.mkdirSync(contracts);
  const entrypoint = path.join(scripts, "desktop_bridge_port.mjs");
  fs.writeFileSync(entrypoint, content);
  const payload = { component_manifest_version: "1", algorithm: "sha256-canonical-component-payload-v1",
    entrypoint: "scripts/desktop_bridge_port.mjs",
    modules: [{ path: "scripts/desktop_bridge_port.mjs", sha256: digest(content), size: Buffer.byteLength(content) }],
    assets: [], runtime_dependencies: [] };
  const manifest = { ...payload, component_manifest_hash: digest(JSON.stringify(canonical(payload))) };
  fs.writeFileSync(path.join(contracts, "edupi-desktop-component-manifest.json"), JSON.stringify(manifest));
  const identity = { core_commit: "a".repeat(40), component_manifest_path: "contracts/edupi-desktop-component-manifest.json",
    component_manifest_hash: manifest.component_manifest_hash };
  return { root, entrypoint, manifest, identity };
}

test("cache never hides same-size tampering, replacement, symlink, manifest or root changes", async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-core-cache-integrity-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const { resolveEduPiCoreRoot } = await createJiti(import.meta.url).import("./edupi-core-root.ts");
  const first = coreFixture(parent, "first");
  const resolve = (fixture = first) => resolveEduPiCoreRoot({ configuredRoot: fixture.root, allowedRoot: parent,
    runtimeIdentity: fixture.identity, validationMode: "bundled" });
  resolve(); resolve();
  const before = fs.statSync(first.entrypoint);
  const changed = "export const ready = fals;\n";
  assert.equal(Buffer.byteLength(changed), before.size);
  fs.writeFileSync(first.entrypoint, changed);
  fs.utimesSync(first.entrypoint, before.atime, before.mtime);
  assert.throws(() => resolve(), /hash mismatch/u, "mtime restoration cannot hide same-size byte changes");
  fs.writeFileSync(first.entrypoint, "export const ready = true;\n");
  resolve();
  const originalInode = fs.statSync(first.entrypoint).ino;
  const replacement = `${first.entrypoint}.replacement`;
  fs.writeFileSync(replacement, "export const ready = true;\n");
  fs.renameSync(replacement, first.entrypoint);
  assert.notEqual(fs.statSync(first.entrypoint).ino, originalInode);
  const originalRead = fs.readFileSync;
  let replacementReads = 0;
  fs.readFileSync = function (...args) {
    if (String(args[0]) === fs.realpathSync(first.entrypoint)) replacementReads++;
    return originalRead.apply(this, args);
  };
  try { resolve(); }
  finally { fs.readFileSync = originalRead; }
  assert.equal(replacementReads, 1, "a replacement inode must be rehashed even when its bytes match");
  fs.writeFileSync(replacement, changed);
  fs.renameSync(replacement, first.entrypoint);
  assert.throws(() => resolve(), /hash mismatch/u, "new inode with bad bytes cannot reuse the old hash");
  fs.writeFileSync(first.entrypoint, "export const ready = true;\n");
  resolve();
  fs.renameSync(first.entrypoint, replacement);
  fs.symlinkSync(replacement, first.entrypoint);
  assert.throws(() => resolve(), /symlink/u, "a contained symlink is still not a regular Core source");
  fs.unlinkSync(first.entrypoint);
  fs.renameSync(replacement, first.entrypoint);
  const manifestPath = path.join(first.root, "contracts/edupi-desktop-component-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ ...first.manifest, modules: [{ ...first.manifest.modules[0], size: 1 }] }));
  assert.throws(() => resolve(), /manifest hash mismatch/u);
  const manifestPayload = { ...first.manifest };
  delete manifestPayload.component_manifest_hash;
  const revisedPayload = { ...manifestPayload, assets: [{ path: "scripts/extra.mjs", sha256: digest("extra"), size: 5 }] };
  fs.writeFileSync(manifestPath, JSON.stringify({ ...revisedPayload,
    component_manifest_hash: digest(JSON.stringify(canonical(revisedPayload))) }));
  assert.throws(() => resolve(), /manifest hash mismatch/u,
    "an internally consistent but newly signed manifest cannot replace the pinned identity");
  const second = coreFixture(parent, "second", changed);
  fs.writeFileSync(path.join(second.root, "contracts/edupi-desktop-component-manifest.json"), JSON.stringify(first.manifest));
  assert.throws(() => resolve({ ...second, identity: first.identity }), /hash mismatch/u,
    "a second root cannot inherit the first root's cache proof");
  fs.writeFileSync(manifestPath, JSON.stringify(first.manifest));
  fs.writeFileSync(first.entrypoint, changed);
  const childCode = `import { createJiti } from "jiti";
    const { resolveEduPiCoreRoot } = await createJiti(import.meta.url).import(${JSON.stringify(fileURLToPath(new URL("./edupi-core-root.ts", import.meta.url)))});
    resolveEduPiCoreRoot({ configuredRoot: ${JSON.stringify(first.root)}, allowedRoot: ${JSON.stringify(parent)},
      runtimeIdentity: ${JSON.stringify(first.identity)}, validationMode: "bundled" });`;
  assert.throws(() => execFileSync(process.execPath, ["--input-type=module", "-e", childCode],
    { cwd: process.cwd(), stdio: "pipe" }), error => /hash mismatch/u.test(String(error.stderr)),
  "a new process must not inherit any in-memory proof for changed bytes");
});

test("repeated bridge-root and status reads do not rehash an unchanged staged Core closure",
  { skip: !configured || !expectedCommit }, async t => {
    assert.match(expectedCommit, /^[a-f0-9]{40}$/u);
    const root = fs.realpathSync(configured);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "contracts/edupi-desktop-component-manifest.json"), "utf8"));
    const runtime = JSON.parse(fs.readFileSync(path.join(root, "contracts/edupi-core-runtime-component-manifest.json"), "utf8"));
    assert.ok(manifest.runtime_dependencies.flatMap(item => item.files).length > 8192);
    const identity = { core_commit: expectedCommit,
      component_manifest_path: "contracts/edupi-desktop-component-manifest.json",
      component_manifest_hash: manifest.component_manifest_hash,
      runtime_component_manifest_hash: runtime.component_manifest_hash,
      runtime_schema_hash: JSON.parse(fs.readFileSync(path.join(root, "contracts/edupi-core-runtime-v1-hash.json"), "utf8")).schema_hash };
    const dataParent = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-cache-status-"));
    const dataRoot = path.join(dataParent, "data");
    fs.mkdirSync(dataRoot);
    const names = ["EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT", "EDUPI_CORE_VALIDATION_MODE", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT"];
    const prior = new Map(names.map(name => [name, process.env[name]]));
    Object.assign(process.env, { EDUPI_CORE_ROOT: root, EDUPI_CORE_ALLOWED_ROOT: path.dirname(root),
      EDUPI_CORE_VALIDATION_MODE: "bundled", EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: dataParent });
    const coreRoot = await createJiti(import.meta.url).import("./edupi-core-root.ts");
    const source = fs.readFileSync(new URL("./edupi-core-snapshot.ts", import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const exports = {};
    const modules = {
      "node:path": path,
      "typebox/value": { Value: {} },
      "../contracts/edupi-schedule-occurrence-v1.2.schema.json": {},
      "./edupi-core-process-client": { EduPiCoreProcessError: class extends Error {} },
      "./file-access": { isWindowsAbsolutePath: () => false },
      "./edupi-bridge-manifest": { activeBridgeIdentity: () => ({ runtime: identity }) },
      "./edupi-bridge-consumer": {},
      "./edupi-core-root": coreRoot,
      "./edupi-runtime-supervisor": {},
      "./edupi-proactivity-config": {},
    };
    vm.runInNewContext(code, { exports, process, require: name => {
      assert.ok(Object.hasOwn(modules, name), `unexpected snapshot import ${name}`);
      return modules[name];
    } });
    const originalRead = fs.readFileSync;
    const originalLstat = fs.lstatSync;
    let dependencyReads = 0;
    let lstatCount = 0;
    fs.readFileSync = function (...args) {
      if (String(args[0]).startsWith(path.join(root, "node_modules") + path.sep)) dependencyReads++;
      return originalRead.apply(this, args);
    };
    fs.lstatSync = function (...args) { lstatCount++; return originalLstat.apply(this, args); };
    try {
      const resolve = () => exports.resolveEduPiBridgeRoots();
      const coldAt = performance.now();
      resolve();
      const coldMs = performance.now() - coldAt;
      dependencyReads = 0;
      lstatCount = 0;
      const warmAt = performance.now();
      resolve();
      const warmMs = performance.now() - warmAt;
      assert.equal(dependencyReads, 0, "status path should not rehash every unchanged dependency");
      const routeSource = originalRead(new URL("../app/api/edupi/status/route.ts", import.meta.url), "utf8");
      const routeCode = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022 } }).outputText;
      const routeExports = {};
      const capabilities = { g1_processor: "activation_pending", g2_processor: "activation_pending",
        g3_processor: "activation_pending", attention_delivery: "active", teacher_feedback: "active" };
      const routeModules = {
        "next/server": { NextResponse: { json: body => ({ status: 200, body }) } },
        "@/lib/edupi-core-process-client": { EduPiCoreProcessError: class extends Error {} },
        "@/lib/edupi-core-snapshot": { EduPiSnapshotError: class extends Error {}, resolveEduPiBridgeRoots: resolve,
          readEduPiCoreHealth: async () => ({ health: { contract_version: "1.1", schema_hash: identity.runtime_schema_hash,
            fixture_manifest_hash: identity.component_manifest_hash, supported_commands: [], supported_projections: [] } }),
          readEduPiEducationSnapshot: async () => ({ workspace: { students: [], timetable: [], calendar: [], tasks: [] } }),
          readEduPiKernelProjection: async () => ({ projection: { projection_kind: "proactive_work_kernel",
            state_version: 1, updated_at: "2026-10-08T00:00:00.000Z", summary: { total: 0 }, runs: [] } }) },
        "@/lib/edupi-bridge-manifest": { loadEduPiCompatManifest: () => ({ core_runtime: identity,
          contract_identities: [{ contract_version: "1.1", schema_hash: identity.runtime_schema_hash,
            fixture_manifest_hash: identity.component_manifest_hash, supported_commands: [], supported_projections: [] }],
          unsupported_command_reasons: {}, unsupported_projection_reasons: {} }) },
        "@/lib/edupi-runtime-supervisor": { describeEduPiRuntimeStartupFailure: () => null,
          ensureEduPiRuntime: async () => ({ call: async () => ({ ok: true, result: { capabilities } }) }),
          g1ScopeForActivation: () => null },
        "@/lib/edupi-runtime-health": { projectCoreRuntimeHealth: () => ({ status: "ready", reason: null,
          component_manifest_hash: runtime.component_manifest_hash, capabilities, lifecycle: {}, queue: {}, scheduler: {} }) },
        "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: () => ({ enabled: false,
          source: "default", configurationStatus: "missing", scope: null }) },
      };
      vm.runInNewContext(routeCode, { exports: routeExports, URL, require: name => {
        assert.ok(Object.hasOwn(routeModules, name), `unexpected status import ${name}`);
        return routeModules[name];
      } });
      dependencyReads = 0;
      lstatCount = 0;
      const statusAt = performance.now();
      const response = await routeExports.GET(new Request("http://127.0.0.1:30141/api/edupi/status?summary=1"));
      const statusMs = performance.now() - statusAt;
      assert.equal(response.status, 200);
      assert.equal(response.body.core.coreCommit, expectedCommit);
      assert.equal(dependencyReads, 0, "a warm status request should not rehash the same Core dependencies");
      t.diagnostic(JSON.stringify({ coldMs: Math.round(coldMs), warmMs: Math.round(warmMs),
        statusMs: Math.round(statusMs), dependencyReads, lstatCount }));
    } finally {
      fs.readFileSync = originalRead;
      fs.lstatSync = originalLstat;
      for (const [name, value] of prior) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
      fs.rmSync(dataParent, { recursive: true, force: true });
    }
  });
