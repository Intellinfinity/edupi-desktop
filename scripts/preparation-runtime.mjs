import { createRequire } from "node:module";
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const PREPARATION_PACKAGES = ["jszip", "@xmldom/xmldom", "mammoth"];

async function copyDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, destinationPath);
    }
  }
}

async function copyPackageClosure(root, destination, packageName, seen) {
  const require = createRequire(join(root, "package.json"));
  let manifestPath;
  try {
    manifestPath = require.resolve(`${packageName}/package.json`);
  } catch {
    return;
  }
  const packageRoot = dirname(manifestPath);
  const packageIdentity = await stat(packageRoot).then(() => packageRoot);
  if (seen.has(packageIdentity)) return;
  seen.add(packageIdentity);
  await copyDirectory(packageRoot, join(destination, "node_modules", packageName));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const dependencies = { ...(manifest.dependencies || {}), ...(manifest.optionalDependencies || {}) };
  for (const dependency of Object.keys(dependencies)) {
    await copyPackageClosure(packageRoot, destination, dependency, seen);
  }
}

export async function copyPreparationDependencies(root, destination) {
  const require = createRequire(join(root,"package.json"));
  const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft");
  const trace = await nodeFileTrace([
    join(root,"desktop/preparation-materials.mjs"),
    join(root,"desktop/preparation-source-text.mjs"),
    join(root,"desktop/office-archive.mjs"),
    join(root,"desktop/preparation-skills.mjs"),
  ],{base:root});
  if (trace.warnings.size) throw new Error("Preparation dependency tracing failed");
  for (const file of trace.fileList) {
    if (!/^node_modules[\\/]/.test(file)) continue;
    const target = join(destination,file);
    await mkdir(dirname(target),{recursive:true});
    await copyFile(join(root,file),target);
  }
  const seenPackages = new Set();
  for (const packageName of PREPARATION_PACKAGES) await copyPackageClosure(root, destination, packageName, seenPackages);
}
