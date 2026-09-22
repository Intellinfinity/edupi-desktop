import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  EDUPI_RELEASE_REPOSITORY,
  EDUPI_UPDATER_ENDPOINT,
  readReleaseDestinationFiles,
  verifyReleaseDestinations,
} from "./verify-release-destinations.mjs";
import {
  DESKTOP_UPSTREAM_BRANCH,
  DESKTOP_UPSTREAM_REPOSITORY,
  parseDesktopUpstreamState,
} from "./desktop-upstream-state.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workflow = await readFile(
  join(root, ".github", "workflows", "desktop-upstream-sync.yml"),
  "utf8",
);
const readmes = Object.fromEntries(
  await Promise.all(
    ["README.md", "README.zh-CN.md", "README.edupi.md"].map(async (path) => [
      path,
      await readFile(join(root, path), "utf8"),
    ]),
  ),
);

test("desktop upstream detection is scheduled, read-only, and source scoped", () => {
  assert.match(workflow, /on:\s*\n\s*schedule:\s*\n\s*- cron:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+(push|pull_request|pull_request_target|repository_dispatch|workflow_run):/);
  assert.match(workflow, /if: github\.repository == 'PIGU-PPPgu\/edupi-desktop'/);
  assert.match(workflow, /EDUPI_SOURCE_REPOSITORY: PIGU-PPPgu\/edupi-desktop/);

  const detect = workflow.slice(workflow.indexOf("\n  detect:"), workflow.indexOf("\n  prepare:"));
  assert.match(detect, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(detect, /contents: write|pull-requests: write/);
  assert.match(detect, /repository: \$\{\{ env\.EDUPI_SOURCE_REPOSITORY \}\}/);
  assert.match(detect, /persist-credentials: false/);
});

test("desktop upstream is fetched as an attribution-only remote", () => {
  assert.match(
    workflow,
    /UPSTREAM_DESKTOP_URL: https:\/\/github\.com\/abcwyc\/pi-agent-desktop\.git/,
  );
  assert.match(workflow, /git remote add upstream-desktop "\$UPSTREAM_DESKTOP_URL"/);
  assert.equal(
    workflow.match(/git remote set-url --push upstream-desktop disabled:\/\/read-only-upstream/g)
      ?.length,
    2,
  );
  assert.match(
    workflow,
    /git fetch --no-tags upstream-desktop[\s\\]+"\+refs\/heads\/main:refs\/remotes\/upstream-desktop\/main"/,
  );
  assert.match(workflow, /git merge-base --is-ancestor "\$upstream_sha" refs\/remotes\/origin\/main/);
  assert.match(workflow, /reviewed_sha="\$\(node scripts\/desktop-upstream-state\.mjs get\)"/);
  assert.match(workflow, /\[ "\$reviewed_sha" = "\$upstream_sha" \]/);
  assert.match(workflow, /changed=false/);
});

test("an existing review is preserved and updated idempotently", () => {
  assert.match(workflow, /SYNC_BRANCH: sync\/upstream-desktop/);
  assert.equal(workflow.match(/gh pr list/g)?.length, 2);
  assert.equal(workflow.match(/--base main/g)?.length, 3);
  assert.match(workflow, /gh pr list[\s\S]{0,260}--base main[\s\S]{0,80}--head "\$SYNC_BRANCH"/);
  assert.match(
    workflow,
    /git switch --create "\$SYNC_BRANCH" "refs\/remotes\/origin\/\$SYNC_BRANCH"/,
  );
  assert.match(workflow, /git merge --no-edit refs\/remotes\/origin\/main/);
  assert.match(workflow, /if \[ -n "\$pr_number" \]; then[\s\S]{0,180}gh pr edit/);
  assert.match(workflow, /else[\s\S]{0,180}gh pr create/);
  assert.match(workflow, /--base main/);
});

test("origin read credentials are scoped before upstream code is merged or executed", () => {
  const prepare = workflow.slice(
    workflow.indexOf("\n  prepare:"),
    workflow.indexOf("\n  publish-review:"),
  );
  const readCredentialAt = prepare.indexOf('auth_header="AUTHORIZATION: basic');
  const fetchAt = prepare.indexOf("fetch --no-tags origin");
  const mergeAt = workflow.indexOf('git merge --no-commit --no-ff "$UPSTREAM_SHA"');
  const installAt = workflow.indexOf("run: npm ci");

  assert.match(prepare, /persist-credentials: false/);
  assert.ok(readCredentialAt > -1);
  assert.ok(readCredentialAt < fetchAt);
  assert.ok(mergeAt < installAt);
  assert.doesNotMatch(prepare.slice(prepare.indexOf("id: candidate")), /GH_TOKEN|auth_header/);
});

test("the review branch is fully gated before the write-permission job", () => {
  const prepare = workflow.slice(
    workflow.indexOf("\n  prepare:"),
    workflow.indexOf("\n  publish-review:"),
  );
  const publish = workflow.slice(workflow.indexOf("\n  publish-review:"));

  assert.match(prepare, /permissions:\s*\n\s*contents: read\s*\n\s*pull-requests: read/);
  assert.match(prepare, /npm test/);
  assert.match(prepare, /node_modules\/\.bin\/tsc --noEmit/);
  assert.match(prepare, /npm run lint/);
  assert.match(prepare, /node scripts\/verify-release-destinations\.mjs/);
  assert.match(prepare, /node scripts\/desktop-upstream-state\.mjs set "\$UPSTREAM_SHA"/);
  assert.match(prepare, /git add scripts\/desktop-upstream-state\.json/);
  assert.match(prepare, /test "\$\(git rev-parse HEAD\)" = "\$EXPECTED_CANDIDATE_SHA"/);
  assert.match(prepare, /git diff --exit-code/);
  assert.match(prepare, /git status --porcelain --untracked-files=all/);
  assert.match(prepare, /git bundle create/);
  assert.doesNotMatch(prepare, /git push/);

  assert.match(publish, /needs: \[detect, prepare\]/);
  assert.match(publish, /permissions:\s*\n\s*contents: write\s*\n\s*pull-requests: write/);
  assert.match(publish, /git bundle verify/);
  assert.match(
    publish,
    /test "\$\(git rev-parse "\$candidate_ref"\)" = "\$EXPECTED_CANDIDATE_SHA"/,
  );
  assert.match(publish, /git merge-base --is-ancestor "\$UPSTREAM_SHA" "\$candidate_ref"/);
  assert.match(
    publish,
    /git diff --exit-code refs\/remotes\/origin\/main "\$candidate_ref" -- \.github\/workflows/,
  );
  assert.match(publish, /--force-with-lease="refs\/heads\/\$SYNC_BRANCH:\$EXPECTED_REMOTE_SHA"/);
  assert.match(publish, /origin "\$candidate_ref:refs\/heads\/\$SYNC_BRANCH"/);
  assert.doesNotMatch(
    publish,
    /^\s+(?:npm (?:ci|test|run)|node_modules\/\.bin|node scripts\/)/m,
  );
});

test("candidate workflows always come from trusted protected main", () => {
  const prepare = workflow.slice(
    workflow.indexOf("\n  prepare:"),
    workflow.indexOf("\n  publish-review:"),
  );
  const restoreAt = prepare.indexOf(
    "git restore --source=refs/remotes/origin/main",
  );
  const stateAt = prepare.indexOf('node scripts/desktop-upstream-state.mjs set "$UPSTREAM_SHA"');
  const bundleAt = prepare.indexOf("git bundle create");

  assert.ok(restoreAt > -1);
  assert.ok(restoreAt < stateAt);
  assert.ok(stateAt < bundleAt);
  assert.ok(
    prepare.match(/git diff --exit-code refs\/remotes\/origin\/main -- \.github\/workflows/g)
      ?.length >= 2,
  );
  assert.match(
    workflow,
    /Public-upstream \\`\.github\/workflows\\` changes are deliberately excluded/,
  );
});

test("desktop upstream automation cannot push main, sign, or release", () => {
  assert.doesNotMatch(workflow, /git push[^\n]*(HEAD:main|refs\/heads\/main)/);
  for (const forbidden of [
    "EDUPI_RELEASE_TOKEN",
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_UPDATER_PUBLIC_KEY",
    "gh release",
    "tauri-action",
    "softprops/action-gh-release",
    "ncipollo/release-action",
    "actions/create-release",
    "gh workflow run",
    "release.yml",
    "secrets.",
    "npm publish",
    "cargo publish",
    "uploadUpdaterJson",
    "actions: write",
    "id-token: write",
  ]) {
    assert.equal(workflow.includes(forbidden), false, forbidden);
  }
});

test("readmes use EduPi source and downloads while retaining upstream attribution", () => {
  for (const [path, source] of Object.entries(readmes)) {
    assert.match(source, /https:\/\/github\.com\/PIGU-PPPgu\/edupi-desktop/);
    assert.match(source, /https:\/\/github\.com\/PIGU-PPPgu\/edupi-desktop\/releases/);
    assert.match(source, /https:\/\/github\.com\/abcwyc\/pi-agent-desktop/);
    assert.doesNotMatch(
      source,
      /https:\/\/github\.com\/abcwyc\/pi-agent-desktop\/releases/,
      `${path} still sends readers to upstream downloads`,
    );
  }
});

test("reviewed upstream state is strict and squash-merge safe", async () => {
  const source = await readFile(join(root, "scripts", "desktop-upstream-state.json"), "utf8");
  assert.deepEqual(parseDesktopUpstreamState(source), {
    schemaVersion: 1,
    repository: DESKTOP_UPSTREAM_REPOSITORY,
    branch: DESKTOP_UPSTREAM_BRANCH,
    reviewedCommit: null,
  });
  assert.deepEqual(
    parseDesktopUpstreamState(
      JSON.stringify({
        schemaVersion: 1,
        repository: DESKTOP_UPSTREAM_REPOSITORY,
        branch: DESKTOP_UPSTREAM_BRANCH,
        reviewedCommit: "a".repeat(40),
      }),
    ).reviewedCommit,
    "a".repeat(40),
  );
  assert.throws(
    () =>
      parseDesktopUpstreamState(
        JSON.stringify({
          schemaVersion: 1,
          repository: "untrusted/desktop",
          branch: DESKTOP_UPSTREAM_BRANCH,
          reviewedCommit: null,
        }),
      ),
    /Invalid desktop upstream review state/,
  );
});

test("current release destinations pass the standalone sentinel", async () => {
  const files = await readReleaseDestinationFiles(root);
  assert.doesNotThrow(() => verifyReleaseDestinations(files));
});

test("release destination sentinel rejects a different action owner", async () => {
  const files = await readReleaseDestinationFiles(root);
  files[".github/workflows/release.yml"] = files[".github/workflows/release.yml"].replace(
    "owner: Intellinfinity",
    "owner: abcwyc",
  );

  assert.throws(
    () => verifyReleaseDestinations(files),
    /release workflow must target the EduPi release owner/,
  );
});

test("release destination sentinel rejects a different action repository", async () => {
  const files = await readReleaseDestinationFiles(root);
  files[".github/workflows/release.yml"] = files[".github/workflows/release.yml"].replace(
    "repo: edupi-desktop",
    "repo: pi-agent-desktop",
  );

  assert.throws(
    () => verifyReleaseDestinations(files),
    /release workflow must target the EduPi release repository/,
  );
});

test("release destination sentinel rejects updater drift", async () => {
  const files = await readReleaseDestinationFiles(root);
  files["src-tauri/tauri.conf.json"] = files["src-tauri/tauri.conf.json"].replace(
    EDUPI_UPDATER_ENDPOINT,
    "https://github.com/abcwyc/pi-agent-desktop/releases/latest/download/latest.json",
  );

  assert.throws(
    () => verifyReleaseDestinations(files),
    /Tauri updater must list the raw EduPi feed before the migration fallback endpoint/,
  );
});

test("release destination sentinel rejects component manifest drift", async () => {
  const files = await readReleaseDestinationFiles(root);
  files["src-tauri/resources/component-versions.json"] = files[
    "src-tauri/resources/component-versions.json"
  ].replace(EDUPI_RELEASE_REPOSITORY, "abcwyc/pi-agent-desktop");

  assert.throws(
    () => verifyReleaseDestinations(files),
    /desktop component metadata must use the EduPi release repository/,
  );
});
