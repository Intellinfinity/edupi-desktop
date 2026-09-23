import { access, chmod, copyFile, cp, lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopTargetTriple } from "./desktop-platform.mjs";
import { copyDesktopStandaloneTree, verifyDesktopServerRuntime } from "./desktop-standalone-tree.mjs";
import { buildPackagedCoreBundle } from "./packaged-core-bundle.mjs";
import { piPackageDirNames } from "./pi-packages.mjs";
import { removeUnusedMuslSharp } from "./packaged-sharp.mjs";
import { copyPackageClosure, copyPreparationDependencies } from "./preparation-runtime.mjs";
import { copyRuntimeModelHostFiles } from "./runtime-model-host-files.mjs";
import { cleanupStandaloneTraceLeak, planStandaloneTraceLeakCleanup } from "./desktop-trace-leak.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopBuildDir = join(rootDir, ".next-desktop");
const standaloneDir = join(desktopBuildDir, "standalone");
const serverResourcesDir = join(rootDir, "src-tauri", "resources", "server");
const serverHelperDir = join(rootDir, "src-tauri", "resources", "Pi Agent Server.app");
const nodeResourcesDir = join(rootDir, "src-tauri", "resources", "node");

async function copySymlinkedStandaloneDependencies(standaloneRoot, destinationRoot) {
  const standaloneNodeModules = join(standaloneRoot, "node_modules");
  let nodeModulesStat;
  try { nodeModulesStat = await lstat(standaloneNodeModules); } catch { return 0; }
  if (!nodeModulesStat.isSymbolicLink()) return 0;

  // Next keeps the NFT manifests beside `standalone`, not inside the copied
  // server tree. This matters when a worktree exposes node_modules via a
  // symlink and standalone cannot materialize the traced packages itself.
  const traceRoot = dirname(standaloneRoot);
  const traceFiles = [];
  async function collect(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = join(current, entry.name);
      if (entry.isDirectory()) await collect(file);
      else if (entry.isFile() && entry.name.endsWith(".nft.json")) traceFiles.push(file);
    }
  }
  await collect(traceRoot);

  const destinationRootReal = resolve(destinationRoot);
  const copied = new Set();
  for (const traceFile of traceFiles) {
    let trace;
    try { trace = JSON.parse(await readFile(traceFile, "utf8")); } catch { continue; }
    if (!Array.isArray(trace?.files)) continue;
    const traceDirectory = dirname(traceFile);
    for (const listed of trace.files) {
      if (typeof listed !== "string") continue;
      const normalized = listed.replaceAll("\\", "/");
      const parts = normalized.split("/");
      const nodeModulesIndex = parts.indexOf("node_modules");
      if (nodeModulesIndex < 0 || nodeModulesIndex === parts.length - 1) continue;
      const source = resolve(traceDirectory, ...parts);
      let sourceStat;
      try { sourceStat = await lstat(source); } catch { continue; }
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) continue;
      const packageRelative = parts.slice(nodeModulesIndex).join("/");
      const destination = resolve(destinationRootReal, ...packageRelative.split("/"));
      const destinationRelative = relative(destinationRootReal, destination);
      if (destinationRelative.startsWith("..") || destinationRelative.includes(`${process.platform === "win32" ? "\\" : "/"}..`)) continue;
      if (copied.has(destination)) continue;
      copied.add(destination);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
  }
  const packageFilesBefore = copied.size;
  const packageSeen = new Set();
  for (const packageName of ["next", "react", "react-dom", "undici"]) {
    await copyPackageClosure(rootDir, destinationRoot, packageName, packageSeen);
  }
  for (const packageName of await piPackageDirNames()) {
    await copyPackageClosure(rootDir, destinationRoot, `@earendil-works/${packageName}`, packageSeen);
  }
  const packageFiles = packageFilesBefore + packageSeen.size;
  if (copied.size === 0 && packageSeen.size === 0) throw new Error("Next standalone node_modules is a symlink but no traced dependency files were found");
  return packageFiles;
}

async function runNextBuild() {
  const require = createRequire(import.meta.url);
  const nextBin = require.resolve("next/dist/bin/next", { paths: [rootDir] });

  await rm(desktopBuildDir, { recursive: true, force: true });

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextBin, "build", "--webpack"], {
      cwd: rootDir,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        PI_WEB_DESKTOP_BUILD: "1",
      },
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Next.js desktop build failed (${signal ?? `exit ${code}`}).`));
    });
  });
}

async function assembleServer() {
  await access(join(standaloneDir, "server.js"), constants.R_OK);
  await rm(serverResourcesDir, { recursive: true, force: true });
  await mkdir(dirname(serverResourcesDir), { recursive: true });
  await copyDesktopStandaloneTree({ standaloneRoot: standaloneDir, destinationRoot: serverResourcesDir });
  const tracedDependencies = await copySymlinkedStandaloneDependencies(standaloneDir, serverResourcesDir);
  if (tracedDependencies > 0) console.log(`Expanded ${tracedDependencies} traced dependency files from a standalone node_modules symlink`);

  // Next's trace omits dependencies reached by the external Pi packages at
  // runtime. Keep their package exports and full dependency closure together.
  const piPackages = new Set();
  for (const packageName of await piPackageDirNames()) {
    await copyPackageClosure(rootDir, serverResourcesDir, `@earendil-works/${packageName}`, piPackages);
  }

  await copyFile(
    join(rootDir, "desktop", "server-launcher.cjs"),
    join(serverResourcesDir, "desktop-server.cjs"),
  );
  await copyFile(join(rootDir, "desktop", "mobile-gateway.cjs"), join(serverResourcesDir, "mobile-gateway.cjs"));
  await copyFile(join(rootDir, "desktop", "preparation-worker.mjs"), join(serverResourcesDir, "preparation-worker.mjs"));
  await copyFile(join(rootDir, "desktop", "core-runtime-host.mjs"), join(serverResourcesDir, "core-runtime-host.mjs"));
  await copyFile(join(rootDir, "desktop", "model-output-repair.mjs"), join(serverResourcesDir, "model-output-repair.mjs"));
  await copyFile(join(rootDir, "desktop", "preparation-materials.mjs"), join(serverResourcesDir, "preparation-materials.mjs"));
  await copyFile(join(rootDir, "desktop", "preparation-skills.mjs"), join(serverResourcesDir, "preparation-skills.mjs"));
  await copyFile(join(rootDir, "desktop", "preparation-source-text.mjs"), join(serverResourcesDir, "preparation-source-text.mjs"));
  await copyFile(join(rootDir, "desktop", "office-archive.mjs"), join(serverResourcesDir, "office-archive.mjs"));
  await copyFile(join(rootDir, "desktop", "ocr-worker.cjs"), join(serverResourcesDir, "ocr-worker.cjs"));
  await copyFile(join(rootDir, "desktop", "pdf-page-extract.mjs"), join(serverResourcesDir, "pdf-page-extract.mjs"));
  await copyPreparationDependencies(rootDir, serverResourcesDir);
  const ocrPackages = new Set();
  for (const packageName of ["tesseract.js", "@tesseract.js-data/chi_sim", "@tesseract.js-data/eng", "pdfjs-dist", "@napi-rs/canvas"]) {
    await copyPackageClosure(rootDir, serverResourcesDir, packageName, ocrPackages);
  }

  const staticSource = join(desktopBuildDir, "static");
  const staticDestination = join(serverResourcesDir, ".next-desktop", "static");
  await mkdir(dirname(staticDestination), { recursive: true });
  await cp(staticSource, staticDestination, { recursive: true });

  const publicDir = join(rootDir, "public");
  try {
    await access(publicDir, constants.R_OK);
    await cp(publicDir, join(serverResourcesDir, "public"), { recursive: true });
  } catch {
    // `public/` is optional in Next.js projects.
  }
}

async function readPackageVersion(packageDir) {
  try {
    return JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/** Package directories directly under a node_modules dir, resolving @scope/name. */
async function listPackageDirs(nodeModulesDir) {
  const packages = [];
  let entries;
  try {
    entries = await readdir(nodeModulesDir, { withFileTypes: true });
  } catch {
    return packages;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".bin") continue;
    const entryPath = join(nodeModulesDir, entry.name);

    if (entry.name.startsWith("@")) {
      for (const scoped of await readdir(entryPath, { withFileTypes: true })) {
        if (scoped.isDirectory()) {
          packages.push({ name: `${entry.name}/${scoped.name}`, dir: join(entryPath, scoped.name) });
        }
      }
      continue;
    }
    packages.push({ name: entry.name, dir: entryPath });
  }
  return packages;
}

/**
 * Drop nested node_modules copies that duplicate a top-level package at the
 * exact same version.
 *
 * npm nests a dependency when versions conflict, but it also leaves redundant
 * copies behind. Each nesting level adds ~45 characters to every path inside
 * it, and NSIS cannot open a path over Windows' 260-character MAX_PATH — one
 * file in @mistralai took the whole Windows installer down that way.
 *
 * Only exact version matches are removed, so a genuine version conflict keeps
 * its nested copy and Node still resolves it correctly.
 */
async function dedupeNestedPackages() {
  const topLevelDir = join(serverResourcesDir, "node_modules");
  const topLevelVersions = new Map();
  for (const { name, dir } of await listPackageDirs(topLevelDir)) {
    topLevelVersions.set(name, await readPackageVersion(dir));
  }

  let removed = 0;
  for (const { dir } of await listPackageDirs(topLevelDir)) {
    const nestedDir = join(dir, "node_modules");
    for (const nested of await listPackageDirs(nestedDir)) {
      const topVersion = topLevelVersions.get(nested.name);
      if (!topVersion) continue;
      if (topVersion !== (await readPackageVersion(nested.dir))) continue;

      await rm(nested.dir, { recursive: true, force: true });
      removed += 1;
    }

    // Removing @scope/name leaves the @scope directory behind. An empty
    // directory is harmless to Node but confuses anyone auditing the bundle.
    for (const entry of await readdir(nestedDir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !entry.name.startsWith("@")) continue;
      const scopeDir = join(nestedDir, entry.name);
      if ((await readdir(scopeDir)).length === 0) await rm(scopeDir, { recursive: true, force: true });
    }
  }
  return removed;
}

/** Paths that would exceed Windows' MAX_PATH once staged on a runner. */
async function findOverlongPaths() {
  // Mirrors the checkout location on a windows-latest runner. Measured even on
  // macOS so a long path fails the build here instead of inside makensis.
  const windowsPrefix = "D:\\a\\pi-agent-desktop\\pi-agent-desktop\\src-tauri\\resources\\server";
  const overlong = [];

  async function walk(dir, relative) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const childRelative = relative ? `${relative}\\${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), childRelative);
        continue;
      }
      const full = `${windowsPrefix}\\${childRelative}`;
      if (full.length > 260) overlong.push({ length: full.length, path: childRelative });
    }
  }

  await walk(serverResourcesDir, "");
  return overlong;
}

async function findNpmSource() {
  const npmFromCurrentRun = process.env.npm_execpath
    ? dirname(dirname(process.env.npm_execpath))
    : null;
  const candidates = [
    npmFromCurrentRun,
    join(dirname(process.execPath), "node_modules", "npm"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(join(candidate, "bin", "npx-cli.js"), constants.R_OK);
      return candidate;
    } catch {
      // Try the next Node installation layout.
    }
  }

  throw new Error("Could not locate npm next to the bundled Node.js runtime.");
}

async function bundleNodeRuntime() {
  const triple = desktopTargetTriple();
  await rm(serverHelperDir, { recursive: true, force: true });
  await rm(nodeResourcesDir, { recursive: true, force: true });

  let binaryPath;
  if (process.platform === "darwin") {
    // Wrap Node in an LSBackgroundOnly .app so it does not appear in the Dock.
    // Info.plist uses the parent CFBundleIdentifier (com.abcwyc.pi-agent) so
    // macOS TCC SystemPolicyAppData grants persist across launches — a distinct
    // helper id re-prompts "access data from other apps" every cold start.
    const contentsDir = join(serverHelperDir, "Contents");
    binaryPath = join(contentsDir, "MacOS", "node");
    await mkdir(dirname(binaryPath), { recursive: true });
    await copyFile(process.execPath, binaryPath);
    await chmod(binaryPath, 0o755);
    await copyFile(
      join(rootDir, "desktop", "server-helper-Info.plist"),
      join(contentsDir, "Info.plist"),
    );
  } else {
    const executableName = process.platform === "win32" ? "node.exe" : "node";
    binaryPath = join(nodeResourcesDir, executableName);
    await mkdir(nodeResourcesDir, { recursive: true });
    await copyFile(process.execPath, binaryPath);
    await chmod(binaryPath, 0o755);
    await cp(
      await findNpmSource(),
      join(nodeResourcesDir, "node_modules", "npm"),
      { recursive: true },
    );
  }

  return { binaryPath, triple };
}

const traceLeakCleanup = await planStandaloneTraceLeakCleanup({ rootDir, standaloneDir });
try {
  await runNextBuild();
} finally {
  await cleanupStandaloneTraceLeak(traceLeakCleanup);
}
await assembleServer();
await removeUnusedMuslSharp(serverResourcesDir);

const deduped = await dedupeNestedPackages();
if (deduped > 0) console.log(`Removed ${deduped} redundant nested package cop${deduped === 1 ? "y" : "ies"}`);

// Fail here rather than inside makensis, which reports a bare "failed opening
// file" and takes an entire signed release build down with it.
const overlong = await findOverlongPaths();
if (overlong.length > 0) {
  console.error(
    `${overlong.length} staged path(s) exceed Windows' 260-character limit:\n` +
      overlong.map(({ length, path }) => `  ${length}  ${path}`).join("\n"),
  );
  throw new Error("Staged paths would break the Windows installer.");
}

const { binaryPath: nodeBinary, triple } = await bundleNodeRuntime();
const coreBundle = await buildPackagedCoreBundle({ coreRoot: process.env.EDUPI_CORE_ROOT, desktopRoot: rootDir });
await copyRuntimeModelHostFiles(coreBundle.sourceRoot, serverResourcesDir);
await verifyDesktopServerRuntime(serverResourcesDir);

console.log(`Desktop server staged at ${serverResourcesDir}`);
console.log(`Node runtime staged at ${nodeBinary} (${triple})`);
console.log(`Core runtime staged at ${coreBundle.destinationRoot} (${coreBundle.files} files, ${coreBundle.coreCommit})`);
