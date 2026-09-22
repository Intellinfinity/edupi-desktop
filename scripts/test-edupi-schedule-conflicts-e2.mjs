#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createJiti } from "jiti";

const desktopRoot = path.resolve(new URL("..", import.meta.url).pathname);
const staged = process.env.EDUPI_SCHEDULE_E2_STAGED === "1";
const resources = path.resolve(process.env.EDUPI_STAGED_RESOURCES || path.join(desktopRoot, "src-tauri", "resources"));
const coreRootValue = staged ? path.join(resources, "edupi-core") : process.env.EDUPI_CORE_ROOT;
if (!coreRootValue || !path.isAbsolute(coreRootValue)) throw new Error("EDUPI_CORE_ROOT must be an absolute Core checkout");
const coreRoot = fs.realpathSync(coreRootValue);
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-schedule-review-e2-")));
const dataRoot = path.join(temporaryRoot, "data");
const desktopStateDir = path.join(temporaryRoot, "desktop-state");
fs.mkdirSync(dataRoot, { mode: 0o700 });
fs.mkdirSync(desktopStateDir, { mode: 0o700 });
const home = path.join(dataRoot, ".edupi");
const memoryDir = path.join(home, "memory");
const outputDir = path.join(home, "output");
const lockDir = path.join(home, "locks");
for (const directory of [memoryDir, outputDir, lockDir]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts/edupi-core-compat.json"), "utf8"));
const keys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT", "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT", "EDUPI_AMBIENT_PLANNING", "PI_DESKTOP_STATE_DIR", "PI_DESKTOP_API_TOKEN"];
const previous = new Map(keys.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: path.dirname(dataRoot),
  EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: staged ? resources : path.dirname(coreRoot), EDUPI_HOME: home, EDUPI_MEMORY_DIR: memoryDir,
  EDUPI_OUTPUT_DIR: outputDir, EDUPI_LOCK_DIR: lockDir, EDUPI_CORE_COMMIT: compat.core_runtime.core_commit,
  EDUPI_AMBIENT_PLANNING: "1", PI_DESKTOP_STATE_DIR: desktopStateDir,
  PI_DESKTOP_API_TOKEN: "schedule-review-test-token-012345678901234567890123456789",
});

let admission;
let runtimeSupervisor;
let stagedServer;

async function startStagedServer() {
  const serverDir = path.join(resources, "server");
  const nodeBinary = path.join(resources, "Pi Agent Server.app", "Contents", "MacOS", "node");
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => address && typeof address === "object" ? resolve(address.port) : reject(new Error("port unavailable")));
    });
  });
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(nodeBinary, [path.join(serverDir, "desktop-server.cjs")], {
    cwd: serverDir, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
      EDUPI_CORE_VALIDATION_MODE: "bundled", PI_DESKTOP_INSTANCE_ID: "staged-schedule-review", PI_WEB_PARENT_PID: String(process.pid), PI_OFFLINE: "1" },
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs = (logs + chunk.toString("utf8")).slice(-4000); });
  child.stderr.on("data", (chunk) => { logs = (logs + chunk.toString("utf8")).slice(-4000); });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    const exitedNormally = await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 3000))]);
    if (exitedNormally) return;
    child.kill("SIGKILL");
    const exitedForced = await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 3000))]);
    if (!exitedForced) throw new Error("staged server did not exit");
  };
  try {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`staged server exited: ${logs}`);
      try {
        if ((await fetch(`${url}/api/desktop/identity`, { signal: AbortSignal.timeout(2000) })).status === 204) return { url, stop };
      } catch { /* cold start */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`staged server not ready: ${logs}`);
  } catch (error) { await stop(); throw error; }
}

try {
  const rootModule = await import(path.join(coreRoot, "scripts/core_runtime_root.mjs"));
  const admissionModule = await import(path.join(coreRoot, "scripts/core_runtime_writer_admission.mjs"));
  const intake = await import(path.join(coreRoot, "scripts/education_intake_store.mjs"));
  const root = rootModule.prepareCoreRuntimeRoot(dataRoot);
  admission = await admissionModule.acquireCoreRuntimeWriterAdmission({ root, kind: "legacy_desktop_schedule_review_e2" });
  const at = new Date().toISOString();
  const snapshotFor = (state) => {
    const digest = crypto.createHash("sha256").update(JSON.stringify(intake.canonicalEducationIntakeIdentityState(state))).digest("hex");
    return { snapshot_id: `snapshot-${digest.slice(0, 24)}`, state_hash: `sha256:${digest}` };
  };
  const importEvent = (requestId, sourceId, event) => {
    const sourceHash = `sha256:${crypto.createHash("sha256").update(requestId).digest("hex")}`;
    const source = { source_id: sourceId, source_kind: "teacher_message", source_hash: sourceHash, evidence_ids: [`evidence-${requestId}`] };
    return intake.applyEducationIntakeCommand({ commandEnvelope: {
      message_id: requestId, request_id: requestId, issued_at: at, snapshot_id: snapshotFor(intake.loadEducationIntakeState()).snapshot_id,
      idempotency_key: `idem-${requestId}`, provenance: [{ source_kind: source.source_kind, source_id: source.source_id,
        source_path: null, source_hash: source.source_hash, observed_at: at, actor: "teacher", evidence_ids: source.evidence_ids, parent_ids: [] }],
      teacher_review: { state: "pending_review", reviewer_id: null, reviewed_at: null, note: null, revision: 0 },
      command: { command_type: "import_calendar", source, events: [event] },
    }, buildSnapshotForState: snapshotFor });
  };
  const original = { event_id: "校历-开放日-e2", date: "2026-10-12", end_date: null, name: "学校开放日",
    type: "activity", confidence: "teacher_confirmed", notes: "原日期" };
  const first = await importEvent("opening-day-original-e2", "旧通知", original);
  assert.equal(first.receipt.payload.status, "accepted");
  const second = await importEvent("opening-day-correction-e2", "新通知", { ...original, event_id: "开放日-更正-e2", date: "2026-10-13", notes: "更正日期" });
  assert.equal(second.receipt.payload.status, "held");
  await admission.release();
  admission = null;

  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const route = staged ? null : await jiti.import(path.join(desktopRoot, "app/api/edupi/schedule-conflicts/route.ts"));
  const snapshot = staged ? null : await jiti.import(path.join(desktopRoot, "lib/edupi-core-snapshot.ts"));
  runtimeSupervisor = staged ? null : await jiti.import(path.join(desktopRoot, "lib/edupi-runtime-supervisor.ts"));
  if (staged) stagedServer = await startStagedServer();
  const url = "http://localhost:30141/api/edupi/schedule-conflicts";
  const token = process.env.PI_DESKTOP_API_TOKEN;
  const headers = { host: "localhost:30141", origin: "http://localhost:30141", "x-pi-desktop-token": token };
  const get = async (authorized = true) => stagedServer
    ? fetch(`${stagedServer.url}/api/edupi/schedule-conflicts?limit=50`, { headers: { origin: stagedServer.url, ...(authorized ? { "x-pi-desktop-token": token } : {}) }, signal: AbortSignal.timeout(15000) })
    : route.GET(new Request(`${url}?limit=50`, { headers: authorized ? headers : { host: headers.host, origin: headers.origin } }));
  const post = async (body) => stagedServer
    ? fetch(`${stagedServer.url}/api/edupi/schedule-conflicts`, { method: "POST", headers: { origin: stagedServer.url, "x-pi-desktop-token": token, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
    : route.POST(new Request(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) }));

  if (staged && process.env.EDUPI_SCHEDULE_E2_VISUAL === "1") {
    console.log(JSON.stringify({ visual_url: stagedServer.url, pid: process.pid, fixture: "isolated_schedule_conflict" }));
    await new Promise((resolve) => process.once("SIGUSR1", resolve));
  } else {
  assert.equal((await get(false)).status, 403);
  assert.equal((await get()).status, 409);
  assert.equal((await post({ action: "bootstrap" })).status, 200);
  const listedResponse = await get();
  const listed = await listedResponse.json();
  assert.equal(listedResponse.status, 200, JSON.stringify(listed));
  assert.equal(listed.result.conflicts.length, 1);
  const conflict = listed.result.conflicts[0];
  assert.equal(conflict.candidate.date, "2026-10-13");
  assert.equal(conflict.external_send, false);
  const decision = { action: "resolve", commandId: "desktop-resolve-opening-day-e2", conflictId: conflict.conflict_id,
    kind: conflict.kind, canonicalId: conflict.canonical_id, expectedRevision: conflict.expected_revision,
    expectedContentHash: conflict.expected_content_hash, expectedConflictHash: conflict.expected_conflict_hash,
    decision: "replace_with_candidate" };
  const resolvedResponse = await post(decision);
  const resolved = await resolvedResponse.json();
  assert.equal(resolvedResponse.status, 200, JSON.stringify(resolved));
  assert.match(resolved.result.resolution_id, /^schedule_resolution_[a-f0-9]{32}$/);
  assert.equal(resolved.result.replayed, false);
  const afterDecision = await get();
  const afterBody = await afterDecision.json();
  assert.equal(afterDecision.status, 200, JSON.stringify(afterBody));
  assert.equal(afterBody.result.conflicts.length, 0);
  const educationAfter = stagedServer
    ? await (await fetch(`${stagedServer.url}/api/edupi/education`, { signal: AbortSignal.timeout(15000) })).json()
    : (await snapshot.readEduPiEducationSnapshot()).workspace;
  assert.equal(educationAfter.calendar.some((item) => (staged ? item.id : item.event_id) === original.event_id && item.date === "2026-10-13"), true,
    JSON.stringify({ calendar: educationAfter.calendar }));
  const replay = await post(decision);
  assert.equal(replay.status, 200, JSON.stringify(await replay.clone().json()));
  assert.equal((await replay.json()).result.replayed, true);
  const changedDecision = await post({ ...decision, decision: "keep_existing" });
  assert.equal(changedDecision.status, 409);
  assert.equal((await changedDecision.json()).errorCode, "schedule_conflict_replay_mismatch");
  const staleDecision = await post({ ...decision, commandId: "desktop-stale-opening-day-e2" });
  assert.equal(staleDecision.status, 409);
  assert.equal((await staleDecision.json()).errorCode, "schedule_conflict_stale");
  if (stagedServer) {
    await stagedServer.stop();
    stagedServer = await startStagedServer();
  } else {
    await runtimeSupervisor.closeAllEduPiRuntimes();
    await runtimeSupervisor.ensureEduPiRuntime(snapshot.resolveEduPiBridgeRoots()).catch((error) => {
      throw new Error(`Core restart failed: ${error.code || "unknown"}`);
    });
  }
  const afterRestart = await get();
  const restartedBody = await afterRestart.json();
  assert.equal(afterRestart.status, 200, JSON.stringify(restartedBody));
  assert.equal(restartedBody.result.conflicts.length, 0);
  const educationAfterRestart = stagedServer
    ? await (await fetch(`${stagedServer.url}/api/edupi/education`, { signal: AbortSignal.timeout(15000) })).json()
    : (await snapshot.readEduPiEducationSnapshot()).workspace;
  assert.equal(educationAfterRestart.calendar.some((item) => (staged ? item.id : item.event_id) === original.event_id && item.date === "2026-10-13"), true);
  const stored = intake.loadEducationIntakeState();
  assert.equal(stored.calendar_events[0].date, "2026-10-13");
  assert.equal(stored.schedule_resolutions.length, 1);
  const credentialDirectory = path.join(desktopStateDir, "edupi-owner-control");
  const credentialFiles = fs.readdirSync(credentialDirectory);
  assert.equal(credentialFiles.length, 1);
  const ownerStateFile = path.join(outputDir, "ambient-authorization-v1.json");
  const ownerState = fs.readFileSync(ownerStateFile);
  if (stagedServer) {
    await stagedServer.stop();
    stagedServer = null;
  } else await runtimeSupervisor.closeAllEduPiRuntimes();
  fs.unlinkSync(path.join(credentialDirectory, credentialFiles[0]));
  if (staged) stagedServer = await startStagedServer();
  const lostCredential = await get();
  assert.equal(lostCredential.status, 503);
  assert.equal((await lostCredential.json()).errorCode, "owner_control_credential_unavailable");
  assert.deepEqual(fs.readFileSync(ownerStateFile), ownerState);
  assert.equal(fs.readdirSync(credentialDirectory).length, 0);
  console.log(JSON.stringify({ status: "passed", token_guard: true, owner_bootstrap: true, conflict_read: true,
    resolution: true, exact_replay: true, changed_decision_rejected: true, stale_revision_rejected: true,
    restart_readback: true, lost_credential_rejected: true, staged_server: staged, external_send: false }));
  }
} finally {
  if (admission) await admission.release().catch(() => {});
  await stagedServer?.stop();
  await runtimeSupervisor?.closeAllEduPiRuntimes();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
