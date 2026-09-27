import assert from "node:assert/strict";
import test from "node:test";
import { draftAssetFingerprint, verifyDraftReleaseProof } from "./release-draft-proof.mjs";
import { requiredReleaseAssetNames } from "./updater-manifest.mjs";

const version = "0.3.47";
const releaseId = 100;
const targetSha = "a".repeat(40);
const draftRunId = 200;
const createdAt = "2026-09-27T10:01:00Z";
const run = {
  id: draftRunId, head_sha: targetSha, path: ".github/workflows/release.yml",
  event: "workflow_dispatch", status: "completed", conclusion: "success",
  run_started_at: "2026-09-27T10:00:00Z", updated_at: "2026-09-27T10:05:00Z",
};
const jobs = ["release", "build (aarch64-apple-darwin)", "build (x86_64-unknown-linux-gnu)",
  "build (x86_64-pc-windows-msvc)", "draft-proof"].map((name) => ({ name, status: "completed", conclusion: "success" }));
const assets = requiredReleaseAssetNames(version).map((name, index) => ({
  name, id: index + 1, size: 100 + index, digest: `sha256:${String(index).padStart(64, "0")}`,
  created_at: createdAt, updated_at: createdAt,
}));
const acceptedFingerprint = draftAssetFingerprint({ version, releaseId, assets, runStartedAt: run.run_started_at });
const input = { version, releaseId, targetSha, draftRunId, acceptedFingerprint, run, jobs, assets };

test("a successful three-platform draft accepts only the installed asset identity", () => {
  assert.equal(verifyDraftReleaseProof(input), acceptedFingerprint);
});

test("a notarization or other platform failure cannot be published", () => {
  for (const name of ["build (aarch64-apple-darwin)", "build (x86_64-pc-windows-msvc)", "draft-proof"]) {
    const failed = jobs.map((job) => job.name === name ? { ...job, conclusion: "failure" } : job);
    assert.throws(() => verifyDraftReleaseProof({ ...input, jobs: failed }), /did not succeed/);
  }
  assert.throws(() => verifyDraftReleaseProof({ ...input, run: { ...run, conclusion: "cancelled" } }), /Successful commit-bound/);
});

test("another release, commit or later replacement cannot inherit draft acceptance", () => {
  assert.throws(() => verifyDraftReleaseProof({ ...input, releaseId: releaseId + 1 }), /changed after installation/);
  assert.throws(() => verifyDraftReleaseProof({ ...input, targetSha: "b".repeat(40) }), /Successful commit-bound/);
  const replaced = assets.map((asset, index) => index === 0 ? { ...asset, id: 99 } : asset);
  assert.throws(() => verifyDraftReleaseProof({ ...input, assets: replaced }), /changed after installation/);
  const later = assets.map((asset, index) => index === 0 ? { ...asset, updated_at: "2026-09-27T10:06:00Z" } : asset);
  assert.throws(() => verifyDraftReleaseProof({ ...input, assets: later }), /changed after the successful build/);
});

test("draft proof rejects incomplete, duplicated and undigested assets", () => {
  assert.throws(() => draftAssetFingerprint({ version, releaseId, runStartedAt: run.run_started_at,
    assets: assets.slice(1) }), /incomplete/);
  assert.throws(() => draftAssetFingerprint({ version, releaseId, runStartedAt: run.run_started_at,
    assets: assets.map((asset, index) => index === 1 ? { ...asset, id: 1 } : asset) }), /identity is invalid/);
  assert.throws(() => draftAssetFingerprint({ version, releaseId, runStartedAt: run.run_started_at,
    assets: assets.map((asset, index) => index === 1 ? { ...asset, digest: null } : asset) }), /identity is invalid/);
  assert.throws(() => draftAssetFingerprint({ version, releaseId, runStartedAt: run.run_started_at,
    assets: assets.map((asset, index) => index === 1 ? { ...asset, created_at: "2026-09-27T09:59:59Z" } : asset) }), /identity is invalid/);
});
