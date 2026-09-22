import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(root, "scripts", "test-windows-installed-release.ps1"), "utf8");

test("published Windows install reuses an installer-started process and captures bounded crash evidence", () => {
  assert.match(source, /Get-Process -Name "pi-agent-desktop"/);
  assert.match(source, /Installer started the application/);
  assert.match(source, /RedirectStandardOutput/);
  assert.match(source, /RedirectStandardError/);
  assert.match(source, /Write-LaunchDiagnostics/);
  assert.match(source, /Get-WinEvent -FilterHashtable/);
  assert.match(source, /Get-Content \$Path -Tail 120/);
  assert.match(source, /\[redacted\]/);
  assert.doesNotMatch(source, /Get-Content \$Path -Raw/);
});
