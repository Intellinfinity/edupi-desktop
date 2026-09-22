import assert from "node:assert/strict";
import test from "node:test";

import {
  GitHubApiError,
  releaseAssetBackupName,
  releaseAssetUploadUrl,
  replaceReleaseAsset,
} from "./replace-release-asset.mjs";

const repository = "Intellinfinity/edupi-desktop";
const releaseId = 731;
const tag = "v0.3.32";
const expectedTarget = "a".repeat(40);
const assetName = "EduPi_0.3.32_aarch64.dmg";
const originalAsset = { id: 11, name: assetName, size: 3, digest: "sha256:old" };
const replacement = Buffer.from("notarized-dmg");

class FakeReleaseClient {
  constructor() {
    this.release = { id: releaseId, tag_name: tag, draft: true, target_commitish: expectedTarget };
    this.releases = [this.release];
    this.assets = [structuredClone(originalAsset)];
    this.calls = [];
    this.nextId = 12;
    this.downloadOverride = null;
    this.uploadError = null;
    this.deleteErrorAfterDeleteId = null;
    this.deleteErrorWithoutDeleteId = null;
  }

  async getRelease(id) {
    this.calls.push(["getRelease", id]);
    return structuredClone(this.release);
  }

  async listReleases() {
    this.calls.push(["listReleases"]);
    return structuredClone(this.releases);
  }

  async listAssets(id) {
    this.calls.push(["listAssets", id]);
    return structuredClone(this.assets);
  }

  async renameAsset(id, name) {
    this.calls.push(["renameAsset", id, name]);
    const asset = this.assets.find((candidate) => candidate.id === id);
    if (!asset) throw new Error(`missing asset ${id}`);
    asset.name = name;
    return structuredClone(asset);
  }

  async deleteAsset(id) {
    this.calls.push(["deleteAsset", id]);
    if (this.deleteErrorWithoutDeleteId === id) throw new Error("delete unavailable");
    const existed = this.assets.some((candidate) => candidate.id === id);
    this.assets = this.assets.filter((candidate) => candidate.id !== id);
    if (this.deleteErrorAfterDeleteId === id) {
      this.deleteErrorAfterDeleteId = null;
      throw new Error("connection closed after delete");
    }
    if (!existed) throw new GitHubApiError(404, "asset not found");
  }

  async uploadAsset(id, name, bytes) {
    this.calls.push(["uploadAsset", id, name]);
    if (this.uploadError) throw this.uploadError;
    const digest = `sha256:${await crypto.subtle.digest("SHA-256", bytes).then((value) => Buffer.from(value).toString("hex"))}`;
    const asset = { id: this.nextId, name, size: bytes.length, digest };
    this.assets.push(asset);
    this.uploadedBytes = Buffer.from(bytes);
    return structuredClone(asset);
  }

  async downloadAsset(id) {
    this.calls.push(["downloadAsset", id]);
    return this.downloadOverride ?? Buffer.from(this.uploadedBytes);
  }
}

function options(client) {
  return {
    client,
    releaseId,
    tag,
    expectedTarget,
    assetName,
    assetBytes: replacement,
    log: () => {},
  };
}

test("uses the exact release ID upload endpoint", () => {
  assert.equal(
    releaseAssetUploadUrl(repository, releaseId, assetName),
    `https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=EduPi_0.3.32_aarch64.dmg`,
  );
  assert.equal(
    releaseAssetBackupName(assetName, releaseId, originalAsset.id),
    `${assetName}.edupi-backup-${releaseId}-${originalAsset.id}`,
  );
});

test("replaces a draft asset only after size and SHA-256 verification", async () => {
  const client = new FakeReleaseClient();
  const result = await replaceReleaseAsset(options(client));

  assert.equal(result.assetId, 12);
  assert.equal(result.size, replacement.length);
  assert.deepEqual(client.assets.map(({ id, name }) => ({ id, name })), [{ id: 12, name: assetName }]);
  const renameAt = client.calls.findIndex(([operation]) => operation === "renameAsset");
  const uploadAt = client.calls.findIndex(([operation]) => operation === "uploadAsset");
  const downloadAt = client.calls.findIndex(([operation]) => operation === "downloadAsset");
  const deleteAt = client.calls.findIndex(([operation, id]) => operation === "deleteAsset" && id === originalAsset.id);
  assert.ok(renameAt < uploadAt && uploadAt < downloadAt && downloadAt < deleteAt);
});

test("restores the previous asset when upload fails", async () => {
  const client = new FakeReleaseClient();
  client.uploadError = new Error("upload unavailable");

  await assert.rejects(
    replaceReleaseAsset(options(client)),
    /previous asset was restored and release 731 remains draft/,
  );
  assert.deepEqual(client.assets, [originalAsset]);
  assert.equal(client.release.draft, true);
});

test("removes a corrupt upload and restores the previous asset", async () => {
  const client = new FakeReleaseClient();
  client.downloadOverride = Buffer.from("corrupt");

  await assert.rejects(
    replaceReleaseAsset(options(client)),
    /previous asset was restored and release 731 remains draft/,
  );
  assert.deepEqual(client.assets, [originalAsset]);
  assert.ok(client.calls.some(([operation, id]) => operation === "deleteAsset" && id === 12));
});

test("accepts the verified replacement when the backup delete response is lost", async () => {
  const client = new FakeReleaseClient();
  client.deleteErrorAfterDeleteId = originalAsset.id;

  const result = await replaceReleaseAsset(options(client));

  assert.equal(result.assetId, 12);
  assert.deepEqual(client.assets.map(({ id, name }) => ({ id, name })), [{ id: 12, name: assetName }]);
  const firstDeleteAt = client.calls.findIndex(
    ([operation, id]) => operation === "deleteAsset" && id === originalAsset.id,
  );
  assert.ok(
    !client.calls.slice(firstDeleteAt + 1).some(([operation]) => operation === "listAssets"),
    "a stale asset listing must not trigger rollback after commit begins",
  );
});

test("keeps the verified replacement and draft recovery asset when backup cleanup is unavailable", async () => {
  const client = new FakeReleaseClient();
  client.deleteErrorWithoutDeleteId = originalAsset.id;

  await assert.rejects(
    replaceReleaseAsset(options(client)),
    /Verified EduPi_0\.3\.32_aarch64\.dmg was preserved, but backup cleanup is inconclusive/,
  );
  assert.deepEqual(
    client.assets.map(({ id, name }) => ({ id, name })),
    [
      { id: originalAsset.id, name: releaseAssetBackupName(assetName, releaseId, originalAsset.id) },
      { id: 12, name: assetName },
    ],
  );
});

test("rejects a published, retargeted, duplicate, or mismatched release before mutation", async (t) => {
  const cases = [
    ["published", (client) => { client.release.draft = false; }, /no longer a draft/],
    ["retargeted", (client) => { client.release.target_commitish = "b".repeat(40); }, /targets/],
    ["duplicate tag", (client) => { client.releases.push({ ...client.release, id: 999 }); }, /Expected one release/],
    ["different ID", (client) => { client.release.id = 999; }, /Release ID changed/],
  ];

  for (const [name, mutate, pattern] of cases) {
    await t.test(name, async () => {
      const client = new FakeReleaseClient();
      mutate(client);
      await assert.rejects(replaceReleaseAsset(options(client)), pattern);
      assert.deepEqual(client.assets, [originalAsset]);
      assert.ok(!client.calls.some(([operation]) => ["renameAsset", "uploadAsset", "deleteAsset"].includes(operation)));
    });
  }
});

test("repairs an interrupted backup before starting a fresh replacement", async () => {
  const client = new FakeReleaseClient();
  client.assets[0].name = releaseAssetBackupName(assetName, releaseId, originalAsset.id);

  await replaceReleaseAsset(options(client));

  assert.deepEqual(client.assets.map(({ id, name }) => ({ id, name })), [{ id: 12, name: assetName }]);
  const recoverAt = client.calls.findIndex(
    ([operation, id, name]) => operation === "renameAsset" && id === originalAsset.id && name === assetName,
  );
  const reserveAt = client.calls.findIndex(
    ([operation, id, name]) => operation === "renameAsset" && id === originalAsset.id && name !== assetName,
  );
  assert.ok(recoverAt >= 0 && recoverAt < reserveAt);
});
