import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveEduPiCoreRoot, resolveEduPiDataRoot, validateContainedRegularFile } = await jiti.import("./edupi-core-root.ts");
const configuredRoot = process.env.EDUPI_CORE_ROOT;

test("resolves and verifies the pinned Core runtime", { skip: !configuredRoot }, () => {
  const realRoot = fs.realpathSync(configuredRoot);
  const manifestPath = path.join(realRoot, "contracts", "edupi-desktop-component-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const runtimeManifest = JSON.parse(fs.readFileSync(path.join(realRoot, "contracts", "edupi-core-runtime-component-manifest.json"), "utf8"));
  const coreCommit = execFileSync("git", ["-C", realRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const resolved = resolveEduPiCoreRoot({
    configuredRoot,
    allowedRoot: path.dirname(realRoot),
    runtimeIdentity: {
      core_commit: coreCommit,
      component_manifest_path: "contracts/edupi-desktop-component-manifest.json",
      component_manifest_hash: manifest.component_manifest_hash,
      runtime_component_manifest_hash: runtimeManifest.component_manifest_hash,
    },
  });
  assert.equal(resolved.root, realRoot);
  assert.equal(resolved.cwd, realRoot);
  assert.equal(resolved.entrypoint, path.join(realRoot, "scripts", "desktop_bridge_port.mjs"));
  assert.equal(resolved.componentManifestHash, manifest.component_manifest_hash);
});

test("fails closed on runtime identity drift", { skip: !configuredRoot }, () => {
  const realRoot = fs.realpathSync(configuredRoot);
  const manifest = JSON.parse(fs.readFileSync(path.join(realRoot, "contracts", "edupi-desktop-component-manifest.json"), "utf8"));
  assert.throws(() => resolveEduPiCoreRoot({ configuredRoot, allowedRoot: path.dirname(realRoot), runtimeIdentity: { core_commit: "wrong", component_manifest_path: "contracts/edupi-desktop-component-manifest.json", component_manifest_hash: manifest.component_manifest_hash } }), /commit/i);
  assert.throws(() => resolveEduPiCoreRoot({ configuredRoot, allowedRoot: path.dirname(realRoot), runtimeIdentity: { core_commit: execFileSync("git", ["-C", realRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), component_manifest_path: "contracts/edupi-desktop-component-manifest.json", component_manifest_hash: "sha256:wrong" } }), /manifest hash/i);
});

test("rejects directory entries and symlink escapes", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-core-root-"));
  const allowed = path.join(temp, "allowed");
  const external = path.join(temp, "external.mjs");
  fs.mkdirSync(allowed, { recursive: true });
  fs.writeFileSync(external, "export {};\n", "utf8");
  assert.throws(() => validateContainedRegularFile({ allowedRoot: allowed, candidate: allowed }), /regular file/i);
  const link = path.join(allowed, "desktop_bridge_port.mjs");
  fs.symlinkSync(external, link);
  assert.throws(() => validateContainedRegularFile({ allowedRoot: allowed, candidate: link }), /escape|outside/i);
});

test("resolves an explicit contained data root and derives only in-root paths", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-data-root-"));
  const dataRoot = path.join(temp, "project");
  fs.mkdirSync(dataRoot, { recursive: true });
  const resolved = resolveEduPiDataRoot({ configuredRoot: dataRoot, allowedRoot: temp });
  assert.equal(resolved.root, fs.realpathSync(dataRoot));
  assert.equal(resolved.memoryDir, path.join(resolved.root, ".edupi", "memory"));
  assert.equal(resolved.outputDir, path.join(resolved.root, ".edupi", "output"));
  assert.equal(resolved.lockDir, path.join(resolved.root, ".edupi", "locks"));
  assert.ok(resolved.memoryDir.startsWith(`${resolved.root}${path.sep}`));
});

test("rejects an .edupi symlink that escapes the data root", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-data-symlink-"));
  const dataRoot = path.join(temp, "project");
  const external = path.join(temp, "external");
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(external, { recursive: true });
  fs.symlinkSync(external, path.join(dataRoot, ".edupi"));

  assert.throws(() => resolveEduPiDataRoot({ configuredRoot: dataRoot, allowedRoot: temp }), /symlink/i);
});

test("rejects memory and output symlinks that escape the data root", () => {
  for (const directory of ["memory", "output"]) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-data-child-symlink-"));
    const dataRoot = path.join(temp, "project");
    const external = path.join(temp, "external");
    const edupiRoot = path.join(dataRoot, ".edupi");
    fs.mkdirSync(edupiRoot, { recursive: true });
    fs.mkdirSync(external, { recursive: true });
    fs.symlinkSync(external, path.join(edupiRoot, directory));

    assert.throws(() => resolveEduPiDataRoot({ configuredRoot: dataRoot, allowedRoot: temp }), /symlink/i);
  }
});

test("accepts existing normal derived directories and a missing locks directory", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-data-directories-"));
  const dataRoot = path.join(temp, "project");
  fs.mkdirSync(path.join(dataRoot, ".edupi", "memory"), { recursive: true });
  fs.mkdirSync(path.join(dataRoot, ".edupi", "output"), { recursive: true });

  const resolved = resolveEduPiDataRoot({ configuredRoot: dataRoot, allowedRoot: temp });
  assert.equal(resolved.memoryDir, path.join(resolved.root, ".edupi", "memory"));
  assert.equal(resolved.outputDir, path.join(resolved.root, ".edupi", "output"));
  assert.equal(resolved.lockDir, path.join(resolved.root, ".edupi", "locks"));
  assert.equal(fs.existsSync(resolved.lockDir), false);
});

test("requires an absolute data root and rejects allowed-root escapes", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-data-boundary-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-data-outside-"));
  assert.throws(() => resolveEduPiDataRoot({ configuredRoot: "relative-data", allowedRoot: temp }), /absolute/i);
  assert.throws(() => resolveEduPiDataRoot({ configuredRoot: outside, allowedRoot: temp }), /outside/i);
});
