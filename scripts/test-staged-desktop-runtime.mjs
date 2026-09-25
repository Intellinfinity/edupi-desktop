#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const compat = JSON.parse(fs.readFileSync(path.join(root, "contracts/edupi-core-compat.json"), "utf8"));
const resources = path.resolve(process.env.EDUPI_STAGED_RESOURCES || path.join(root, "src-tauri/resources"));
const stagedServerDir = path.join(resources, "server");
const nodeBinary = process.platform === "darwin"
  ? path.join(resources, "Pi Agent Server.app/Contents/MacOS/node")
  : path.join(resources, "node", process.platform === "win32" ? "node.exe" : "node");
const stagedCoreRoot = path.join(resources, "edupi-core");
const identityOnly = process.env.EDUPI_STAGED_IDENTITY_ONLY === "1";
for (const required of [
  stagedServerDir,
  nodeBinary,
  stagedCoreRoot,
  path.join(stagedServerDir, "mobile-gateway.cjs"),
  path.join(stagedServerDir, "node_modules/next/package.json"),
  path.join(stagedServerDir, "node_modules/next/dist/server/lib/start-server.js"),
]) assert.equal(fs.existsSync(required), true, `missing staged resource: ${required}`);
const occurrenceIdentity = compat.contract_identities.find((item) => item.contract_id === "edupi-schedule-occurrence-v1.2");
assert.ok(occurrenceIdentity, "missing schedule occurrence compatibility identity");
const occurrenceSchema = path.join(stagedCoreRoot, occurrenceIdentity.schema_path);
const occurrenceHash = path.join(stagedCoreRoot, "contracts/edupi-schedule-occurrence-v1.2-hash.json");
const runtimeSchemaHash = path.join(stagedCoreRoot, "contracts/edupi-core-runtime-v1-hash.json");
for (const required of [occurrenceSchema, occurrenceHash, runtimeSchemaHash]) assert.equal(fs.existsSync(required), true, `missing staged Core contract: ${required}`);
assert.deepEqual(JSON.parse(fs.readFileSync(occurrenceSchema, "utf8")), JSON.parse(fs.readFileSync(path.join(root, occurrenceIdentity.schema_path), "utf8")));
assert.equal(JSON.parse(fs.readFileSync(occurrenceHash, "utf8")).schema_hash, occurrenceIdentity.schema_hash);
assert.equal(JSON.parse(fs.readFileSync(runtimeSchemaHash, "utf8")).schema_hash, compat.core_runtime.runtime_schema_hash);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-staged-runtime-"));
const isolatedResources = path.join(temporaryRoot, "staged-resources");
const serverDir = path.join(isolatedResources, "server");
const coreRoot = path.join(isolatedResources, "edupi-core");
const dataRoot = path.join(temporaryRoot, "data");
const stateRoot = path.join(temporaryRoot, "state");
fs.mkdirSync(isolatedResources, { recursive: true });
fs.cpSync(stagedServerDir, serverDir, { recursive: true, verbatimSymlinks: true });
fs.cpSync(stagedCoreRoot, coreRoot, { recursive: true, verbatimSymlinks: true });
for (const directory of [path.join(dataRoot, ".edupi/memory"), path.join(dataRoot, ".edupi/output"), path.join(dataRoot, ".edupi/locks"), stateRoot]) fs.mkdirSync(directory, { recursive: true });

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      server.close(() => port ? resolve(port) : reject(new Error("staged runtime port unavailable")));
    });
  });
}

const port = await freePort();
const child = spawn(nodeBinary, [path.join(serverDir, "desktop-server.cjs")], {
  cwd: serverDir,
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    EDUPI_PROJECT_ROOT: dataRoot,
    EDUPI_DATA_ROOT: dataRoot,
    EDUPI_DATA_ALLOWED_ROOT: temporaryRoot,
    EDUPI_CORE_ROOT: coreRoot,
    EDUPI_CORE_ALLOWED_ROOT: isolatedResources,
    EDUPI_CORE_VALIDATION_MODE: "bundled",
    PI_DESKTOP_STATE_DIR: stateRoot,
    PI_DESKTOP_API_TOKEN: "staged-runtime-token-012345678901234567890123456789",
    PI_DESKTOP_INSTANCE_ID: "staged-core-instance",
    PI_WEB_PARENT_PID: String(process.pid),
    PI_OFFLINE: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk.toString("utf8"); });
child.stderr.on("data", (chunk) => { logs += chunk.toString("utf8"); });
const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
const baseUrl = `http://127.0.0.1:${port}`;

async function stop() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

try {
  let identityReady = false;
  let status = null;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline && !(identityReady && (identityOnly || status))) {
    if (child.exitCode !== null) throw new Error(`staged server exited: ${logs.slice(-4000)}`);
    try {
      const identity = await fetch(`${baseUrl}/api/desktop/identity`, { signal: AbortSignal.timeout(2000) });
      if (identity.status === 204) {
        identityReady = true;
        if (identityOnly) break;
        const response = await fetch(`${baseUrl}/api/edupi/status?summary=1`, { signal: AbortSignal.timeout(10_000) });
        status = await response.json();
      }
    } catch {
      // Keep polling while the staged server completes its cold start.
    }
    if (!(identityReady && (identityOnly || status))) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(identityReady, true, `staged server identity did not become ready: ${logs.slice(-4000)}`);
  if (identityOnly) {
    console.log(JSON.stringify({ status: "passed", identityOnly: true }, null, 2));
  } else {
    assert.ok(status, `staged server did not become ready: ${logs.slice(-4000)}`);
    assert.equal(status.compatibility.actual.coreCommit, compat.core_runtime.core_commit);
    assert.equal(status.compatibility.actual.componentManifestHash, compat.core_runtime.component_manifest_hash);
    assert.equal(status.core.runtimeComponentManifestHash, compat.core_runtime.runtime_component_manifest_hash);
    assert.equal(status.compatibility.actual.supportedCommands.includes("review_follow_up"), true);
    assert.equal(status.core.status, "ready");
    assert.equal(status.projection.status, "ready");
    assert.equal(status.core.capabilities.g1_processor, "active");
    assert.equal(status.core.capabilities.g2_processor, "activation_pending");
    assert.equal(status.core.capabilities.g3_processor, "activation_pending");
    assert.equal(status.externalSend, false);
    const timetableSources = await fetch(`${baseUrl}/api/edupi/timetable-sources`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(timetableSources.status, 200);
    assert.equal(timetableSources.headers.get("cache-control"), "no-store");
    assert.deepEqual((await timetableSources.json()).sources, []);
    console.log(JSON.stringify({ status: "passed", coreCommit: status.compatibility.actual.coreCommit, coreStatus: status.core.status,
      projectionStatus: status.projection.status, occurrenceContract: occurrenceIdentity.contract_version,
      proactivity: status.proactivity.status,
      processors: { g1: status.core.capabilities.g1_processor, g2: status.core.capabilities.g2_processor, sharedCapability: status.core.capabilities.g3_processor },
      externalSend: status.externalSend }, null, 2));
  }
} finally {
  await stop();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
