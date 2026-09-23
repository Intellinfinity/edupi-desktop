import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { loadOwnerControlToken, loadRuntimeOwnerControlToken } = await createJiti(import.meta.url).import("./edupi-owner-control-token.ts");

test("owner control key persists per root without exposing the runtime transport token", () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-owner-token-")));
  const state = path.join(temp, "desktop-state");
  const firstRoot = path.join(temp, "first-data");
  const secondRoot = path.join(temp, "second-data");
  for (const directory of [state, firstRoot, secondRoot]) fs.mkdirSync(directory, { mode: 0o700 });
  try {
    const first = loadOwnerControlToken(state, firstRoot);
    assert.match(first, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(loadOwnerControlToken(state, firstRoot), first);
    assert.notEqual(loadOwnerControlToken(state, secondRoot), first);
    const privateDir = path.join(state, "edupi-owner-control");
    assert.equal(fs.readdirSync(privateDir).length, 2);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(privateDir).mode & 0o077, 0);
      assert.equal(fs.statSync(path.join(privateDir, fs.readdirSync(privateDir)[0])).mode & 0o077, 0);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("lost, corrupt and linked owner keys fail closed without changing owner state", () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-owner-token-")));
  const state = path.join(temp, "desktop-state");
  const data = path.join(temp, "data");
  const output = path.join(data, ".edupi", "output");
  fs.mkdirSync(state, { mode: 0o700 });
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const key = path.join(state, "edupi-owner-control", `${crypto.createHash("sha256").update(data).digest("hex").slice(0, 32)}.key`);
  try {
    assert.throws(() => loadOwnerControlToken(undefined, data), { code: "owner_control_credential_unavailable" });
    const nestedState = path.join(data, "desktop-state");
    fs.mkdirSync(nestedState, { mode: 0o700 });
    assert.throws(() => loadOwnerControlToken(nestedState, data), { code: "owner_control_credential_unavailable" });
    const first = loadOwnerControlToken(state, data);
    fs.writeFileSync(path.join(output, "ambient-authorization-v1.json"), "existing-owner-state", { mode: 0o600 });
    fs.unlinkSync(key);
    assert.throws(() => loadOwnerControlToken(state, data), { code: "owner_control_credential_unavailable" });
    assert.equal(fs.existsSync(key), false);
    assert.equal(fs.readFileSync(path.join(output, "ambient-authorization-v1.json"), "utf8"), "existing-owner-state");
    fs.writeFileSync(key, `${first.slice(1)}x`, { mode: 0o600 });
    assert.throws(() => loadOwnerControlToken(state, data), { code: "owner_control_credential_unavailable" });
    fs.unlinkSync(key);
    if (process.platform !== "win32") {
      fs.symlinkSync(path.join(output, "ambient-authorization-v1.json"), key);
      assert.throws(() => loadOwnerControlToken(state, data), { code: "owner_control_credential_unavailable" });
      fs.unlinkSync(key);
    }
    fs.writeFileSync(key, first, { mode: 0o600 });
    if (process.platform !== "win32") {
      fs.chmodSync(key, 0o644);
      assert.throws(() => loadOwnerControlToken(state, data), { code: "owner_control_credential_unavailable" });
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("recovers only a matching private temporary link after interrupted publication", () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-owner-token-")));
  const state = path.join(temp, "desktop-state");
  const data = path.join(temp, "data");
  fs.mkdirSync(state, { mode: 0o700 });
  fs.mkdirSync(data, { mode: 0o700 });
  try {
    const token = loadOwnerControlToken(state, data);
    const directory = path.join(state, "edupi-owner-control");
    const file = path.join(directory, fs.readdirSync(directory)[0]);
    const temporary = path.join(directory, `${path.basename(file, ".key")}.${crypto.randomUUID()}.tmp`);
    fs.linkSync(file, temporary);
    assert.equal(loadOwnerControlToken(state, data), token);
    assert.equal(fs.existsSync(temporary), false);
    const outside = path.join(temp, "outside-link");
    fs.linkSync(file, outside);
    assert.throws(() => loadOwnerControlToken(state, data), { code: "owner_control_credential_unavailable" });
    assert.equal(fs.readFileSync(outside, "ascii"), token);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("legacy owner state degrades normal runtime but still blocks ambient startup", () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-owner-token-")));
  const state = path.join(temp, "desktop-state");
  const data = path.join(temp, "data");
  const output = path.join(data, ".edupi", "output");
  fs.mkdirSync(state, { mode: 0o700 });
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const ownerState = path.join(output, "ambient-authorization-v1.json");
  fs.writeFileSync(ownerState, '{"legacy":true}\n', { mode: 0o600 });
  try {
    assert.equal(loadRuntimeOwnerControlToken(state, data, { required: false }), null);
    assert.equal(fs.readFileSync(ownerState, "utf8"), '{"legacy":true}\n');
    assert.equal(fs.existsSync(path.join(state, "edupi-owner-control")), true);
    assert.equal(fs.readdirSync(path.join(state, "edupi-owner-control")).length, 0);
    assert.throws(
      () => loadRuntimeOwnerControlToken(state, data, { required: true }),
      { code: "owner_control_credential_unavailable" },
    );
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
