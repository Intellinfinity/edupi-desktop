#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = fs.readFileSync(path.join(root, "lib/edupi-ambient-message.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022 } }).outputText;
const identity = { sessionId: "synthetic-pi-session", messageId: "prompt-stable-client-request",
  occurredAt: "2026-10-08T00:00:00.000Z" };

function client(directory) {
  const file = path.join(directory, "native-outbox-synthetic.json");
  const read = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  const save = entries => {
    const descriptor = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC, 0o600);
    try { fs.writeFileSync(descriptor, JSON.stringify(entries)); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
  };
  let posts = 0;
  const storage = { readEduPiAmbientUnconfirmedDurable: async sessionId => read().filter(item => item.sessionId === sessionId),
    rememberEduPiAmbientUnconfirmedDurable: async entry => { save([...read(), { sessionId: entry.sessionId,
      messageId: entry.messageId, occurredAt: entry.occurredAt }]); return true; },
    clearEduPiAmbientUnconfirmedDurable: async (sessionId, messageId) => {
      save(read().filter(item => item.sessionId !== sessionId || item.messageId !== messageId)); return true;
    } };
  const exports = {};
  vm.runInNewContext(code, { exports, URLSearchParams, require(name) {
    if (name === "./desktop-native") return { fetchDesktopApi: async (_url, options) => {
      const action = options.method === "POST" ? JSON.parse(options.body).action : null;
      if (options.method === "POST" && action !== "arm") posts++;
      return { ok: true, json: async () => action === "arm"
        ? { status: "armed", externalSend: false }
        : { status: "clear", pending: [], recovered: [], externalSend: false } };
    } };
    if (name === "./desktop-updater") return { isTauriDesktop: () => true };
    if (name === "./edupi-ambient-client-pending") return storage;
    throw new Error(`unexpected import ${name}`);
  } });
  return { api: exports, entries: read, posts: () => posts };
}

if (process.argv[2] === "--arm-child") {
  const directory = process.argv[3];
  const { api } = client(directory);
  assert.equal((await api.armEduPiAmbientMessage(identity)).status, "armed");
  // This file simulates an accepted Pi user entry after the exact prewrite.
  // Only this synthetic Pi fixture contains message text; the outbox does not.
  fs.writeFileSync(path.join(directory, "synthetic-pi-session.jsonl"),
    `${JSON.stringify({ type: "message", id: "entry-stable", clientRequestId: identity.messageId,
      message: { role: "user", content: "合成教师请求" } })}\n`, { mode: 0o600 });
  process.stdout.write("PI_COMMITTED_AFTER_ARM\n");
  setInterval(() => {}, 1000);
  await new Promise(() => {});
} else if (process.argv[2] === "--recover-child") {
  const { api, entries, posts } = client(process.argv[3]);
  const state = await api.readEduPiAmbientPending(identity.sessionId);
  const attempt = await api.captureEduPiAmbientMessage({ ...identity, text: "合成教师请求" });
  process.stdout.write(`${JSON.stringify({ state, attempt, entries: entries(), posts: posts() })}\n`);
} else {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-pi-capture-boundary-")));
  try {
    const script = fileURLToPath(import.meta.url);
    const first = spawn(process.execPath, [script, "--arm-child", directory], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = "";
    first.stdout.on("data", chunk => { output += chunk.toString("utf8"); });
    first.stderr.on("data", chunk => { errors += chunk.toString("utf8"); });
    const deadline = Date.now() + 10_000;
    while (!output.includes("PI_COMMITTED_AFTER_ARM") && Date.now() < deadline) {
      if (first.exitCode !== null) throw new Error(`arm child exited: ${errors}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.match(output, /PI_COMMITTED_AFTER_ARM/u, errors);
    const exited = new Promise(resolve => first.once("exit", (code, signal) => resolve({ code, signal })));
    first.kill("SIGKILL");
    const killed = await exited;
    assert.equal(killed.signal, "SIGKILL");
    const outbox = fs.readFileSync(path.join(directory, "native-outbox-synthetic.json"), "utf8");
    assert.equal(outbox.includes("合成教师请求"), false, "the prewrite cannot persist private text");
    assert.match(fs.readFileSync(path.join(directory, "synthetic-pi-session.jsonl"), "utf8"), /entry-stable/u);
    const recovered = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, "--recover-child", directory], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", chunk => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
      child.once("exit", code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
      child.once("error", reject);
    });
    assert.equal(recovered.state.status, "outcome_unknown");
    assert.equal(recovered.state.pending[0].messageId, identity.messageId);
    assert.equal(recovered.state.pending[0].unconfirmed, true);
    assert.equal(recovered.attempt.status, "outcome_unknown");
    assert.equal(recovered.posts, 0, "a killed Pi reply cannot authorize speculative Core capture");
    assert.deepEqual(recovered.entries, [identity]);
    console.log(JSON.stringify({ status: "passed", killedAfterPiCommit: true,
      sameClientRequestIdAfterRestart: true, nativeIdentityNoText: true, corePosts: 0,
      piSdkUsed: false, externalSend: false }));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
