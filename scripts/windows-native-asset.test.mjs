import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { preparePinnedWindowsNativeAsset, stagePinnedWindowsNativeAsset, verifyPinnedWindowsNativeAsset, WINDOWS_NATIVE_ASSET_PATH,
  WINDOWS_NATIVE_CONTRACT_PATH } from "./windows-native-asset.mjs";

const bytes = Buffer.from("isolated-windows-native-fixture");
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const approved = (source, overrides = {}) => ({ version: 1, status: "approved", platform: "win32", architecture: "x64", node_major: 22,
  binary_relative_path: WINDOWS_NATIVE_ASSET_PATH, binary_sha256: sha256(bytes), binary_size: bytes.length,
  binary_source_commit: source, release_asset_id: 123, ...overrides });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-native-ancestor-"));
  const git = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init", "-b", "main"]);
  git(["config", "user.name", "EduPi Test"]);
  git(["config", "user.email", "edupi-test@example.invalid"]);
  git(["commit", "--allow-empty", "-m", "native source"]);
  const source = git(["rev-parse", "HEAD"]);
  const file = path.join(root, WINDOWS_NATIVE_CONTRACT_PATH);
  fs.mkdirSync(path.dirname(file));
  const commitContract = (contract) => {
    fs.writeFileSync(file, JSON.stringify(contract));
    git(["add", WINDOWS_NATIVE_CONTRACT_PATH]);
    git(["commit", "-m", "native contract"]);
    return git(["rev-parse", "HEAD"]);
  };
  return { root, file, source, git, commitContract,
    verify: (pin, rawAssetBytes = bytes) => verifyPinnedWindowsNativeAsset({ coreRoot: root, coreCommit: pin, rawAssetBytes }),
    close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("only a fixed, committed, approved Core contract is accepted", () => {
  const core = fixture();
  try {
    const base = approved(core.source);
    for (const contract of [approved(core.source, { status: "pending" }), approved(core.source, { release_asset_id: null }),
      approved(core.source, { binary_relative_path: "../other.node" }), approved(core.source, { node_major: 23 }),
      approved(core.source, { extra: true })]) {
      const pin = core.commitContract(contract);
      assert.throws(() => core.verify(pin), /not approved/);
    }
    const pin = core.commitContract(base);
    assert.deepEqual(core.verify(pin), { releaseAssetId: 123, digest: sha256(bytes), size: bytes.length,
      sourceCommit: core.source, relativePath: WINDOWS_NATIVE_ASSET_PATH });
    fs.writeFileSync(core.file, JSON.stringify({ ...base, release_asset_id: 999 }));
    assert.throws(() => core.verify(pin), /differs from the pinned Core commit/);
  } finally { core.close(); }
});

test("raw native bytes must match the committed Core-approved size and SHA-256", () => {
  const core = fixture();
  try {
    const pin = core.commitContract(approved(core.source));
    assert.equal(core.verify(pin).digest, sha256(bytes));
    assert.throws(() => core.verify(pin, bytes.subarray(1)), /size/);
    const changed = Buffer.from(bytes);
    changed[0] ^= 1;
    assert.throws(() => core.verify(pin, changed), /SHA-256/);
  } finally { core.close(); }
});

test("native source must be an ancestor in the exact, sufficiently deep Core checkout", () => {
  const core = fixture();
  try {
    const originalPin = core.commitContract(approved(core.source));
    core.git(["switch", "-c", "side", core.source]);
    core.git(["commit", "--allow-empty", "-m", "unrelated native source"]);
    const side = core.git(["rev-parse", "HEAD"]);
    core.git(["switch", "main"]);
    const pin = core.commitContract(approved(side));
    assert.throws(() => core.verify(pin), /not a verified ancestor/);
    const missingPin = core.commitContract(approved("f".repeat(40)));
    assert.throws(() => core.verify(missingPin), /unavailable in Core history/);
    assert.throws(() => core.verify(originalPin), /differs from the pinned Core commit/);
  } finally { core.close(); }
});

test("a symlinked working-tree contract is rejected even if its content matches Git", () => {
  const core = fixture();
  try {
    const pin = core.commitContract(approved(core.source));
    const target = path.join(core.root, "copy.json");
    fs.copyFileSync(core.file, target);
    fs.rmSync(core.file);
    fs.symlinkSync(target, core.file);
    assert.throws(() => core.verify(pin), /not a regular Core file/);
  } finally { core.close(); }
});

test("approved raw bytes are staged only after committed contract and digest checks", () => {
  const core = fixture();
  try {
    const pin = core.commitContract(approved(core.source));
    const destinationRoot = path.join(core.root, "bundle");
    fs.mkdirSync(destinationRoot);
    const target = path.join(destinationRoot, ...WINDOWS_NATIVE_ASSET_PATH.split("/"));
    const altered = Buffer.from(bytes);
    altered[0] ^= 1;
    assert.throws(() => stagePinnedWindowsNativeAsset({ coreRoot: core.root, coreCommit: pin,
      destinationRoot, downloadAsset: () => altered }), /SHA-256/);
    assert.equal(fs.existsSync(target), false, "rejected bytes must not reach the package");
    const staged = stagePinnedWindowsNativeAsset({ coreRoot: core.root, coreCommit: pin,
      destinationRoot, downloadAsset: () => bytes });
    assert.equal(staged.digest, sha256(bytes));
    assert.deepEqual(fs.readFileSync(target), bytes);
    assert.throws(() => stagePinnedWindowsNativeAsset({ coreRoot: core.root, coreCommit: pin,
      destinationRoot, downloadAsset: () => bytes }), /already exists/);
  } finally { core.close(); }
});

test("source proof and scoped credential are required before fetching native bytes", () => {
  const core = fixture();
  try {
    const destinationRoot = path.join(core.root, "bundle");
    fs.mkdirSync(destinationRoot);
    const badPin = core.commitContract(approved("f".repeat(40)));
    let fetched = false;
    assert.throws(() => stagePinnedWindowsNativeAsset({ coreRoot: core.root, coreCommit: badPin,
      destinationRoot, downloadAsset: () => { fetched = true; return bytes; } }), /unavailable in Core history/);
    assert.equal(fetched, false);
    const goodPin = core.commitContract(approved(core.source));
    assert.throws(() => stagePinnedWindowsNativeAsset({ coreRoot: core.root, coreCommit: goodPin,
      destinationRoot, token: "" }), /read token/);
    assert.equal(fs.existsSync(path.join(destinationRoot, ...WINDOWS_NATIVE_ASSET_PATH.split("/"))), false);
  } finally { core.close(); }
});

test("Windows packaging allows only committed pending or approved source states", () => {
  const core = fixture();
  try {
    const destinationRoot = path.join(core.root, "bundle");
    fs.mkdirSync(destinationRoot);
    const pending = approved(core.source, { status: "pending", binary_sha256: null, binary_size: null,
      binary_source_commit: null, release_asset_id: null });
    const pendingPin = core.commitContract(pending);
    let fetched = false;
    assert.equal(preparePinnedWindowsNativeAsset({ coreRoot: core.root, coreCommit: pendingPin,
      destinationRoot, platform: "win32", downloadAsset: () => { fetched = true; return bytes; } }), null);
    assert.equal(fetched, false);
    const approvedPin = core.commitContract(approved(core.source));
    assert.equal(preparePinnedWindowsNativeAsset({ coreRoot: core.root, coreCommit: approvedPin,
      destinationRoot, platform: "darwin", downloadAsset: () => { fetched = true; return bytes; } }), null);
    assert.equal(fetched, false);
    const staged = preparePinnedWindowsNativeAsset({ coreRoot: core.root, coreCommit: approvedPin,
      destinationRoot, platform: "win32", downloadAsset: () => bytes });
    assert.equal(staged.digest, sha256(bytes));
    const invalidPin = core.commitContract({ ...pending, release_asset_id: 123 });
    assert.throws(() => preparePinnedWindowsNativeAsset({ coreRoot: core.root, coreCommit: invalidPin,
      destinationRoot, platform: "win32", downloadAsset: () => bytes }), /not approved or pending/);
  } finally { core.close(); }
});
