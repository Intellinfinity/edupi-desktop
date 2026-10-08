import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import ts from "typescript";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("supervisor shares startup, binds private requests, rejects mismatches and clears failed children", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-supervisor-test-"));
  const hash = `sha256:${"a".repeat(64)}`;
  const manifest = { entrypoint: "scripts/core_runtime_daemon.mjs", component_manifest_version: "1", component_manifest_hash: hash, modules: [], assets: [], runtime_dependencies: [] };
  fs.mkdirSync(path.join(root, "contracts"));
  fs.writeFileSync(path.join(root, "contracts/edupi-core-runtime-component-manifest.json"), JSON.stringify(manifest));
  let requests = 0, wrongBinding = false, privateToken, ownerControlHeader, wrongReady = false, startupErrorCode = null, forks = 0, stopped = 0, ownerCredentialUnavailable = false;
  const startupOptions = [];
  const deadlines = [];
  const deadlineCallbacks = [];
  let holdResponse = false, responseReceived;
  let virtualNow = null, virtualTimers = null, fetchOverride = null, shutdownCoordinator = null, readerActive = false, forcedReaderKills = 0;
  class TestDate extends Date { static now() { return virtualNow ?? Date.now(); } }
  const spawnEnvironments = [];
  const originalAmbientPlanning = process.env.EDUPI_AMBIENT_PLANNING;
  const originalWindowsCanary = process.env.EDUPI_WINDOWS_G1_CANARY;
  const originalDesktopStateDir = process.env.PI_DESKTOP_STATE_DIR;
  process.env.PI_DESKTOP_STATE_DIR = path.join(root, "desktop-state");
  fs.mkdirSync(process.env.PI_DESKTOP_STATE_DIR, { mode: 0o700 });
  delete process.env.EDUPI_AMBIENT_PLANNING;
  process.env.EDUPI_WINDOWS_G1_CANARY = "1";
  const children = [];
  const server = http.createServer(async (request, response) => {
    let bytes = ""; for await (const chunk of request) bytes += chunk;
    requests++;
    assert.equal(request.headers.authorization, `Bearer ${privateToken}`);
    if (request.headers["x-edupi-owner-control"]) ownerControlHeader = request.headers["x-edupi-owner-control"];
    const value = JSON.parse(bytes);
    if (holdResponse) {
      const disconnected = new Promise(resolve => response.once("close", resolve));
      responseReceived({ value, disconnected });
      return;
    }
    response.end(JSON.stringify({ ...value, request_id: wrongBinding ? "wrong" : value.request_id, ok: true }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const protocol = { CORE_RUNTIME_PROTOCOL: "edupi-core-runtime", CORE_RUNTIME_PROTOCOL_VERSION: 1, CORE_RUNTIME_CONTRACT_VERSION: "1.0", CORE_RUNTIME_SCHEMA_HASH: hash, CORE_RUNTIME_ENDPOINT: "/runtime/v1", CORE_RUNTIME_OUTER_REQUEST_MAX_BYTES: 10000, CORE_RUNTIME_OUTER_RESPONSE_MAX_BYTES: 10000, validateRuntimeRequest: value => ({ ok: value.operation === "health" && value.payload === null }), validateRuntimeResponse: value => ({ ok: value.ok === true && value.schema_hash === hash }) };
  protocol.classifyCoreRuntimeBridgeRequest = request => request.operation === "command" ? "call" : request.operation === "generated-artifacts" ? request.action === "list" ? "read" : "call" : null;
  const originalValidateRequest = protocol.validateRuntimeRequest;
  protocol.validateRuntimeRequest = value => ({ ok: originalValidateRequest(value).ok || ["bridge_read", "bridge_call"].includes(value.operation) && typeof value.payload?.bridge_frame === "string" });
  const fork = (_bootstrap, _args, options) => {
    forks++;
    spawnEnvironments.push(options.env);
    const child = new EventEmitter(); child.connected = true; children.push(child);
    child.kill = signal => {
      if (signal === "SIGKILL" && readerActive) forcedReaderKills++;
      if (child.connected) { child.connected = false; child.emit("exit", 0); child.emit("close", 0); } return true;
    };
    child.send = (message, callback) => {
      if (message.type === "runtime-stop") {
        stopped++;
        if (shutdownCoordinator) { shutdownCoordinator.stop(); void shutdownCoordinator.waitForIdle().then(() => child.kill()); }
        else child.kill();
      }
      if (message.type === "runtime-start") {
        privateToken = message.options.token;
        startupOptions.push(message.options);
        queueMicrotask(() => child.emit("message", startupErrorCode
          ? { type: "runtime-error", code: startupErrorCode }
          : { type: "runtime-ready", endpoint: `http://127.0.0.1:${server.address().port}/runtime/v1`, host: "127.0.0.1", port: server.address().port, protocol: protocol.CORE_RUNTIME_PROTOCOL, protocolVersion: 1, contractVersion: "1.0", schemaHash: hash, supervisorSessionId: wrongReady ? "wrong" : message.options.supervisorSessionId, coreCommit: message.options.coreCommit, componentManifestHash: hash, dataRootFingerprint: hash, fencingGeneration: 1, instanceNonce: "nonce" }));
      }
      callback?.();
    };
    return child;
  };
  const nativeRequire = createRequire(import.meta.url);
  let preflightFailure = false;
  let coreImports = 0;
  let activationReads = 0;
  let activationOverride = null;
  let platformGate = true;
  let capabilityGate = true;
  const g3Activations = new Map();
  const modules = {
    "node:child_process": { fork },
    "./edupi-core-root": { verifyEduPiRuntimeManifest: ({ root: candidateRoot, pinnedHash }) => {
      if (preflightFailure) throw new Error("Runtime manifest hash mismatch");
      assert.equal(candidateRoot, root);
      assert.equal(pinnedHash, hash);
      return { manifest, filePath: path.join(root, "contracts/edupi-core-runtime-component-manifest.json"), hash };
    } },
    "./edupi-runtime-model-host": { createRuntimeModelHost: () => ({}), attachRuntimeModelHost: () => ({ close: async () => {} }) },
    "./edupi-owner-control-token": {
      loadRuntimeOwnerControlToken: (_stateDir, _dataRoot, { required }) => {
        if (!ownerCredentialUnavailable) return "test-persistent-owner-token";
        if (!required) return null;
        throw Object.assign(new Error("credential unavailable"), { code: "owner_control_credential_unavailable" });
      },
    },
    "./edupi-proactivity-config": {
      readEduPiProactivityActivation: ({ domain } = {}) => {
        activationReads++;
        if (["calendar_administration", "lesson_reflection", "parent_communication"].includes(domain)) {
          return g3Activations.get(domain) ?? { enabled: false, source: "default", configurationStatus: "missing",
            scope: null, grantId: null, updatedAt: null };
        }
        if (activationOverride) return activationOverride;
        const enabled = process.env.EDUPI_AMBIENT_PLANNING === "1";
        return { enabled, source: enabled ? "environment" : "default", updatedAt: null };
      },
    },
    "./edupi-proactivity-control": { isCapabilityGrantBindingIdentity: (domain, scope, grantId) =>
      grantId === `cap-${domain}-${scope.classId}-${scope.subject}` },
    "./safe-mode": { canStartEduPiProactivity: () => platformGate,
      canStartEduPiStudentFollowup: () => false,
      canStartEduPiCapabilityCanary: () => capabilityGate,
      coreRuntimeCanaryEnvironment: (_platform, environment) => platformGate
        && environment.EDUPI_WINDOWS_G1_CANARY === "1" ? { EDUPI_WINDOWS_G1_CANARY: "1" } : {} },
  };
  const source = fs.readFileSync(new URL("./edupi-runtime-supervisor.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const supervisorModule = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", "Date", "fetch", compiled)(name => {
    if (name.endsWith("/edupi_component_manifest.mjs")) { coreImports++; return { generateComponentManifest: () => manifest }; }
    if (name.endsWith("/core_runtime_protocol.mjs")) { coreImports++; return protocol; }
    if (name.endsWith("/core_runtime_root.mjs")) { coreImports++; return { verifyCoreRuntimeRoot: () => ({ ok: true, dataRootFingerprint: hash }) }; }
    return modules[name] || nativeRequire(name);
  }, supervisorModule, supervisorModule.exports, (callback, ms) => {
    deadlines.push(ms); deadlineCallbacks.push(callback);
    if (virtualTimers) { const timer = { fn: callback, ms, at: virtualNow + ms, active: true }; virtualTimers.push(timer); return timer; }
    return setTimeout(callback, ms);
  }, timer => { if (typeof timer?.fn === "function") timer.active = false; else clearTimeout(timer); }, TestDate,
  (...args) => fetchOverride ? fetchOverride(...args) : fetch(...args));
  const api = supervisorModule.exports;
  const scopedActivation = { enabled: true, source: "desktop_canary", configurationStatus: "ready",
    scope: { classId: "class-7-1", subject: "数学" }, grantId: "desktop_canary_math", updatedAt: "2026-09-27T00:00:00.000Z" };
  assert.equal(api.describeEduPiRuntimeStartupFailure({ code: "runtime_state_invalid" }), "Core Runtime 状态需要修复（runtime_state_invalid）");
  assert.match(api.describeEduPiRuntimeStartupFailure({ code: "owner_control_credential_unavailable" }), /授权凭据不可用/);
  assert.equal(api.describeEduPiRuntimeStartupFailure({ code: "private_path_detail" }), null);
  const runtime = { root, coreCommit: "a".repeat(40), componentManifestHash: hash,
    runtimeComponentManifestHash: hash };
  const dataRoot = { root, memoryDir: path.join(root, ".edupi/memory"), outputDir: path.join(root, ".edupi/output"), lockDir: path.join(root, ".edupi/locks") };
  try {
    preflightFailure = true;
    await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot }), { code: "runtime_unavailable" });
    assert.equal(coreImports, 0, "a rejected Runtime manifest cannot import Core code");
    assert.equal(forks, 0, "a rejected Runtime manifest cannot start Core");
    preflightFailure = false;
    assert.deepEqual(api.g1ScopeForActivation(scopedActivation), { ...scopedActivation.scope, grantId: scopedActivation.grantId });
    assert.equal(api.g1ScopeForActivation({ ...scopedActivation, source: "environment" }), null);
    assert.equal(api.g1ScopeForActivation({ ...scopedActivation, grantId: null }), null);
    assert.equal(api.g1ScopeForActivation({ ...scopedActivation, configurationStatus: "mismatched" }), null);
    assert.equal(api.g1ScopeForActivation({ ...scopedActivation, enabled: false }), null);
    const first = api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.equal(api.getPendingEduPiRuntime(root), first);
    assert.equal(api.ensureEduPiRuntime({ runtime, dataRoot }), first);
    const handle = await first;
    assert.equal(forks, 1);
    assert.equal(startupOptions[0].ambientPlanning, undefined);
    assert.equal(startupOptions[0].g1Scope, undefined);
    assert.equal(startupOptions[0].g3AllowedDomains, undefined);
    assert.equal(spawnEnvironments[0].EDUPI_WINDOWS_G1_CANARY, "1",
      "an admitted isolated Core root remains usable before G1 is enabled");
    assert.equal(typeof startupOptions[0].ownerControlToken, "string");
    assert.equal(api.getActiveEduPiRuntime(root), handle);
    assert.equal((await handle.call("health", null)).ok, true);
    await assert.rejects(handle.call("unknown", null), { code: "invalid_request" });
    assert.equal((await handle.callOwnerControl("health", null)).ok, true);
    assert.equal(ownerControlHeader, startupOptions[0].ownerControlToken);
    assert.equal(requests, 2);
    const list = { operation: "generated-artifacts", action: "list" };
    const registered = { operation: "generated-artifacts", action: "register" };
    const listedResponse = await handle.callBridge(list);
    assert.equal(listedResponse.operation, "bridge_read");
    assert.deepEqual(JSON.parse(listedResponse.payload.bridge_frame), list);
    assert.equal((await handle.callBridge(registered)).operation, "bridge_call");
    await assert.rejects(handle.callBridge({ operation: "unknown" }), { code: "invalid_request" });
    assert.equal(requests, 4);
    const intakeRequest = { operation: "command", envelope: { command: { command_type: "intake_material" } } };
    assert.deepEqual(api.eduPiBridgeRequestBudget(intakeRequest), { processingMs: 26000, transportMs: 27000 });
    assert.equal((await handle.callBridge(intakeRequest)).operation, "bridge_call");
    assert.equal(deadlines.at(-1), 27000);
    await handle.callBridge({ operation: "command", envelope: { command: { command_type: "import_calendar" } } });
    assert.equal(deadlines.at(-1), 15000, "the material completion extension cannot widen calendar/timetable/other mutations");
    assert.deepEqual(api.eduPiBridgeRequestBudget({ operation: "snapshot", envelope: intakeRequest.envelope }), { processingMs: 15000, transportMs: 15000 });
    holdResponse = true;
    const beforeCancellation = requests, cancellation = new AbortController();
    let received = new Promise(resolve => { responseReceived = resolve; });
    const pendingIntake = handle.callBridge(intakeRequest, cancellation.signal);
    const cancelledHttp = await received;
    assert.equal(cancelledHttp.value.operation, "bridge_call"); assert.equal(deadlines.at(-1), 27000);
    cancellation.abort();
    await assert.rejects(pendingIntake, { code: "runtime_unavailable" });
    await cancelledHttp.disconnected;
    assert.equal(requests, beforeCancellation + 1, "intake cancellation disconnects its real loopback HTTP request without retry");
    received = new Promise(resolve => { responseReceived = resolve; });
    const timedOutIntake = handle.callBridge(intakeRequest);
    const timedOutHttp = await received;
    assert.equal(deadlines.at(-1), 27000);
    deadlineCallbacks.at(-1)();
    await assert.rejects(timedOutIntake, { code: "runtime_unavailable" });
    await timedOutHttp.disconnected;
    assert.equal(requests, beforeCancellation + 2, "the exact production timer callback aborts HTTP and does not resubmit the accepted-or-unknown mutation");
    holdResponse = false;
    wrongBinding = true;
    await assert.rejects(handle.call("health", null), { code: "runtime_unavailable" });
    assert.equal(JSON.stringify(handle).includes(privateToken), false);
    wrongBinding = false;
    activationOverride = scopedActivation;
    const restartAction = api.restartEduPiRuntime({ runtime, dataRoot });
    assert.equal(api.restartEduPiRuntime({ runtime, dataRoot }), restartAction);
    const restartedFromAction = await restartAction;
    assert.notEqual(restartedFromAction, handle);
    assert.equal(forks, 2);
    assert.equal(startupOptions[1].ambientPlanning, true);
    assert.deepEqual(startupOptions[1].g1Scope, { ...scopedActivation.scope, grantId: scopedActivation.grantId });
    assert.equal(spawnEnvironments[1].EDUPI_WINDOWS_G1_CANARY, "1");
    assert.equal(typeof startupOptions[1].ownerControlToken, "string");
    assert.equal(startupOptions[1].ownerControlToken, startupOptions[0].ownerControlToken);
    assert.notEqual(startupOptions[1].ownerControlToken, startupOptions[1].token);
    assert.equal(stopped, 1);
    assert.equal((await restartedFromAction.call("health", null)).ok, true);
    assert.equal((await restartedFromAction.callOwnerControl("health", null)).ok, true);
    assert.equal(ownerControlHeader, startupOptions[1].ownerControlToken);
    await restartedFromAction.close();
    assert.equal(api.getActiveEduPiRuntime(root), null);
    assert.equal(api.getPendingEduPiRuntime(root), null);
    assert.equal(stopped, 2);
    activationOverride = { ...scopedActivation, enabled: false, configurationStatus: "stop_pending" };
    const stoppedRuntime = await api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.equal(startupOptions.at(-1).g1Scope, undefined);
    assert.equal(startupOptions.at(-1).ambientPlanning, undefined);
    assert.equal(spawnEnvironments.at(-1).EDUPI_WINDOWS_G1_CANARY, "1",
      "stop intent keeps native root admission for owner grant pause and saved-draft reads");
    assert.equal((await stoppedRuntime.callOwnerControl("health", null)).ok, true);
    await stoppedRuntime.close();
    activationOverride = null;
    g3Activations.set("calendar_administration", { ...scopedActivation,
      grantId: "g3-calendar-grant", updatedAt: "2026-10-08T01:00:00.000Z" });
    const g3Running = await api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.equal(startupOptions.at(-1).g3AllowedDomains, undefined,
      "an old Core with only a domain allowlist cannot exclude a second active grant in the same domain");
    assert.equal(startupOptions.at(-1).g1Scope, undefined);
    const stopsBeforeG3Change = stopped;
    g3Activations.set("lesson_reflection", { ...scopedActivation,
      grantId: "g3-reflection-grant", updatedAt: "2026-10-08T01:30:00.000Z" });
    const g3Expanded = await api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.notEqual(g3Expanded, g3Running);
    assert.equal(stopped, stopsBeforeG3Change + 1);
    assert.equal(startupOptions.at(-1).g3AllowedDomains, undefined);
    g3Activations.set("calendar_administration", { ...scopedActivation, enabled: false,
      configurationStatus: "stop_pending", grantId: "g3-calendar-grant", updatedAt: "2026-10-08T02:00:00.000Z" });
    const g3Reduced = await api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.notEqual(g3Reduced, g3Expanded);
    assert.equal(stopped, stopsBeforeG3Change + 2, "domain removal drains the selected Core before replacement startup");
    assert.equal(startupOptions.at(-1).g3AllowedDomains, undefined);
    g3Activations.set("lesson_reflection", { ...scopedActivation, enabled: false,
      configurationStatus: "stop_pending", grantId: "g3-reflection-grant", updatedAt: "2026-10-08T02:30:00.000Z" });
    const g3Stopped = await api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.notEqual(g3Stopped, g3Reduced);
    assert.equal(stopped, stopsBeforeG3Change + 3);
    assert.equal(startupOptions.at(-1).g3AllowedDomains, undefined);
    await g3Stopped.close();
    const stagedRuntime = { ...runtime, coreCommit: "682ebbad9ade9494d9304b026207e659eb265d29" };
    g3Activations.set("calendar_administration", { ...scopedActivation,
      scope: { classId: "class-7-1", subject: "administration" },
      grantId: "cap-calendar_administration-class-7-1-administration", updatedAt: "2026-10-08T02:45:00.000Z" });
    const exactOne = await api.ensureEduPiRuntime({ runtime: stagedRuntime, dataRoot });
    assert.deepEqual(startupOptions.at(-1).g3AllowedBindings, [{ domain: "calendar_administration",
      grantId: "cap-calendar_administration-class-7-1-administration",
      scope: { class_id: "class-7-1", subject: "administration" } }]);
    g3Activations.set("lesson_reflection", { ...scopedActivation,
      grantId: "cap-lesson_reflection-class-7-1-数学", updatedAt: "2026-10-08T02:50:00.000Z" });
    const exactTwo = await api.ensureEduPiRuntime({ runtime: stagedRuntime, dataRoot });
    assert.notEqual(exactTwo, exactOne, "binding expansion drains before restarting the shared Core");
    assert.equal(startupOptions.at(-1).g3AllowedBindings.length, 2);
    g3Activations.set("calendar_administration", { ...g3Activations.get("calendar_administration"),
      enabled: false, configurationStatus: "stop_pending", updatedAt: "2026-10-08T02:55:00.000Z" });
    const exactReduced = await api.ensureEduPiRuntime({ runtime: stagedRuntime, dataRoot });
    assert.notEqual(exactReduced, exactTwo);
    assert.deepEqual(startupOptions.at(-1).g3AllowedBindings.map(binding => binding.domain), ["lesson_reflection"]);
    g3Activations.set("lesson_reflection", { ...g3Activations.get("lesson_reflection"),
      enabled: false, configurationStatus: "stop_pending", updatedAt: "2026-10-08T03:00:00.000Z" });
    const exactOff = await api.ensureEduPiRuntime({ runtime: stagedRuntime, dataRoot });
    assert.notEqual(exactOff, exactReduced);
    assert.equal(startupOptions.at(-1).g3AllowedBindings, undefined);
    await exactOff.close();
    g3Activations.set("calendar_administration", { ...scopedActivation,
      grantId: "g3-calendar-grant", updatedAt: "2026-10-08T03:00:00.000Z" });
    capabilityGate = false;
    platformGate = false;
    activationOverride = scopedActivation;
    assert.equal(api.g1ScopeForActivation(scopedActivation), null);
    const normalRestart = await api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.equal(startupOptions.at(-1).ambientPlanning, undefined,
      "a persisted Safe Mode grant cannot start G1 after Windows returns to normal mode");
    assert.equal(startupOptions.at(-1).g1Scope, undefined);
    assert.equal(startupOptions.at(-1).g3AllowedDomains, undefined,
      "a persisted G3 config cannot start the shared processor outside an isolated canary");
    assert.equal(spawnEnvironments.at(-1).EDUPI_WINDOWS_G1_CANARY, undefined);
    await normalRestart.close();
    g3Activations.clear();
    platformGate = true;
    const forksBeforeQuarantine = forks;
    await api.quarantineEduPiRuntime(root);
    await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot }), { code: "runtime_unavailable" });
    assert.equal(forks, forksBeforeQuarantine, "failed stop never restarts G1 on a status refresh");
    api.clearEduPiRuntimeQuarantine(root);
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
    startupErrorCode = null;
    const restarted = await api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.equal((await restarted.call("health", null)).ok, true);
    assert.equal(startupOptions.at(-1).ownerControlToken, startupOptions[1].ownerControlToken);
    await api.closeAllEduPiRuntimes();
    assert.equal(children.every(child => !child.connected), true);

    ownerCredentialUnavailable = true;
    activationOverride = null;
    delete process.env.EDUPI_AMBIENT_PLANNING;
    const degraded = await api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.equal(startupOptions.at(-1).ownerControlToken, undefined);
    assert.equal((await degraded.call("health", null)).ok, true);
    await assert.rejects(degraded.callOwnerControl("health", null), { code: "owner_control_credential_unavailable" });
    await degraded.close();
    const forksBeforeRequiredCredential = forks;
    process.env.EDUPI_AMBIENT_PLANNING = "1";
    await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot }), { code: "owner_control_credential_unavailable" });
    assert.equal(forks, forksBeforeRequiredCredential);
    assert.ok(activationReads >= forks, "every runtime identity is bound to the current proactivity activation");
    await t.test("a timed-out FIFO intake keeps actual Core reader completion alive through shutdown", { skip: !process.env.EDUPI_CORE_ROOT }, async () => {
      const { createCoreRuntimeBridgeCallCoordinator } = await import(pathToFileURL(path.join(process.env.EDUPI_CORE_ROOT, "scripts/core_runtime_daemon.mjs")).href);
      const queue = createCoreRuntimeBridgeCallCoordinator();
      let releaseEarlier, releaseReader, readerStarted, shutdown;
      const earlier = new Promise(resolve => { releaseEarlier = resolve; });
      const prior = queue.enqueue(() => ({ response: earlier, completion: earlier, serialized: earlier }));
      const started = new Promise(resolve => { readerStarted = resolve; });
      ownerCredentialUnavailable = false; activationOverride = null; delete process.env.EDUPI_AMBIENT_PLANNING;
      virtualNow = 0; virtualTimers = []; shutdownCoordinator = queue;
      let fetchCalls = 0;
      fetchOverride = (_url, init) => {
        fetchCalls++;
        return new Promise((resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("transport aborted")), { once: true });
          void queue.enqueue(() => {
            readerActive = true;
            const reader = new Promise(done => { releaseReader = () => { readerActive = false; done(); }; });
            readerStarted();
            return { response: reader.then(() => { const sent = JSON.parse(init.body); return new Response(JSON.stringify({ ...sent, ok: true })); }),
              completion: reader, serialized: Promise.resolve() };
          }).then(resolve, reject);
        });
      };
      try {
        const fifoHandle = await api.ensureEduPiRuntime({ runtime, dataRoot });
        const caller = fifoHandle.callBridge(intakeRequest);
        assert.equal(queue.queued, 1); assert.equal(readerActive, false);
        virtualNow = 24000; releaseEarlier(); await prior; await started;
        virtualNow = 27000;
        const transport = virtualTimers.find(timer => timer.active && timer.ms === 27000); transport.active = false; transport.fn();
        await assert.rejects(caller, { code: "runtime_unavailable" });
        shutdown = fifoHandle.close();
        const force = virtualTimers.at(-1);
        assert.equal(force.ms, 27000, "shutdown must budget from close, not from the expired caller clock");
        virtualNow = 32000;
        for (const timer of virtualTimers) if (timer.active && timer.at <= virtualNow) { timer.active = false; timer.fn(); }
        assert.equal(children.at(-1).connected, true, "the reader began at t24 and is still completing before its t34 bound");
        assert.equal(readerActive, true); assert.equal(forcedReaderKills, 0);
        virtualNow = 34000; releaseReader(); await shutdown;
        assert.equal(await queue.waitForIdle(), true); assert.equal(forcedReaderKills, 0);
        assert.equal(children.at(-1).connected, false); assert.equal(fetchCalls, 1);
      } finally {
        releaseEarlier(); releaseReader?.(); await shutdown;
        shutdownCoordinator = null; fetchOverride = null; virtualTimers = null; virtualNow = null;
      }
    });
  } finally {
    if (originalAmbientPlanning === undefined) delete process.env.EDUPI_AMBIENT_PLANNING;
    else process.env.EDUPI_AMBIENT_PLANNING = originalAmbientPlanning;
    if (originalWindowsCanary === undefined) delete process.env.EDUPI_WINDOWS_G1_CANARY;
    else process.env.EDUPI_WINDOWS_G1_CANARY = originalWindowsCanary;
    if (originalDesktopStateDir === undefined) delete process.env.PI_DESKTOP_STATE_DIR;
    else process.env.PI_DESKTOP_STATE_DIR = originalDesktopStateDir;
    await api.closeAllEduPiRuntimes(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
  }
});
