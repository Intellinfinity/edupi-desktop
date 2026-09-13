import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import path from "node:path";

test("cancel during session startup must not send a prompt", async () => {
  let release;
  let starting;
  const started = new Promise(resolve => { starting = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let status = "queued";
  const sent = [];
  const job = { job_id: "test", title: "test", instructions: "test", job_type: "document" };
  const dependencies = {
    default: path,
    resolveEduPiBridgeRoots: () => ({ dataRoot: { root: "/tmp/test" } }),
    runCoreProcess: async ({ request }) => {
      let claimed = null;
      if (request.action === "claim" && status === "queued") { status = "running"; claimed = job; }
      if (request.action === "cancel") status = "canceled";
      return { ok: true, job: claimed, projection: { jobs: [{ ...job, status }] } };
    },
    startHarnessSession: async () => {
      starting(); await gate;
      return { realSessionId: "test", session: { setArtifactOutputDirectory() {}, destroy() {}, onEvent: () => () => {}, send: async command => sent.push(command.type) } };
    },
  };
  const source = fs.readFileSync(new URL("./edupi-background-jobs.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const context = vm.createContext({ exports, require: () => dependencies, crypto: { randomUUID: () => "test" }, process: { pid: 1 }, setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(compiled, context);
  const pumping = exports.pumpBackgroundJobs();
  await started;
  await exports.cancelBackgroundJob("test");
  release();
  await pumping;
  // Always clear runtime timers even on the failing baseline.
  await exports.cancelBackgroundJob("test");
  assert.equal(status, "canceled");
  assert.equal(sent.includes("prompt"), false);
});

test("background completion excludes another job's file", async () => {
  let status = "queued";
  let listener;
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  let delivered;
  const progress = [];
  const job = { job_id: "own", title: "test", instructions: "test", job_type: "document" };
  const dependencies = {
    default: path,
    resolveEduPiBridgeRoots: () => ({ dataRoot: { root: "/tmp/test" } }),
    generatedArtifactsRequest: async () => ({ artifacts: [
      { artifact_id: "other", session_id: "session", relative_path: ".edupi/output/agent-computer/other/file.txt", size_bytes: 20 },
      { artifact_id: "own", session_id: "session", relative_path: ".edupi/output/agent-computer/own/file.txt", size_bytes: 20 },
    ] }),
    runCoreProcess: async ({ request }) => {
      let claimed = null;
      if (request.action === "claim" && status === "queued") { status = "running"; claimed = job; }
      if (request.action === "progress") progress.push({ phase: request.phase, message: request.message });
      if (request.action === "complete") { status = "completed"; delivered = request.artifacts; finish(); }
      return { ok: true, job: claimed, projection: { jobs: [{ ...job, status }] } };
    },
    startHarnessSession: async () => ({ realSessionId: "session", session: {
      setArtifactOutputDirectory() {}, destroy() {}, onEvent: callback => { listener = callback; return () => {}; },
      send: async () => { listener({ type: "prompt_done" }); },
    } }),
  };
  const source = fs.readFileSync(new URL("./edupi-background-jobs.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: () => dependencies, crypto: { randomUUID: () => "test" }, process: { pid: 1 }, setTimeout, clearTimeout, setInterval, clearInterval });
  await exports.pumpBackgroundJobs();
  await done;
  assert.deepEqual(Array.from(delivered, file => file.artifact_id), ["own"]);
  assert.deepEqual(progress, [
    { phase: "working", message: "正在理解任务" },
    { phase: "finalizing", message: "正在登记文件" },
  ]);
});
