import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function trackedFiles(...patterns) {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...patterns], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

function actionReferences(source) {
  return [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)].map(
    (match) => match[1],
  );
}

test("public source contains no maintainer workstation path", async () => {
  const textFiles = trackedFiles().filter(
    (path) => !/\.(?:ico|icns|png|jpe?g|gif|webp|woff2?|ttf|zip|gz)$/i.test(path),
  );

  for (const path of textFiles) {
    const source = await readFile(join(root, path), "utf8").catch((error) => {
      if (error?.code === "ENOENT") return null; // A tracked file may be deleted in the current diff.
      throw error;
    });
    if (source === null) continue;
    assert.doesNotMatch(source, /\/Users\/iguppp|\.openclaw\/workspace\/edupi/);
  }
});

test("every external GitHub Action is pinned to a commit", async () => {
  for (const path of trackedFiles(".github/workflows/*.yml", ".github/workflows/*.yaml")) {
    const source = await readFile(join(root, path), "utf8");
    const references = actionReferences(source);

    for (const reference of references) {
      if (reference.startsWith("./")) continue;
      assert.match(reference, /@[0-9a-f]{40}$/, `${path}: ${reference}`);
    }
  }
});

test("action pin parser covers named and shorthand YAML steps", () => {
  assert.deepEqual(
    actionReferences("steps:\n  - uses: owner/short@v1\n  - name: Long\n    uses: owner/long@v2\n"),
    ["owner/short@v1", "owner/long@v2"],
  );
});

test("public security reporting and canonical source links are present", async () => {
  const security = await readFile(join(root, "SECURITY.md"), "utf8");
  const readme = await readFile(join(root, "README.edupi.md"), "utf8");
  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

  assert.match(security, /security\/advisories\/new/);
  assert.match(readme, /github\.com\/Intellinfinity\/edupi-desktop/);
  assert.doesNotMatch(readme, /Private EduPi source/);
  assert.equal(packageJson.private, true, "the desktop fork must not publish the upstream npm name");
  assert.equal(packageJson.repository.url, "git+https://github.com/Intellinfinity/edupi-desktop.git");
  assert.equal(packageJson.scripts.release, undefined);
  assert.match(gitignore, /^\/\.pi\/$/m);
  assert.match(gitignore, /^\/src-tauri\/resources\/node\/$/m);
});

test("historical Desktop PR links point to the preserved internal archive", async () => {
  for (const path of trackedFiles("*.md", "*.json")) {
    const source = await readFile(join(root, path), "utf8");
    // PR #46 consolidated releases; later PRs are current public work, not archive links.
    assert.doesNotMatch(source, /github\.com\/PIGU-PPPgu\/edupi-desktop\/pull\/(?:[1-9]|[1-3]\d|4[0-5])(?:\D|$)/);
  }
});
