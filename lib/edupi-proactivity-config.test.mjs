import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const config = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-proactivity-config.ts");

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-proactivity-config-")));
  const stateDir = path.join(root, "state");
  const dataRoot = path.join(root, "data");
  fs.mkdirSync(stateDir, { mode: 0o700 });
  fs.mkdirSync(dataRoot, { mode: 0o700 });
  return { root, stateDir, dataRoot };
}

test("proactivity is default-off and persists one private data-root-bound canary", () => {
  const value = fixture();
  try {
    assert.deepEqual(config.readEduPiProactivityActivation({ stateDir: value.stateDir, dataRoot: value.dataRoot, env: {} }), {
      enabled: false, source: "default", configurationStatus: "missing", scope: null, grantId: null, updatedAt: null,
    });
    const scope = { classId: "class-7-1", subject: "数学" };
    const written = config.writeEduPiProactivityConfig({ enabled: true, scope, grantId: "desktop_canary_1234" },
      { stateDir: value.stateDir, dataRoot: value.dataRoot, now: "2026-09-23T08:00:00.000Z" });
    assert.equal(written.enabled, true);
    assert.deepEqual(written.scope, scope);
    const file = path.join(value.stateDir, "edupi-proactivity.json");
    const stat = fs.statSync(file);
    if (process.platform !== "win32") assert.equal(stat.mode & 0o077, 0);
    assert.equal(fs.readdirSync(value.stateDir).filter((name) => name.includes(".tmp")).length, 0);
    assert.deepEqual(config.readEduPiProactivityActivation({ stateDir: value.stateDir, dataRoot: value.dataRoot, env: {} }), {
      enabled: true, source: "desktop_canary", configurationStatus: "ready", scope, grantId: "desktop_canary_1234",
      updatedAt: "2026-09-23T08:00:00.000Z",
    });
    const disabled = config.writeEduPiProactivityConfig({ enabled: false, scope, grantId: "desktop_canary_1234" },
      { stateDir: value.stateDir, dataRoot: value.dataRoot, now: "2026-09-23T09:00:00.000Z" });
    assert.equal(disabled.enabled, false);
    assert.equal(config.readEduPiProactivityActivation({ stateDir: value.stateDir, dataRoot: value.dataRoot, env: {} }).source, "desktop_canary");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a foreign root, corrupt file, or symlinked state fails closed", () => {
  const value = fixture();
  try {
    const otherData = path.join(value.root, "other-data");
    fs.mkdirSync(otherData);
    config.writeEduPiProactivityConfig({ enabled: true, scope: { classId: "class-7-1", subject: "数学" }, grantId: "grant-1" },
      { stateDir: value.stateDir, dataRoot: value.dataRoot, now: "2026-09-23T08:00:00.000Z" });
    assert.deepEqual(config.readEduPiProactivityActivation({ stateDir: value.stateDir, dataRoot: otherData, env: {} }), {
      enabled: false, source: "default", configurationStatus: "mismatched", scope: null, grantId: null, updatedAt: null,
    });
    fs.writeFileSync(path.join(value.stateDir, "edupi-proactivity.json"), "{broken", { mode: 0o600 });
    assert.equal(config.readEduPiProactivityActivation({ stateDir: value.stateDir, dataRoot: value.dataRoot, env: {} }).configurationStatus, "invalid");
    const linkedState = path.join(value.root, "linked-state");
    fs.symlinkSync(value.stateDir, linkedState);
    assert.equal(config.readEduPiProactivityActivation({ stateDir: linkedState, dataRoot: value.dataRoot, env: {} }).enabled, false);
    assert.throws(() => config.writeEduPiProactivityConfig({ enabled: false, scope: null, grantId: null },
      { stateDir: linkedState, dataRoot: value.dataRoot, now: "2026-09-23T09:00:00.000Z" }),
    (error) => error?.code === "proactivity_configuration_unavailable");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("the explicit environment activation remains test-only and observable", () => {
  const value = fixture();
  try {
    const activation = config.readEduPiProactivityActivation({ stateDir: value.stateDir, dataRoot: value.dataRoot,
      env: { EDUPI_AMBIENT_PLANNING: "1" } });
    assert.equal(activation.enabled, true);
    assert.equal(activation.source, "environment");
    assert.equal(activation.configurationStatus, "missing");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("enabled configurations always carry one complete scope and grant binding", () => {
  const value = fixture();
  try {
    assert.throws(() => config.writeEduPiProactivityConfig({ enabled: true, scope: null, grantId: null },
      { stateDir: value.stateDir, dataRoot: value.dataRoot, now: "2026-09-23T08:00:00.000Z" }),
    (error) => error?.code === "proactivity_configuration_unavailable");
    const hash = `sha256:${crypto.createHash("sha256").update(fs.realpathSync(value.dataRoot), "utf8").digest("hex")}`;
    fs.writeFileSync(path.join(value.stateDir, "edupi-proactivity.json"), JSON.stringify({ version: 1, data_root_hash: hash,
      enabled: true, scope: null, grant_id: null, updated_at: "2026-09-23T08:00:00.000Z" }), { mode: 0o600 });
    assert.equal(config.readEduPiProactivityActivation({ stateDir: value.stateDir, dataRoot: value.dataRoot, env: {} }).configurationStatus, "invalid");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});
