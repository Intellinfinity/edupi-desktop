import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  computerUsePermissionFlowAfterStatus,
  computerUsePrimaryAction,
  nextMissingComputerUsePermission,
  computerUsePermissionLabel,
  computerUseHostLabel,
} = await jiti.import("./computer-use-permissions.ts");

test("permission labels distinguish unknown, rejected and cached screen grants", () => {
  assert.equal(computerUsePermissionLabel(undefined), "未检测");
  assert.equal(computerUsePermissionLabel(null), "无法检测");
  assert.equal(computerUsePermissionLabel(false), "未授权");
  assert.equal(computerUsePermissionLabel(true), "已授权");
  assert.equal(computerUsePermissionLabel(false, true), "待系统确认或重启");
});

test("permission identity names the current executable rather than a Canary label", () => {
  assert.equal(computerUseHostLabel({ appName: "EduPi", appVersion: "0.3.56", processId: 42, executablePath: "/Applications/EduPi.app/Contents/MacOS/pi-agent-desktop", bundlePath: "/Applications/EduPi.app", bundleId: "com.abcwyc.pi-agent", signingTeam: "TESTTEAM", platform: "macos" }), "EduPi · v0.3.56");
  assert.equal(computerUseHostLabel(undefined), "应用身份未检测");
});

test("orders accessibility before screen recording", () => {
  assert.equal(nextMissingComputerUsePermission({ accessibility: false, screenRecording: false }), "accessibility");
  assert.equal(nextMissingComputerUsePermission({ accessibility: true, screenRecording: false }), "screen_recording");
  assert.equal(nextMissingComputerUsePermission({ accessibility: null, screenRecording: null }), null);
});

test("advances from accessibility to screen recording only after accessibility is live", () => {
  const flow = { permission: "accessibility", screenRecordingRequested: false };
  assert.deepEqual(
    computerUsePermissionFlowAfterStatus({ accessibility: false, screenRecording: false }, flow),
    flow,
  );
  assert.deepEqual(
    computerUsePermissionFlowAfterStatus({ accessibility: true, screenRecording: false }, flow),
    { permission: "screen_recording", screenRecordingRequested: false },
  );
  assert.equal(
    computerUsePermissionFlowAfterStatus({ accessibility: true, screenRecording: true }, flow),
    null,
  );
});

test("keeps screen recording in the restart stage after its system request", () => {
  const flow = { permission: "screen_recording", screenRecordingRequested: true };
  assert.deepEqual(computerUsePrimaryAction({
    status: { enabled: false, accessibility: true, screenRecording: false },
    flow,
  }), { kind: "restart" });
  assert.equal(computerUsePermissionFlowAfterStatus({ accessibility: true, screenRecording: true }, flow), null);
});

test("does not gate platforms without a reportable system permission", () => {
  assert.deepEqual(computerUsePrimaryAction({
    status: { enabled: false, accessibility: null, screenRecording: null },
    flow: null,
  }), { kind: "enable" });
});

test("uses one primary action for every desktop-control state", () => {
  assert.deepEqual(computerUsePrimaryAction({ status: null, flow: null }), { kind: "detect" });
  assert.deepEqual(computerUsePrimaryAction({
    status: { enabled: false, accessibility: false, screenRecording: true },
    flow: null,
  }), { kind: "request", permission: "accessibility" });
  assert.deepEqual(computerUsePrimaryAction({
    status: { enabled: false, accessibility: true, screenRecording: true },
    flow: null,
  }), { kind: "enable" });
  assert.deepEqual(computerUsePrimaryAction({
    status: { enabled: true, accessibility: true, screenRecording: true },
    flow: null,
  }), { kind: "stop" });
});
