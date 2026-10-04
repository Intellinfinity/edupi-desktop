/**
 * The set of `@earendil-works/*` packages this app bundles, derived from
 * package.json so it cannot drift when a pi package is added or removed.
 *
 * Deliberately NOT used for `serverExternalPackages` in next.config.ts: that
 * file is owned by agegr/pi-web upstream, which maintains its own copy of the
 * list. Deriving it here would manufacture a merge conflict on every sync.
 * See docs/ownership-boundaries.md.
 *
 * CLI:
 *   node scripts/pi-packages.mjs --install-spec 0.82.1  # npm install arguments
 *   node scripts/pi-packages.mjs --names                # bare package names
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const SCOPE = "@earendil-works/";

export function assertDesktopPiVersion(manifest, expectedVersion) {
  if (typeof expectedVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(expectedVersion)) throw new Error("Missing exact Core Pi version");
  for (const name of ["pi-ai", "pi-agent-core", "pi-coding-agent", "pi-tui"]) {
    if (manifest.dependencies?.[`${SCOPE}${name}`] !== expectedVersion) {
      throw new Error(`Desktop ${name} must match Core Pi ${expectedVersion}`);
    }
  }
}

export function assertCoreSdkAlignment({ desktopPackage, corePackage, identity, durableBuild, runtimeManifest }) {
  assertDesktopPiVersion(desktopPackage, identity?.pi);
  for (const name of ["pi-ai", "pi-coding-agent", "chord"]) {
    if (corePackage.dependencies?.[`${SCOPE}${name}`] !== identity.pi) throw new Error(`Core ${name} version is not paired`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(identity.pi_durable ?? "")
    || corePackage.dependencies?.[`${SCOPE}pi-durable`] !== identity.pi_durable
    || durableBuild?.sdk_version !== identity.pi_durable) throw new Error("Core Pi Durable version is not paired");
  const output = `scripts/vendor/pi-durable-v${identity.pi_durable}.mjs`;
  const files = [...runtimeManifest.modules, ...runtimeManifest.assets];
  if (durableBuild.output !== output || !files.some(file => file.path === output
    && file.sha256 === durableBuild.output_hash && file.size === durableBuild.size_bytes)
    || !files.some(file => file.path === `scripts/vendor/pi-durable-v${identity.pi_durable}.build.json`)) {
    throw new Error("Core Pi Durable bundle is not in the pinned runtime closure");
  }
}

/** Fully scoped package names, e.g. `@earendil-works/pi-ai`. */
export async function piPackageNames() {
  const pkg = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
  const names = Object.keys(pkg.dependencies ?? {})
    .filter((name) => name.startsWith(SCOPE))
    .sort();

  if (names.length === 0) {
    throw new Error("No @earendil-works/* dependencies found in package.json.");
  }
  return names;
}

/** Unscoped names, matching the directory layout under node_modules/@earendil-works. */
export async function piPackageDirNames() {
  return (await piPackageNames()).map((name) => name.slice(SCOPE.length));
}

async function main() {
  const [flag, version] = process.argv.slice(2);

  if (flag === "--names") {
    console.log((await piPackageNames()).join("\n"));
    return;
  }

  if (flag === "--install-spec") {
    if (!version) {
      console.error("--install-spec requires a version argument");
      process.exitCode = 2;
      return;
    }
    console.log((await piPackageNames()).map((name) => `${name}@${version}`).join(" "));
    return;
  }

  console.error("usage: node scripts/pi-packages.mjs --install-spec <version> | --names");
  process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
