import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { canonicalEduPiCwd } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-education-server.ts");

test("task-session binding compares canonical cwd identities across macOS path aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "edupi-cwd-alias-"));
  const alias = `${root}-alias`;
  try {
    await symlink(root, alias, "dir");
    assert.equal(canonicalEduPiCwd(alias), realpathSync(root));
    assert.equal(canonicalEduPiCwd(root), realpathSync(root));
  } finally {
    await rm(alias, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("a Core-validated education root becomes readable by the shared file viewer", async () => {
  const source = await readFile(new URL("./edupi-education-server.ts", import.meta.url), "utf8");
  assert.match(source, /setScopedAllowedFileRoots\("edupi-education"/);
  assert.match(source, /\.edupi", "output"/);
  assert.match(source, /\.edupi", "inbox", "teacher-materials"/);
  assert.doesNotMatch(source, /allowFileRoot\(snapshot\.dataRoot\.root\)/);
  assert.ok(source.indexOf("setScopedAllowedFileRoots") < source.indexOf("listAllSessions()"));
});
