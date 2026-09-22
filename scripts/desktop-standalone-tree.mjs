import { cp, lstat, realpath, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { isDesktopServerInput } from "./desktop-package-inputs.mjs";

async function rejectSymlinks(root) {
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Staged desktop server contains a symbolic link: ${relative(root, child)}`);
      }
      if (entry.isDirectory()) await walk(child);
    }
  }
  await walk(root);
}

function isContained(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== "" && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
}

export async function copyDesktopStandaloneTree({ standaloneRoot, destinationRoot }) {
  const standaloneNodeModules = join(standaloneRoot, "node_modules");
  const nodeModulesStat = await lstat(standaloneNodeModules);
  if (!nodeModulesStat.isDirectory() && !nodeModulesStat.isSymbolicLink()) {
    throw new Error("Next standalone node_modules is neither a directory nor a symlink");
  }
  const excludeNodeModules = nodeModulesStat.isSymbolicLink();
  const resolvedNodeModules = resolve(standaloneNodeModules);
  await cp(standaloneRoot, destinationRoot, {
    recursive: true,
    filter: source => (
      (!excludeNodeModules || resolve(source) !== resolvedNodeModules)
      && isDesktopServerInput(standaloneRoot, source)
    ),
  });
  await rejectSymlinks(destinationRoot);
  return { nodeModulesMode: excludeNodeModules ? "symlink" : "directory" };
}

export async function verifyDesktopServerRuntime(destinationRoot) {
  const resolvedDestination = await realpath(destinationRoot);
  await rejectSymlinks(resolvedDestination);
  for (const relativePath of [
    ["node_modules", "next", "package.json"],
    ["node_modules", "next", "dist", "server", "lib", "start-server.js"],
    ["node_modules", "react", "package.json"],
    ["node_modules", "react-dom", "package.json"],
  ]) {
    const required = join(resolvedDestination, ...relativePath);
    try {
      const requiredStat = await lstat(required);
      if (!requiredStat.isFile() || requiredStat.isSymbolicLink()) throw new Error("not a regular file");
      const resolvedRequired = await realpath(required);
      if (!isContained(resolvedDestination, resolvedRequired)) throw new Error("outside staged server");
    } catch {
      throw new Error(`Staged desktop server is missing ${relativePath.join("/")}`);
    }
  }
}
