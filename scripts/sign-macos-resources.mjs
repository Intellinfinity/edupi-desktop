import { execFileSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const identity = process.env.APPLE_SIGNING_IDENTITY?.trim();
const keychain = process.env.EDUPI_RESOURCE_KEYCHAIN_PATH?.trim();
const root = process.argv[2] ?? "src-tauri/resources";

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

function sign(path, deep = false) {
  const args = ["--force", "--timestamp", "--options", "runtime", "--keychain", keychain];
  if (deep) args.push("--deep");
  args.push("--sign", identity, path);
  execFileSync("codesign", args, { stdio: "inherit" });
}

// Apple requires nested code to be signed before the containing app bundle.
for (const path of nativeFiles.sort((a, b) => b.length - a.length)) sign(path);
for (const path of appBundles.sort((a, b) => b.length - a.length)) sign(path, true);

console.log(`Signed ${nativeFiles.length} native resource(s) and ${appBundles.length} helper app bundle(s).`);
