import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/preview-installers.yml", import.meta.url), "utf8");

test("preview installers are manual, unsigned, non-release artifacts for Mac and Windows", () => {
  const packageJob = workflow.slice(workflow.indexOf("\n  package:"));
  assert.match(workflow, /workflow_dispatch:/);
  for (const forbidden of ["push:", "pull_request:", "pull_request_target:", "repository_dispatch:", "workflow_run:", "schedule:", "workflow_call:", "contents: write", "gh release", "npm publish", "cargo publish", "tauri-action", "softprops/action-gh-release", "ncipollo/release-action", "actions/create-release", "uploadUpdaterJson", "TAURI_SIGNING_PRIVATE_KEY", "TAURI_UPDATER_PUBLIC_KEY"]) assert.equal(workflow.includes(forbidden), false, forbidden);
  assert.match(workflow, /package:\n\s+needs:\s+quality/);
  assert.match(workflow, /aarch64-apple-darwin/);
  assert.match(workflow, /bundle:\s*app,dmg/);
  assert.match(workflow, /artifact_path:\s*src-tauri\/target\/aarch64-apple-darwin\/release\/bundle\/dmg\/\*\.dmg/);
  assert.match(workflow, /Verify preview macOS application catalog[\s\S]*EDUPI_STAGED_NODE:.*Pi Agent Server\.app\/Contents\/MacOS\/node/);
  assert.match(workflow, /x86_64-pc-windows-msvc/);
  assert.match(workflow, /bundle:\s*nsis/);
  assert.doesNotMatch(packageJob, /ubuntu|linux|x86_64-unknown-linux-gnu|bundle:\s*(?:deb|rpm|appimage)|\.AppImage/);
  assert.match(workflow, /dtolnay\/rust-toolchain@4360b52568e2003a75bf9bc1d59f33a8e3fc893c/);
  assert.match(workflow, /createUpdaterArtifacts\\?":false|createUpdaterArtifacts":false/);
  assert.match(
    workflow,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  );
  assert.match(workflow, /retention-days:\s*7/);
  assert.match(workflow, /if-no-files-found:\s*error/);
  for (const gate of ["npm test", "tsc --noEmit", "npm run lint", "npm run security:audit"]) assert.match(workflow, new RegExp(gate));
});
