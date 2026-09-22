#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const compat = JSON.parse(fs.readFileSync(path.join(root, "contracts/edupi-core-compat.json"), "utf8"));
const resources = path.resolve(process.env.EDUPI_STAGED_RESOURCES || path.join(root, "src-tauri/resources"));
const serverDir = path.join(resources, "server");
const nodeBinary = path.join(resources, "Pi Agent Server.app/Contents/MacOS/node");
const coreRoot = path.join(resources, "edupi-core");
for (const required of [serverDir, nodeBinary, coreRoot, path.join(serverDir, "mobile-gateway.cjs")]) assert.equal(fs.existsSync(required), true, `missing staged resource: ${required}`);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-staged-runtime-"));
const dataRoot = path.join(temporaryRoot, "data");
const stateRoot = path.join(temporaryRoot, "state");
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
    EDUPI_CORE_ALLOWED_ROOT: resources,
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
  let status = null;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline && !status) {
    if (child.exitCode !== null) throw new Error(`staged server exited: ${logs.slice(-4000)}`);
    try {
      const identity = await fetch(`${baseUrl}/api/desktop/identity`, { signal: AbortSignal.timeout(2000) });
      if (identity.status === 204) {
        const response = await fetch(`${baseUrl}/api/edupi/status?summary=1`, { signal: AbortSignal.timeout(10_000) });
        status = await response.json();
      }
    } catch {
      // Keep polling while the staged server completes its cold start.
    }
    if (!status) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(status, `staged server did not become ready: ${logs.slice(-4000)}`);
  assert.equal(status.compatibility.actual.coreCommit, compat.core_runtime.core_commit);
  assert.equal(status.compatibility.actual.componentManifestHash, compat.core_runtime.component_manifest_hash);
  assert.equal(status.core.runtimeComponentManifestHash, compat.core_runtime.runtime_component_manifest_hash);
  assert.equal(status.compatibility.actual.supportedCommands.includes("review_follow_up"), true);
  assert.equal(status.core.status, "ready");
  assert.equal(status.projection.status, "ready");
  assert.equal(status.externalSend, false);
  console.log(JSON.stringify({ status: "passed", coreCommit: status.compatibility.actual.coreCommit, coreStatus: status.core.status, projectionStatus: status.projection.status, proactivity: status.proactivity.status, externalSend: status.externalSend }, null, 2));
} finally {
  await stop();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
