import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const config = await jiti.import("./edupi-proactivity-config.ts");
const safety = await jiti.import("./safe-mode.ts");
const scope = { classId: "class-1", subject: "数学" };

test("G2 requires the isolated-root marker and stays unavailable on Windows", () => {
  assert.equal(safety.canStartEduPiStudentFollowup("darwin", {}), false);
  assert.equal(safety.canStartEduPiStudentFollowup("darwin", { EDUPI_AMBIENT_PLANNING: "1" }), false);
  assert.equal(safety.canStartEduPiStudentFollowup("darwin", { EDUPI_DESKTOP_ISOLATED_CANARY: "1" }), true);
  assert.equal(safety.canStartEduPiStudentFollowup("win32", { EDUPI_DESKTOP_ISOLATED_CANARY: "1", EDUPI_SAFE_MODE: "1", EDUPI_WINDOWS_G1_CANARY: "1" }), false);
});

test("G2 activation and its durable stop are independent of G1", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-g2-config-"));
  const stateDir = path.join(root, "state");
  const dataRoot = path.join(root, "data");
  fs.mkdirSync(stateDir, { mode: 0o700 }); fs.mkdirSync(dataRoot, { mode: 0o700 });
  const g1 = { stateDir, dataRoot, env: {} };
  const g2 = { ...g1, domain: "student_followup" };
  try {
    config.writeEduPiProactivityConfig({ enabled: true, scope, grantId: "g1" }, g1);
    assert.equal(config.readEduPiProactivityActivation(g2).enabled, false);
    config.writeEduPiProactivityConfig({ enabled: true, scope, grantId: "g2" }, g2);
    assert.equal(config.readEduPiProactivityActivation(g1).grantId, "g1");
    assert.equal(config.readEduPiProactivityActivation(g2).grantId, "g2");
    config.writeEduPiProactivityStopIntent({ scope, grantId: "g2" }, g2);
    assert.equal(config.readEduPiProactivityActivation(g2).configurationStatus, "stop_pending");
    assert.equal(config.readEduPiProactivityActivation(g1).enabled, true);
    config.writeEduPiProactivityConfig({ enabled: false, scope: null, grantId: null }, g2);
    config.clearEduPiProactivityStopIntent({ ...g2, grantId: "g2" });
    assert.equal(config.readEduPiProactivityActivation({ ...g2, env: { EDUPI_AMBIENT_PLANNING: "1" } }).enabled, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
