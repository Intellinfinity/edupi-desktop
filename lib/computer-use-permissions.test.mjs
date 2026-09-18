import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  computerUsePermissionFlowAfterStatus,
  computerUsePrimaryAction,
  nextMissingComputerUsePermission,
} = await jiti.import("./computer-use-permissions.ts");

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
