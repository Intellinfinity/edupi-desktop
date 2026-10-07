import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { createJiti } from "jiti";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const jiti = createJiti(import.meta.url);
const { resolveEduPiCoreRoot, resolveEduPiDataRoot } = await jiti.import("./edupi-core-root.ts");
const coreClient = await jiti.import("./edupi-core-process-client.ts");
const { callEduPiCore, runCoreProcess } = coreClient;
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

test("adds the schedule occurrence opt-in only to an explicit snapshot read", async () => {
  const runtime = fakeRuntime('throw new Error("must not spawn");');
  const dataRoot = fakeDataRoot(runtime);
  const calls = [];
  globalThis.__edupiRuntimeSupervisors.set(dataRoot.root, { identity: "test", startup: Promise.resolve({
    callBridge: async (request) => {
      calls.push(structuredClone(request));
      return { ok: true, result: { bridge_frame: '{"ok":true}\n' } };
    },
  }) });
  try {
    await callEduPiCore({ operation: "snapshot", requestId: "snapshot-default", runtime, dataRoot });
    await callEduPiCore({ operation: "snapshot", requestId: "snapshot-occurrence", runtime, dataRoot, scheduleOccurrenceVersion: "1.2" });
    assert.deepEqual(calls, [
      { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "snapshot", request_id: "snapshot-default" },
      { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "snapshot", request_id: "snapshot-occurrence", schedule_occurrence_version: "1.2" },
    ]);
    await assert.rejects(
      callEduPiCore({ operation: "health", requestId: "health-occurrence", runtime, dataRoot, scheduleOccurrenceVersion: "1.2" }),
      (error) => error?.code === "invalid_request",
    );
    assert.equal(calls.length, 2, "an invalid opt-in cannot reach Core");
  } finally { globalThis.__edupiRuntimeSupervisors.delete(dataRoot.root); }
});

test("runtime intake keeps the exact accepted receipt and exposes Unicode opaque proposal metadata independently", async () => {
  const runtime = fakeRuntime('throw new Error("must not spawn");');
  const dataRoot = fakeDataRoot(runtime);
  const requestId = "upload-original";
  const receipt = { request_id: requestId, payload: { command_type: "intake_material", command_id: "upload-command", request_id: requestId,
    status: "accepted", receipt_phase: "mutation", applied_ids: ["旧材料中文"], rejected_ids: [], target: { target_kind: "material_intake", target_id: "target" } } };
  const bridgeResponse = { ok: true, operation: "command", request_id: requestId, receipt };
  const frame = `${JSON.stringify(bridgeResponse)}\n`;
  const proposal = { status: "unavailable", material_id: "旧材料中文", read_result: null, reason_code: "material_schedule_invalid",
    read_only: true, automatic_import: false, external_send: false };
  fs.mkdirSync(path.join(runtime.root, "scripts"));
  fs.writeFileSync(path.join(runtime.root, "scripts/core_runtime_protocol.mjs"), `export const MaterialScheduleProposalSchema = ${JSON.stringify({
    type: "object", additionalProperties: false, required: Object.keys(proposal), properties: { status: { const: "unavailable" }, material_id: { type: "string", minLength: 1, maxLength: 160 },
      read_result: { type: "null" }, reason_code: { const: "material_schedule_invalid" }, read_only: { const: true }, automatic_import: { const: false }, external_send: { const: false } },
  })};`);
  let calls = 0;
  globalThis.__edupiRuntimeSupervisors.set(dataRoot.root, { identity: "test", startup: Promise.resolve({ callBridge: async () => {
    calls++; return { ok: true, operation: "bridge_call", result: { bridge_frame: frame, material_schedule_proposal: proposal } };
  } }) });
  try {
    const fn = coreClient.callEduPiCoreWithMetadata ?? callEduPiCore;
    const result = await fn({ operation: "command", requestId, runtime, dataRoot, envelope: { message_id: "upload-command", request_id: requestId,
      command: { command_type: "intake_material", material: { material_id: "旧材料中文" } } } });
    assert.deepEqual(result.response ?? result, bridgeResponse);
    assert.deepEqual(result.runtimeMetadata?.materialScheduleProposal, proposal, "the Runtime-only proposal must survive the old frame unwrap");
    assert.equal(result.bridgeFrame, frame);
    assert.deepEqual(receipt, bridgeResponse.receipt, "v1.1 receipt fields are never decorated or replaced");
    assert.equal(calls, 1, "proposal exposure must not submit again");
  } finally { globalThis.__edupiRuntimeSupervisors.delete(dataRoot.root); fs.rmSync(runtime.root, { recursive: true, force: true }); }
});

test("proposal metadata is strict, capacity bounded, and never attaches to a different request or mutation", async () => {
  const runtime = fakeRuntime('throw new Error("must not spawn");'), dataRoot = fakeDataRoot(runtime);
  const request = { operation: "command", request_id: "metadata-request", envelope: { message_id: "metadata-command", request_id: "metadata-request",
    command: { command_type: "intake_material", material: { material_id: "材料原文" } } } };
  const original = { ok: true, operation: "command", request_id: request.request_id, receipt: { request_id: request.request_id,
    payload: { command_type: "intake_material", command_id: request.envelope.message_id, request_id: request.request_id, status: "accepted",
      receipt_phase: "mutation", applied_ids: ["材料原文"], rejected_ids: [], target: { target_kind: "material_intake", target_id: "target" } } } };
  const proposal = { status: "unavailable", material_id: "材料原文", read_result: null, reason_code: "material_schedule_invalid",
    read_only: true, automatic_import: false, external_send: false };
  fs.mkdirSync(path.join(runtime.root, "scripts"));
  fs.writeFileSync(path.join(runtime.root, "scripts/core_runtime_protocol.mjs"), `export const MaterialScheduleProposalSchema = ${JSON.stringify({
    type: "object", additionalProperties: false, required: Object.keys(proposal), properties: { status: { const: "unavailable" }, material_id: { type: "string", minLength: 1, maxLength: 160 },
      read_result: { type: "null" }, reason_code: { const: "material_schedule_invalid" }, read_only: { const: true }, automatic_import: { const: false }, external_send: { const: false } },
  })};`);
  let response = original, sidecar = proposal, calls = 0;
  globalThis.__edupiRuntimeSupervisors.set(dataRoot.root, { identity: "test", startup: Promise.resolve({ callBridge: async () => {
    calls++; return { ok: true, result: { bridge_frame: JSON.stringify(response), ...(sidecar === undefined ? {} : { material_schedule_proposal: sidecar }) } };
  } }) });
  const invoke = sent => coreClient.runCoreProcessWithMetadata({ runtime, dataRoot, request: sent || request, timeoutMs: 1000 });
  try {
    for (const invalid of [null, { ...proposal, external_send: true }, { ...proposal, automatic_import: true }, { ...proposal, extra: true },
      { ...proposal, material_id: "unrelated" }, { ...proposal, reason_code: "private_diagnostic" }, { ...proposal, status: "ready" }]) {
      sidecar = invalid;
      const result = await invoke();
      assert.deepEqual(result.response, original, "an invalid optional field does not change the accepted receipt");
      assert.deepEqual(result.runtimeMetadata.materialScheduleProposal, proposal, "invalid proposals are explicit read-only unavailable observations");
    }
    sidecar = { ...proposal, extra: "x".repeat(640 * 1024 + 4096) };
    assert.equal((await invoke()).runtimeMetadata.materialScheduleProposal.reason_code, "material_schedule_proposal_capacity");
    sidecar = undefined;
    assert.deepEqual((await invoke()).runtimeMetadata, {}, "older Core without a sidecar remains compatible");
    sidecar = proposal;
    for (const invalid of [
      { ...original, request_id: "different-response" },
      { ...original, receipt: { ...original.receipt, request_id: "different-receipt" } },
      { ...original, receipt: { ...original.receipt, payload: { ...original.receipt.payload, command_id: "different-command" } } },
      { ...original, receipt: { ...original.receipt, payload: { ...original.receipt.payload, status: "held" } } },
      { ...original, receipt: { ...original.receipt, payload: { ...original.receipt.payload, applied_ids: ["材料原文", "second-material"] } } },
      { ...original, receipt: { ...original.receipt, payload: { ...original.receipt.payload, target: { target_kind: "calendar_import" } } } },
    ]) {
      response = invalid;
      assert.deepEqual((await invoke()).runtimeMetadata, {}, "only a request-bound accepted material mutation can expose metadata");
    }
    response = original;
    assert.deepEqual((await invoke({ ...request, request_id: "different-outer-request" })).runtimeMetadata, {});
    assert.deepEqual((await invoke({ ...request, operation: "snapshot" })).runtimeMetadata, {});
    assert.deepEqual((await invoke({ ...request, envelope: { ...request.envelope, command: { command_type: "import_calendar" } } })).runtimeMetadata, {});
    assert.equal(calls, 18, "validation never submits a follow-up command or retries intake");
  } finally { globalThis.__edupiRuntimeSupervisors.delete(dataRoot.root); fs.rmSync(runtime.root, { recursive: true, force: true }); }
});

test("cancelled or timed-out Runtime intake cannot publish a late accepted frame or proposal", async () => {
  const runtime = fakeRuntime('throw new Error("must not spawn");'), dataRoot = fakeDataRoot(runtime);
  let calls = 0, release, hostSignal;
  const source = () => new Promise(resolve => { release = resolve; });
  let held = source();
  globalThis.__edupiRuntimeSupervisors.set(dataRoot.root, { identity: "test", startup: Promise.resolve({ callBridge: (_request, signal) => {
    calls++; hostSignal = signal; return held;
  } }) });
  try {
    const request = { operation: "command", envelope: { command: { command_type: "intake_material" } } };
    const controller = new AbortController();
    const cancelled = coreClient.runCoreProcessWithMetadata({ runtime, dataRoot, request, timeoutMs: 1000, signal: controller.signal });
    await Promise.resolve(); controller.abort();
    await assert.rejects(cancelled, error => error.code === "aborted");
    assert.equal(hostSignal.aborted, true);
    release({ ok: true, result: { bridge_frame: '{"ok":true,"receipt":{"status":"accepted"}}', material_schedule_proposal: {} } });
    await Promise.resolve();
    held = source();
    await assert.rejects(coreClient.runCoreProcessWithMetadata({ runtime, dataRoot, request, timeoutMs: 10 }), error => error.code === "timeout");
    assert.equal(hostSignal.aborted, true);
    release({ ok: true, result: { bridge_frame: '{"ok":true,"receipt":{"status":"accepted"}}', material_schedule_proposal: {} } });
    await Promise.resolve();
    controller.abort();
    await assert.rejects(coreClient.runCoreProcessWithMetadata({ runtime, dataRoot, request, timeoutMs: 1000, signal: controller.signal }), error => error.code === "aborted");
    assert.equal(calls, 2, "cancellation and deadline never resubmit or spawn a fallback writer");
  } finally { globalThis.__edupiRuntimeSupervisors.delete(dataRoot.root); fs.rmSync(runtime.root, { recursive: true, force: true }); }
});

test("actual loopback intake completion after the old 15-second boundary is retained without retry", { timeout: 32_000 }, async () => {
  const runtime = fakeRuntime('throw new Error("must not spawn");');
  const dataRoot = fakeDataRoot(runtime);
  let calls = 0;
  const server = http.createServer(async (request, response) => {
    for await (const chunk of request) { void chunk; /* Drain the actual request. */ }
    calls++; setTimeout(() => { if (!response.destroyed) response.end(JSON.stringify({ ok: true, result: { bridge_frame: '{"ok":true,"operation":"command","receipt":{"status":"accepted"}}\n' } })); }, 15_250);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  globalThis.__edupiRuntimeSupervisors.set(dataRoot.root, { identity: "test", startup: Promise.resolve({ callBridge: async (_request, signal) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, { method: "POST", body: "{}", signal }); return response.json();
  } }) });
  try {
    const result = await callEduPiCore({ operation: "command", requestId: "late-intake", runtime, dataRoot,
      envelope: { command: { command_type: "intake_material" } } });
    assert.equal(result.receipt.status, "accepted");
    assert.equal(calls, 1);
  } finally { globalThis.__edupiRuntimeSupervisors.delete(dataRoot.root); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(runtime.root, { recursive: true, force: true }); }
});

test("real paired Core host exposes initial read-only proposals and requires a fresh source proof after restart", { skip: !configuredRoot, timeout: 25_000 }, async () => {
  const coreRoot = fs.realpathSync(configuredRoot);
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-proposal-consumer-")));
  const dataDirectory = path.join(temp, "teacher"), stateDirectory = path.join(temp, "desktop");
  for (const directory of [dataDirectory, stateDirectory, path.join(dataDirectory, ".edupi/memory"), path.join(dataDirectory, ".edupi/output"), path.join(dataDirectory, ".edupi/locks")]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const previousState = process.env.PI_DESKTOP_STATE_DIR;
  process.env.PI_DESKTOP_STATE_DIR = stateDirectory;
  const from = name => import(pathToFileURL(path.join(coreRoot, "scripts", name)).href);
  const { buildCommandEnvelope } = await from("edupi_bridge_command.mjs");
  const { validateReceiptEnvelope } = await from("edupi_bridge_receipt.mjs");
  const { prepareCoreRuntimeRoot } = await from("core_runtime_root.mjs");
  const { acquireCoreRuntimeWriterAdmission } = await from("core_runtime_writer_admission.mjs");
  const supervisor = await jiti.import("./edupi-runtime-supervisor.ts");
  const runtime = actualRuntime(), dataRoot = resolveEduPiDataRoot({ configuredRoot: dataDirectory, allowedRoot: temp });
  const { activeBridgeIdentity } = await jiti.import("./edupi-bridge-manifest.ts");
  const identity = activeBridgeIdentity().runtime, protocol = await from("core_runtime_protocol.mjs");
  assert.equal(runtime.coreCommit, identity.core_commit, "actual host must consume the Desktop pin, not an independently selected compatible tree");
  assert.equal(runtime.componentManifestHash, identity.component_manifest_hash);
  assert.equal(protocol.CORE_RUNTIME_SCHEMA_HASH, identity.runtime_schema_hash);
  assert.equal(JSON.parse(fs.readFileSync(path.join(coreRoot, "contracts/edupi-core-runtime-component-manifest.json"), "utf8")).component_manifest_hash, identity.runtime_component_manifest_hash);
  let handle, admission;
  const bytes = Buffer.from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-consumer\r\nDTSTART:20261012T090000Z\r\nDTEND:20261012T100000Z\r\nSUMMARY:合成教研会\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n");
  const sourceHash = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  try {
    handle = await supervisor.ensureEduPiRuntime({ runtime, dataRoot });
    const rootRef = (await handle.call("health", null)).result.data_root_fingerprint;
    assert.equal((await handle.callOwnerControl("owner_control", { command_id: "consumer-owner", root_ref: rootRef, expected_owner_id: null, action: "bootstrap" })).ok, true);
    const ownerId = (await handle.call("owner_read", { root_ref: rootRef })).result.owner.id;
    const snapshot = async () => (await callEduPiCore({ operation: "snapshot", requestId: `consumer-snapshot-${crypto.randomUUID()}`, runtime, dataRoot })).envelope.payload;
    const prepareUpload = (id, number) => {
      const stagingId = `stg_${String(number).padStart(32, "0")}`, directory = path.join(stateDirectory, "material-staging", stagingId);
      fs.mkdirSync(directory, { recursive: true }); const staged = path.join(directory, "material.ics"); fs.writeFileSync(staged, bytes);
      const source = { source_id: id, source_kind: "teacher_file", source_hash: sourceHash, evidence_ids: [stagingId] };
      return { command_type: "intake_material", source, material: { material_id: id, staging_id: stagingId, staging_path: staged, source_path: null,
        source_hash: sourceHash, expected_size_bytes: bytes.length, kind: "other", title: "合成消费者材料", subject: null, class_id: null, source_scope: "desktop_staging" } };
    };
    const upload = async (id, number) => {
      const command = prepareUpload(id, number);
      const at = new Date().toISOString(), before = await snapshot(), requestId = `consumer-intake-${number}`;
      const source = command.source;
      const envelope = buildCommandEnvelope({ messageId: requestId, requestId, issuedAt: at, snapshotId: before.snapshot_id, idempotencyKey: requestId,
        provenance: [{ ...source, source_path: null, observed_at: at, actor: "teacher", parent_ids: [] }],
        teacherReview: { state: "pending_review", reviewer_id: null, reviewed_at: null, note: null, revision: 0 },
        command });
      return coreClient.callEduPiCoreWithMetadata({ operation: "command", requestId, runtime, dataRoot, envelope });
    };
    const first = await upload("consumer-material", 1);
    assert.equal(first.response.receipt.payload.status, "accepted"); assert.equal(validateReceiptEnvelope(first.response.receipt).ok, true);
    assert.deepEqual(JSON.parse(first.bridgeFrame), first.response);
    assert.equal(first.response.receipt.material_schedule_proposal, undefined);
    const proposal = first.runtimeMetadata.materialScheduleProposal;
    assert.equal(proposal.status, "proposed"); assert.equal(proposal.read_result.status, "ready");
    assert.equal(proposal.automatic_import, false);
    assert.equal(proposal.read_result.owner_id, ownerId); assert.equal(proposal.read_result.root_ref, rootRef);
    const opaque = await upload("历史中文资料", 2);
    assert.equal(opaque.response.receipt.payload.status, "accepted");
    assert.equal(opaque.runtimeMetadata.materialScheduleProposal.material_id, "历史中文资料");
    assert.equal(opaque.runtimeMetadata.materialScheduleProposal.status, "unavailable");
    const canonical = JSON.parse(fs.readFileSync(path.join(dataDirectory, ".edupi/output/education_intake_state.json"), "utf8"));
    assert.deepEqual(canonical.calendar_events, []); assert.deepEqual(canonical.timetable_slots, []);
    const fresh = await snapshot();
    const flatReceipt = fresh.receipts.find(receipt => receipt.receipt_id === first.response.receipt.payload.receipt_id);
    assert.equal(flatReceipt.payload, undefined, "public snapshot receipts are flat normalized mutation payloads");
    for (const key of ["receipt_id", "command_id", "request_id", "command_type", "receipt_phase", "status", "applied_ids", "target"]) {
      assert.deepEqual(flatReceipt[key], first.response.receipt.payload[key]);
    }
    const reviewTarget = fresh.review_targets.find(target => target.projection_kind === "material_intake"
      && target.target.target_id === flatReceipt.target.target_id);
    assert.equal(reviewTarget.source_hash, sourceHash, "current source proof comes from the exact canonical review target");
    const metadata = await runCoreProcess({ runtime, dataRoot, timeoutMs: 15000, request: { protocol: "edupi-desktop-bridge", protocol_version: 1,
      producer: "edupi-desktop", operation: "workspace-resources", request_id: "consumer-metadata-history", include_material_metadata_versions: true, material_id: proposal.material_id } });
    assert.equal(metadata.materialMetadataVersions.material_id, proposal.material_id);
    assert.equal(metadata.materialMetadataVersions.revision, proposal.read_result.source.metadata_revision);
    const readRequest = { root_ref: rootRef, expected_owner_id: ownerId, material_id: proposal.material_id,
      expected_source_hash: proposal.read_result.source.source_hash, expected_metadata_revision: proposal.read_result.source.metadata_revision };
    const current = await handle.callOwnerControl("material_schedule_read", readRequest);
    assert.equal(current.ok, true); assert.equal(current.result.parse_fingerprint, proposal.read_result.parse_fingerprint);
    const { issueEducationIntake } = await jiti.import("./edupi-education-intake.ts");
    let replayedResponse;
    const replayed = await issueEducationIntake(prepareUpload("consumer-material", 3), {
      readSnapshot: async () => ({ payload: await snapshot(), roots: { runtime, dataRoot } }),
      dispatchWithMetadata: async envelope => {
        const outcome = await coreClient.callEduPiCoreWithMetadata({ operation: "command", requestId: envelope.request_id, runtime, dataRoot, envelope });
        replayedResponse = outcome.response;
        assert.equal(validateReceiptEnvelope(replayedResponse.receipt).ok, true); assert.equal(replayedResponse.receipt.payload.reason_code, "already_applied");
        const update = await runCoreProcess({ runtime, dataRoot, timeoutMs: 15000, request: { protocol: "edupi-desktop-bridge", protocol_version: 1,
          producer: "edupi-desktop", operation: "material-metadata", request_id: "consumer-overtaking-metadata", action: "update",
          material_id: "consumer-material", expected_revision: 0, patch: { title: "合成材料修订" } } });
        assert.equal(update.ok, true);
        return outcome;
      },
      refreshSnapshot: snapshot,
    });
    assert.equal(replayed.receipt.reason_code, "already_applied");
    assert.deepEqual(replayed.receipt, replayedResponse.receipt.payload, "an overtaking source edit cannot rewrite the original accepted replay observation");
    assert.notEqual(replayed.data.snapshot_id, replayed.receipt.after_snapshot_id);
    assert.equal(replayed.data.receipts.some(receipt => receipt.receipt_id === replayed.receipt.receipt_id), false, "Core correctly does not persist its transient source replay receipt");
    assert.equal(replayed.data.receipts.filter(receipt => receipt.command_type === "intake_material" && receipt.applied_ids.includes("consumer-material")).length, 1);
    readRequest.expected_metadata_revision = 1;
    const reread = await handle.callOwnerControl("material_schedule_read", readRequest);
    assert.equal(reread.ok, true); assert.equal(reread.result.source.metadata_revision, 1);
    await handle.close(); handle = null;
    admission = await acquireCoreRuntimeWriterAdmission({ root: prepareCoreRuntimeRoot(dataDirectory), kind: "legacy_consumer_material_change" });
    fs.writeFileSync(path.join(dataDirectory, proposal.read_result.source.relative_path), "Synthetic source bytes changed.");
    await admission.release(); admission = null;
    handle = await supervisor.ensureEduPiRuntime({ runtime, dataRoot });
    const stale = await handle.callOwnerControl("material_schedule_read", readRequest);
    assert.equal(stale.ok, false, "cached upload proposal is not current proof after actual source change/restart");
    assert.ok(["material_schedule_source_unavailable", "material_schedule_stale"].includes(stale.error_code));
    assert.equal(proposal.status, "proposed", "old immutable metadata stays an initial observation, not a fresh read result");
  } finally {
    await admission?.release(); await handle?.close();
    if (previousState === undefined) delete process.env.PI_DESKTOP_STATE_DIR; else process.env.PI_DESKTOP_STATE_DIR = previousState;
    fs.rmSync(temp, { recursive: true, force: true });
  }
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

test("classifies only request-bound known writer denials from nonzero exits", async () => {
  const request = { operation: "command", request_id: "writer-denial-test" };
  const base = { ok: false, operation: request.operation, request_id: request.request_id, code: "writer_admission_unavailable" };
  for (const [failure, expected, suffix = ""] of [
    [base, "writer_admission_unavailable"],
    [{ ...base, code: "writer_admission_invalid_root" }, "writer_admission_invalid_root"],
    [{ ...base, code: "writer_admission_path_invalid" }, "writer_admission_path_invalid"],
    [base, "nonzero_exit", "noise\n"],
    [{ ...base, request_id: "different-request" }, "nonzero_exit"],
    [{ ...base, operation: "students" }, "nonzero_exit"],
    [{ ...base, code: "writer_admission_unknown" }, "nonzero_exit"],
    [{ ...base, ok: true }, "nonzero_exit"],
  ]) {
    const runtime = fakeRuntime(`process.stderr.write("private diagnostic secret=synthetic-token"); process.stdout.write(${JSON.stringify(JSON.stringify(failure) + "\n" + suffix)}); process.exitCode=1;`);
    try {
      await assert.rejects(runCoreProcess({ runtime, dataRoot: fakeDataRoot(runtime), request, timeoutMs: 1000 }), error => {
        assert.equal(error.code, expected);
        assert.doesNotMatch(error.message, /synthetic-token/);
        if (expected !== "nonzero_exit") assert.doesNotMatch(error.message, /private diagnostic/);
        return true;
      });
    } finally { fs.rmSync(runtime.root, { recursive: true, force: true }); }
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

test("passes only validated roots and admitted Windows mode to the Core read child", async () => {
  const runtime = fakeRuntime('process.stdout.write(JSON.stringify({ project: process.env.EDUPI_PROJECT_ROOT, home: process.env.EDUPI_HOME, parent: process.env.EDUPI_CORE_PARENT_PID, memory: process.env.EDUPI_MEMORY_DIR, output: process.env.EDUPI_OUTPUT_DIR, locks: process.env.EDUPI_LOCK_DIR, commit: process.env.EDUPI_CORE_COMMIT, state: process.env.PI_DESKTOP_STATE_DIR, canary: process.env.EDUPI_WINDOWS_G1_CANARY }) + "\\n");');
  const dataRoot = fakeDataRoot(runtime);
  const previous = {
    project: process.env.EDUPI_PROJECT_ROOT,
    memory: process.env.EDUPI_MEMORY_DIR,
    output: process.env.EDUPI_OUTPUT_DIR,
    locks: process.env.EDUPI_LOCK_DIR,
    state: process.env.PI_DESKTOP_STATE_DIR,
    safeMode: process.env.EDUPI_SAFE_MODE,
    canary: process.env.EDUPI_WINDOWS_G1_CANARY,
  };
  process.env.EDUPI_PROJECT_ROOT = "/ambient-project";
  process.env.EDUPI_MEMORY_DIR = "/ambient-memory";
  process.env.EDUPI_OUTPUT_DIR = "/ambient-output";
  process.env.EDUPI_LOCK_DIR = "/ambient-locks";
  process.env.PI_DESKTOP_STATE_DIR = path.join(runtime.root, "desktop-state");
  process.env.EDUPI_SAFE_MODE = "1";
  process.env.EDUPI_WINDOWS_G1_CANARY = "1";
  try {
    const result = await runCoreProcess({ runtime, dataRoot, request: { operation: "health" }, timeoutMs: 1000 });
    assert.deepEqual(result, { project: runtime.root, home: path.resolve(runtime.root, ".edupi"), parent: String(process.pid), memory: dataRoot.memoryDir, output: dataRoot.outputDir, locks: dataRoot.lockDir, commit: runtime.coreCommit, state: path.join(runtime.root, "desktop-state"), ...(process.platform === "win32" ? { canary: "1" } : {}) });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const envKey = { project: "EDUPI_PROJECT_ROOT", memory: "EDUPI_MEMORY_DIR", output: "EDUPI_OUTPUT_DIR", locks: "EDUPI_LOCK_DIR", state: "PI_DESKTOP_STATE_DIR", safeMode: "EDUPI_SAFE_MODE", canary: "EDUPI_WINDOWS_G1_CANARY" }[key];
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
