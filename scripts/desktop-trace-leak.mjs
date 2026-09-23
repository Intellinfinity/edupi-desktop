import { lstat, realpath, rm } from "node:fs/promises";
import path from "node:path";

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function existingStat(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function planStandaloneTraceLeakCleanup({ rootDir, standaloneDir }) {
  const requestedRoot = path.resolve(rootDir);
  const root = await realpath(requestedRoot);
  const standalone = path.resolve(root, path.relative(requestedRoot, path.resolve(standaloneDir)));
  if (!inside(root, standalone)) throw new Error("Desktop standalone directory escaped the project root");
  const nodeModules = path.join(root, "node_modules");
  const nodeModulesStat = await existingStat(nodeModules);
  if (!nodeModulesStat?.isSymbolicLink()) return null;
  const physicalNodeModules = await realpath(nodeModules);
  const leakNodeModules = path.resolve(standalone, path.relative(root, physicalNodeModules));
  const leakRelative = path.relative(root, leakNodeModules);
  if (!inside(root, leakNodeModules) || !leakRelative || leakRelative === "node_modules") {
    throw new Error("Symlinked standalone trace output would escape the project build boundary");
  }
  const firstSegment = leakRelative.split(path.sep)[0];
  if (firstSegment === ".next-desktop") return null;
  const leakRoot = path.join(root, firstSegment);
  if (await existingStat(leakRoot)) {
    throw new Error(`Refusing desktop build because the trace leak cleanup path already exists: ${leakRoot}`);
  }
  return { rootDir: root, leakRoot };
}

export async function cleanupStandaloneTraceLeak(plan) {
  if (!plan) return;
  const root = path.resolve(plan.rootDir);
  const leakRoot = path.resolve(plan.leakRoot);
  if (!inside(root, leakRoot) || path.dirname(leakRoot) !== root) {
    throw new Error("Desktop trace leak cleanup target is invalid");
  }
  const stat = await existingStat(leakRoot);
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Desktop trace leak cleanup target changed during the build");
  }
  await rm(leakRoot, { recursive: true, force: false });
}
