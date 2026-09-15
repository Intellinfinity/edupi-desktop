import assert from "node:assert/strict";
import test from "node:test";
import {
  createUpdaterManifest,
  requiredReleaseAssetNames,
  validateReleaseAssets,
} from "./updater-manifest.mjs";

const version = "0.3.16";
const releaseAssets = requiredReleaseAssetNames(version).map((name) => ({ name, size: 128 }));
const signatures = Object.fromEntries(
  releaseAssets.filter((asset) => asset.name.endsWith(".sig")).map((asset, index) => [asset.name, String.fromCharCode(65 + index).repeat(404)]),
);

test("builds one signed updater manifest from all platform assets", () => {
  const manifest = createUpdaterManifest({
    version,
    repository: "PIGU-PPPgu/edupi-desktop",
    notes: "Signed release",
    pubDate: "2026-09-15T20:16:50.063Z",
    signatures,
    releaseAssets,
  });

  assert.equal(manifest.version, version);
  assert.equal(manifest.pub_date, "2026-09-15T20:16:50.063Z");
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [
    "darwin-aarch64",
    "darwin-aarch64-app",
    "linux-x86_64",
    "linux-x86_64-appimage",
    "linux-x86_64-deb",
    "windows-x86_64",
    "windows-x86_64-nsis",
  ]);
  assert.deepEqual(manifest.platforms["darwin-aarch64"], manifest.platforms["darwin-aarch64-app"]);
  assert.deepEqual(manifest.platforms["linux-x86_64"], manifest.platforms["linux-x86_64-appimage"]);
  assert.deepEqual(manifest.platforms["windows-x86_64"], manifest.platforms["windows-x86_64-nsis"]);
  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    assert.match(entry.url, /^https:\/\/github\.com\/PIGU-PPPgu\/edupi-desktop\/releases\/download\/v0\.3\.16\/EduPi_/);
    assert.ok(entry.signature.length >= 404, `${platform} has a signature`);
  }
});

test("refuses to publish when an installer is missing or duplicated", () => {
  assert.throws(
    () => validateReleaseAssets(version, releaseAssets.filter((asset) => !asset.name.endsWith("x64-setup.exe"))),
    /Release asset is missing: EduPi_0\.3\.16_x64-setup\.exe/,
  );
  assert.throws(
    () => validateReleaseAssets(version, [...releaseAssets, releaseAssets[0]]),
    /Release asset is duplicated/,
  );
});

test("refuses a missing updater signature", () => {
  const missing = { ...signatures };
  delete missing["EduPi_aarch64.app.tar.gz.sig"];
  assert.throws(
    () => createUpdaterManifest({
      version,
      repository: "PIGU-PPPgu/edupi-desktop",
      notes: "Signed release",
      pubDate: "2026-09-15T20:16:50.063Z",
      signatures: missing,
      releaseAssets,
    }),
    /Updater signature is invalid: EduPi_aarch64\.app\.tar\.gz\.sig/,
  );
});
