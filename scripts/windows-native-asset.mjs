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
const MAX_BINARY_SIZE = 8 * 1024 * 1024;

function validateApprovedWindowsNativeContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(CONTRACT_KEYS)
    || value.version !== 1 || value.status !== "approved"
    || value.platform !== "win32" || value.architecture !== "x64" || value.node_major !== 22
    || value.binary_relative_path !== WINDOWS_NATIVE_ASSET_PATH
    || !SHA256.test(value.binary_sha256) || !Number.isSafeInteger(value.binary_size)
    || value.binary_size <= 0 || value.binary_size > MAX_BINARY_SIZE
    || !COMMIT.test(value.binary_source_commit)
    || !Number.isSafeInteger(value.release_asset_id) || value.release_asset_id <= 0) {
    throw new Error("Windows native asset contract is not approved");
  }
  return value;
}

function isPendingWindowsNativeContract(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(CONTRACT_KEYS)
    && value.version === 1 && value.status === "pending" && value.platform === "win32"
    && value.architecture === "x64" && value.node_major === 22
    && value.binary_relative_path === WINDOWS_NATIVE_ASSET_PATH
    && value.binary_sha256 === null && value.binary_size === null
    && value.binary_source_commit === null && value.release_asset_id === null;
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

function readCommittedWindowsNativeContract(coreRoot, coreCommit) {
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
  return { root, contract };
}

function readPinnedWindowsNativeContract(coreRoot, coreCommit) {
  const { root, contract } = readCommittedWindowsNativeContract(coreRoot, coreCommit);
  validateApprovedWindowsNativeContract(contract);
  assertWindowsNativeSourceAncestor(root, contract, coreCommit);
  return { root, contract };
}

/** Never accept a caller-supplied approval object. */
export function verifyPinnedWindowsNativeAsset({ coreRoot, coreCommit, rawAssetBytes }) {
  const { contract } = readPinnedWindowsNativeContract(coreRoot, coreCommit);
  const digest = verifyWindowsNativeAssetBytes(contract, rawAssetBytes);
  return Object.freeze({ releaseAssetId: contract.release_asset_id, digest,
    size: contract.binary_size, sourceCommit: contract.binary_source_commit,
    relativePath: WINDOWS_NATIVE_ASSET_PATH });
}

function downloadApprovedAsset(assetId, token, maxBuffer) {
  try {
    return execFileSync("gh", ["api", "-H", "Accept: application/octet-stream",
      `repos/PIGU-PPPgu/edupi/releases/assets/${assetId}`], {
      env: { ...process.env, GH_TOKEN: token }, stdio: ["ignore", "pipe", "pipe"], maxBuffer,
    });
  } catch {
    throw new Error("Core private native asset download failed");
  }
}

/** Stages only the exact Core-approved bytes into a fresh packaged Core root. */
export function stagePinnedWindowsNativeAsset({ coreRoot, coreCommit, destinationRoot,
  token = process.env.EDUPI_CORE_READ_TOKEN, downloadAsset = null }) {
  const { contract } = readPinnedWindowsNativeContract(coreRoot, coreCommit);
  if (typeof destinationRoot !== "string" || !path.isAbsolute(destinationRoot)) {
    throw new Error("Packaged Core destination is invalid");
  }
  const destination = fs.realpathSync(destinationRoot);
  if (!downloadAsset && (typeof token !== "string" || !token)) {
    throw new Error("Scoped Core read token is required for the Windows native asset");
  }
  const target = path.join(destination, ...WINDOWS_NATIVE_ASSET_PATH.split("/"));
  if (fs.existsSync(target)) throw new Error("Windows native asset already exists in the package");
  const rawAssetBytes = downloadAsset
    ? downloadAsset(contract.release_asset_id)
    : downloadApprovedAsset(contract.release_asset_id, token, Math.min(MAX_BINARY_SIZE + 4096, contract.binary_size + 4096));
  const verified = verifyPinnedWindowsNativeAsset({ coreRoot, coreCommit, rawAssetBytes });
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const relative = path.relative(destination, fs.realpathSync(path.dirname(target)));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Windows native asset destination escaped the package");
  }
  let created = false;
  try {
    fs.writeFileSync(target, rawAssetBytes, { flag: "wx", mode: 0o600 });
    created = true;
    const staged = fs.lstatSync(target);
    if (!staged.isFile() || staged.isSymbolicLink()
      || verifyWindowsNativeAssetBytes(contract, fs.readFileSync(target)) !== verified.digest) {
      throw new Error("Staged Windows native asset differs from Core approval");
    }
  } catch (error) {
    if (created) fs.rmSync(target);
    throw error;
  }
  return Object.freeze({ path: target, ...verified });
}

function assertNoUnapprovedNativeAsset(destinationRoot) {
  if (typeof destinationRoot !== "string" || !path.isAbsolute(destinationRoot)) {
    throw new Error("Packaged Core destination is invalid");
  }
  const target = path.join(fs.realpathSync(destinationRoot), ...WINDOWS_NATIVE_ASSET_PATH.split("/"));
  if (fs.existsSync(target)) throw new Error("Windows package contains an unapproved native asset");
}

export function preparePinnedWindowsNativeAsset({ coreRoot, coreCommit, destinationRoot,
  platform = process.platform, token, downloadAsset } = {}) {
  if (platform !== "win32") return null;
  const { contract } = readCommittedWindowsNativeContract(coreRoot, coreCommit);
  if (isPendingWindowsNativeContract(contract)) {
    assertNoUnapprovedNativeAsset(destinationRoot);
    return null;
  }
  if (contract?.status !== "approved") throw new Error("Windows native asset contract is not approved or pending");
  return stagePinnedWindowsNativeAsset({ coreRoot, coreCommit, destinationRoot, token, downloadAsset });
}

export function verifyStagedWindowsNativeAsset({ coreRoot, coreCommit, destinationRoot,
  platform = process.platform } = {}) {
  if (platform !== "win32") return null;
  const { contract } = readCommittedWindowsNativeContract(coreRoot, coreCommit);
  if (isPendingWindowsNativeContract(contract)) {
    assertNoUnapprovedNativeAsset(destinationRoot);
    return null;
  }
  validateApprovedWindowsNativeContract(contract);
  const destination = fs.realpathSync(destinationRoot);
  const target = path.join(destination, ...WINDOWS_NATIVE_ASSET_PATH.split("/"));
  let file;
  try { file = fs.lstatSync(target); }
  catch { throw new Error("Core-approved Windows native asset is missing from the package"); }
  if (!file.isFile() || file.isSymbolicLink()) throw new Error("Staged Windows native asset is not a regular file");
  const parent = fs.realpathSync(path.dirname(target));
  const relative = path.relative(destination, parent);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Windows native asset destination escaped the package");
  }
  return verifyPinnedWindowsNativeAsset({ coreRoot, coreCommit, rawAssetBytes: fs.readFileSync(target) });
}
