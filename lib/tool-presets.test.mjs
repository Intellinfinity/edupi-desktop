import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getPermissionModeForToolPreset, getToolNamesForPreset, getToolPresetForPermissionMode } = await createJiti(import.meta.url).import("./tool-presets.ts");

test("full access selects the complete built-in tool set", () => {
  assert.equal(getToolPresetForPermissionMode("full"), "full");
  assert.deepEqual(getToolNamesForPreset(getToolPresetForPermissionMode("full")), ["bash", "read", "edit", "write", "grep", "find", "ls"]);
  assert.equal(getPermissionModeForToolPreset("full"), "full");
});

test("approval and workspace modes keep the bounded default tool set", () => {
  assert.equal(getToolPresetForPermissionMode("approval"), "default");
  assert.equal(getToolPresetForPermissionMode("workspace"), "default");
  assert.equal(getPermissionModeForToolPreset("default"), "workspace");
});
