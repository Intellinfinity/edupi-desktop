import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, open, lstat, writeFile, rename, symlink, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { readServerForegroundPolicy } = await jiti.import("./edupi-foreground-server.ts");
const foreground = await jiti.import("./edupi-foreground.ts");
const now = new Date("2026-10-07T16:30:00.000Z");

async function withPreferences(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-foreground-native-prefs-"));
  const previous = process.env.PI_DESKTOP_STATE_DIR;
  process.env.PI_DESKTOP_STATE_DIR = root;
  try { await work({ root, file: path.join(root, "foreground-prefs.json") }); }
  finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_STATE_DIR; else process.env.PI_DESKTOP_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("server reads the native foreground file afresh with Shanghai days and a missing-file default", async () => withPreferences(async ({ file }) => {
  assert.deepEqual(await readServerForegroundPolicy(now), { today: "2026-10-08", graceDays: 3, pinnedTaskIds: [] });
  await writeFile(file, JSON.stringify({ graceDays: 0, pinnedTaskIds: ["synthetic-pinned"] }));
  assert.deepEqual(await readServerForegroundPolicy(now), { today: "2026-10-08", graceDays: 0, pinnedTaskIds: ["synthetic-pinned"] });
  await writeFile(file, JSON.stringify({ graceDays: 365, pinnedTaskIds: [], dismissedStaleTaskIds: ["synthetic-dismissed"] }));
  assert.equal((await readServerForegroundPolicy(now)).graceDays, 365, "no cached policy may outlive the user's new threshold");
  delete process.env.PI_DESKTOP_STATE_DIR;
  assert.equal((await readServerForegroundPolicy(now)).graceDays, 3, "absence never reads a HOME fallback");
}));

test("broken, oversized, redirected, and invalid native preferences fail closed instead of returning a permissive default", async () => withPreferences(async ({ root, file }) => {
  for (const value of ["broken", "null", JSON.stringify({ graceDays: -1, pinnedTaskIds: [] }),
    JSON.stringify({ graceDays: 366, pinnedTaskIds: [] }), JSON.stringify({ graceDays: 3.5, pinnedTaskIds: [] }),
    JSON.stringify({ graceDays: 3, pinnedTaskIds: [""] }), JSON.stringify({ graceDays: 3, pinnedTaskIds: [], scope: "all" }),
    JSON.stringify({ graceDays: 3, pinnedTaskIds: [], dismissedStaleTaskIds: "invalid" }), " ".repeat(2_100_001),
    '{"graceDays":3,"graceDays":365,"pinnedTaskIds":[]}',
    '{"graceDays":3,"\\u0067raceDays":365,"pinnedTaskIds":[]}',
    '{"graceDays":365,"pinnedTaskIds":["\\ud800"]}',
    Buffer.concat([Buffer.from('{"graceDays":365,"pinnedTaskIds":["synthetic-'), Buffer.from([0x80]), Buffer.from('"]}')]),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"graceDays":365,"pinnedTaskIds":[]}')])]) {
    await writeFile(file, value);
    await assert.rejects(readServerForegroundPolicy(now));
  }
  const target = path.join(root, "synthetic-target.json");
  await writeFile(target, JSON.stringify({ graceDays: 365, pinnedTaskIds: [] }));
  await rm(file);
  await symlink(target, file);
  await assert.rejects(readServerForegroundPolicy(now));
  process.env.PI_DESKTOP_STATE_DIR = "relative-synthetic-state";
  await assert.rejects(readServerForegroundPolicy(now));
}));

test("an atomic native preference replacement during the read invalidates the old policy", async () => withPreferences(async ({ file }) => {
  await writeFile(file, JSON.stringify({ graceDays: 365, pinnedTaskIds: [] }));
  const replacement = `${file}.replacement`;
  await writeFile(replacement, JSON.stringify({ graceDays: 0, pinnedTaskIds: [] }));
  const source = fs.readFileSync(new URL("./edupi-foreground-server.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const require = createRequire(import.meta.url);
  const dependencies = { "./edupi-foreground": foreground, "node:fs/promises": { lstat, open: async (...args) => {
    const handle = await open(...args);
    let reads = 0;
    return { stat: async () => {
      reads += 1;
      if (reads === 2) await rename(replacement, file);
      return handle.stat();
    }, read: (...readArgs) => handle.read(...readArgs), close: () => handle.close() };
  } } };
  const policyModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => dependencies[name] || require(name), policyModule, policyModule.exports);
  await assert.rejects(policyModule.exports.readServerForegroundPolicy(now), /已变化/);
  assert.equal((await readServerForegroundPolicy(now)).graceDays, 0);
}));
