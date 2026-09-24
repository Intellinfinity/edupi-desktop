import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

const managedMode = process.argv.includes("--managed");
if (process.argv.slice(2).some((value) => value !== "--managed")
  || process.argv.filter((value) => value === "--managed").length > 1) {
  throw new Error("Only --managed is supported");
}

const resources = process.env.EDUPI_STAGED_RESOURCES;
if (!resources || !path.isAbsolute(resources)) throw new Error("EDUPI_STAGED_RESOURCES must be an absolute path");
const catalogRoot = path.join(resources, "open-connector");
const host = path.join(catalogRoot, "host.mjs");
const packageRoot = path.join(catalogRoot, "node_modules", "@oomol-lab", "open-connector");
for (const file of [host, path.join(packageRoot, "package.json"), path.join(packageRoot, "LICENSE.txt"), path.join(packageRoot, "NOTICE.md")]) {
  await access(file);
}

const dataDir = await mkdtemp(path.join(os.tmpdir(), "edupi-openconnector-staged-"));
const nodeExecutable = process.env.EDUPI_STAGED_NODE || process.execPath;
await access(nodeExecutable);
const child = spawn(nodeExecutable, [host, dataDir], {
  cwd: catalogRoot,
  env: { NODE_ENV: "production", PATH: process.env.PATH },
  stdio: ["pipe", "pipe", "pipe"],
});
let errorTail = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { errorTail = (errorTail + chunk).slice(-1000); });
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();

async function nextLine() {
  let timer;
  try {
    const result = await Promise.race([
      lines.next(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("catalog host timed out")), 15_000); }),
    ]);
    if (result.done) throw new Error("catalog host exited: " + errorTail);
    return JSON.parse(result.value);
  } finally {
    clearTimeout(timer);
  }
}

async function request(value) {
  child.stdin.write(JSON.stringify(value) + "\n");
  return nextLine();
}

async function waitForExit() {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
  let timer;
  try {
    return await Promise.race([
      new Promise((resolveExit, rejectExit) => {
        child.once("error", rejectExit);
        child.once("exit", resolveExit);
      }),
      new Promise((_, rejectExit) => {
        timer = setTimeout(() => rejectExit(new Error("catalog host did not close")), 5_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

try {
  assert.deepEqual(await nextLine(), { type: "ready", version: 1 });
  const providers = await request({ id: "providers", op: "providers" });
  assert.equal(providers.ok, true);
  assert.ok(Array.isArray(providers.data) && providers.data.length > 100);
  const search = await request({ id: "search", op: "search", query: "calendar" });
  assert.equal(search.ok, true);
  assert.ok(Array.isArray(search.data) && search.data.length > 0);
  assert.ok(search.data.every((action) => typeof action.id === "string" && action.id.includes(".")));
  const inspect = await request({ id: "inspect", op: "inspect", actionId: "npm.get_package" });
  assert.equal(inspect.ok, true);
  assert.equal(inspect.data.id, "npm.get_package");
  assert.deepEqual(await request({ id: "execute", op: "execute", actionId: "npm.get_package", input: {} }), {
    id: null, ok: false, code: "invalid_catalog_request",
  });
  child.stdin.end();
  const exitCode = await waitForExit();
  assert.equal(exitCode, 0, errorTail);
  if (managedMode) {
    const { createJiti } = await import("jiti");
    const { runCatalogQuery } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../lib/openconnector-catalog-process.ts");
    const managed = await runCatalogQuery({ op: "search", query: "calendar" }, { root: catalogRoot, nodeExecutable });
    assert.equal(managed.kind, "search");
    assert.ok(managed.actions.length > 0);
    const inspected = await runCatalogQuery({ op: "inspect", actionId: "npm.get_package" }, { root: catalogRoot, nodeExecutable });
    assert.equal(inspected.kind, "inspect");
    assert.ok(inspected.fields.some((field) => field.name === "packageName" && field.required));
  }
  console.log(JSON.stringify({ status: "passed", catalog: true, inspect: true, execute_blocked: true, managed: managedMode }));
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((resolveExit) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolveExit(); }, 3_000);
      child.once("exit", () => { clearTimeout(timer); resolveExit(); });
      child.kill("SIGTERM");
    });
  }
  await rm(dataDir, { recursive: true, force: true });
}
