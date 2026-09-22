import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { buildPackagedCoreBundle } from "./packaged-core-bundle.mjs";

const desktopRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { loadEduPiCompatManifest } = await jiti.import(path.join(desktopRoot, "lib", "edupi-bridge-manifest.ts"));
const { resolveEduPiCoreRoot, resolveEduPiDataRoot } = await jiti.import(path.join(desktopRoot, "lib", "edupi-core-root.ts"));

function listFiles(root, current = root) {
  const files = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(current, entry.name);
    const stat = fs.lstatSync(absolute);
    assert.equal(stat.isSymbolicLink(), false, `bundle contains a symlink: ${absolute}`);
    if (stat.isDirectory()) files.push(...listFiles(root, absolute));
    else if (stat.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
    else throw new Error(`bundle contains a non-regular entry: ${absolute}`);
  }
  return files;
}

function hash(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function destinationRoot() {
  const relative = `src-tauri/resources/edupi-core-test-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const destination = path.join(desktopRoot, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  return destination;
}

test("copies exactly the Desktop and Runtime closure union and validates without .git", { skip: !configuredCoreRoot }, async () => {
  const destination = destinationRoot();
  try {
    const result = await buildPackagedCoreBundle({ coreRoot: configuredCoreRoot, desktopRoot, destinationRoot: destination });
    const compat = loadEduPiCompatManifest();
    assert.equal(result.coreCommit, compat.core_runtime.core_commit);
    assert.equal(result.componentManifestHash, compat.core_runtime.component_manifest_hash);
    assert.equal(fs.existsSync(path.join(destination, ".git")), false);
    assert.equal(fs.existsSync(path.join(destination, "fixtures/bridge/v1.1/fixture-manifest.json")), true);
    const bridgeIdentity = compat.contract_identities.find(item => item.contract_id === "edupi-bridge-v1.1");
    const occurrenceIdentity = compat.contract_identities.find(item => item.contract_id === "edupi-schedule-occurrence-v1.2");
    assert.ok(bridgeIdentity);
    assert.ok(occurrenceIdentity);
    const occurrenceSchemaPath = path.join(destination, occurrenceIdentity.schema_path);
    const occurrenceHashPath = path.join(destination, "contracts/edupi-schedule-occurrence-v1.2-hash.json");
    assert.equal(fs.existsSync(occurrenceSchemaPath), true);
    assert.equal(fs.existsSync(occurrenceHashPath), true);
    const occurrenceSchema = JSON.parse(fs.readFileSync(occurrenceSchemaPath, "utf8"));
    const occurrenceHash = JSON.parse(fs.readFileSync(occurrenceHashPath, "utf8"));
    assert.equal(hash(Buffer.from(JSON.stringify(canonical(occurrenceSchema)), "utf8")), occurrenceIdentity.schema_hash);
    assert.equal(occurrenceHash.schema_hash, occurrenceIdentity.schema_hash);
    const manifest = JSON.parse(fs.readFileSync(path.join(destination, compat.core_runtime.component_manifest_path), "utf8"));
    const runtimeManifestPath = "contracts/edupi-core-runtime-component-manifest.json";
    const sourceRuntimeManifest = JSON.parse(fs.readFileSync(path.join(result.sourceRoot, runtimeManifestPath), "utf8"));
    const runtimeManifest = JSON.parse(fs.readFileSync(path.join(destination, runtimeManifestPath), "utf8"));
    assert.deepEqual(runtimeManifest, sourceRuntimeManifest);
    assert.equal(runtimeManifest.entrypoint, "scripts/core_runtime_daemon.mjs");
    assert.equal(runtimeManifest.component_manifest_hash, compat.core_runtime.runtime_component_manifest_hash);
    assert.equal(JSON.parse(fs.readFileSync(path.join(destination, "contracts/edupi-core-runtime-v1-hash.json"), "utf8")).schema_hash,
      compat.core_runtime.runtime_schema_hash);
    const closure = value => [
      ...value.modules.map(entry => entry.path),
      ...value.assets.map(entry => entry.path),
      ...value.runtime_dependencies.flatMap(dependency => dependency.files.map(entry => entry.path)),
    ];
    const expectedFiles = [...new Set([
      compat.core_runtime.component_manifest_path,
      runtimeManifestPath,
      ...closure(manifest),
      ...closure(sourceRuntimeManifest),
      bridgeIdentity.fixture_manifest_path,
    ])].sort();
    assert.deepEqual(listFiles(destination).sort(), expectedFiles);
    assert.equal(result.files, expectedFiles.length);
    for (const entry of [...sourceRuntimeManifest.modules, ...sourceRuntimeManifest.assets, ...sourceRuntimeManifest.runtime_dependencies.flatMap(dependency => dependency.files)]) {
      const bytes = fs.readFileSync(path.join(destination, entry.path));
      assert.equal(hash(bytes), entry.sha256, entry.path);
      assert.equal(bytes.byteLength, entry.size, entry.path);
    }
    const typebox = manifest.runtime_dependencies.find((dependency) => dependency.name === "typebox");
    const typeboxValue = typebox.files.find((entry) => entry.path === "node_modules/typebox/build/value/index.mjs");
    assert.equal(typeboxValue.sha256, hash(fs.readFileSync(path.join(destination, typeboxValue.path))));
    assert.equal(typeboxValue.size, fs.statSync(path.join(destination, typeboxValue.path)).size);
    const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-bundled-start-")));
    let handle;
    try {
      for (const directory of ["memory", "output", "locks"]) fs.mkdirSync(path.join(data, ".edupi", directory), { recursive: true });
      const { ensureEduPiRuntime } = await jiti.import(path.join(desktopRoot, "lib", "edupi-runtime-supervisor.ts"));
      handle = await ensureEduPiRuntime({ runtime: resolveEduPiCoreRoot({ configuredRoot: destination, allowedRoot: path.dirname(destination), runtimeIdentity: compat.core_runtime, validationMode: "bundled" }), dataRoot: resolveEduPiDataRoot({ configuredRoot: data, allowedRoot: path.dirname(data) }) });
      assert.equal((await handle.call("health", null)).ok, true, "copied Core must start without development-only files");
    } finally { await handle?.close(); fs.rmSync(data, { recursive: true, force: true }); }
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test("bundled validation rejects a tampered or missing runtime dependency file", { skip: !configuredCoreRoot }, async () => {
  const destination = destinationRoot();
  try {
    await buildPackagedCoreBundle({ coreRoot: configuredCoreRoot, desktopRoot, destinationRoot: destination });
    const compat = loadEduPiCompatManifest();
    const runtimeIdentity = compat.core_runtime;
    const runtimeFile = path.join(destination, "node_modules/typebox/build/value/index.mjs");
    fs.appendFileSync(runtimeFile, "\n// tampered\n", "utf8");
    assert.throws(
      () => resolveEduPiCoreRoot({ configuredRoot: destination, allowedRoot: path.dirname(destination), runtimeIdentity, validationMode: "bundled" }),
      /size|hash/i,
    );
    await buildPackagedCoreBundle({ coreRoot: configuredCoreRoot, desktopRoot, destinationRoot: destination });
    fs.rmSync(runtimeFile);
    assert.throws(
      () => resolveEduPiCoreRoot({ configuredRoot: destination, allowedRoot: path.dirname(destination), runtimeIdentity, validationMode: "bundled" }),
      /missing|enoent|regular/i,
    );
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test("external mode still requires Git while bundled mode does not infer from path", { skip: !configuredCoreRoot }, async () => {
  const destination = destinationRoot();
  try {
    const compat = loadEduPiCompatManifest();
    await buildPackagedCoreBundle({ coreRoot: configuredCoreRoot, desktopRoot, destinationRoot: destination });
    assert.throws(
      () => resolveEduPiCoreRoot({ configuredRoot: destination, allowedRoot: path.dirname(destination), runtimeIdentity: compat.core_runtime, validationMode: "external" }),
      /git|checkout|commit/i,
    );
    assert.throws(
      () => resolveEduPiCoreRoot({ configuredRoot: destination, allowedRoot: path.dirname(destination), runtimeIdentity: compat.core_runtime, validationMode: "unknown" }),
      /validation mode/i,
    );
    const bundled = resolveEduPiCoreRoot({ configuredRoot: destination, allowedRoot: path.dirname(destination), runtimeIdentity: compat.core_runtime, validationMode: "bundled" });
    assert.equal(bundled.validationMode, "bundled");
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
});
