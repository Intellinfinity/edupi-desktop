import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const componentUpdates = await readFile(
  join(root, ".github", "workflows", "component-updates.yml"),
  "utf8",
);

test("component updates are manual-only with the permissions the sync needs", () => {
  assert.match(componentUpdates, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(componentUpdates, /schedule:/);
  assert.doesNotMatch(componentUpdates, /actions: write/);
  assert.match(componentUpdates, /contents: write/);
  assert.match(componentUpdates, /pull-requests: write/);
  assert.match(componentUpdates, /issues: write/);
  assert.doesNotMatch(componentUpdates, /codex\/component-updates/);
});

test("the boundary is classified before the merge, not after", () => {
  // Once a merge commit exists the incoming changeset can no longer be
  // recovered with a plain diff, so ordering here is load-bearing.
  const classifyAt = componentUpdates.indexOf("fork-ownership.mjs classify");
  const mergeAt = componentUpdates.indexOf("git merge --no-edit --no-ff");
  assert.ok(classifyAt > -1, "sync must classify the upstream changeset");
  assert.ok(mergeAt > -1, "sync must still merge the upstream tag");
  assert.ok(classifyAt < mergeAt, "classification must run before the merge");
});

test("every component sync opens a review PR and never pushes main", () => {
  const reviewStep = componentUpdates.slice(componentUpdates.indexOf("Open a review PR"));
  assert.match(
    reviewStep,
    /steps\.releases\.outputs\.needs_update == 'true' && steps\.pending\.outputs\.awaiting_review != 'true'/,
  );
  assert.match(reviewStep, /git push --force-with-lease origin "HEAD:refs\/heads\/\$branch"/);
  assert.match(reviewStep, /branch="sync\/components-\$PI_VERSION-\$PI_WEB_TAG"/);
  assert.match(reviewStep, /gh pr create/);
  assert.doesNotMatch(componentUpdates, /git push origin HEAD:main/);
  assert.doesNotMatch(componentUpdates, /gh workflow run release\.yml/);
});

test("the signed release workflow is manual-only", async () => {
  const release = await readFile(join(root, ".github", "workflows", "release.yml"), "utf8");
  assert.match(release, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(release, /\bpush:/);
  assert.ok(release.indexOf("name: Verify application quality") < release.indexOf("name: Check out the pinned EduPi Core runtime"));
  assert.match(release, /tauriScript: npx tauri/);
});

test("signed releases and updater metadata belong to the EduPi Desktop repository", async () => {
  const release = await readFile(join(root, ".github", "workflows", "release.yml"), "utf8");
  const tauriConfig = JSON.parse(await readFile(join(root, "src-tauri", "tauri.conf.json"), "utf8"));

  assert.doesNotMatch(release, /EDUPI_RELEASE_TOKEN/);
  assert.match(release, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(release, /owner:\s*PIGU-PPPgu/);
  assert.match(release, /repo:\s*edupi-desktop/);
  assert.match(release, /--arg target "\$GITHUB_SHA"/);
  assert.match(release, /target_commitish: \$target/);
  assert.match(release, /releaseId: \$\{\{ needs\.release\.outputs\.release_id \}\}/);
  assert.match(release, /repos\/\$RELEASE_REPOSITORY\/releases/);
  assert.doesNotMatch(release, /abcwyc\/pi-agent-desktop/);
  assert.deepEqual(tauriConfig.plugins.updater.endpoints, [
    "https://github.com/PIGU-PPPgu/edupi-desktop/releases/latest/download/latest.json",
  ]);
  assert.equal(tauriConfig.identifier, "com.abcwyc.pi-agent");
});

test("the merge gate covers tests, types, lint and a real build", () => {
  assert.match(componentUpdates, /npm test/);
  assert.match(componentUpdates, /tsc --noEmit/);
  assert.match(componentUpdates, /npm run lint/);
  assert.match(componentUpdates, /PI_WEB_DESKTOP_BUILD=1 node_modules\/\.bin\/next build/);
});

test("npm test covers every test directory, recursively", async () => {
  // Upstream ships components/*.test.mjs covering fork-modified files, and the
  // sync gate once ran only lib/ and scripts/, silently skipping them nightly.
  // The globs must recurse too: a flat components/*.test.mjs skips the
  // fork-owned tests under components/desktop/.
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  for (const dir of ["app", "lib", "scripts", "components", "hooks", "desktop"]) {
    assert.match(
      pkg.scripts.test,
      new RegExp(`${dir}/\\*\\*/\\*\\.test\\.mjs`),
      `npm test must recurse into ${dir}/`,
    );
  }
});

test("no test file is left out of npm test", async () => {
  // Catches a test added in a directory the globs do not cover.
  const { execFileSync } = await import("node:child_process");
  const tracked = execFileSync("git", ["ls-files", "*.test.mjs"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  const covered = tracked.filter((file) => /^(app|lib|scripts|components|hooks|desktop)\//.test(file));
  assert.deepEqual(
    tracked.filter((file) => !covered.includes(file)),
    [],
    "a .test.mjs file lives outside the configured test directories — extend npm test",
  );
});

test("a sync already awaiting review is skipped, not retried nightly", () => {
  // needs_update stays true while a review PR is open, so without this guard
  // the job would rebuild and collide with its own branch every night — and
  // file a failure issue each time.
  const pending = componentUpdates.slice(
    componentUpdates.indexOf("Skip if this sync is already awaiting review"),
    componentUpdates.indexOf("Classify the upstream changeset"),
  );
  assert.match(pending, /if: steps\.releases\.outputs\.needs_update == 'true'/);
  assert.match(pending, /PI_VERSION: \$\{\{ steps\.releases\.outputs\.pi_version \}\}/);
  assert.match(pending, /PI_WEB_TAG: \$\{\{ steps\.releases\.outputs\.pi_web_tag \}\}/);
  assert.match(pending, /branch="sync\/components-\$PI_VERSION-\$PI_WEB_TAG"/);
  assert.match(pending, /gh pr list[\s\S]{0,160}--head "\$branch"/);
  assert.match(componentUpdates, /awaiting_review=true/);

  const gated = componentUpdates
    .slice(componentUpdates.indexOf("Classify the upstream changeset"))
    .split("\n")
    .filter((line) => line.trimStart().startsWith("if: steps.releases.outputs.needs_update"));
  assert.ok(gated.length >= 3, "expected the sync/verify/publish steps to be gated");
  for (const line of gated) {
    assert.match(line, /steps\.pending\.outputs\.awaiting_review != 'true'/);
  }
});

test("a failed sync is reported instead of failing silently", () => {
  assert.match(componentUpdates, /if: failure\(\)/);
  assert.match(componentUpdates, /gh issue create/);
  assert.match(componentUpdates, /component-sync-failure/);
});

test("failure alerts do not depend on Issues being enabled", async () => {
  // This repository has Issues disabled, so the original issue-only alerts
  // failed silently and reported nothing at all. The job summary always works.
  const release = await readFile(join(root, ".github", "workflows", "release.yml"), "utf8");

  for (const [name, workflow] of [["component-updates", componentUpdates], ["release", release]]) {
    assert.match(workflow, /GITHUB_STEP_SUMMARY/, `${name} must always write a job summary`);
    assert.match(
      workflow,
      /has_issues/,
      `${name} must check whether Issues are enabled before using them`,
    );
  }
});

test("the pi package list is derived, never hand-written in the workflow", () => {
  assert.match(componentUpdates, /scripts\/pi-packages\.mjs --install-spec/);
  assert.doesNotMatch(componentUpdates, /@earendil-works\/pi-coding-agent@/);
  assert.doesNotMatch(componentUpdates, /@earendil-works\/pi-tui@/);
});

test("history is never rewritten on main", () => {
  // --force-with-lease on the disposable sync branch is fine; a bare --force
  // anywhere, or any force push to main, is not.
  assert.doesNotMatch(componentUpdates, /--force(?!-with-lease)/);
  assert.doesNotMatch(componentUpdates, /push .*--force-with-lease origin HEAD:main/);
});

test("a failed release build is reported instead of failing silently", async () => {
  // Four consecutive v0.1.3 builds failed on Windows with no notification, and
  // the draft was published by hand with macOS artifacts and no manifest.
  const workflow = await readFile(join(root, ".github", "workflows", "release.yml"), "utf8");

  assert.match(workflow, /if: failure\(\)/);
  assert.match(workflow, /gh issue create/);
  assert.match(workflow, /release-failure/);
  assert.match(workflow, /needs: \[release, build, manifest\]/);
});

test("the manifest job only publishes when every platform succeeded", async () => {
  // `needs: build` covers the whole matrix, so one failed platform keeps the
  // release a draft. Publishing a release that is missing a platform's
  // installer or its component manifest breaks updates for that platform.
  const workflow = await readFile(join(root, ".github", "workflows", "release.yml"), "utf8");
  const manifestJob = workflow.slice(workflow.indexOf("\n  manifest:"), workflow.indexOf("\n  notify:"));

  assert.match(manifestJob, /needs: \[release, build\]/);
  assert.doesNotMatch(manifestJob, /if: (always|success\(\) \|\|)/);
  assert.match(manifestJob, /scripts\/updater-manifest\.mjs/);
  assert.match(manifestJob, /-F draft=false/);
  assert.match(manifestJob, /-f make_latest=true/);
});

test("parallel builders share one commit-bound draft release", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "release.yml"), "utf8");
  const releaseJob = workflow.slice(workflow.indexOf("\n  release:"), workflow.indexOf("\n  build:"));
  const buildJob = workflow.slice(workflow.indexOf("\n  build:"), workflow.indexOf("\n  manifest:"));

  assert.match(releaseJob, /Create one draft release/);
  assert.match(releaseJob, /release_count.*-gt 1/);
  assert.match(releaseJob, /release_draft.*!= "true"/);
  assert.match(releaseJob, /release_target.*!= "\$GITHUB_SHA"/);
  assert.match(buildJob, /needs: release/);
  assert.match(buildJob, /releaseId: \$\{\{ needs\.release\.outputs\.release_id \}\}/);
  assert.match(buildJob, /tagName: \$\{\{ needs\.release\.outputs\.tag \}\}/);
  assert.doesNotMatch(buildJob, /releaseCommitish:/);
});

test("release workflow publishes Apple Silicon, Linux x64, and Windows x64 installers", async () => {
  const workflow = await readFile(
    join(root, ".github", "workflows", "release.yml"),
    "utf8",
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /max-parallel: 3/);
  assert.match(workflow, /'macos-15'/);
  assert.match(workflow, /\["aarch64-apple-darwin"\]/);
  assert.match(workflow, /'ubuntu-24\.04'/);
  assert.match(workflow, /\["x86_64-unknown-linux-gnu"\]/);
  assert.match(workflow, /'deb,appimage'/);
  assert.match(workflow, /libwebkit2gtk-4\.1-dev/);
  assert.match(workflow, /libayatana-appindicator3-dev/);
  assert.match(workflow, /'windows-latest'/);
  assert.match(workflow, /\["x86_64-pc-windows-msvc"\]/);
  assert.match(workflow, /'nsis'/);
  assert.match(workflow, /EduPi_aarch64\.app\.tar\.gz\.sig/);
  assert.match(workflow, /EduPi_\$\{RELEASE_VERSION\}_x64-setup\.exe\.sig/);
  assert.doesNotMatch(workflow, /x86_64-apple-darwin/);
  assert.doesNotMatch(workflow, /macos-15-intel/);
  assert.match(workflow, /includeUpdaterJson: false/);
  assert.doesNotMatch(workflow, /uploadUpdaterJson:/);
  assert.doesNotMatch(workflow, /gh release download .*latest\.json/);
  assert.match(workflow, /https:\/\/uploads\.github\.com\/repos\/\$RELEASE_REPOSITORY\/releases\/\$RELEASE_ID\/assets\?name=latest\.json/);
});

test("release validates the Cargo lock before packaging any platform", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "release.yml"), "utf8");
  const rustSetup = workflow.indexOf("name: Set up Rust");
  const lockValidation = workflow.indexOf("name: Validate Cargo lockfile");
  const packageBuild = workflow.indexOf("name: Prepare packaged Next.js server");
  assert.ok(rustSetup >= 0 && lockValidation > rustSetup && packageBuild > lockValidation);
  assert.match(workflow, /cargo metadata --locked --no-deps --manifest-path src-tauri\/Cargo\.toml --format-version 1/);
});

test("macOS releases accept stable Developer ID signing without hiding the ad-hoc fallback", async () => {
  const workflow = await readFile(
    join(root, ".github", "workflows", "release.yml"),
    "utf8",
  );

  assert.match(workflow, /CODE_SIGN_CERTIFICATE: \$\{\{ secrets\.APPLE_CERTIFICATE \}\}/);
  assert.match(workflow, /CODE_SIGN_CERTIFICATE_PASSWORD: \$\{\{ secrets\.APPLE_CERTIFICATE_PASSWORD \}\}/);
  assert.match(workflow, /CODE_SIGN_IDENTITY: \$\{\{ secrets\.APPLE_SIGNING_IDENTITY \}\}/);
  assert.match(workflow, /append_env "APPLE_CERTIFICATE=\$CODE_SIGN_CERTIFICATE"/);
  assert.match(workflow, /append_env "APPLE_CERTIFICATE_PASSWORD=\$CODE_SIGN_CERTIFICATE_PASSWORD"/);
  assert.match(workflow, /append_env "APPLE_ID=\$NOTARY_APPLE_ID"/);
  assert.match(workflow, /append_env "APPLE_PASSWORD=\$NOTARY_PASSWORD"/);
  assert.match(workflow, /append_env "APPLE_TEAM_ID=\$NOTARY_TEAM_ID"/);
  assert.match(workflow, /append_env "APPLE_SIGNING_IDENTITY=-"/);
  assert.match(workflow, /macOS is ad-hoc signed; Accessibility and Screen Recording grants may need to be renewed after an update/);
  assert.doesNotMatch(workflow, /APPLE_SIGNING_IDENTITY: \$\{\{ runner\.os == 'macOS'/);
  assert.doesNotMatch(workflow, /\n\s{10}APPLE_(?:CERTIFICATE|ID|PASSWORD|TEAM_ID): \$\{\{ secrets\./);
});

test("the published Linux installer workflow verifies a real packaged Core startup", async () => {
  const workflow = await readFile(
    join(root, ".github", "workflows", "linux-published-install.yml"),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /gh release download/);
  assert.match(workflow, /\*_amd64\.deb/);
  assert.match(workflow, /dpkg-deb -f/);
  assert.match(workflow, /apt-get install --yes "\$EDUPI_DEB"/);
  assert.match(workflow, /xvfb-run/);
  assert.match(workflow, /EDUPI_DATA_ROOT/);
  assert.match(workflow, /api\/edupi\/status\?summary=1/);
  assert.match(workflow, /core.*status.*ready/);
});

test("nothing reintroduces a literal homedir() into an fs call", async () => {
  // This is what broke the Windows build for every release: @vercel/nft folds
  // homedir() at build time and globs the whole user profile, which dies on the
  // profile's junction loops. lib/user-home.ts exists to keep it dynamic.
  const guarded = [
    "lib/file-access.ts",
    "lib/directory-browser.ts",
    "lib/skill-lock.ts",
    "app/api/cwd/validate/route.ts",
    "app/api/default-cwd/route.ts",
  ];

  for (const file of guarded) {
    const source = await readFile(join(root, file), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(
      code,
      /\bhomedir\s*\(/,
      `${file} calls homedir() directly — use userHome() from lib/user-home.ts instead`,
    );
    assert.match(code, /userHome\s*\(/, `${file} should resolve the home directory via userHome()`);
  }
});

test("every Next.js build keeps output tracing inside the repository", async () => {
  const config = await readFile(join(root, "next.config.ts"), "utf8");
  const beforeDesktopBranch = config.slice(0, config.indexOf("...(isDesktopBuild"));
  assert.match(beforeDesktopBranch, /outputFileTracingRoot: __dirname/);
});

test("the packaged server reads EduPi roots at runtime instead of baking build-machine paths", async () => {
  const config = await readFile(join(root, "next.config.ts"), "utf8");
  assert.doesNotMatch(config, /env:\s*\{[\s\S]*EDUPI_PROJECT_ROOT/);
  const launcher = await readFile(join(root, "desktop", "server-launcher.cjs"), "utf8");
  assert.match(launcher, /resolveEduPiLaunchRoots\(environment = process\.env\)/);
  assert.match(launcher, /EDUPI_PROJECT_ROOT/);
});

test("the Windows debug workflow cannot release or sign anything", async () => {
  const workflow = await readFile(
    join(root, ".github", "workflows", "windows-build-debug.yml"),
    "utf8",
  );

  // Manual only, and it must never touch signing keys or create a release.
  assert.match(workflow, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.doesNotMatch(workflow, /tauri-action/);
  assert.doesNotMatch(workflow, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.doesNotMatch(workflow, /gh release/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /trace-stray-scandir\.cjs/);
});

test("every packaged workflow checks out the exact pinned Core runtime", async () => {
  const workflows = await Promise.all([
    readFile(join(root, ".github", "workflows", "preview-installers.yml"), "utf8"),
    readFile(join(root, ".github", "workflows", "release.yml"), "utf8"),
    readFile(join(root, ".github", "workflows", "windows-build-debug.yml"), "utf8"),
  ]);
  for (const workflow of workflows) {
    assert.match(workflow, /contracts\/edupi-core-compat\.json/);
    assert.match(workflow, /repository: PIGU-PPPgu\/edupi/);
    assert.match(workflow, /ref: \$\{\{ steps\.core\.outputs\.commit \}\}/);
    assert.match(workflow, /ssh-key: \$\{\{ secrets\.EDUPI_CORE_DEPLOY_KEY \}\}/);
    assert.match(
      workflow,
      /token: \$\{\{ secrets\.EDUPI_CORE_READ_TOKEN \|\| github\.token \}\}/,
      "public Core checkout must remain usable without an optional private-mirror secret",
    );
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /git -C \.edupi-core-runtime config core\.autocrlf false/);
    assert.match(workflow, /git -C \.edupi-core-runtime checkout-index --all --force/);
    assert.match(workflow, /npm ci --ignore-scripts --prefix \.edupi-core-runtime/);
    assert.match(workflow, /EDUPI_CORE_ROOT: \$\{\{ github\.workspace \}\}\/\.edupi-core-runtime/);
    assert.doesNotMatch(workflow, /git checkout (main|master|latest)/i);
  }
});

test("all packaged platform configs carry the bundled Core and third-party notices", async () => {
  const [base, windows, linux, dev] = await Promise.all([
    readFile(join(root, "src-tauri", "tauri.conf.json"), "utf8"),
    readFile(join(root, "src-tauri", "tauri.windows.conf.json"), "utf8"),
    readFile(join(root, "src-tauri", "tauri.linux.conf.json"), "utf8"),
    readFile(join(root, "src-tauri", "tauri.dev.conf.json"), "utf8"),
  ]);
  for (const source of [base, windows, linux]) {
    assert.match(source, /resources\/edupi-core/);
    assert.match(source, /resources\/third-party/);
  }
  assert.deepEqual(JSON.parse(dev).bundle.resources, []);
});
