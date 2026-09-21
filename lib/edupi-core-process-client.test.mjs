import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveEduPiCoreRoot, resolveEduPiDataRoot } = await jiti.import("./edupi-core-root.ts");
const { callEduPiCore, runCoreProcess } = await jiti.import("./edupi-core-process-client.ts");
const configuredRoot = process.env.EDUPI_CORE_ROOT;
const configuredDataRoot = process.env.EDUPI_DATA_ROOT;

test("Core read calls leave enough time for a cold packaged runtime", () => {
  const source = fs.readFileSync(new URL("./edupi-core-process-client.ts", import.meta.url), "utf8");
  assert.match(source, /CORE_READ_TIMEOUT_MS = 15_000/);
});

test("waits for runtime startup and never spawns a fallback writer", async () => {
  const runtime = fakeRuntime('throw new Error("must not spawn");');
  const dataRoot = fakeDataRoot(runtime);
  let release;
  const calls = [];
  const startup = new Promise(resolve => { release = resolve; });
  globalThis.__edupiRuntimeSupervisors.set(dataRoot.root, { identity: "test", startup });
  try {
    const result = runCoreProcess({ runtime, dataRoot, request: { operation: "snapshot" }, timeoutMs: 1000 });
    release({ callBridge: async (request) => { calls.push(request.operation); assert.deepEqual(request, { operation: "snapshot" }); return { ok: true, result: { bridge_frame: '{"ok":true}\n' } }; } });
    assert.deepEqual(await result, { ok: true });
    assert.deepEqual(calls, ["snapshot"]);
    globalThis.__edupiRuntimeSupervisors.set(dataRoot.root, { identity: "test", startup: new Promise(() => {}) });
    await assert.rejects(runCoreProcess({ runtime, dataRoot, request: { operation: "students" }, timeoutMs: 10 }), error => error.code === "timeout");
  } finally { globalThis.__edupiRuntimeSupervisors.delete(dataRoot.root); }
});

function actualRuntime() {
  const root = fs.realpathSync(configuredRoot);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "contracts", "edupi-desktop-component-manifest.json"), "utf8"));
  return resolveEduPiCoreRoot({ configuredRoot: root, allowedRoot: path.dirname(root), runtimeIdentity: { core_commit: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), component_manifest_path: "contracts/edupi-desktop-component-manifest.json", component_manifest_hash: manifest.component_manifest_hash } });
}

function actualDataRoot() {
  return resolveEduPiDataRoot({ configuredRoot: configuredDataRoot, allowedRoot: process.env.EDUPI_DATA_ALLOWED_ROOT });
}

test("calls real Core health, snapshot, and native task-review handler", { skip: !configuredRoot || !configuredDataRoot }, async () => {
  const runtime = actualRuntime();
  const dataRoot = actualDataRoot();
  const health = await callEduPiCore({ operation: "health", requestId: "health-desktop-1", runtime, dataRoot });
  assert.equal(health.ok, true);
  assert.equal(health.contract_version, "1.1");
  assert.deepEqual(health.supported_commands, ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"]);
  assert.deepEqual(health.supported_projections, ["education_workspace"]);
  const kernel = await callEduPiCore({ operation: "kernel", requestId: "kernel-desktop-1", runtime, dataRoot });
  assert.equal(kernel.ok, true);
  assert.equal(kernel.projection.projection_kind, "proactive_work_kernel");
  const memoryScopes = await callEduPiCore({ operation: "memory-scopes", requestId: "memory-scopes-desktop-1", runtime, dataRoot });
  assert.equal(memoryScopes.ok, true);
  assert.equal(memoryScopes.projection.projection_kind, "scoped_education_memory");
  const snapshot = await callEduPiCore({ operation: "snapshot", requestId: "snapshot-desktop-1", runtime, dataRoot });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.envelope.contract_version, "1.1");
  assert.ok(snapshot.envelope.payload.education_workspace.tasks.length > 0);
  const fixture = JSON.parse(fs.readFileSync(path.join(runtime.root, "fixtures", "bridge", "v1.1", "command-unsupported.json"), "utf8"));
  const reviewTaskBase = { ...fixture.command };
  delete reviewTaskBase.candidate_id;
  const envelope = {
    ...fixture,
    message_id: "v11-review-task-missing-message",
    request_id: "v11-review-task-missing-request",
    idempotency_key: "v11-review-task-missing-idempotency",
    command: {
      ...reviewTaskBase,
      command_type: "review_task",
      task_id: "task-fixture",
      rollback_id: null,
    },
  };
  const first = await callEduPiCore({ operation: "command", requestId: "command-desktop-1", runtime, dataRoot, envelope });
  assert.equal(first.ok, true);
  assert.equal(first.receipt.payload.command_type, "review_task");
  assert.ok(["task_missing", "stale_snapshot"].includes(first.receipt.payload.reason_code));
});

function fakeRuntime(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-core-process-"));
  const entrypoint = path.join(root, "entry.mjs");
  fs.writeFileSync(entrypoint, source, "utf8");
  return { root, cwd: root, entrypoint, componentManifestHash: "sha256:test", coreCommit: "test-commit" };
}

function fakeDataRoot(runtime) {
  return { root: runtime.root, allowedRoot: runtime.root, memoryDir: path.join(runtime.root, ".edupi", "memory"), outputDir: path.join(runtime.root, ".edupi", "output"), lockDir: path.join(runtime.root, ".edupi", "locks") };
}

test("rejects malformed and extra stdout frames", async () => {
  for (const source of [
    'process.stdout.write("not-json\\n");',
    'process.stdout.write("{}\\n{}\\n");',
  ]) {
    const runtime = fakeRuntime(source);
    await assert.rejects(runCoreProcess({ runtime, dataRoot: fakeDataRoot(runtime), request: { operation: "health" }, timeoutMs: 1000 }), /stdout|JSON|frame/i);
  }
});

test("rejects nonzero exit, oversized output and stderr", async () => {
  for (const [source, pattern] of [
    ['process.stderr.write("failed"); process.exit(2);', /exit/i],
    ['process.stdout.write("x".repeat(2*1024*1024+1));', /stdout.*limit/i],
    ['process.stderr.write("x".repeat(64*1024+1)); setTimeout(()=>{}, 5000);', /stderr.*limit/i],
  ]) {
    const runtime = fakeRuntime(source);
    await assert.rejects(runCoreProcess({ runtime, dataRoot: fakeDataRoot(runtime), request: { operation: "health" }, timeoutMs: 1000 }), pattern);
  }
});

test("kills timeout and abort without accepting late output", async () => {
  let runtime = fakeRuntime('setTimeout(()=>process.stdout.write("{}\\n"), 5000);');
  await assert.rejects(runCoreProcess({ runtime, dataRoot: fakeDataRoot(runtime), request: { operation: "health" }, timeoutMs: 30 }), /timeout/i);
  const controller = new AbortController();
  controller.abort();
  runtime = fakeRuntime('setTimeout(()=>{}, 5000);');
  await assert.rejects(runCoreProcess({ runtime, dataRoot: fakeDataRoot(runtime), request: { operation: "health" }, timeoutMs: 1000, signal: controller.signal }), /abort/i);
});

test("rejects oversized requests before spawning", async () => {
  const runtime = fakeRuntime('process.stdout.write("{}\\n");');
  await assert.rejects(runCoreProcess({ runtime, dataRoot: fakeDataRoot(runtime), request: { payload: "x".repeat(256 * 1024) }, timeoutMs: 1000 }), /request.*limit/i);
});

test("passes only the validated data-root paths and Desktop state root to the child", async () => {
  const runtime = fakeRuntime('process.stdout.write(JSON.stringify({ project: process.env.EDUPI_PROJECT_ROOT, home: process.env.EDUPI_HOME, parent: process.env.EDUPI_CORE_PARENT_PID, memory: process.env.EDUPI_MEMORY_DIR, output: process.env.EDUPI_OUTPUT_DIR, locks: process.env.EDUPI_LOCK_DIR, commit: process.env.EDUPI_CORE_COMMIT, state: process.env.PI_DESKTOP_STATE_DIR }) + "\\n");');
  const dataRoot = fakeDataRoot(runtime);
  const previous = {
    project: process.env.EDUPI_PROJECT_ROOT,
    memory: process.env.EDUPI_MEMORY_DIR,
    output: process.env.EDUPI_OUTPUT_DIR,
    locks: process.env.EDUPI_LOCK_DIR,
    state: process.env.PI_DESKTOP_STATE_DIR,
  };
  process.env.EDUPI_PROJECT_ROOT = "/ambient-project";
  process.env.EDUPI_MEMORY_DIR = "/ambient-memory";
  process.env.EDUPI_OUTPUT_DIR = "/ambient-output";
  process.env.EDUPI_LOCK_DIR = "/ambient-locks";
  process.env.PI_DESKTOP_STATE_DIR = path.join(runtime.root, "desktop-state");
  try {
    const result = await runCoreProcess({ runtime, dataRoot, request: { operation: "health" }, timeoutMs: 1000 });
    assert.deepEqual(result, { project: runtime.root, home: path.resolve(runtime.root, ".edupi"), parent: String(process.pid), memory: dataRoot.memoryDir, output: dataRoot.outputDir, locks: dataRoot.lockDir, commit: runtime.coreCommit, state: path.join(runtime.root, "desktop-state") });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const envKey = { project: "EDUPI_PROJECT_ROOT", memory: "EDUPI_MEMORY_DIR", output: "EDUPI_OUTPUT_DIR", locks: "EDUPI_LOCK_DIR", state: "PI_DESKTOP_STATE_DIR" }[key];
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
  }
});

test("source keeps fixed invocation boundaries", () => {
  const source = fs.readFileSync(new URL("./edupi-core-process-client.ts", import.meta.url), "utf8");
  assert.match(source, /process\.execPath/);
  assert.match(source, /shell:\s*false/);
  assert.match(source, /EDUPI_PROJECT_ROOT:\s*dataRoot\.root/);
  assert.match(source, /EDUPI_MEMORY_DIR:\s*dataRoot\.memoryDir/);
  assert.match(source, /PI_DESKTOP_STATE_DIR/);
  assert.doesNotMatch(source, /process\.env\.EDUPI_(?:MEMORY|OUTPUT|LOCK)_DIR/);
  assert.doesNotMatch(source, /exec\(|execSync|shell:\s*true/);
});
