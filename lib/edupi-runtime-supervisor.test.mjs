import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import ts from "typescript";
import test from "node:test";

test("supervisor shares startup, binds private requests, rejects mismatches and clears failed children", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-supervisor-test-"));
  const hash = `sha256:${"a".repeat(64)}`;
  const manifest = { entrypoint: "scripts/core_runtime_daemon.mjs", component_manifest_version: "1", component_manifest_hash: hash, modules: [], assets: [], runtime_dependencies: [] };
  fs.mkdirSync(path.join(root, "contracts"));
  fs.writeFileSync(path.join(root, "contracts/edupi-core-runtime-component-manifest.json"), JSON.stringify(manifest));
  let requests = 0, wrongBinding = false, privateToken, wrongReady = false, startupErrorCode = null, forks = 0, stopped = 0;
  const children = [];
  const server = http.createServer(async (request, response) => {
    let bytes = ""; for await (const chunk of request) bytes += chunk;
    requests++;
    assert.equal(request.headers.authorization, `Bearer ${privateToken}`);
    const value = JSON.parse(bytes);
    response.end(JSON.stringify({ ...value, request_id: wrongBinding ? "wrong" : value.request_id, ok: true }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const protocol = { CORE_RUNTIME_PROTOCOL: "edupi-core-runtime", CORE_RUNTIME_PROTOCOL_VERSION: 1, CORE_RUNTIME_CONTRACT_VERSION: "1.0", CORE_RUNTIME_SCHEMA_HASH: hash, CORE_RUNTIME_ENDPOINT: "/runtime/v1", CORE_RUNTIME_OUTER_REQUEST_MAX_BYTES: 10000, CORE_RUNTIME_OUTER_RESPONSE_MAX_BYTES: 10000, validateRuntimeRequest: value => ({ ok: value.operation === "health" && value.payload === null }), validateRuntimeResponse: value => ({ ok: value.ok === true && value.schema_hash === hash }) };
  protocol.classifyCoreRuntimeBridgeRequest = request => request.operation === "generated-artifacts" ? request.action === "list" ? "read" : "call" : null;
  const originalValidateRequest = protocol.validateRuntimeRequest;
  protocol.validateRuntimeRequest = value => ({ ok: originalValidateRequest(value).ok || ["bridge_read", "bridge_call"].includes(value.operation) && typeof value.payload?.bridge_frame === "string" });
  const fork = () => {
    forks++;
    const child = new EventEmitter(); child.connected = true; children.push(child);
    child.kill = () => { if (child.connected) { child.connected = false; child.emit("exit", 0); child.emit("close", 0); } return true; };
    child.send = (message, callback) => {
      if (message.type === "runtime-stop") { stopped++; child.kill(); }
      if (message.type === "runtime-start") {
        privateToken = message.options.token;
        queueMicrotask(() => child.emit("message", startupErrorCode
          ? { type: "runtime-error", code: startupErrorCode }
          : { type: "runtime-ready", endpoint: `http://127.0.0.1:${server.address().port}/runtime/v1`, host: "127.0.0.1", port: server.address().port, protocol: protocol.CORE_RUNTIME_PROTOCOL, protocolVersion: 1, contractVersion: "1.0", schemaHash: hash, supervisorSessionId: wrongReady ? "wrong" : message.options.supervisorSessionId, coreCommit: message.options.coreCommit, componentManifestHash: hash, dataRootFingerprint: hash, fencingGeneration: 1, instanceNonce: "nonce" }));
      }
      callback?.();
    };
    return child;
  };
  const nativeRequire = createRequire(import.meta.url);
  const modules = {
    "node:child_process": { fork },
    "./edupi-core-root": { validateContainedRegularFile: ({ candidate }) => fs.realpathSync(candidate) },
    "./edupi-runtime-model-host": { createRuntimeModelHost: () => ({}), attachRuntimeModelHost: () => ({ close: async () => {} }) },
  };
  const source = fs.readFileSync(new URL("./edupi-runtime-supervisor.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const supervisorModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name.endsWith("/edupi_component_manifest.mjs")) return { generateComponentManifest: () => manifest };
    if (name.endsWith("/core_runtime_protocol.mjs")) return protocol;
    if (name.endsWith("/core_runtime_root.mjs")) return { verifyCoreRuntimeRoot: () => ({ ok: true, dataRootFingerprint: hash }) };
    return modules[name] || nativeRequire(name);
  }, supervisorModule, supervisorModule.exports);
  const api = supervisorModule.exports;
  assert.equal(api.describeEduPiRuntimeStartupFailure({ code: "runtime_state_invalid" }), "Core Runtime 状态需要修复（runtime_state_invalid）");
  assert.equal(api.describeEduPiRuntimeStartupFailure({ code: "private_path_detail" }), null);
  const runtime = { root, coreCommit: "a".repeat(40), componentManifestHash: hash };
  const dataRoot = { root, memoryDir: path.join(root, ".edupi/memory"), outputDir: path.join(root, ".edupi/output"), lockDir: path.join(root, ".edupi/locks") };
  try {
    const first = api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.equal(api.getPendingEduPiRuntime(root), first);
    assert.equal(api.ensureEduPiRuntime({ runtime, dataRoot }), first);
    const handle = await first;
    assert.equal(forks, 1);
    assert.equal(api.getActiveEduPiRuntime(root), handle);
    assert.equal((await handle.call("health", null)).ok, true);
    await assert.rejects(handle.call("unknown", null), { code: "invalid_request" });
    assert.equal(requests, 1);
    const list = { operation: "generated-artifacts", action: "list" };
    const registered = { operation: "generated-artifacts", action: "register" };
    const listedResponse = await handle.callBridge(list);
    assert.equal(listedResponse.operation, "bridge_read");
    assert.deepEqual(JSON.parse(listedResponse.payload.bridge_frame), list);
    assert.equal((await handle.callBridge(registered)).operation, "bridge_call");
    await assert.rejects(handle.callBridge({ operation: "unknown" }), { code: "invalid_request" });
    assert.equal(requests, 3);
    wrongBinding = true;
    await assert.rejects(handle.call("health", null), { code: "runtime_unavailable" });
    assert.equal(JSON.stringify(handle).includes(privateToken), false);
    await handle.close();
    assert.equal(api.getActiveEduPiRuntime(root), null);
    assert.equal(api.getPendingEduPiRuntime(root), null);
    assert.equal(stopped, 1);
    wrongReady = true;
    await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot }), { code: "runtime_unavailable" });
    assert.equal(children.at(-1).connected, false);
    wrongReady = false;
    startupErrorCode = "runtime_state_invalid";
    await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot }), { code: "runtime_state_invalid" });
    assert.equal(children.at(-1).connected, false);
    startupErrorCode = "private_path_detail";
    await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot }), { code: "runtime_unavailable" });
    assert.equal(children.at(-1).connected, false);
    startupErrorCode = null; wrongBinding = false;
    const restarted = await api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.equal((await restarted.call("health", null)).ok, true);
    await api.closeAllEduPiRuntimes();
    assert.equal(children.every(child => !child.connected), true);
  } finally { await api.closeAllEduPiRuntimes(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
});
