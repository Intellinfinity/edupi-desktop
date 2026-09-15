import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const bundles = [
  {
    platforms: ["darwin-aarch64", "darwin-aarch64-app"],
    asset: () => "EduPi_aarch64.app.tar.gz",
    signature: () => "EduPi_aarch64.app.tar.gz.sig",
  },
  {
    platforms: ["linux-x86_64", "linux-x86_64-appimage"],
    asset: (version) => `EduPi_${version}_amd64.AppImage`,
    signature: (version) => `EduPi_${version}_amd64.AppImage.sig`,
  },
  {
    platforms: ["linux-x86_64-deb"],
    asset: (version) => `EduPi_${version}_amd64.deb`,
    signature: (version) => `EduPi_${version}_amd64.deb.sig`,
  },
  {
    platforms: ["windows-x86_64", "windows-x86_64-nsis"],
    asset: (version) => `EduPi_${version}_x64-setup.exe`,
    signature: (version) => `EduPi_${version}_x64-setup.exe.sig`,
  },
];

function assertVersion(version) {
  if (typeof version !== "string" || !/^[0-9A-Za-z.+-]{1,64}$/.test(version)) {
    throw new Error("Updater version is invalid");
  }
}

function assertRepository(repository) {
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("Release repository is invalid");
  }
}

function signatureText(value, filename) {
  const signature = typeof value === "string" ? value.trim() : "";
  if (signature.length < 100 || signature.length > 8_192 || !/^[A-Za-z0-9+/=]+$/.test(signature)) {
    throw new Error(`Updater signature is invalid: ${filename}`);
  }
  return signature;
}

export function requiredReleaseAssetNames(version) {
  assertVersion(version);
  return [
    `EduPi_${version}_aarch64.dmg`,
    ...bundles.flatMap((bundle) => [bundle.asset(version), bundle.signature(version)]),
  ];
}

export function validateReleaseAssets(version, assets) {
  if (!Array.isArray(assets)) throw new Error("Release asset index is invalid");
  const byName = new Map();
  for (const asset of assets) {
    if (!asset || typeof asset.name !== "string" || !Number.isFinite(asset.size) || asset.size <= 0) continue;
    if (byName.has(asset.name)) throw new Error(`Release asset is duplicated: ${asset.name}`);
    byName.set(asset.name, asset);
  }
  for (const name of requiredReleaseAssetNames(version)) {
    if (!byName.has(name)) throw new Error(`Release asset is missing: ${name}`);
  }
  return byName;
}

export function createUpdaterManifest({ version, repository, notes, pubDate, signatures, releaseAssets }) {
  assertVersion(version);
  assertRepository(repository);
  validateReleaseAssets(version, releaseAssets);
  if (typeof notes !== "string" || !notes.trim()) throw new Error("Release notes are empty");
  if (typeof pubDate !== "string" || !Number.isFinite(Date.parse(pubDate))) throw new Error("Publish date is invalid");
  if (!signatures || typeof signatures !== "object" || Array.isArray(signatures)) throw new Error("Updater signatures are invalid");

  const platforms = {};
  for (const bundle of bundles) {
    const asset = bundle.asset(version);
    const signatureFile = bundle.signature(version);
    const entry = {
      signature: signatureText(signatures[signatureFile], signatureFile),
      url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(asset)}`,
    };
    for (const platform of bundle.platforms) platforms[platform] = { ...entry };
  }

  return {
    version,
    notes: notes.trim(),
    pub_date: new Date(pubDate).toISOString(),
    platforms,
  };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid argument: ${key || "<missing>"}`);
    values[key.slice(2)] = value;
  }
  for (const required of ["version", "repository", "assets-dir", "assets-json", "notes-file", "output"]) {
    if (!values[required]) throw new Error(`Missing --${required}`);
  }
  return values;
}

export async function writeUpdaterManifest(argv = process.argv.slice(2)) {
  const values = parseArguments(argv);
  const version = values.version;
  const releaseAssets = JSON.parse(await readFile(values["assets-json"], "utf8"));
  const signatures = {};
  for (const bundle of bundles) {
    const filename = bundle.signature(version);
    signatures[filename] = await readFile(resolve(values["assets-dir"], filename), "utf8");
  }
  const manifest = createUpdaterManifest({
    version,
    repository: values.repository,
    notes: await readFile(values["notes-file"], "utf8"),
    pubDate: values["pub-date"] || new Date().toISOString(),
    signatures,
    releaseAssets,
  });
  await writeFile(values.output, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manifest = await writeUpdaterManifest();
  process.stdout.write(`${JSON.stringify({ version: manifest.version, platforms: Object.keys(manifest.platforms) })}\n`);
}
