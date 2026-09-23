import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const identity = process.env.APPLE_SIGNING_IDENTITY?.trim();
const keychain = process.env.EDUPI_RESOURCE_KEYCHAIN_PATH?.trim();
const root = process.argv[2] ?? "src-tauri/resources";
const helperName = "Pi Agent Server.app";
const helperEntitlements = fileURLToPath(new URL("../src-tauri/entitlements/node-helper.plist", import.meta.url));

if (!identity) throw new Error("APPLE_SIGNING_IDENTITY is required");
if (!keychain) throw new Error("EDUPI_RESOURCE_KEYCHAIN_PATH is required");

const nativeFiles = [];
const appBundles = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (entry.name.endsWith(".app")) appBundles.push(path);
      await walk(path);
      continue;
    }

    const description = execFileSync("file", ["-b", path], { encoding: "utf8" });
    if (/Mach-O/.test(description)) nativeFiles.push(path);
  }
}

await walk(root);

function sign(path, { deep = false, entitlements } = {}) {
  const args = ["--force", "--timestamp", "--options", "runtime", "--keychain", keychain];
  if (deep) args.push("--deep");
  if (entitlements) args.push("--entitlements", entitlements);
  args.push("--sign", identity, path);
  execFileSync("codesign", args, { stdio: "inherit" });
}

// Apple requires nested code to be signed before the containing app bundle.
for (const path of nativeFiles.sort((a, b) => b.length - a.length)) sign(path);
const helpers = appBundles.filter((path) => basename(path) === helperName);
if (helpers.length !== 1) throw new Error(`Expected one ${helperName}, found ${helpers.length}`);
for (const path of appBundles.sort((a, b) => b.length - a.length)) {
  sign(path, { deep: true, entitlements: path === helpers[0] ? helperEntitlements : undefined });
}

const helperNode = join(helpers[0], "Contents", "MacOS", "node");
const smoke = execFileSync(helperNode, ["-e", "process.stdout.write('EDUPI_NODE_JIT_READY')"], {
  encoding: "utf8",
  timeout: 10_000,
});
if (smoke !== "EDUPI_NODE_JIT_READY") throw new Error("Signed Node helper failed its V8 smoke check");

console.log(`Signed ${nativeFiles.length} native resource(s) and ${appBundles.length} helper app bundle(s).`);
