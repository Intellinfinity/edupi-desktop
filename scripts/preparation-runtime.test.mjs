import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyPackageClosure, copyPreparationDependencies } from "./preparation-runtime.mjs";

test("package closure includes import-only scoped dependencies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-esm-closure-"));
  const destination = await mkdtemp(path.join(os.tmpdir(), "edupi-esm-output-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
    for (const [name, dependencies] of [["parent", { "@example/child": "1" }], ["child", {}]]) {
      const packageDir = path.join(root, "node_modules", "@example", name);
      await mkdir(packageDir, { recursive: true });
      await writeFile(path.join(packageDir, "package.json"), JSON.stringify({
        name: `@example/${name}`, type: "module", exports: { ".": { import: "./index.js" } }, dependencies,
      }));
      await writeFile(path.join(packageDir, "index.js"), "export const ready = true;\n");
    }
    await copyPackageClosure(root, destination, "@example/parent");
    const child = JSON.parse(await readFile(path.join(destination, "node_modules/@example/child/package.json"), "utf8"));
    assert.equal(child.name, "@example/child");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(destination, { recursive: true, force: true });
  }
});

test("package closure preserves nested dependency versions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-nested-closure-"));
  const destination = await mkdtemp(path.join(os.tmpdir(), "edupi-nested-output-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
    const packages = [
      ["@example/parent", "1.0.0", { retry: "^0.12" }],
      ["@example/other", "1.0.0", { retry: "^0.13" }],
      ["@example/parent/node_modules/retry", "0.12.0", {}],
      ["retry", "0.13.1", {}],
    ];
    for (const [name, version, dependencies] of packages) {
      const packageDir = path.join(root, "node_modules", name);
      await mkdir(packageDir, { recursive: true });
      await writeFile(path.join(packageDir, "package.json"), JSON.stringify({ name: name.split("/").at(-1), version, dependencies }));
    }
    const seen = new Set();
    await copyPackageClosure(root, destination, "@example/parent", seen);
    await copyPackageClosure(root, destination, "@example/other", seen);
    const nested = JSON.parse(await readFile(path.join(destination, "node_modules/@example/parent/node_modules/retry/package.json"), "utf8"));
    const topLevel = JSON.parse(await readFile(path.join(destination, "node_modules/retry/package.json"), "utf8"));
    assert.equal(nested.version, "0.12.0");
    assert.equal(topLevel.version, "0.13.1");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(destination, { recursive: true, force: true });
  }
});

test("preparation dependencies load outside the development node_modules", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
  const destination = await mkdtemp(path.join(os.tmpdir(),"edupi-preparation-runtime-"));
  try {
    await copyPreparationDependencies(root,destination);
    for(const file of ["preparation-materials.mjs","preparation-source-text.mjs","office-archive.mjs","preparation-skills.mjs"]) await copyFile(path.join(root,"desktop",file),path.join(destination,file));
    const result = spawnSync(process.execPath,["--input-type=module","-e",'await import("./preparation-materials.mjs"); const s=await import("./preparation-skills.mjs"); const m=await import("mammoth"); if(typeof m.extractRawText!=="function"||typeof s.preparationSkillsPrompt!=="function")process.exit(1); console.log("runtime ready");'],{cwd:destination,encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/runtime ready/);
  } finally {await rm(destination,{recursive:true,force:true});}
});
