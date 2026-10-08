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
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 2);
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

test("G3 through G5 keep separate default-off activation records and stop fences", () => {
  const value = fixture();
  try {
    const domains = ["calendar_administration", "lesson_reflection", "parent_communication"];
    for (const domain of domains) {
      assert.deepEqual(config.readEduPiProactivityActivation({ stateDir: value.stateDir, dataRoot: value.dataRoot, env: {}, domain }), {
        enabled: false, source: "default", configurationStatus: "missing", scope: null, grantId: null, updatedAt: null,
      });
    }
    const scope = { classId: "synthetic-class", subject: "数学" };
    config.writeEduPiProactivityConfig({ enabled: true, scope, grantId: "synthetic-calendar-grant" },
      { stateDir: value.stateDir, dataRoot: value.dataRoot, domain: domains[0] });
    config.writeEduPiProactivityStopIntent({ scope, grantId: "synthetic-calendar-grant" },
      { stateDir: value.stateDir, dataRoot: value.dataRoot, domain: domains[0] });
    const stopped = config.readEduPiProactivityActivation({ stateDir: value.stateDir, dataRoot: value.dataRoot, env: {}, domain: domains[0] });
    assert.equal(stopped.enabled, false);
    assert.equal(stopped.configurationStatus, "stop_pending");
    for (const domain of domains.slice(1)) {
      assert.equal(config.readEduPiProactivityActivation({ stateDir: value.stateDir, dataRoot: value.dataRoot, env: {}, domain }).enabled, false);
    }
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
    assert.throws(() => config.readEduPiProactivityActivation({ stateDir: linkedState, dataRoot: value.dataRoot, env: {} }),
      (error) => error?.code === "proactivity_configuration_unavailable");
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

test("a legacy enabled canary cannot silently reactivate after the budget migration", () => {
  const value = fixture();
  try {
    const rootHash = `sha256:${crypto.createHash("sha256").update(fs.realpathSync(value.dataRoot), "utf8").digest("hex")}`;
    const file = path.join(value.stateDir, "edupi-proactivity.json");
    fs.writeFileSync(file, JSON.stringify({ version: 1, data_root_hash: rootHash, enabled: true,
      scope: { class_id: "class-7-1", subject: "数学" }, grant_id: "desktop_canary_old",
      updated_at: "2026-09-23T08:00:00.000Z" }), { mode: 0o600 });
    const legacy = config.readEduPiProactivityActivation({ stateDir: value.stateDir, dataRoot: value.dataRoot, env: {} });
    assert.equal(legacy.enabled, false);
    assert.equal(legacy.configurationStatus, "legacy");
    assert.deepEqual(legacy.scope, { classId: "class-7-1", subject: "数学" });
    assert.equal(legacy.grantId, "desktop_canary_old");
    assert.equal(legacy.updatedAt, "2026-09-23T08:00:00.000Z");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 1, "read does not rewrite legacy authority");
    fs.writeFileSync(file, JSON.stringify({ version: 1, data_root_hash: rootHash, enabled: false,
      scope: { class_id: "class-7-1", subject: "数学" }, grant_id: "desktop_canary_old",
      updated_at: "2026-09-23T09:00:00.000Z" }), { mode: 0o600 });
    const pendingStop = config.readEduPiProactivityActivation({ stateDir: value.stateDir, dataRoot: value.dataRoot, env: {} });
    assert.equal(pendingStop.enabled, false);
    assert.equal(pendingStop.configurationStatus, "legacy");
    assert.equal(pendingStop.grantId, "desktop_canary_old", "failed stop keeps the old grant fence");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a proactivity change is not acknowledged when its directory cannot be synced", () => {
  const value = fixture();
  const originalSync = fs.fsyncSync;
  try {
    fs.fsyncSync = descriptor => {
      if (fs.fstatSync(descriptor).isDirectory()) throw new Error("synthetic_directory_sync_failure");
      return originalSync(descriptor);
    };
    assert.throws(() => config.writeEduPiProactivityConfig({ enabled: true,
      scope: { classId: "class-7-1", subject: "数学" }, grantId: "desktop_canary_v2_test" },
    { stateDir: value.stateDir, dataRoot: value.dataRoot, now: "2026-09-23T08:00:00.000Z" }),
    (error) => error?.code === "proactivity_configuration_unavailable");
  } finally {
    fs.fsyncSync = originalSync;
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test("a durable stop intent overrides an enabled config across reads until explicit cleanup", () => {
  const value = fixture();
  const scope = { classId: "class-7-1", subject: "数学" };
  const grantId = "desktop_canary_v2_test";
  try {
    config.writeEduPiProactivityConfig({ enabled: true, scope, grantId },
      { stateDir: value.stateDir, dataRoot: value.dataRoot, now: "2026-09-23T08:00:00.000Z" });
    config.writeEduPiProactivityStopIntent({ scope, grantId },
      { stateDir: value.stateDir, dataRoot: value.dataRoot, now: "2026-09-23T09:00:00.000Z" });
    const stopped = config.readEduPiProactivityActivation({ stateDir: value.stateDir, dataRoot: value.dataRoot, env: {} });
    assert.deepEqual(stopped, { enabled: false, source: "desktop_canary", configurationStatus: "stop_pending",
      scope, grantId, updatedAt: "2026-09-23T09:00:00.000Z" });
    assert.equal(JSON.parse(fs.readFileSync(path.join(value.stateDir, "edupi-proactivity.json"), "utf8")).enabled, true,
      "the independent fence stops a previously enabled config without overwriting it");
    config.writeEduPiProactivityConfig({ enabled: false, scope: null, grantId: null },
      { stateDir: value.stateDir, dataRoot: value.dataRoot, now: "2026-09-23T10:00:00.000Z" });
    config.clearEduPiProactivityStopIntent({ stateDir: value.stateDir, dataRoot: value.dataRoot, grantId });
    assert.equal(config.readEduPiProactivityActivation({ stateDir: value.stateDir, dataRoot: value.dataRoot, env: {} }).enabled, false);
    assert.equal(fs.existsSync(path.join(value.stateDir, "edupi-proactivity-stop.json")), false);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a damaged stop marker blocks runtime activation instead of falling back to enabled", () => {
  const value = fixture();
  try {
    config.writeEduPiProactivityConfig({ enabled: true, scope: { classId: "class-7-1", subject: "数学" },
      grantId: "desktop_canary_v2_test" }, { stateDir: value.stateDir, dataRoot: value.dataRoot });
    fs.writeFileSync(path.join(value.stateDir, "edupi-proactivity-stop.json"), "{broken", { mode: 0o600 });
    assert.throws(() => config.readEduPiProactivityActivation({ stateDir: value.stateDir, dataRoot: value.dataRoot, env: {} }),
      (error) => error?.code === "proactivity_configuration_unavailable");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});
