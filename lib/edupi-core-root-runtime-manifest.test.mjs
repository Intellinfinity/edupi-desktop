import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { resolveEduPiCoreRoot } = await createJiti(import.meta.url).import("./edupi-core-root.ts");
const digest = value => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const fileEntry = (name, bytes) => ({ path: name, sha256: digest(bytes), size: Buffer.byteLength(bytes) });

function fixture(t, name = "core") {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-runtime-pin-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, name);
  const files = {
    "scripts/desktop_bridge_port.mjs": "export const desktop = true;\n",
    "scripts/core_runtime_daemon.mjs": "export const daemon = true;\n",
    "scripts/core_runtime_protocol.mjs": "export const protocol = true;\n",
    "scripts/core_runtime_root.mjs": "export const root = true;\n",
    "scripts/edupi_component_manifest.mjs": "export const generator = true;\n",
    "contracts/runtime-v1.schema.json": "{}\n",
    "node_modules/example/package.json": '{"name":"example","version":"1.0.0"}\n',
    "node_modules/example/index.mjs": "export const example = true;\n",
  };
  for (const [relative, bytes] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  const makeManifest = (entrypoint, modules, assets = [], runtime_dependencies = []) => {
    const payload = { component_manifest_version: "1", algorithm: "sha256-canonical-component-payload-v1",
      entrypoint, modules, assets, runtime_dependencies };
    return { ...payload, component_manifest_hash: digest(JSON.stringify(canonical(payload))) };
  };
  const desktop = makeManifest("scripts/desktop_bridge_port.mjs", [fileEntry("scripts/desktop_bridge_port.mjs", files["scripts/desktop_bridge_port.mjs"])]);
  const runtime = makeManifest("scripts/core_runtime_daemon.mjs",
    ["scripts/core_runtime_daemon.mjs", "scripts/core_runtime_protocol.mjs", "scripts/core_runtime_root.mjs", "scripts/edupi_component_manifest.mjs"]
      .map(name => fileEntry(name, files[name])),
    [fileEntry("contracts/runtime-v1.schema.json", files["contracts/runtime-v1.schema.json"])],
    [{ name: "example", version: "1.0.0", root: "node_modules/example",
      files: ["node_modules/example/package.json", "node_modules/example/index.mjs"].map(name => fileEntry(name, files[name])) }]);
  const desktopPath = path.join(root, "contracts/edupi-desktop-component-manifest.json");
  const runtimePath = path.join(root, "contracts/edupi-core-runtime-component-manifest.json");
  fs.writeFileSync(desktopPath, JSON.stringify(desktop));
  fs.writeFileSync(runtimePath, JSON.stringify(runtime));
  const identity = { core_commit: "a".repeat(40), component_manifest_path: "contracts/edupi-desktop-component-manifest.json",
    component_manifest_hash: desktop.component_manifest_hash, runtime_component_manifest_hash: runtime.component_manifest_hash };
  const resolve = (selectedRoot = root, selectedIdentity = identity) => resolveEduPiCoreRoot({ configuredRoot: selectedRoot,
    allowedRoot: parent, runtimeIdentity: selectedIdentity, validationMode: "bundled" });
  return { parent, root, files, desktop, desktopPath, runtime, runtimePath, identity, resolve, makeManifest };
}

test("requires the pinned Runtime manifest and verifies its full closure", t => {
  const f = fixture(t);
  const resolved = f.resolve();
  assert.equal(resolved.runtimeComponentManifestHash, f.runtime.component_manifest_hash);
  assert.equal(resolved.runtimeComponentManifestPath, fs.realpathSync(f.runtimePath));
  assert.throws(() => f.resolve(f.root, { ...f.identity, runtime_component_manifest_hash: undefined }), /runtime manifest hash/i);
  assert.throws(() => f.resolve(f.root, { ...f.identity, runtime_component_manifest_hash: digest("old pin") }), /runtime manifest hash mismatch/i);
});

test("rejects generator, daemon, asset and dependency tampering after a warm validation", t => {
  const f = fixture(t);
  for (const relative of ["scripts/edupi_component_manifest.mjs", "scripts/core_runtime_daemon.mjs",
    "contracts/runtime-v1.schema.json", "node_modules/example/index.mjs"]) {
    f.resolve(); f.resolve();
    const target = path.join(f.root, relative);
    const original = fs.readFileSync(target);
    const stats = fs.statSync(target);
    fs.writeFileSync(target, Buffer.alloc(original.length, 0x78));
    fs.utimesSync(target, stats.atime, stats.mtime);
    assert.throws(() => f.resolve(), /component hash mismatch/i, relative);
    fs.writeFileSync(target, original);
  }
});

test("rejects a forged self hash and an internally consistent Runtime manifest with the old Desktop pin", t => {
  const f = fixture(t);
  fs.writeFileSync(f.runtimePath, JSON.stringify({ ...f.runtime, component_manifest_hash: digest("forged") }));
  assert.throws(() => f.resolve(), /runtime manifest hash mismatch/i);
  const changed = f.makeManifest(f.runtime.entrypoint, f.runtime.modules, f.runtime.assets,
    [{ ...f.runtime.runtime_dependencies[0], version: "1.0.1" }]);
  fs.writeFileSync(f.runtimePath, JSON.stringify(changed));
  assert.throws(() => f.resolve(), /runtime manifest hash mismatch/i);
});

test("requires the fixed daemon entrypoint and an intact runtime dependency package", t => {
  const f = fixture(t);
  const wrongEntry = f.makeManifest("scripts/core_runtime_protocol.mjs", f.runtime.modules,
    f.runtime.assets, f.runtime.runtime_dependencies);
  fs.writeFileSync(f.runtimePath, JSON.stringify(wrongEntry));
  assert.throws(() => f.resolve(f.root, { ...f.identity, runtime_component_manifest_hash: wrongEntry.component_manifest_hash }),
    /runtime manifest entrypoint/i);

  const missingPackageJson = f.makeManifest(f.runtime.entrypoint, f.runtime.modules, f.runtime.assets,
    [{ ...f.runtime.runtime_dependencies[0], files: [f.runtime.runtime_dependencies[0].files[1]] }]);
  fs.writeFileSync(f.runtimePath, JSON.stringify(missingPackageJson));
  assert.throws(() => f.resolve(f.root, { ...f.identity, runtime_component_manifest_hash: missingPackageJson.component_manifest_hash }),
    /omits package\.json/i);
});

test("rejects Runtime path traversal, symlinks, duplicate metadata and a swapped root", t => {
  const f = fixture(t);
  const outside = path.join(f.parent, "outside.mjs");
  fs.writeFileSync(outside, "export const outside = true;\n");
  const link = path.join(f.root, "scripts/edupi_component_manifest.mjs");
  fs.unlinkSync(link);
  fs.symlinkSync(outside, link);
  assert.throws(() => f.resolve(), /outside|symlink/i);
  fs.unlinkSync(link);
  fs.writeFileSync(link, f.files["scripts/edupi_component_manifest.mjs"]);

  const traversal = f.makeManifest(f.runtime.entrypoint,
    [...f.runtime.modules, { path: "scripts/../outside.mjs", sha256: digest("x"), size: 1 }],
    f.runtime.assets, f.runtime.runtime_dependencies);
  fs.writeFileSync(f.runtimePath, JSON.stringify(traversal));
  assert.throws(() => f.resolve(f.root, { ...f.identity, runtime_component_manifest_hash: traversal.component_manifest_hash }), /invalid component manifest entry/i);

  const overlap = f.makeManifest(f.runtime.entrypoint, [...f.runtime.modules, f.desktop.modules[0]],
    f.runtime.assets, f.runtime.runtime_dependencies);
  fs.writeFileSync(f.runtimePath, JSON.stringify(overlap));
  f.resolve(f.root, { ...f.identity, runtime_component_manifest_hash: overlap.component_manifest_hash });
  const conflict = f.makeManifest(f.runtime.entrypoint,
    [...f.runtime.modules, { ...f.desktop.modules[0], sha256: digest("other") }],
    f.runtime.assets, f.runtime.runtime_dependencies);
  fs.writeFileSync(f.runtimePath, JSON.stringify(conflict));
  assert.throws(() => f.resolve(f.root, { ...f.identity, runtime_component_manifest_hash: conflict.component_manifest_hash }), /conflicting|metadata/i);

  fs.writeFileSync(f.runtimePath, JSON.stringify(f.runtime));
  const swapped = path.join(f.parent, "swapped");
  fs.cpSync(f.root, swapped, { recursive: true });
  fs.writeFileSync(path.join(swapped, "scripts/core_runtime_daemon.mjs"), "export const daemon = false;\n");
  assert.throws(() => f.resolve(swapped), /component (hash|size) mismatch/i);
});
