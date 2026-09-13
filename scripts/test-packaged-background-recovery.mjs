import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const appRoot = path.resolve(process.env.EDUPI_INSTALLED_APP || "/Applications/EduPi.app");
const resources = path.join(appRoot, "Contents", "Resources", "resources");
const serverDir = path.join(resources, "server");
const serverEntry = path.join(serverDir, "desktop-server.cjs");
const nodeBinary = path.join(resources, "Pi Agent Server.app", "Contents", "MacOS", "node");
const coreRoot = path.join(resources, "edupi-core");
const infoPlist = path.join(appRoot, "Contents", "Info.plist");

for (const required of [serverEntry, nodeBinary, coreRoot, infoPlist]) {
  assert.equal(fs.existsSync(required), true, `missing packaged resource: ${required}`);
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-packaged-background-"));
const dataRoot = path.join(temporaryRoot, "teacher-data");
const homeRoot = path.join(temporaryRoot, "home");
const agentDir = path.join(homeRoot, ".pi", "agent");
const stateDir = path.join(temporaryRoot, "desktop-state");
const attemptMarker = path.join(dataRoot, ".edupi", "background-attempt-one.pid");
const serverLogs = [];
let success = false;
let firstServer;
let secondServer;
let modelServer;

fs.mkdirSync(agentDir, { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });
for (const directory of ["memory", "output", "locks"]) {
  fs.mkdirSync(path.join(dataRoot, ".edupi", directory), { recursive: true });
}

const wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitFor(label, read, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  let latestError;
  while (Date.now() < deadline) {
    try {
      latest = await read();
      if (predicate(latest)) return latest;
    } catch (error) {
      latestError = error;
    }
    await wait(200);
  }
  const detail = latestError instanceof Error ? latestError.message : JSON.stringify(latest);
  throw new Error(`${label} timed out: ${detail}`);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function sendSse(response, chunks) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  response.end(`${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`);
}

async function readJsonRequest(request) {
  const parts = [];
  for await (const part of request) parts.push(part);
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

let initialModelCalls = 0;
let finalModelCalls = 0;
modelServer = http.createServer(async (request, response) => {
  try {
    const body = await readJsonRequest(request);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const hasToolResult = messages.some(message => message?.role === "tool");
    const id = `packaged-recovery-${initialModelCalls + finalModelCalls + 1}`;
    const base = { id, object: "chat.completion.chunk", created: 1, model: "local" };

    if (hasToolResult) {
      finalModelCalls += 1;
      sendSse(response, [
        { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "任务已完成" }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ]);
      return;
    }

    const serializedMessages = JSON.stringify(messages);
    const jobId = serializedMessages.match(/agent_job_[a-f0-9]{32}/)?.[0];
    assert.ok(jobId, "background prompt did not include its Core job id");
    initialModelCalls += 1;
    const tool = initialModelCalls === 1
      ? {
          name: "bash",
          arguments: JSON.stringify({
            command: `mkdir -p .edupi && printf '%s' \"$$\" > ${JSON.stringify(path.relative(dataRoot, attemptMarker))} && sleep 120`,
          }),
        }
      : {
          name: "write",
          arguments: JSON.stringify({
            path: `.edupi/output/agent-computer/${jobId}/recovery.txt`,
            content: "安装版退出后由 Core 自动恢复成功\n",
          }),
        };
    sendSse(response, [
      {
        ...base,
        choices: [{
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [{ index: 0, id: `call-${initialModelCalls}`, type: "function", function: tool }],
          },
          finish_reason: null,
        }],
      },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ]);
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

await new Promise((resolve, reject) => {
  modelServer.once("error", reject);
  modelServer.listen(0, "127.0.0.1", resolve);
});
const modelAddress = modelServer.address();
assert.ok(modelAddress && typeof modelAddress === "object");

fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({
  providers: {
    local: {
      api: "openai-completions",
      baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`,
      models: [{
        id: "local",
        name: "Local packaged recovery",
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32_000,
        maxTokens: 1_024,
      }],
    },
  },
}, null, 2));
fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({
  defaultProvider: "local",
  defaultModel: "local",
}, null, 2));

async function startPackagedServer(label) {
  const port = await freePort();
  const child = spawn(nodeBinary, [serverEntry], {
    cwd: serverDir,
    detached: true,
    env: {
      ...process.env,
      HOME: homeRoot,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      PI_CODING_AGENT_DIR: agentDir,
      PI_DESKTOP_STATE_DIR: stateDir,
      PI_DESKTOP_API_TOKEN: "packaged-background-recovery-token-00000000000000000000000000000000",
      PI_DESKTOP_INSTANCE_ID: `packaged-background-${label}`,
      PI_WEB_PARENT_PID: String(process.pid),
      PI_OFFLINE: "1",
      EDUPI_PROJECT_ROOT: dataRoot,
      EDUPI_DATA_ROOT: dataRoot,
      EDUPI_DATA_ALLOWED_ROOT: temporaryRoot,
      EDUPI_CORE_ROOT: coreRoot,
      EDUPI_CORE_ALLOWED_ROOT: resources,
      EDUPI_CORE_VALIDATION_MODE: "bundled",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = chunk => {
    serverLogs.push(`[${label}] ${chunk.toString("utf8")}`);
    if (serverLogs.length > 400) serverLogs.shift();
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.once("error", collect);
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(`${label} packaged server`, async () => {
    const response = await fetch(`${baseUrl}/api/home`);
    return response.status;
  }, status => status === 200, 45_000);
  return { child, baseUrl };
}

async function stopPackagedServer(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  const pid = server.child.pid;
  const exited = new Promise(resolve => server.child.once("exit", resolve));
  server.child.kill("SIGTERM");
  await Promise.race([exited, wait(3_000)]);
  if (server.child.exitCode === null && server.child.signalCode === null) {
    try { process.kill(-pid, "SIGKILL"); } catch { server.child.kill("SIGKILL"); }
    await Promise.race([exited, wait(3_000)]);
  }
  await waitFor("packaged server process to stop", () => {
    try { process.kill(pid, 0); return false; } catch { return true; }
  }, Boolean, 5_000);
}

async function api(server, pathname, init = {}) {
  const response = await fetch(`${server.baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return body;
}

function findJob(projection, jobId) {
  return projection?.jobs?.find(job => job.job_id === jobId);
}

try {
  firstServer = await startPackagedServer("attempt-one");
  const initialEnsure = await api(firstServer, "/api/edupi/preparation", {
    method: "POST",
    body: JSON.stringify({ action: "ensure" }),
  });
  assert.notEqual(initialEnsure.state, "error", `packaged Core startup failed: ${JSON.stringify(initialEnsure)}`);
  const enqueued = await api(firstServer, "/api/edupi/jobs", {
    method: "POST",
    body: JSON.stringify({
      action: "enqueue",
      kind: "document",
      title: "安装版后台恢复验收",
      instructions: "写出 recovery.txt，内容说明恢复成功。",
    }),
  });
  const jobId = enqueued.job?.job_id;
  assert.match(jobId, /^agent_job_[a-f0-9]{32}$/);

  await waitFor("first packaged attempt to enter its tool", () => fs.existsSync(attemptMarker), Boolean, 30_000);
  const firstProjection = await api(firstServer, "/api/edupi/jobs");
  assert.equal(findJob(firstProjection.projection, jobId)?.status, "running");
  assert.equal(findJob(firstProjection.projection, jobId)?.attempt_count, 1);
  const firstToolPid = Number.parseInt(fs.readFileSync(attemptMarker, "utf8"), 10);
  assert.equal(Number.isInteger(firstToolPid), true);

  await stopPackagedServer(firstServer);
  firstServer = undefined;
  await waitFor("interrupted packaged tool to stop", () => {
    try { process.kill(firstToolPid, 0); return false; } catch { return true; }
  }, Boolean, 10_000);

  secondServer = await startPackagedServer("attempt-two");
  const recoveryEnsure = await api(secondServer, "/api/edupi/preparation", {
    method: "POST",
    body: JSON.stringify({ action: "ensure" }),
  });
  assert.notEqual(recoveryEnsure.state, "error", `packaged startup recovery failed: ${JSON.stringify(recoveryEnsure)}`);
  const completedProjection = await waitFor("Core to reclaim and finish the packaged job", async () => {
    const current = await api(secondServer, "/api/edupi/jobs");
    return current.projection;
  }, projection => findJob(projection, jobId)?.status === "completed", 60_000);
  const completed = findJob(completedProjection, jobId);
  assert.equal(completed.attempt_count, 2);
  assert.equal(completed.error, null);
  assert.equal(completed.artifacts.length, 1);
  assert.equal(initialModelCalls, 2);
  assert.equal(finalModelCalls, 1);

  const artifactPath = path.join(dataRoot, completed.artifacts[0].relative_path);
  assert.equal(fs.readFileSync(artifactPath, "utf8"), "安装版退出后由 Core 自动恢复成功\n");
  const artifacts = await api(secondServer, "/api/edupi/artifacts");
  const registered = artifacts.artifacts?.find(item => item.artifact_id === completed.artifacts[0].artifact_id);
  assert.ok(registered, "completed file was not registered in Core artifacts");
  assert.equal(registered.available, true);

  const plist = fs.readFileSync(infoPlist, "utf8");
  const version = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1] || "unknown";
  const compatibility = JSON.parse(fs.readFileSync(path.join(serverDir, "contracts", "edupi-core-compat.json"), "utf8"));
  process.stdout.write(`${JSON.stringify({
    ok: true,
    version,
    coreCommit: compatibility.core_runtime.core_commit,
    jobId,
    attemptCount: completed.attempt_count,
    interruptedToolStopped: true,
    artifact: completed.artifacts[0].relative_path,
    artifactRegistered: true,
  }, null, 2)}\n`);
  success = true;
} finally {
  await stopPackagedServer(firstServer);
  await stopPackagedServer(secondServer);
  if (modelServer) {
    modelServer.closeAllConnections();
    await new Promise(resolve => modelServer.close(resolve));
  }
  if (success) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  else {
    process.stderr.write(`Packaged recovery data preserved at ${temporaryRoot}\n`);
    process.stderr.write(serverLogs.slice(-80).join(""));
  }
}
