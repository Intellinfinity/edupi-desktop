import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyCoreRuntimeStartupError, createParentModelExecutor, startCoreRuntimeHost } from "./core-runtime-host.mjs";

test("runtime startup errors expose only bounded operational categories", () => {
  assert.equal(classifyCoreRuntimeStartupError({ code: "database_unavailable", message: "/private/teacher/data" }), "runtime_database_unavailable");
  assert.equal(classifyCoreRuntimeStartupError({ code: "invalid_state" }), "runtime_state_invalid");
  assert.equal(classifyCoreRuntimeStartupError({ code: "writer_admission_unavailable" }), "runtime_writer_unavailable");
  assert.equal(classifyCoreRuntimeStartupError({ code: "layout_mismatch" }), "runtime_root_invalid");
  assert.equal(classifyCoreRuntimeStartupError({ code: "writer_admission_root_mismatch" }), "runtime_root_invalid");
  assert.equal(classifyCoreRuntimeStartupError({ code: "unexpected_private_detail" }), "runtime_unavailable");
  assert.equal(classifyCoreRuntimeStartupError(null), "runtime_unavailable");
});

test("runtime host child reports a classified startup failure without private details", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-runtime-host-error-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(root, "scripts/core_runtime_daemon.mjs"), `
    export async function createCoreRuntimeDaemon() {
      throw Object.assign(new Error("private teacher path: ${root}"), { code: "database_unavailable" });
    }
  `);
  const child = fork(fileURLToPath(new URL("./core-runtime-host.mjs", import.meta.url)), [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  const message = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("runtime host did not report startup failure")), 5_000);
    child.once("message", (value) => { clearTimeout(timer); resolve(value); });
  });
  child.send({ type: "runtime-start", coreRoot: root, options: { dataRoot: root, token: "private-token", supervisorSessionId: "private-session", coreCommit: "a".repeat(40), componentManifestHash: `sha256:${"b".repeat(64)}`, port: 0 } });
  assert.deepEqual(await message, { type: "runtime-error", code: "runtime_database_unavailable" });
  assert.equal(await exited, 1);
});

test("private model IPC correlates results, forwards cancellation and rejects on disconnect", async () => {
  const channel = new EventEmitter(); channel.connected = true;
  const sent = []; channel.send = (value, callback) => { sent.push(value); callback?.(); };
  const host = createParentModelExecutor(channel);
  const controller = new AbortController();
  const request = { deadline_at: new Date(Date.now() + 20000).toISOString(), input: { title: "Synthetic" } };
  const running = host.run(request, { signal: controller.signal });
  const id = sent[0].id;
  assert.deepEqual(sent[0], { type: "model-run", id, request });
  controller.abort();
  assert.deepEqual(sent[1], { type: "model-cancel", id });
  channel.emit("message", { type: "unrelated", id, result: "ignored" });
  channel.emit("message", { type: "model-result", id: "wrong", result: "ignored" });
  channel.emit("message", { type: "model-result", id, result: { ok: false, error_code: "cancelled" } });
  assert.deepEqual(await running, { ok: false, error_code: "cancelled" });
  const disconnected = host.run(request, { signal: new AbortController().signal });
  channel.connected = false; channel.emit("disconnect");
  await assert.rejects(disconnected, { code: "model_unavailable" });
  host.close();
});

test("runtime host forwards explicit ambient planning activation to Core", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-runtime-host-ambient-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(root, "scripts/core_runtime_daemon.mjs"), `
    let received = null;
    export async function createCoreRuntimeDaemon(options) {
      received = options;
      return { async close() {} };
    }
    export function lastOptions() { return received; }
  `);
  const channel = new EventEmitter();
  channel.connected = true;
  channel.send = () => {};
  const host = await startCoreRuntimeHost({
    coreRoot: root,
    options: { dataRoot: root, token: "token", supervisorSessionId: "session", coreCommit: "a".repeat(40), componentManifestHash: `sha256:${"b".repeat(64)}`, port: 0, ambientPlanning: true },
  }, channel);
  const { lastOptions } = await import(path.join(root, "scripts/core_runtime_daemon.mjs"));
  assert.equal(lastOptions().ambientPlanning, true);
  await host.close();
});
