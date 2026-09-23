import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const signer = await readFile(join(root, "scripts", "sign-macos-resources.mjs"), "utf8");
const helperEntitlements = await readFile(join(root, "src-tauri", "entitlements", "node-helper.plist"), "utf8");
const workflow = await readFile(join(root, ".github", "workflows", "release.yml"), "utf8");

test("macOS packaged native resources receive timestamped hardened-runtime signatures", () => {
  assert.match(signer, /--timestamp/);
  assert.match(signer, /--options.*runtime/);
  assert.match(signer, /Mach-O/);
  assert.match(signer, /EDUPI_RESOURCE_KEYCHAIN_PATH/);
  assert.match(workflow, /Sign bundled macOS native resources/);
  assert.match(workflow, /scripts\/sign-macos-resources\.mjs/);
});

test("signed macOS Node helper retains only its required JIT entitlement and runs after packaging", () => {
  assert.match(helperEntitlements, /<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\/>/);
  assert.doesNotMatch(helperEntitlements, /allow-unsigned-executable-memory|disable-library-validation|disable-executable-page-protection/);
  assert.match(signer, /--entitlements/);
  assert.match(signer, /EDUPI_NODE_JIT_READY/);
  assert.match(workflow, /name: Verify signed macOS packaged runtime/);
  assert.match(workflow, /name: Verify signed macOS packaged runtime[\s\S]*npm run test:staged-desktop-runtime/);
  assert.ok(workflow.indexOf("name: Build, sign, and upload updater artifacts") < workflow.indexOf("name: Verify signed macOS packaged runtime"));
  assert.ok(workflow.indexOf("name: Verify signed macOS packaged runtime") < workflow.indexOf("name: Verify packaged macOS updater key"));
  assert.ok(workflow.indexOf("name: Verify packaged macOS updater key") < workflow.indexOf("name: Notarize, staple, and replace macOS disk image"));
  assert.match(workflow, /node scripts\/verify-updater-plugin-binary\.mjs/);
  assert.match(workflow, /PI_AGENT_DESKTOP_REQUIRE_UPDATER: '1'/);
});
