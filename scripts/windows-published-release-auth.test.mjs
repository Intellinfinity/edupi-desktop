import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public Windows install authenticates its release metadata request with a read-only runner token", async () => {
  const workflow = await readFile(".github/workflows/windows-build-debug.yml", "utf8");
  const script = await readFile("scripts/test-windows-installed-release.ps1", "utf8");
  const installStep = workflow.split("- name: Install and start published application")[1]
    ?.split("- name: Check native source with public resource fixture")[0] || "";
  assert.match(workflow, /permissions:\s*\n\s*contents: read/u);
  assert.match(installStep, /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/u);
  assert.match(script, /\$env:GH_TOKEN/u);
  assert.match(script, /Authorization\s*=\s*"Bearer \$env:GH_TOKEN"/u);
  assert.match(script, /Invoke-RestMethod[^\n]*-Headers \$releaseHeaders/u);
});
