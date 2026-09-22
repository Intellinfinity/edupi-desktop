#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createJiti } from "jiti";

const desktopRoot = path.resolve(new URL("..", import.meta.url).pathname);
const staged = process.env.EDUPI_OCCURRENCE_E2_STAGED === "1";
const resources = path.resolve(process.env.EDUPI_STAGED_RESOURCES || path.join(desktopRoot, "src-tauri", "resources"));
const coreRootValue = staged ? path.join(resources, "edupi-core") : process.env.EDUPI_CORE_ROOT;
if (!coreRootValue || !path.isAbsolute(coreRootValue)) throw new Error("EDUPI_CORE_ROOT must be an absolute Core checkout");
const coreRoot = fs.realpathSync(coreRootValue);
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-occurrence-e2-")));
const dataRoot = path.join(temporaryRoot, "data");
const desktopStateDir = path.join(temporaryRoot, "desktop-state");
const home = path.join(dataRoot, ".edupi");
for (const directory of [dataRoot, desktopStateDir, path.join(home, "memory"), path.join(home, "output"), path.join(home, "locks")]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}
const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts", "edupi-core-compat.json"), "utf8"));
const token = "schedule-occurrence-test-token-012345678901234567890123456789";
const keys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT", "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT", "EDUPI_AMBIENT_PLANNING", "PI_DESKTOP_STATE_DIR", "PI_DESKTOP_API_TOKEN"];
const previous = new Map(keys.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: temporaryRoot,
  EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: staged ? resources : path.dirname(coreRoot), EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: path.join(home, "memory"), EDUPI_OUTPUT_DIR: path.join(home, "output"), EDUPI_LOCK_DIR: path.join(home, "locks"),
  EDUPI_CORE_COMMIT: compat.core_runtime.core_commit, EDUPI_AMBIENT_PLANNING: "1", PI_DESKTOP_STATE_DIR: desktopStateDir,
  PI_DESKTOP_API_TOKEN: token,
});

let stagedServer;
let runtimeSupervisor;

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
  const child = spawn(nodeBinary, [path.join(serverDir, "desktop-server.cjs")], { cwd: serverDir, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
      EDUPI_CORE_VALIDATION_MODE: "bundled", PI_DESKTOP_INSTANCE_ID: "staged-occurrence-e2", PI_WEB_PARENT_PID: String(process.pid), PI_OFFLINE: "1" } });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs = (logs + chunk.toString("utf8")).slice(-5000); });
  child.stderr.on("data", (chunk) => { logs = (logs + chunk.toString("utf8")).slice(-5000); });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    if (await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 3000))])) return;
    child.kill("SIGKILL");
    if (!await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 3000))])) throw new Error("staged server did not exit");
  };
  try {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`staged server exited: ${logs}`);
      try { if ((await fetch(`${url}/api/desktop/identity`, { signal: AbortSignal.timeout(2000) })).status === 204) return { url, stop }; }
      catch { /* cold start */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`staged server not ready: ${logs}`);
  } catch (error) { await stop(); throw error; }
}

try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const intakeRoute = staged ? null : await jiti.import(path.join(desktopRoot, "app/api/edupi/intake/route.ts"));
  const educationRoute = staged ? null : await jiti.import(path.join(desktopRoot, "app/api/edupi/education/route.ts"));
  const conflictRoute = staged ? null : await jiti.import(path.join(desktopRoot, "app/api/edupi/schedule-conflicts/route.ts"));
  const snapshot = staged ? null : await jiti.import(path.join(desktopRoot, "lib/edupi-core-snapshot.ts"));
  runtimeSupervisor = staged ? null : await jiti.import(path.join(desktopRoot, "lib/edupi-runtime-supervisor.ts"));
  if (staged) stagedServer = await startStagedServer();
  const baseUrl = () => stagedServer?.url || "http://localhost:30141";
  const desktopHeaders = () => ({ host: new URL(baseUrl()).host, origin: baseUrl(), "x-pi-desktop-token": token });
  const intake = async (body) => {
    const response = stagedServer
      ? await fetch(`${baseUrl()}/api/edupi/intake`, { method: "POST", headers: { ...desktopHeaders(), "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
      : await intakeRoute.POST(new Request(`${baseUrl()}/api/edupi/intake`, { method: "POST", headers: { ...desktopHeaders(), "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { response, body: await response.json() };
  };
  const education = async () => {
    const response = stagedServer
      ? await fetch(`${baseUrl()}/api/edupi/education`, { headers: desktopHeaders(), signal: AbortSignal.timeout(15000) })
      : await educationRoute.GET();
    return { response, body: await response.json() };
  };
  const conflicts = async () => {
    const response = stagedServer
      ? await fetch(`${baseUrl()}/api/edupi/schedule-conflicts?limit=50`, { headers: desktopHeaders(), signal: AbortSignal.timeout(15000) })
      : await conflictRoute.GET(new Request(`${baseUrl()}/api/edupi/schedule-conflicts?limit=50`, { headers: desktopHeaders() }));
    return { response, body: await response.json() };
  };
  const decide = async (body) => {
    const response = stagedServer
      ? await fetch(`${baseUrl()}/api/edupi/schedule-conflicts`, { method: "POST", headers: { ...desktopHeaders(), "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
      : await conflictRoute.POST(new Request(`${baseUrl()}/api/edupi/schedule-conflicts`, { method: "POST", headers: { ...desktopHeaders(), "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { response, body: await response.json() };
  };

  const occurrenceRef = "desktop-e2-meeting-42";
  const original = { eventId: null, date: "2026-11-05", endDate: null, name: "跨校教研会", type: "meeting",
    confidence: "teacher_confirmed", notes: "typed occurrence E2", sourceOccurrenceRef: occurrenceRef,
    timeInterval: { start: "2026-11-05T09:00+08:00", end: "2026-11-05T10:00+08:00", timeZone: "Asia/Shanghai" }, location: "东楼 203" };
  const first = await intake({ kind: "calendar", events: [original] });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.receipt.status, "accepted");
  const replay = await intake({ kind: "calendar", events: [original] });
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.receipt.reason_code, "already_applied");
  const initialRead = await education();
  assert.equal(initialRead.response.status, 200, JSON.stringify(initialRead.body));
  const projected = initialRead.body.calendar.find((item) => item.occurrenceRef === occurrenceRef);
  assert.ok(projected, JSON.stringify(initialRead.body.calendar));
  assert.equal(initialRead.body.calendar.filter((item) => item.occurrenceRef === occurrenceRef).length, 1);
  assert.equal(projected.startsAt, original.timeInterval.start);
  assert.equal(projected.timeZone, original.timeInterval.timeZone);
  assert.equal(projected.location, original.location);

  const moved = { ...original, eventId: projected.id, date: "2026-11-06",
    timeInterval: { start: "2026-11-06T11:00+08:00", end: "2026-11-06T12:00+08:00", timeZone: "Asia/Shanghai" }, location: "西楼 401" };
  const movedResult = await intake({ kind: "calendar", events: [moved] });
  assert.equal(movedResult.response.status, 200, JSON.stringify(movedResult.body));
  assert.equal(movedResult.body.receipt.status, "held");
  let conflictRead = await conflicts();
  if (conflictRead.response.status === 409 && conflictRead.body.errorCode === "owner_uninitialized") {
    const bootstrapped = await decide({ action: "bootstrap" });
    assert.equal(bootstrapped.response.status, 200, JSON.stringify(bootstrapped.body));
    conflictRead = await conflicts();
  }
  assert.equal(conflictRead.response.status, 200, JSON.stringify(conflictRead.body));
  const conflict = conflictRead.body.result.conflicts.find((item) => item.canonical.source_occurrence_ref === occurrenceRef);
  assert.ok(conflict, JSON.stringify(conflictRead.body));
  const command = { action: "resolve", commandId: "desktop-resolve-occurrence-e2", conflictId: conflict.conflict_id,
    kind: conflict.kind, canonicalId: conflict.canonical_id, expectedRevision: conflict.expected_revision,
    expectedContentHash: conflict.expected_content_hash, expectedConflictHash: conflict.expected_conflict_hash,
    decision: "keep_both_distinct" };
  const refused = await decide(command);
  assert.equal(refused.response.status, 400, JSON.stringify(refused.body));
  assert.equal(refused.body.errorCode, "schedule_conflict_invalid");
  const resolved = await decide({ ...command, decision: "replace_with_candidate" });
  assert.equal(resolved.response.status, 200, JSON.stringify(resolved.body));

  if (stagedServer) {
    await stagedServer.stop();
    stagedServer = await startStagedServer();
  } else {
    await runtimeSupervisor.closeAllEduPiRuntimes();
    await runtimeSupervisor.ensureEduPiRuntime(snapshot.resolveEduPiBridgeRoots());
  }
  const afterRestart = await education();
  assert.equal(afterRestart.response.status, 200, JSON.stringify(afterRestart.body));
  const revised = afterRestart.body.calendar.find((item) => item.occurrenceRef === occurrenceRef);
  assert.equal(revised.date, moved.date);
  assert.equal(revised.startsAt, moved.timeInterval.start);
  assert.equal(revised.endsAt, moved.timeInterval.end);
  assert.equal(revised.timeZone, moved.timeInterval.timeZone);
  assert.equal(revised.location, moved.location);
  const state = JSON.parse(fs.readFileSync(path.join(home, "output", "education_intake_state.json"), "utf8"));
  assert.equal(state.calendar_events.filter((item) => item.source_occurrence_ref === occurrenceRef).length, 1);
  assert.equal(state.schedule_resolutions.length, 1);
  console.log(JSON.stringify({ status: "passed", desktop_intake: true, exact_dedupe: true, typed_projection: true,
    move_held: true, keep_both_rejected: true, replace: true, restart_readback: true, staged_server: staged, external_send: false }));
} finally {
  await stagedServer?.stop();
  await runtimeSupervisor?.closeAllEduPiRuntimes();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
