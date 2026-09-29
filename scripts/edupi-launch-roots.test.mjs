import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { resolveEduPiLaunchRoots: resolveServerRoots } = require(path.join(root, "desktop/server-launcher.cjs"));
const { resolveEduPiLaunchRoots: resolveDevRoots } = await import("./desktop-dev.mjs");

function assertRoots(roots, dataRoot, coreRoot, stateRoot = "") {
  const resolvedDataRoot = path.resolve(dataRoot);
  const resolvedCoreRoot = path.resolve(coreRoot);
  assert.equal(roots.EDUPI_PROJECT_ROOT, resolvedDataRoot);
  assert.equal(roots.EDUPI_DATA_ROOT, resolvedDataRoot);
  assert.equal(roots.EDUPI_CORE_ROOT, resolvedCoreRoot);
  assert.equal(roots.EDUPI_DATA_ALLOWED_ROOT, path.dirname(resolvedDataRoot));
  assert.equal(roots.EDUPI_CORE_ALLOWED_ROOT, path.dirname(resolvedCoreRoot));
  assert.equal(roots.PI_DESKTOP_STATE_DIR, stateRoot ? path.resolve(stateRoot) : "");
}

test("launchers keep data and Core precedence independent", () => {
  const dataRoot = path.join(tmpdir(), "edupi-data-root");
  const coreRoot = path.join(tmpdir(), "edupi-core-root");
  const legacyRoot = path.join(tmpdir(), "edupi-legacy-root");
  const stateRoot = path.join(tmpdir(), "edupi-desktop-state");
  const environment = {
    EDUPI_DATA_ROOT: dataRoot,
    EDUPI_CORE_ROOT: coreRoot,
    EDUPI_PROJECT_ROOT: legacyRoot,
    EDUPI_WORKSPACE: path.join(tmpdir(), "edupi-workspace"),
    PI_DESKTOP_STATE_DIR: stateRoot,
  };

  assertRoots(resolveDevRoots(environment), dataRoot, coreRoot, stateRoot);
  assertRoots(resolveServerRoots(environment), dataRoot, coreRoot, stateRoot);
});

test("launchers preserve legacy, workspace, data-only, and sibling fallbacks", () => {
  const legacyRoot = path.join(tmpdir(), "edupi-legacy-root");
  assertRoots(resolveDevRoots({ EDUPI_PROJECT_ROOT: legacyRoot }), legacyRoot, legacyRoot);

  const workspaceRoot = path.join(tmpdir(), "edupi-workspace");
  assertRoots(resolveDevRoots({ EDUPI_WORKSPACE: workspaceRoot }), workspaceRoot, workspaceRoot);

  const dataRoot = path.join(tmpdir(), "edupi-data-only");
  const bundledCoreRoot = mkdtempSync(path.join(tmpdir(), "edupi-bundled-core-"));
  const dataOnlyRoots = resolveDevRoots({ EDUPI_DATA_ROOT: dataRoot }, path.join(tmpdir(), "missing-edupi"), bundledCoreRoot);
  assertRoots(dataOnlyRoots, dataRoot, bundledCoreRoot);
  assert.equal(dataOnlyRoots.EDUPI_CORE_VALIDATION_MODE, "bundled");

  const siblingParent = mkdtempSync(path.join(tmpdir(), "edupi-launch-sibling-"));
  const siblingRoot = path.join(siblingParent, "edupi");
  mkdirSync(siblingRoot);
  assertRoots(resolveDevRoots({}, siblingRoot, bundledCoreRoot), siblingRoot, bundledCoreRoot);
  assert.equal(resolveDevRoots({}, siblingRoot, bundledCoreRoot).EDUPI_CORE_VALIDATION_MODE, "bundled");

  const explicitCoreRoot = path.join(tmpdir(), "edupi-explicit-core");
  assertRoots(resolveDevRoots({ EDUPI_CORE_ROOT: explicitCoreRoot }, siblingRoot, bundledCoreRoot), siblingRoot, explicitCoreRoot);
  assert.equal(resolveDevRoots({ EDUPI_CORE_ROOT: explicitCoreRoot }, siblingRoot, bundledCoreRoot).EDUPI_CORE_VALIDATION_MODE, "external");

  const serverWithoutRoots = resolveServerRoots({});
  assert.equal(serverWithoutRoots.EDUPI_PROJECT_ROOT, "");
  assert.equal(serverWithoutRoots.EDUPI_DATA_ROOT, "");
  assert.equal(serverWithoutRoots.EDUPI_CORE_ROOT, "");
  assert.equal(serverWithoutRoots.EDUPI_DATA_ALLOWED_ROOT, "");
  assert.equal(serverWithoutRoots.EDUPI_CORE_ALLOWED_ROOT, "");
  assert.equal(serverWithoutRoots.PI_DESKTOP_STATE_DIR, "");
});

test("server launcher normalizes legacy roots before requiring the server", () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "edupi-launch-server-"));
  const launcherPath = path.join(tempRoot, "server-launcher.cjs");
  const serverPath = path.join(tempRoot, "server.js");
  copyFileSync(path.join(root, "desktop/server-launcher.cjs"), launcherPath);
  writeFileSync(
    serverPath,
    "process.stdout.write(JSON.stringify({ project: process.env.EDUPI_PROJECT_ROOT, data: process.env.EDUPI_DATA_ROOT, core: process.env.EDUPI_CORE_ROOT, coreAllowed: process.env.EDUPI_CORE_ALLOWED_ROOT, dataAllowed: process.env.EDUPI_DATA_ALLOWED_ROOT, state: process.env.PI_DESKTOP_STATE_DIR }));\n",
  );

  const legacyRoot = path.join(tempRoot, "legacy-root");
  const environment = { ...process.env, EDUPI_PROJECT_ROOT: legacyRoot, PI_WEB_PARENT_PID: "" };
  for (const name of [
    "EDUPI_DATA_ROOT",
    "EDUPI_CORE_ROOT",
    "EDUPI_CORE_ALLOWED_ROOT",
    "EDUPI_DATA_ALLOWED_ROOT",
  ]) delete environment[name];
  const observed = JSON.parse(execFileSync(process.execPath, [launcherPath], {
    cwd: tempRoot,
    env: environment,
    encoding: "utf8",
  }));

  assert.equal(observed.project, legacyRoot);
  assert.equal(observed.data, legacyRoot);
  assert.equal(observed.core, legacyRoot);
  assert.equal(observed.coreAllowed, path.dirname(legacyRoot));
  assert.equal(observed.dataAllowed, path.dirname(legacyRoot));
  assert.equal(observed.state, "");
});

test("explicit allowed roots are forwarded and launcher watchdog entrypoints remain intact", async () => {
  const dataRoot = path.join(tmpdir(), "edupi-data-root");
  const coreRoot = path.join(tmpdir(), "edupi-core-root");
  const dataAllowedRoot = path.join(tmpdir(), "edupi-data-allowed");
  const coreAllowedRoot = path.join(tmpdir(), "edupi-core-allowed");
  const stateRoot = path.join(tmpdir(), "edupi-desktop-state");
  const roots = resolveServerRoots({
    EDUPI_DATA_ROOT: dataRoot,
    EDUPI_CORE_ROOT: coreRoot,
    EDUPI_DATA_ALLOWED_ROOT: dataAllowedRoot,
    EDUPI_CORE_ALLOWED_ROOT: coreAllowedRoot,
    PI_DESKTOP_STATE_DIR: stateRoot,
  });
  assert.equal(roots.EDUPI_DATA_ALLOWED_ROOT, path.resolve(dataAllowedRoot));
  assert.equal(roots.EDUPI_CORE_ALLOWED_ROOT, path.resolve(coreAllowedRoot));
  assert.equal(roots.PI_DESKTOP_STATE_DIR, path.resolve(stateRoot));

  const launcher = await readFile(path.join(root, "desktop/server-launcher.cjs"), "utf8");
  assert.match(launcher, /const parentWatchdog = setInterval/);
  assert.match(launcher, /parentWatchdog\.unref\(\)/);
  assert.match(launcher, /require\("\.\/server\.js"\)/);

  const rust = await readFile(path.join(root, "src-tauri/src/lib.rs"), "utf8");
  for (const name of [
    "EDUPI_PROJECT_ROOT",
    "EDUPI_DATA_ROOT",
    "EDUPI_CORE_ROOT",
    "EDUPI_CORE_ALLOWED_ROOT",
    "EDUPI_DATA_ALLOWED_ROOT",
    "PI_DESKTOP_STATE_DIR",
  ]) {
    assert.match(rust, new RegExp(name));
  }
  assert.match(rust, /fn edupi_launch_roots\(app: &AppHandle\)/);
  assert.match(rust, /if !path\.is_dir\(\)/);
  assert.match(rust, /\.env\("EDUPI_PROJECT_ROOT", &roots\.data_root\)/);
  assert.match(rust, /\.env\("EDUPI_CORE_ROOT", &roots\.core_root\)/);
  assert.match(rust, /\.env\("EDUPI_CORE_VALIDATION_MODE", roots\.core_validation_mode\)/);
  assert.match(rust, /\.env\("EDUPI_DATA_ALLOWED_ROOT", &roots\.data_allowed_root\)/);
  assert.match(rust, /\.env\("PI_DESKTOP_STATE_DIR", &desktop_state_dir\)/);
  assert.match(rust, /\.env\("EDUPI_DESKTOP_ISOLATED_CANARY", if isolated_canary \{ "1" \} else \{ "0" \}\)/);
  assert.match(rust, /\.env_remove\(ROUTE1_ISOLATED_CANARY_ENV\)/);
  assert.match(rust, /resources\/edupi-core/);
  assert.match(rust, /edupiDataRoot/);
  assert.match(rust, /get_edupi_root_status/);
  assert.match(rust, /set_edupi_data_root/);
  assert.match(rust, /reset_edupi_data_root/);
});
