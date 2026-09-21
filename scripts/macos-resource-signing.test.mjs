import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const signer = await readFile(join(root, "scripts", "sign-macos-resources.mjs"), "utf8");
const workflow = await readFile(join(root, ".github", "workflows", "release.yml"), "utf8");

test("macOS packaged native resources receive timestamped hardened-runtime signatures", () => {
  assert.match(signer, /--timestamp/);
  assert.match(signer, /--options.*runtime/);
  assert.match(signer, /Mach-O/);
  assert.match(signer, /EDUPI_RESOURCE_KEYCHAIN_PATH/);
  assert.match(workflow, /Sign bundled macOS native resources/);
  assert.match(workflow, /scripts\/sign-macos-resources\.mjs/);
});
