import { cp, lstat, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const patches = { undici: "8.10.2", "brace-expansion": "5.0.12" };

// npm installs Pi's published shrinkwrap even when the root lock/overrides
// specify patched versions. Copy only these verified registry packages.
export async function prepareSecurityDependencies(projectRoot = root) {
  const modules = join(projectRoot, "node_modules");
  const sdk = join(modules, "@earendil-works/pi-coding-agent");
  const sdkManifest = JSON.parse(await readFile(join(sdk, "package.json"), "utf8"));
  if (sdkManifest.version !== "0.84.1") throw new Error("Re-evaluate the Pi shrinkwrap patch for the new SDK");
  for (const directory of [modules, join(modules, "@earendil-works"), sdk, join(sdk, "node_modules")]) {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe dependency patch directory");
  }
  for (const [name, version] of Object.entries(patches)) {
    const source = join(modules, name);
    const destination = join(sdk, "node_modules", name);
    const sourceStat = await lstat(source);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error("Unsafe patch source");
    const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    if (manifest.name !== name || manifest.version !== version) throw new Error(`Missing verified ${name}@${version}`);
    const targetStat = await lstat(destination).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
    if (targetStat?.isSymbolicLink()) throw new Error("Unsafe patch destination");
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true, dereference: false });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareSecurityDependencies();
  console.log("Verified patched Pi runtime dependencies.");
}
