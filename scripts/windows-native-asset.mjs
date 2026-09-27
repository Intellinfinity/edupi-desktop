import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const WINDOWS_NATIVE_ASSET_PATH = "native/windows-runtime-attestation/approved/windows_runtime_attestation.node";
export const WINDOWS_NATIVE_CONTRACT_PATH = "contracts/windows-runtime-attestation-v1.json";
const CONTRACT_KEYS = [
  "architecture", "binary_relative_path", "binary_sha256", "binary_size",
  "binary_source_commit", "node_major", "platform", "release_asset_id", "status", "version",
].sort();
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;

function validateApprovedWindowsNativeContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(CONTRACT_KEYS)
    || value.version !== 1 || value.status !== "approved"
    || value.platform !== "win32" || value.architecture !== "x64" || value.node_major !== 22
    || value.binary_relative_path !== WINDOWS_NATIVE_ASSET_PATH
    || !SHA256.test(value.binary_sha256) || !Number.isSafeInteger(value.binary_size) || value.binary_size <= 0
    || !COMMIT.test(value.binary_source_commit)
    || !Number.isSafeInteger(value.release_asset_id) || value.release_asset_id <= 0) {
    throw new Error("Windows native asset contract is not approved");
  }
  return value;
}

function verifyWindowsNativeAssetBytes(contract, bytes) {
  validateApprovedWindowsNativeContract(contract);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== contract.binary_size) {
    throw new Error("Windows native asset size does not match Core approval");
  }
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== contract.binary_sha256) throw new Error("Windows native asset SHA-256 does not match Core approval");
  return digest;
}

function assertWindowsNativeSourceAncestor(coreRoot, contract, coreCommit) {
  validateApprovedWindowsNativeContract(contract);
  if (!COMMIT.test(coreCommit)) throw new Error("Pinned Core commit is invalid");
  const git = (args) => execFileSync("git", ["-C", coreRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  let head;
  try { head = git(["rev-parse", "HEAD"]); }
  catch { throw new Error("Pinned Core Git history is unavailable"); }
  if (head !== coreCommit) throw new Error("Pinned Core checkout does not match the compatibility commit");
  try { git(["cat-file", "-e", `${contract.binary_source_commit}^{commit}`]); }
  catch { throw new Error("Approved native source commit is unavailable in Core history"); }
  try { git(["merge-base", "--is-ancestor", contract.binary_source_commit, coreCommit]); }
  catch { throw new Error("Approved native source is not a verified ancestor of the Core pin"); }
  return true;
}

/** The only build-time entry point: never accept a caller-supplied approval object. */
export function verifyPinnedWindowsNativeAsset({ coreRoot, coreCommit, rawAssetBytes }) {
  if (typeof coreRoot !== "string" || !path.isAbsolute(coreRoot) || !COMMIT.test(coreCommit)) {
    throw new Error("Pinned Core root or commit is invalid");
  }
  const root = fs.realpathSync(coreRoot);
  const contractsDir = path.join(root, "contracts");
  const contractPath = path.join(root, WINDOWS_NATIVE_CONTRACT_PATH);
  const directory = fs.lstatSync(contractsDir);
  const file = fs.lstatSync(contractPath);
  if (!directory.isDirectory() || directory.isSymbolicLink() || !file.isFile() || file.isSymbolicLink()) {
    throw new Error("Pinned Windows native contract is not a regular Core file");
  }
  const actualBytes = fs.readFileSync(contractPath);
  let committedBytes;
  try {
    committedBytes = execFileSync("git", ["-C", root, "show", `${coreCommit}:${WINDOWS_NATIVE_CONTRACT_PATH}`],
      { stdio: ["ignore", "pipe", "pipe"] });
  } catch { throw new Error("Pinned Windows native contract is absent from Core Git history"); }
  if (!actualBytes.equals(committedBytes)) throw new Error("Windows native contract differs from the pinned Core commit");
  let contract;
  try { contract = JSON.parse(actualBytes.toString("utf8")); }
  catch { throw new Error("Pinned Windows native contract is invalid JSON"); }
  validateApprovedWindowsNativeContract(contract);
  assertWindowsNativeSourceAncestor(root, contract, coreCommit);
  const digest = verifyWindowsNativeAssetBytes(contract, rawAssetBytes);
  return Object.freeze({ releaseAssetId: contract.release_asset_id, digest,
    size: contract.binary_size, sourceCommit: contract.binary_source_commit,
    relativePath: WINDOWS_NATIVE_ASSET_PATH });
}
