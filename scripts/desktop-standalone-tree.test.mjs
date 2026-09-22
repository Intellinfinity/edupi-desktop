import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { copyDesktopStandaloneTree, verifyDesktopServerRuntime } from "./desktop-standalone-tree.mjs";

test("copies a real standalone node_modules tree without local state", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "edupi-standalone-tree-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const standaloneRoot = join(temporaryRoot, "standalone");
  const destinationRoot = join(temporaryRoot, "staged");
  const nextRuntime = join(standaloneRoot, "node_modules", "next", "dist", "server", "lib");
  await mkdir(nextRuntime, { recursive: true });
  await writeFile(join(standaloneRoot, "server.js"), "require('next');\n", "utf8");
  await writeFile(join(standaloneRoot, ".env.local"), "SECRET=must-not-copy\n", "utf8");
  await writeFile(join(standaloneRoot, "node_modules", "next", "package.json"), '{"name":"next"}\n', "utf8");
  await writeFile(join(nextRuntime, "start-server.js"), "export {};\n", "utf8");
  for (const packageName of ["react", "react-dom"]) {
    const packageRoot = join(standaloneRoot, "node_modules", packageName);
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), `{"name":"${packageName}"}\n`, "utf8");
  }

  const result = await copyDesktopStandaloneTree({ standaloneRoot, destinationRoot });
  await verifyDesktopServerRuntime(destinationRoot);

  assert.equal(result.nodeModulesMode, "directory");
  assert.equal(await readFile(join(destinationRoot, "server.js"), "utf8"), "require('next');\n");
  assert.equal(
    await readFile(join(destinationRoot, "node_modules", "next", "dist", "server", "lib", "start-server.js"), "utf8"),
    "export {};\n",
  );
  await assert.rejects(access(join(destinationRoot, ".env.local")));
});

test("rejects a staged server that could borrow Next from a source ancestor", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "edupi-staged-runtime-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const destinationRoot = join(temporaryRoot, "staged");
  await mkdir(destinationRoot, { recursive: true });

  await assert.rejects(
    verifyDesktopServerRuntime(destinationRoot),
    /missing node_modules\/next\/package\.json/,
  );
});

test("leaves a symlinked standalone node_modules tree for trace expansion", {
  skip: process.platform === "win32",
}, async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "edupi-linked-standalone-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const standaloneRoot = join(temporaryRoot, "standalone");
  const linkedNodeModules = join(temporaryRoot, "project-node-modules");
  const destinationRoot = join(temporaryRoot, "staged");
  await mkdir(linkedNodeModules, { recursive: true });
  await mkdir(standaloneRoot, { recursive: true });
  await writeFile(join(standaloneRoot, "server.js"), "require('next');\n", "utf8");
  await symlink(linkedNodeModules, join(standaloneRoot, "node_modules"), "dir");

  const result = await copyDesktopStandaloneTree({ standaloneRoot, destinationRoot });

  assert.equal(result.nodeModulesMode, "symlink");
  assert.equal(await readFile(join(destinationRoot, "server.js"), "utf8"), "require('next');\n");
  await assert.rejects(access(join(destinationRoot, "node_modules")));
});

test("rejects nested symlinks instead of packaging build-machine paths", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "edupi-standalone-link-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const standaloneRoot = join(temporaryRoot, "standalone");
  const destinationRoot = join(temporaryRoot, "staged");
  const packageRoot = join(standaloneRoot, "node_modules", "next");
  const outside = join(temporaryRoot, "outside.js");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(standaloneRoot, "server.js"), "require('next');\n", "utf8");
  await writeFile(outside, "export {};\n", "utf8");
  await symlink(outside, join(packageRoot, "escaped.js"));

  await assert.rejects(
    copyDesktopStandaloneTree({ standaloneRoot, destinationRoot }),
    /contains a symbolic link: node_modules\/next\/escaped\.js/,
  );
});

test("final verification rejects a symlink added by a later public copy", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "edupi-final-server-link-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const destinationRoot = join(temporaryRoot, "staged");
  const nextRuntime = join(destinationRoot, "node_modules", "next", "dist", "server", "lib");
  await mkdir(nextRuntime, { recursive: true });
  await writeFile(join(destinationRoot, "node_modules", "next", "package.json"), '{"name":"next"}\n', "utf8");
  await writeFile(join(nextRuntime, "start-server.js"), "export {};\n", "utf8");
  for (const packageName of ["react", "react-dom"]) {
    const packageRoot = join(destinationRoot, "node_modules", packageName);
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), `{"name":"${packageName}"}\n`, "utf8");
  }
  const outside = join(temporaryRoot, "outside.txt");
  const publicRoot = join(destinationRoot, "public");
  await mkdir(publicRoot, { recursive: true });
  await writeFile(outside, "outside\n", "utf8");
  await symlink(outside, join(publicRoot, "escaped.txt"));

  await assert.rejects(
    verifyDesktopServerRuntime(destinationRoot),
    /contains a symbolic link: public\/escaped\.txt/,
  );
});

test("the final server audit runs after every server augmentation", async () => {
  const source = await readFile(new URL("./prepare-desktop.mjs", import.meta.url), "utf8");
  const verifyAt = source.lastIndexOf("await verifyDesktopServerRuntime(serverResourcesDir)");
  assert.ok(verifyAt > source.indexOf("await copyPreparationDependencies"));
  assert.ok(verifyAt > source.indexOf("await cp(publicDir"));
  assert.ok(verifyAt > source.indexOf("await copyRuntimeModelHostFiles"));
});
