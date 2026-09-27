import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { requiredReleaseAssetNames } from "./updater-manifest.mjs";

const hash = (value) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const validDigest = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const validTime = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

export function draftAssetFingerprint({ version, releaseId, assets, runStartedAt }) {
  if (!Number.isSafeInteger(releaseId) || releaseId <= 0 || !validTime(runStartedAt)) {
    throw new Error("Draft release identity is invalid");
  }
  if (!Array.isArray(assets)) throw new Error("Draft asset index is invalid");
  const expected = requiredReleaseAssetNames(version).sort();
  const actual = assets.map((asset) => asset?.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Draft asset set is incomplete or unexpected");
  const ids = new Set();
  const rows = assets.map((asset) => {
    if (!Number.isSafeInteger(asset.id) || asset.id <= 0 || ids.has(asset.id)
      || !Number.isSafeInteger(asset.size) || asset.size <= 0 || !validDigest(asset.digest)
      || !validTime(asset.created_at) || !validTime(asset.updated_at)
      || Date.parse(asset.created_at) < Date.parse(runStartedAt)
      || Date.parse(asset.updated_at) < Date.parse(asset.created_at)) {
      throw new Error(`Draft asset identity is invalid: ${asset.name}`);
    }
    ids.add(asset.id);
    return [asset.name, asset.id, asset.size, asset.digest];
  }).sort((left, right) => left[0].localeCompare(right[0], "en"));
  return hash({ version, releaseId, assets: rows });
}

export function verifyDraftReleaseProof({ version, releaseId, targetSha, draftRunId, acceptedFingerprint, run, jobs, assets }) {
  if (!Number.isSafeInteger(draftRunId) || draftRunId <= 0 || run?.id !== draftRunId
    || !/^[a-f0-9]{40}$/.test(targetSha) || run.head_sha !== targetSha
    || run.path !== ".github/workflows/release.yml" || run.event !== "workflow_dispatch"
    || run.status !== "completed" || run.conclusion !== "success"
    || !validTime(run.run_started_at) || !validTime(run.updated_at)) {
    throw new Error("Successful commit-bound draft run is required");
  }
  const expectedJobs = new Set([
    "release", "build (aarch64-apple-darwin)", "build (x86_64-unknown-linux-gnu)",
    "build (x86_64-pc-windows-msvc)", "draft-proof",
  ]);
  const successful = new Set();
  if (!Array.isArray(jobs)) throw new Error("Draft job results are invalid");
  for (const job of jobs) {
    if (!expectedJobs.has(job?.name)) continue;
    if (successful.has(job.name) || job.status !== "completed" || job.conclusion !== "success") {
      throw new Error(`Draft job did not succeed exactly once: ${job.name}`);
    }
    successful.add(job.name);
  }
  if (successful.size !== expectedJobs.size) throw new Error("All three draft builders and proof job must succeed");
  if (!validDigest(acceptedFingerprint)) throw new Error("Accepted asset fingerprint is missing");
  const actual = draftAssetFingerprint({ version, releaseId, assets, runStartedAt: run.run_started_at });
  if (actual !== acceptedFingerprint) throw new Error("Draft assets changed after installation acceptance");
  if (assets.some((asset) => Date.parse(asset.updated_at) > Date.parse(run.updated_at))) {
    throw new Error("Draft asset changed after the successful build run");
  }
  return actual;
}

function argumentsMap(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error("Invalid draft proof argument");
    values.set(argv[index].slice(2), argv[index + 1]);
  }
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operation, ...args] = process.argv.slice(2);
  const options = argumentsMap(args);
  const json = (name) => JSON.parse(readFileSync(options.get(name), "utf8"));
  const version = options.get("version");
  const releaseId = Number(options.get("release-id"));
  const assets = json("assets-json");
  if (operation === "fingerprint") {
    const run = json("run-json");
    process.stdout.write(`${draftAssetFingerprint({ version, releaseId, assets, runStartedAt: run.run_started_at })}\n`);
  } else if (operation === "verify") {
    const value = verifyDraftReleaseProof({ version, releaseId, assets,
      targetSha: options.get("target-sha"), draftRunId: Number(options.get("draft-run-id")),
      acceptedFingerprint: options.get("accepted-fingerprint"), run: json("run-json"), jobs: json("jobs-json").jobs });
    process.stdout.write(`${value}\n`);
  } else throw new Error("Unknown draft proof operation");
}
