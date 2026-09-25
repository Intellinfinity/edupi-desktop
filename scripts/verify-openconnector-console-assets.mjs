import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultRoot = join(projectRoot, "desktop", "open-connector-console-assets");
const expectedCommit = "c6f55b58f98bae95c14d0848eb612dfa09b80291";
const assetName = /^(?:index\.html|LICENSE\.txt|NOTICE\.md|UPSTREAM\.md|edupi-console\.patch|assets\/[A-Za-z0-9_.-]+\.(?:js|css))$/u;

function equalNames(actual, expected) {
  return actual.sort().join("\n") === expected.sort().join("\n");
}

export async function verifyConsoleAssets(root = defaultRoot) {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.upstream?.repository !== "oomol-lab/open-connector"
    || manifest.upstream.tag !== "v1.6.5" || manifest.upstream.commit !== expectedCommit
    || !/^[a-f0-9]{64}$/u.test(manifest.upstream.archiveSha256)
    || !manifest.assets || typeof manifest.assets !== "object" || Array.isArray(manifest.assets)) {
    throw new Error("console_manifest_invalid");
  }
  const names = Object.keys(manifest.assets);
  if (names.length !== 9 || names.some((name) => !assetName.test(name))
    || !equalNames((await readdir(root)).filter((name) => name !== "assets"), names.filter((name) => !name.startsWith("assets/")).concat("manifest.json"))
    || !equalNames(await readdir(join(root, "assets")), names.filter((name) => name.startsWith("assets/")).map((name) => name.slice(7)))) {
    throw new Error("console_assets_unexpected");
  }
  for (const name of names) {
    const file = join(root, name);
    if (!(await lstat(file)).isFile() || !/^[a-f0-9]{64}$/u.test(manifest.assets[name])) throw new Error("console_asset_invalid");
    const digest = createHash("sha256").update(await readFile(file)).digest("hex");
    if (digest !== manifest.assets[name]) throw new Error("console_asset_drift");
  }
  const html = await readFile(join(root, "index.html"), "utf8");
  const refs = [...html.matchAll(/(?:src|href)="\/(assets\/[A-Za-z0-9_.-]+\.(?:js|css))"/gu)].map((match) => match[1]);
  if (refs.length !== 4 || !equalNames(refs, names.filter((name) => name.startsWith("assets/")))
    || /(?:src|href)="https?:\/\//u.test(html)) throw new Error("console_html_invalid");
  return { version: manifest.upstream.tag.slice(1), assets: names.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(JSON.stringify({ status: "passed", ...(await verifyConsoleAssets()) }));
}
