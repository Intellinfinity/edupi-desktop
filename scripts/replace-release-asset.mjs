import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

const API_ROOT = "https://api.github.com";
const UPLOAD_ROOT = "https://uploads.github.com";
const API_VERSION = "2022-11-28";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function releaseAssetUploadUrl(repository, releaseId, assetName) {
  invariant(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), "Release repository is invalid");
  invariant(Number.isSafeInteger(releaseId) && releaseId > 0, "Release ID must be a positive integer");
  invariant(assetName && basename(assetName) === assetName, "Release asset name must be a basename");
  return `${UPLOAD_ROOT}/repos/${repository}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`;
}

export function releaseAssetBackupName(assetName, releaseId, assetId) {
  invariant(Number.isSafeInteger(assetId) && assetId > 0, "Release asset ID must be a positive integer");
  return `${assetName}.edupi-backup-${releaseId}-${assetId}`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeResponseMessage(status, body) {
  const compact = body.replace(/\s+/g, " ").trim().slice(0, 400);
  return compact ? `GitHub API ${status}: ${compact}` : `GitHub API ${status}`;
}

export class GitHubApiError extends Error {
  constructor(status, body) {
    super(safeResponseMessage(status, body));
    this.name = "GitHubApiError";
    this.status = status;
  }
}

export class GitHubReleaseClient {
  constructor({ repository, token, fetchImpl = fetch }) {
    invariant(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), "Release repository is invalid");
    invariant(typeof token === "string" && token.length > 0, "GH_TOKEN is required");
    this.repository = repository;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async request(url, { method = "GET", headers = {}, body, json = true } = {}) {
    const response = await this.fetchImpl(url, {
      method,
      redirect: "follow",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "User-Agent": "edupi-release-asset-transaction",
        "X-GitHub-Api-Version": API_VERSION,
        ...headers,
      },
      body,
    });
    if (!response.ok) {
      throw new GitHubApiError(response.status, await response.text());
    }
    if (!json) return Buffer.from(await response.arrayBuffer());
    if (response.status === 204) return null;
    return response.json();
  }

  getRelease(releaseId) {
    return this.request(`${API_ROOT}/repos/${this.repository}/releases/${releaseId}`);
  }

  async listReleases() {
    const releases = [];
    for (let page = 1; page <= 100; page += 1) {
      const batch = await this.request(
        `${API_ROOT}/repos/${this.repository}/releases?per_page=100&page=${page}`,
      );
      invariant(Array.isArray(batch), "GitHub releases response is invalid");
      releases.push(...batch);
      if (batch.length < 100) return releases;
    }
    throw new Error("GitHub release pagination exceeded 100 pages");
  }

  async listAssets(releaseId) {
    const assets = [];
    for (let page = 1; page <= 100; page += 1) {
      const batch = await this.request(
        `${API_ROOT}/repos/${this.repository}/releases/${releaseId}/assets?per_page=100&page=${page}`,
      );
      invariant(Array.isArray(batch), "GitHub release assets response is invalid");
      assets.push(...batch);
      if (batch.length < 100) return assets;
    }
    throw new Error("GitHub release asset pagination exceeded 100 pages");
  }

  renameAsset(assetId, name) {
    return this.request(`${API_ROOT}/repos/${this.repository}/releases/assets/${assetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  deleteAsset(assetId) {
    return this.request(`${API_ROOT}/repos/${this.repository}/releases/assets/${assetId}`, {
      method: "DELETE",
    });
  }

  uploadAsset(releaseId, name, bytes) {
    return this.request(releaseAssetUploadUrl(this.repository, releaseId, name), {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.length),
      },
      body: bytes,
    });
  }

  downloadAsset(assetId) {
    return this.request(`${API_ROOT}/repos/${this.repository}/releases/assets/${assetId}`, {
      headers: { Accept: "application/octet-stream" },
      json: false,
    });
  }
}

async function assertReleaseIdentity(client, { releaseId, tag, expectedTarget }) {
  const [release, releases] = await Promise.all([
    client.getRelease(releaseId),
    client.listReleases(),
  ]);
  invariant(release?.id === releaseId, `Release ID changed: expected ${releaseId}`);
  invariant(release.tag_name === tag, `Release ${releaseId} tag is ${release.tag_name}, expected ${tag}`);
  invariant(release.draft === true, `Release ${releaseId} is no longer a draft`);
  invariant(
    release.target_commitish === expectedTarget,
    `Release ${releaseId} targets ${release.target_commitish}, expected ${expectedTarget}`,
  );
  const sameTag = releases.filter((candidate) => candidate.tag_name === tag);
  invariant(sameTag.length === 1, `Expected one release for ${tag}, found ${sameTag.length}`);
  invariant(sameTag[0].id === releaseId, `Tag ${tag} no longer belongs to release ${releaseId}`);
  return release;
}

function assetsNamed(assets, name) {
  return assets.filter((asset) => asset.name === name);
}

function backupAssetsFor(assets, name, releaseId) {
  const prefix = `${name}.edupi-backup-${releaseId}-`;
  return assets.filter((asset) => asset.name.startsWith(prefix));
}

async function restoreInterruptedReplacement(client, identity, assetName, log) {
  let assets = await client.listAssets(identity.releaseId);
  const exact = assetsNamed(assets, assetName);
  const backups = backupAssetsFor(assets, assetName, identity.releaseId);
  invariant(exact.length <= 1, `Expected at most one release asset named ${assetName}, found ${exact.length}`);
  invariant(backups.length <= 1, `Expected at most one backup for ${assetName}, found ${backups.length}`);

  if (backups.length === 0) return assets;

  await assertReleaseIdentity(client, identity);
  for (const asset of exact) await client.deleteAsset(asset.id);
  await client.renameAsset(backups[0].id, assetName);
  log(`Recovered interrupted replacement for ${assetName}`);

  assets = await client.listAssets(identity.releaseId);
  const restored = assetsNamed(assets, assetName);
  invariant(restored.length === 1 && restored[0].id === backups[0].id, `Could not restore ${assetName}`);
  invariant(backupAssetsFor(assets, assetName, identity.releaseId).length === 0, `Backup for ${assetName} remains after recovery`);
  return assets;
}

async function rollBackReplacement(client, identity, assetName, backupAssetId, verifiedAssetId) {
  await assertReleaseIdentity(client, identity);
  const assets = await client.listAssets(identity.releaseId);
  const backup = assets.find((asset) => asset.id === backupAssetId);
  if (!backup) {
    const exact = assetsNamed(assets, assetName);
    if (verifiedAssetId && exact.length === 1 && exact[0].id === verifiedAssetId) {
      await assertReleaseIdentity(client, identity);
      return "committed";
    }
    throw new Error(`Rollback backup ${backupAssetId} is missing`);
  }

  for (const asset of assetsNamed(assets, assetName)) {
    if (asset.id !== backupAssetId) await client.deleteAsset(asset.id);
  }
  if (backup.name !== assetName) await client.renameAsset(backupAssetId, assetName);

  const restoredAssets = await client.listAssets(identity.releaseId);
  const restored = assetsNamed(restoredAssets, assetName);
  invariant(restored.length === 1 && restored[0].id === backupAssetId, `Rollback could not restore ${assetName}`);
  invariant(
    backupAssetsFor(restoredAssets, assetName, identity.releaseId).length === 0,
    `Rollback left a backup asset for ${assetName}`,
  );
  await assertReleaseIdentity(client, identity);
  return "restored";
}

async function commitReplacement(client, backupAssetId) {
  try {
    await client.deleteAsset(backupAssetId);
  } catch (firstError) {
    try {
      await client.deleteAsset(backupAssetId);
    } catch (retryError) {
      if (retryError?.status === 404) return;
      throw new AggregateError(
        [firstError, retryError],
        `Verified replacement is committed, but backup ${backupAssetId} cleanup is inconclusive`,
      );
    }
  }
}

export async function replaceReleaseAsset({
  client,
  releaseId,
  tag,
  expectedTarget,
  assetName,
  assetBytes,
  log = console.log,
}) {
  invariant(Number.isSafeInteger(releaseId) && releaseId > 0, "Release ID must be a positive integer");
  invariant(typeof tag === "string" && tag.length > 0, "Release tag is required");
  invariant(typeof expectedTarget === "string" && expectedTarget.length > 0, "Expected release target is required");
  invariant(assetName && basename(assetName) === assetName, "Release asset name must be a basename");
  invariant(Buffer.isBuffer(assetBytes) && assetBytes.length > 0, "Replacement asset must not be empty");

  const identity = { releaseId, tag, expectedTarget };
  await assertReleaseIdentity(client, identity);
  const assets = await restoreInterruptedReplacement(client, identity, assetName, log);
  const original = assetsNamed(assets, assetName);
  invariant(original.length === 1, `Expected one release asset named ${assetName}, found ${original.length}`);

  const localHash = sha256(assetBytes);
  const localDigest = `sha256:${localHash}`;
  const backupName = releaseAssetBackupName(assetName, releaseId, original[0].id);
  let backupAssetId = null;
  let verifiedAssetId = null;
  let commitStarted = false;

  try {
    await assertReleaseIdentity(client, identity);
    const renamed = await client.renameAsset(original[0].id, backupName);
    invariant(renamed?.id === original[0].id && renamed.name === backupName, `Could not reserve ${assetName}`);
    backupAssetId = original[0].id;

    await assertReleaseIdentity(client, identity);
    const uploaded = await client.uploadAsset(releaseId, assetName, assetBytes);
    invariant(Number.isSafeInteger(uploaded?.id) && uploaded.id > 0, "GitHub did not return an uploaded asset ID");
    invariant(uploaded.name === assetName, `Uploaded asset name is ${uploaded.name}, expected ${assetName}`);
    invariant(uploaded.size === assetBytes.length, `Uploaded asset size is ${uploaded.size}, expected ${assetBytes.length}`);
    if (uploaded.digest) invariant(uploaded.digest === localDigest, `Uploaded asset digest is ${uploaded.digest}, expected ${localDigest}`);

    const remoteBytes = await client.downloadAsset(uploaded.id);
    invariant(remoteBytes.length === assetBytes.length, `Downloaded asset size is ${remoteBytes.length}, expected ${assetBytes.length}`);
    invariant(sha256(remoteBytes) === localHash, `Downloaded asset SHA-256 does not match ${localHash}`);
    verifiedAssetId = uploaded.id;

    await assertReleaseIdentity(client, identity);
    const remoteAssets = await client.listAssets(releaseId);
    const exact = assetsNamed(remoteAssets, assetName);
    invariant(exact.length === 1 && exact[0].id === uploaded.id, `Release does not contain the verified ${assetName}`);
    const backup = remoteAssets.find((asset) => asset.id === backupAssetId);
    invariant(backup?.name === backupName, `Release backup for ${assetName} disappeared before commit`);
    commitStarted = true;
    await commitReplacement(client, backupAssetId);
    log(`Replaced ${assetName} on draft release ${releaseId}; sha256:${localHash}`);
    return { assetId: uploaded.id, sha256: localHash, size: assetBytes.length };
  } catch (error) {
    if (backupAssetId === null) throw error;
    if (commitStarted) {
      throw new Error(
        `Verified ${assetName} was preserved, but backup cleanup is inconclusive; release ${releaseId} must remain draft`,
        { cause: error },
      );
    }
    try {
      const outcome = await rollBackReplacement(client, identity, assetName, backupAssetId, verifiedAssetId);
      if (outcome === "committed") {
        log(`Replaced ${assetName} on draft release ${releaseId}; sha256:${localHash}`);
        return { assetId: verifiedAssetId, sha256: localHash, size: assetBytes.length };
      }
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Replacement of ${assetName} failed and rollback did not complete; release ${releaseId} must remain draft`,
      );
    }
    throw new Error(`Replacement of ${assetName} failed; the previous asset was restored and release ${releaseId} remains draft`, {
      cause: error,
    });
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    invariant(flag?.startsWith("--") && value, `Invalid argument near ${flag ?? "end of command"}`);
    values[flag.slice(2)] = value;
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const releaseId = Number(args["release-id"]);
  const assetPath = args.asset;
  invariant(assetPath, "--asset is required");
  const fileStat = await stat(assetPath);
  invariant(fileStat.isFile() && fileStat.size > 0, "Replacement asset must be a non-empty file");
  const assetBytes = await readFile(assetPath);
  const client = new GitHubReleaseClient({
    repository: args.repository,
    token: process.env.GH_TOKEN,
  });
  await replaceReleaseAsset({
    client,
    releaseId,
    tag: args.tag,
    expectedTarget: args.target,
    assetName: basename(assetPath),
    assetBytes,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}
