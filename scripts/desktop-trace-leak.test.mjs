import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupStandaloneTraceLeak, planStandaloneTraceLeakCleanup } from "./desktop-trace-leak.mjs";

async function fixture(t) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "edupi-trace-leak-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const rootDir = path.join(temporaryRoot, "workspace", "worktrees", "feature");
  const sourceNodeModules = path.join(temporaryRoot, "workspace", "source-project", "node_modules");
  const standaloneDir = path.join(rootDir, ".next-desktop", "standalone");
  await mkdir(sourceNodeModules, { recursive: true });
  await mkdir(standaloneDir, { recursive: true });
  await symlink(sourceNodeModules, path.join(rootDir, "node_modules"), "dir");
  return { rootDir, standaloneDir };
}

test("removes only the absent-before-build trace leak produced by a symlinked worktree", async (t) => {
  const fixturePaths = await fixture(t);
  const plan = await planStandaloneTraceLeakCleanup(fixturePaths);
  assert.equal(plan.leakRoot, path.join(plan.rootDir, "source-project"));
  await mkdir(path.join(plan.leakRoot, "node_modules", "next"), { recursive: true });
  await writeFile(path.join(plan.leakRoot, "node_modules", "next", "index.js"), "generated\n");
  await cleanupStandaloneTraceLeak(plan);
  await assert.rejects(access(plan.leakRoot));
});

test("refuses to clean a path that existed before the build", async (t) => {
  const fixturePaths = await fixture(t);
  const preexisting = path.join(fixturePaths.rootDir, "source-project");
  await mkdir(preexisting, { recursive: true });
  await writeFile(path.join(preexisting, "keep.txt"), "user data\n");
  await assert.rejects(planStandaloneTraceLeakCleanup(fixturePaths), /already exists/);
  assert.equal(await access(path.join(preexisting, "keep.txt")).then(() => true), true);
});

test("does nothing when node_modules is a regular directory", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "edupi-trace-regular-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const rootDir = path.join(temporaryRoot, "project");
  const standaloneDir = path.join(rootDir, ".next-desktop", "standalone");
  await mkdir(path.join(rootDir, "node_modules"), { recursive: true });
  await mkdir(standaloneDir, { recursive: true });
  assert.equal(await planStandaloneTraceLeakCleanup({ rootDir, standaloneDir }), null);
  await cleanupStandaloneTraceLeak(null);
});
