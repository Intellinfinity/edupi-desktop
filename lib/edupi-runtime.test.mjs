import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";

const runtimePath = fileURLToPath(new URL("./edupi-runtime.ts", import.meta.url));
const childSource = [
  'import { createJiti } from "jiti";',
  "const jiti = createJiti(import.meta.url);",
  `const runtime = await jiti.import(${JSON.stringify(runtimePath)});`,
  "process.stdout.write(JSON.stringify({ dataRoot: runtime.EDUPI_ROOT, codeRoot: runtime.EDUPI_CODE_ROOT, extensionPaths: runtime.extensionPaths }));",
].join("\n");
const runtimeEnvKeys = ["EDUPI_CORE_ROOT", "EDUPI_DATA_ROOT", "EDUPI_PROJECT_ROOT"];

function loadRuntime(overrides = {}) {
  const env = { ...process.env };
  for (const key of runtimeEnvKeys) delete env[key];
  Object.assign(env, overrides);
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", childSource], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  }));
}

function assertExtensionPathsUnder(runtime, root) {
  const extensionsRoot = path.join(root, "extensions");
  assert.ok(runtime.extensionPaths.length > 0);
  assert.ok(runtime.extensionPaths.every((extensionPath) => extensionPath.startsWith(`${extensionsRoot}${path.sep}`)));
}

test("an aliased data root resolves to the same identity as Pi sessions", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-runtime-alias-"));
  try {
    const target = path.join(temporary, "data"), alias = path.join(temporary, "alias");
    fs.mkdirSync(target);
    fs.symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir");
    assert.equal(loadRuntime({ EDUPI_DATA_ROOT: alias }).dataRoot, fs.realpathSync(target));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test("runtime roots can target independent data and Core projects", () => {
  const dataRoot = "/tmp/edupi-data-root";
  const codeRoot = "/tmp/edupi-core-root";
  const legacyRoot = "/tmp/edupi-legacy-root";
  const runtime = loadRuntime({
    EDUPI_DATA_ROOT: dataRoot,
    EDUPI_CORE_ROOT: codeRoot,
    EDUPI_PROJECT_ROOT: legacyRoot,
  });

  assert.equal(runtime.dataRoot, dataRoot);
  assert.equal(runtime.codeRoot, codeRoot);
  assertExtensionPathsUnder(runtime, codeRoot);
  assert.ok(runtime.extensionPaths.every((extensionPath) => !extensionPath.startsWith(`${dataRoot}${path.sep}`)));
});

test("legacy project-root configuration remains the shared fallback", () => {
  const legacyRoot = "/tmp/edupi-legacy-root";
  const legacyRuntime = loadRuntime({ EDUPI_PROJECT_ROOT: legacyRoot });
  assert.equal(legacyRuntime.dataRoot, legacyRoot);
  assert.equal(legacyRuntime.codeRoot, legacyRoot);
  assertExtensionPathsUnder(legacyRuntime, legacyRoot);

  const defaultRuntime = loadRuntime();
  const defaultRoot = path.resolve(process.cwd(), "../edupi");
  assert.equal(defaultRuntime.dataRoot, defaultRoot);
  assert.equal(defaultRuntime.codeRoot, defaultRoot);
  assertExtensionPathsUnder(defaultRuntime, defaultRoot);
});

test("RPC keeps desktop controls data-root-bound while extensions use the code root", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(source, /import \{ builtinEducationSkillPaths, EDUPI_CODE_ROOT, EDUPI_ROOT, extensionPaths, prepareEducationResources \} from "\.\/edupi-runtime"/);
  assert.match(startupSource, /additionalExtensionPaths: extensionPaths/);
  assert.match(startupSource, /sessionIsEduPiDataRoot/);
  assert.match(startupSource, /sessionIsEduPiCoreRoot/);
  assert.equal((startupSource.match(/projectRoot: EDUPI_ROOT/g) ?? []).length, 5);
  assert.equal((startupSource.match(/projectRoot: EDUPI_CODE_ROOT/g) ?? []).length, 2);
  assert.match(startupSource, /createEduPiExternalConnectorTool\(\{\s*projectRoot: EDUPI_ROOT/);
  assert.match(startupSource, /EDUPI_CODE_ROOT/);
});
