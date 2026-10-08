#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import ts from "typescript";

const configured = process.env.EDUPI_CORE_ROOT;
assert.ok(configured && path.isAbsolute(configured), "EDUPI_CORE_ROOT must name the isolated staged Core checkout");
const coreRoot = fs.realpathSync(configured);
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-desktop-exact-capabilities-")));
const dataRoot = path.join(temporary, "data"), home = path.join(dataRoot, ".edupi");
const memoryDir = path.join(home, "memory"), outputDir = path.join(home, "output"), lockDir = path.join(home, "locks");
const stateDir = path.join(temporary, "state"), agentDir = path.join(temporary, "agent");
for (const directory of [memoryDir, outputDir, lockDir, stateDir, agentDir]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const environment = { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: memoryDir, EDUPI_OUTPUT_DIR: outputDir, EDUPI_LOCK_DIR: lockDir,
  PI_DESKTOP_STATE_DIR: stateDir, PI_CODING_AGENT_DIR: agentDir, EDUPI_DESKTOP_ISOLATED_CANARY: "1", PI_OFFLINE: "1" };
const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
Object.assign(process.env, environment);
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const address = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  assert.equal(address.hostname, "127.0.0.1", "capability E2 never contacts a provider or external service");
  return originalFetch(input, options);
};
let supervisor, admission;
try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const control = await jiti.import("../lib/edupi-proactivity-control.ts");
  const config = await jiti.import("../lib/edupi-proactivity-config.ts");
  const runtime = await jiti.import("../lib/edupi-proactivity-runtime.ts");
  const ambient = await jiti.import("../lib/edupi-ambient-message-runtime.ts");
  const ledger = await jiti.import("../lib/edupi-ambient-message-ledger.ts");
  supervisor = await jiti.import("../lib/edupi-runtime-supervisor.ts");
  const core = async name => import(pathToFileURL(path.join(coreRoot, "scripts", name)).href);
  const facts = await core("education_fact_store.mjs");
  const { prepareCoreRuntimeRoot } = await core("core_runtime_root.mjs");
  const { acquireCoreRuntimeWriterAdmission } = await core("core_runtime_writer_admission.mjs");
  const scheduler = await core("g3_capability_scheduler.mjs");
  const manifest = JSON.parse(fs.readFileSync(path.join(coreRoot, "contracts/edupi-core-runtime-component-manifest.json"), "utf8"));
  const stagedCommit = process.env.EDUPI_EXPECTED_CORE_COMMIT;
  assert.ok(stagedCommit && /^[a-f0-9]{40}$/u.test(stagedCommit), "EDUPI_EXPECTED_CORE_COMMIT is required");
  const root = prepareCoreRuntimeRoot(dataRoot);
  assert.equal(root.ok, true);
  admission = await acquireCoreRuntimeWriterAdmission({ root, kind: "legacy_capability_natural_seed", busyTimeoutMs: 250 });
  const now = new Date(Date.now() - 60_000).toISOString();
  const offsetTime = value => `${value.toISOString().slice(0, 19)}+00:00`;
  const deadline = offsetTime(new Date(Date.now() + 2 * 86_400_000));
  const lessonAt = offsetTime(new Date(Date.now() - 2 * 3_600_000));
  const entity = (kind, name, externalId = kind) => facts.registerEducationEntity({ memoryDir, now,
    entity: { entity_kind: kind, namespace: "desktop-capability-e2", external_id: externalId, canonical_name: name, aliases: [] } }).entity;
  const classroom = entity("class", "隔离七三班"), term = entity("term", "2026秋隔离学期"), lesson = entity("lesson_occurrence", "移项第一课");
  const foreignClass = entity("class", "隔离八三班", "foreign-class");
  const student = entity("student", "隔离林清禾"), parent = entity("parent", "隔离赵女士");
  function accepted(entityId, sourceId, predicate, value, entityIds, subject = null) {
    const observation = facts.captureEducationObservation({ memoryDir, now, observation: { source_kind: "teacher_utterance", source_id: sourceId,
      source_revision: "1", raw_text: value, observed_at: now, actor_ref: "synthetic-desktop-teacher", entity_ids: entityIds } }).observation;
    const proposed = facts.proposeEducationFact({ memoryDir, now, fact: { entity_id: entityId, fact_kind: "evidence", predicate, value,
      confidence: { basis: "explicit", score: 1 }, subject_ref: subject, source_ids: [sourceId], observation_ids: [observation.observation_id] } }).fact;
    return facts.reviewEducationFact({ memoryDir, now, fact_id: proposed.fact_id, expected_revision: proposed.revision,
      decision: "accept", reviewer: "synthetic-desktop-teacher" }).fact;
  }
  const adminFact = accepted(classroom.entity_id, "desktop-admin-source", "admin.deadline",
    `${term.canonical_name}${classroom.canonical_name}须在${deadline}前整理校历行政材料。`, [classroom.entity_id, term.entity_id]);
  const foreignAdminFact = accepted(foreignClass.entity_id, "desktop-foreign-admin-source", "admin.deadline",
    `${term.canonical_name}${foreignClass.canonical_name}须在${deadline}前整理校历行政材料。`, [foreignClass.entity_id, term.entity_id]);
  const reflectionFact = accepted(classroom.entity_id, "desktop-reflection-source", "lesson.observation",
    `${lesson.canonical_name}有四组完成移项步骤说明。`, [classroom.entity_id, term.entity_id, lesson.entity_id], "math");
  const recipientFact = accepted(parent.entity_id, "desktop-recipient-source", "communication.recipient_confirmed",
    `${parent.canonical_name}是${student.canonical_name}本次家长沟通的已确认收件对象。`,
    [classroom.entity_id, term.entity_id, student.entity_id, parent.entity_id]);
  const bodyFact = accepted(student.entity_id, "desktop-parent-source", "communication.fact",
    `${student.canonical_name}本周已完成课堂练习。`, [classroom.entity_id, term.entity_id, student.entity_id, parent.entity_id], "math");
  assert.equal([adminFact, foreignAdminFact, reflectionFact, recipientFact, bodyFact].every(item => item.status === "accepted"), true);
  await admission.release(); admission = null;

  const workspace = { timetable: [{ slot_id: "synthetic-math-slot", class_id: classroom.entity_id,
    class_name: classroom.canonical_name, subject: "math", kind: "class" }],
    students: [{ student_id: student.entity_id, class_name: classroom.canonical_name }] };
  const cases = [
    { domain: "calendar_administration", subject: "administration",
      text: `请整理${classroom.canonical_name}${term.canonical_name}的校历行政材料，截止时间 ${deadline}。` },
    { domain: "lesson_reflection", subject: "math",
      text: `请整理${classroom.canonical_name}${term.canonical_name}${lesson.canonical_name}的课堂复盘，上课时间 ${lessonAt}，完成时间 ${deadline}。` },
    { domain: "parent_communication", subject: "math",
      text: `请为${classroom.canonical_name}${term.canonical_name}的${student.canonical_name}草拟给${parent.canonical_name}的家长沟通稿，完成时间 ${deadline}。` },
  ];
  const { resolveEduPiCoreRoot } = await jiti.import("../lib/edupi-core-root.ts");
  const { activeBridgeIdentity } = await jiti.import("../lib/edupi-bridge-manifest.ts");
  const runtimeRoot = resolveEduPiCoreRoot({ configuredRoot: coreRoot, allowedRoot: path.dirname(coreRoot),
    runtimeIdentity: activeBridgeIdentity().runtime, validationMode: "external" });
  assert.equal(runtimeRoot.coreCommit, stagedCommit);
  assert.equal(runtimeRoot.runtimeComponentManifestHash, manifest.component_manifest_hash);
  const dataRootDescriptor = { root: dataRoot, memoryDir, outputDir, lockDir };
  let host = await supervisor.ensureEduPiRuntime({ runtime: runtimeRoot, dataRoot: dataRootDescriptor });
  const initial = await host.call("health", null);
  assert.equal(initial.result.capabilities.g3_processor, "activation_pending");
  const bindings = [];
  for (const item of cases) {
    const scope = { classId: classroom.entity_id, subject: item.subject };
    const binding = control.buildCapabilityGrantBinding(item.domain, scope, workspace);
    assert.deepEqual(binding.spec.domains, [item.domain]);
    bindings.push(binding);
    await runtime.ensureProactivityGrant(host, initial.result.data_root_fingerprint, binding);
    config.writeEduPiProactivityConfig({ enabled: true, scope, grantId: binding.grantId }, { dataRoot, stateDir, domain: item.domain });
  }
  host = await supervisor.restartEduPiRuntime({ runtime: runtimeRoot, dataRoot: dataRootDescriptor });
  const active = await host.call("health", null);
  assert.equal(active.result.capabilities.g3_processor, "active");
  const sessionId = "synthetic-desktop-capability-session";
  const results = [];
  let lastApply = null;
  const observedHost = { call: (operation, payload) => host.call(operation, payload),
    callOwnerControl: async (operation, payload) => {
      const response = await host.callOwnerControl(operation, payload);
      if (operation === "owner_intent_route_apply") lastApply = { appliedOperation: response.result?.applied_operation,
        route: response.result?.route, goal: response.result?.application,
        execution: response.result?.execution };
      return response;
    } };
  for (const [index, item] of cases.entries()) {
    const messageId = `prompt-capability-${index}`, occurredAt = new Date().toISOString();
    const callbacks = {
      controlScope: { classId: classroom.entity_id, subject: item.subject }, capabilityActive: true,
      onPrepared: async value => ledger.prepareEduPiAmbientMessageBinding({ sessionId, messageId, occurredAt, ...value }, { dataRoot, stateDir }),
      onCaptured: async value => ledger.confirmEduPiAmbientMessageBinding(sessionId, messageId, value.messageRef, { dataRoot, stateDir }),
      onApplyPending: async value => ledger.markEduPiAmbientMessageOutcomeUnknown(sessionId, value.messageRef, { dataRoot, stateDir }),
    };
    let result;
    try { result = await ambient.captureAndApplyAmbientMessage(observedHost, { rootRef: active.result.data_root_fingerprint,
      grantId: bindings[index].grantId, messageId, text: item.text, occurredAt, domain: item.domain }, callbacks); }
    catch (error) { throw new Error(`${item.domain}: ${error?.code || "unknown_error"}; ${JSON.stringify(lastApply)}`); }
    assert.equal(result.status, "queued", `${item.domain}: ${JSON.stringify(result)}`);
    assert.equal(result.externalSend, false);
    ledger.markEduPiAmbientMessageOutcomeVerified(sessionId, ambient.predictEduPiOwnerMessageRef(active.result.data_root_fingerprint,
      (await runtime.readProactivityOwnerContext(host, active.result.data_root_fingerprint, bindings[index].grantId)).ownerId,
      messageId, item.domain), { dataRoot, stateDir });
    results.push({ ...result, domain: item.domain, messageId, occurredAt, caseId: lastApply?.execution?.case_id });
  }
  const until = Date.now() + 10_000;
  let casesReady = [];
  while (Date.now() < until) {
    casesReady = scheduler.loadCapabilityWorkState({ outputDir }).cases.filter(item => item.status === "draft_ready");
    if (casesReady.length === 3) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(casesReady.length, 3, JSON.stringify(scheduler.loadCapabilityWorkState({ outputDir }).cases.map(item => ({ status: item.status, capability: item.capability_id }))));
  for (const work of casesReady) {
    assert.ok(work.artifacts.length > 0);
    for (const artifact of work.artifacts.filter(item => item.status === "current")) {
      assert.ok(fs.readFileSync(path.join(dataRoot, artifact.relative_path), "utf8").length > 0);
    }
  }
  for (const [index, item] of cases.entries()) {
    const work = casesReady.find(row => row.work_case_id === results[index].workCaseId);
    assert.ok(work, `${item.domain}: draft must belong to the captured Goal`);
    const text = work.artifacts.filter(row => row.status === "current")
      .map(row => fs.readFileSync(path.join(dataRoot, row.relative_path), "utf8")).join("\n");
    assert.ok(text.includes([adminFact, reflectionFact, bodyFact][index].value),
      `${item.domain}: generated content must cite its current accepted fact`);
  }
  const ownerId = (await runtime.readProactivityOwnerContext(host, active.result.data_root_fingerprint, bindings[0].grantId)).ownerId;
  let bridgeSequence = 0;
  const bridge = async (operation, fields = {}) => {
    const outer = await host.callBridge({ protocol: "edupi-desktop-bridge", protocol_version: 1,
      producer: "edupi-desktop", operation, request_id: `desktop-capability-bridge-${++bridgeSequence}`, ...fields });
    assert.equal(outer.ok, true, JSON.stringify(outer));
    const payload = JSON.parse(outer.result.bridge_frame);
    assert.equal(payload.ok, true, JSON.stringify(payload));
    return payload;
  };
  const { buildCommandEnvelope } = await core("edupi_bridge_command.mjs");
  for (const [index, item] of cases.entries()) {
    const snapshot = await bridge("snapshot");
    const work = snapshot.envelope.payload.work_cases.find(row => row.work_case_id === results[index].workCaseId);
    assert.equal(work.current_state, "draft_ready");
    const task = snapshot.envelope.payload.education_workspace.tasks.find(row => row.task_id === work.task_id);
    assert.ok(task && task.status !== "accepted");
    const target = await host.callOwnerControl("teacher_feedback_target_read", { root_ref: active.result.data_root_fingerprint,
      expected_owner_id: ownerId, target: { kind: "capability_work", target_id: work.work_case_id } });
    assert.equal(target.ok, true, JSON.stringify(target));
    const feedback = await host.callOwnerControl("teacher_feedback_record", {
      command_id: `desktop-capability-feedback-${index}`, root_ref: active.result.data_root_fingerprint,
      expected_owner_id: ownerId, session_id: sessionId, evidence_level: "synthetic", domain: item.domain,
      scope: { class_id: classroom.entity_id, subject: item.subject }, signal: "surfaced",
      target: { kind: "capability_work", target_id: work.work_case_id,
        expected_revision: target.result.revision, expected_fingerprint: target.result.fingerprint },
      decision: "accept", usefulness: "useful", used: false, would_use_again: null,
      baseline_minutes: null, review_minutes: null, issue_codes: [], note: "隔离验收，不计入真人价值",
      evidence_ids: target.result.evidence_ids, occurred_at: new Date().toISOString(), supersedes_feedback_id: null,
    });
    assert.equal(feedback.ok, true, JSON.stringify(feedback));
    assert.equal(feedback.result.external_send, false);
    const reviewAt = new Date().toISOString();
    const source = { source_id: task.task_id, source_kind: "core_task", source_hash: snapshot.envelope.payload.state_hash,
      evidence_ids: [results[index].caseId] };
    const command = buildCommandEnvelope({ messageId: `desktop-capability-review-${index}`,
      requestId: `desktop-capability-review-${index}`, issuedAt: reviewAt,
      snapshotId: snapshot.envelope.payload.snapshot_id, idempotencyKey: `desktop-capability-review-${index}`,
      provenance: [{ ...source, source_path: null, observed_at: reviewAt, actor: "core", parent_ids: [] }],
      teacherReview: { state: "pending_review", reviewer_id: "synthetic-desktop-teacher", reviewed_at: null,
        note: "隔离工作流审核", revision: task.revision },
      command: { command_type: "review_task", task_id: task.task_id, expected_revision: task.revision,
        decision: "accept", patch: null, rollback_id: null, source, note: "隔离工作流审核" } });
    const reviewed = await bridge("command", { envelope: command });
    assert.equal(reviewed.receipt.payload.status, "accepted");
    const current = await bridge("snapshot");
    assert.equal(current.envelope.payload.education_workspace.tasks.find(row => row.task_id === task.task_id).status, "accepted");
    assert.equal(current.envelope.payload.work_cases.find(row => row.work_case_id === work.work_case_id).current_state, "accepted");
  }
  const feedbackRead = await host.callOwnerControl("teacher_feedback_read", { root_ref: active.result.data_root_fingerprint,
    expected_owner_id: ownerId });
  assert.equal(feedbackRead.result.feedback.filter(row => row.evidence_level === "synthetic").length, 3);
  const beforeRestart = scheduler.loadCapabilityWorkState({ outputDir }).cases.map(work => ({
    workCaseId: work.work_case_id, status: work.status, artifacts: work.artifacts.map(artifact => artifact.artifact_id) }));
  host = await supervisor.restartEduPiRuntime({ runtime: runtimeRoot, dataRoot: dataRootDescriptor });
  assert.deepEqual(scheduler.loadCapabilityWorkState({ outputDir }).cases.map(work => ({
    workCaseId: work.work_case_id, status: work.status, artifacts: work.artifacts.map(artifact => artifact.artifact_id) })), beforeRestart);
  const original = results[0];
  const replay = await ambient.captureAndApplyAmbientMessage(host, { rootRef: active.result.data_root_fingerprint,
    grantId: bindings[0].grantId, messageId: original.messageId, occurredAt: original.occurredAt,
    text: cases[0].text, domain: cases[0].domain }, {
    controlScope: { classId: classroom.entity_id, subject: cases[0].subject }, capabilityActive: true,
    onPrepared: async value => ledger.prepareEduPiAmbientMessageBinding({ sessionId, messageId: original.messageId,
      occurredAt: original.occurredAt, ...value }, { dataRoot, stateDir }),
    onCaptured: async value => ledger.confirmEduPiAmbientMessageBinding(sessionId, original.messageId, value.messageRef, { dataRoot, stateDir }),
    onApplyPending: async value => ledger.markEduPiAmbientMessageOutcomeUnknown(sessionId, value.messageRef, { dataRoot, stateDir }),
  });
  assert.notEqual(replay.status, "queued", "same message after restart cannot enqueue a second Core case");
  assert.deepEqual(scheduler.loadCapabilityWorkState({ outputDir }).cases.map(work => ({
    workCaseId: work.work_case_id, status: work.status, artifacts: work.artifacts.map(artifact => artifact.artifact_id) })), beforeRestart);
  const foreignGrantId = "synthetic-foreign-admin-grant";
  const foreignGrant = await host.callOwnerControl("owner_control", { command_id: "synthetic-foreign-admin-control",
    root_ref: active.result.data_root_fingerprint, expected_owner_id: ownerId, action: "create",
    grant_id: foreignGrantId, expected_version: 0, spec: { ...bindings[0].spec,
      scope: { class_id: foreignClass.entity_id, subject: "administration" },
      budget: { id: "synthetic-foreign-admin-budget", max_calls: 4 } } });
  assert.equal(foreignGrant.ok, true, JSON.stringify(foreignGrant));
  const foreignMessage = await host.callOwnerControl("owner_message", { action: "capture", root_ref: active.result.data_root_fingerprint,
    expected_owner_id: ownerId, grant_id: foreignGrantId, expected_grant_version: 1,
    conversation_id: control.EDUPI_CALENDAR_ADMINISTRATION_CONVERSATION_ID, message_id: "synthetic-foreign-admin-message",
    occurred_at: new Date().toISOString(),
    text: `请整理${foreignClass.canonical_name}${term.canonical_name}的校历行政材料，截止时间 ${deadline}。` });
  assert.equal(foreignMessage.ok, true, JSON.stringify(foreignMessage));
  const foreignRequest = { root_ref: active.result.data_root_fingerprint, expected_owner_id: ownerId,
    message_ref: foreignMessage.result.receipt.message_ref };
  const foreignRead = await host.callOwnerControl("owner_intent_route_read", foreignRequest);
  assert.equal(foreignRead.result.status, "ready", JSON.stringify(foreignRead));
  const foreignApply = await host.callOwnerControl("owner_intent_route_apply", foreignRequest);
  assert.equal(foreignApply.error_code, "activation_pending", "same-domain foreign grant cannot inherit Desktop's exact binding");
  assert.deepEqual(scheduler.loadCapabilityWorkState({ outputDir }).cases.map(work => ({
    workCaseId: work.work_case_id, status: work.status, artifacts: work.artifacts.map(artifact => artifact.artifact_id) })), beforeRestart);

  config.writeEduPiProactivityStopIntent({ scope: { classId: classroom.entity_id, subject: "administration" },
    grantId: bindings[0].grantId }, { stateDir, dataRoot, domain: "calendar_administration" });
  await supervisor.quarantineEduPiRuntime(dataRoot);
  supervisor.clearEduPiRuntimeQuarantine(dataRoot);
  host = await supervisor.ensureEduPiRuntime({ runtime: runtimeRoot, dataRoot: dataRootDescriptor });
  assert.equal((await host.call("health", null)).result.capabilities.g3_processor, "active",
    "the other two exact domains remain admitted while admin is stop-pending");
  const stopped = await runtime.pauseProactivityGrant(host, active.result.data_root_fingerprint, bindings[0].grantId);
  assert.equal(stopped.state, "paused");
  config.writeEduPiProactivityConfig({ enabled: false, scope: null, grantId: null },
    { dataRoot, stateDir, domain: "calendar_administration" });
  config.clearEduPiProactivityStopIntent({ dataRoot, stateDir, domain: "calendar_administration", grantId: bindings[0].grantId });
  host = await supervisor.restartEduPiRuntime({ runtime: runtimeRoot, dataRoot: dataRootDescriptor });
  assert.equal((await host.call("health", null)).result.capabilities.g3_processor, "active");
  const foreignAfterStop = await host.callOwnerControl("owner_intent_route_apply", foreignRequest);
  assert.equal(foreignAfterStop.error_code, "activation_pending");
  const afterStop = scheduler.loadCapabilityWorkState({ outputDir }).cases.map(work => ({
    workCaseId: work.work_case_id, status: work.status, artifacts: work.artifacts.map(artifact => artifact.artifact_id) }));
  assert.equal(afterStop.length, 3, "a foreign same-domain grant cannot create a fourth work case");
  assert.equal(afterStop[0].status, "stale", "stopping the selected grant retires only its current admin work");
  assert.deepEqual(afterStop[0].artifacts, beforeRestart[0].artifacts, "immutable admin draft identities are retained");
  assert.deepEqual(afterStop.slice(1), beforeRestart.slice(1), "G4/G5 accepted work is not invalidated by G3 stop");
  const g1Scope = { classId: classroom.entity_id, subject: "math" };
  const g1Binding = control.buildProactivityGrantBinding(g1Scope, workspace,
    [{ material_id: "synthetic-math-material", class_id: classroom.entity_id, subject: "math", available: true }]);
  await runtime.ensureProactivityGrant(host, active.result.data_root_fingerprint, g1Binding);
  config.writeEduPiProactivityConfig({ enabled: true, scope: g1Scope, grantId: g1Binding.grantId }, { dataRoot, stateDir });
  config.writeEduPiProactivityConfig({ enabled: true, scope: g1Scope, grantId: g1Binding.grantId },
    { dataRoot, stateDir, domain: "calendar_administration" });
  const routeSource = fs.readFileSync(new URL("../app/api/edupi/proactivity/route.ts", import.meta.url), "utf8");
  const routeCode = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const routeModule = { exports: {} };
  const safeMode = await jiti.import("../lib/safe-mode.ts");
  const modules = {
    "next/server": { NextResponse: { json: (body, options = {}) => ({ status: options.status || 200, json: async () => body }) } },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ runtime: runtimeRoot, dataRoot: dataRootDescriptor }),
      readEduPiEducationSnapshot: async () => ({ workspace }) },
    "@/lib/edupi-generated-artifacts": { workspaceResourcesRequest: async () => ({ teacherMaterials: [] }) },
    "@/lib/edupi-proactivity-control": control,
    "@/lib/edupi-proactivity-config": config,
    "@/lib/edupi-proactivity-runtime": runtime,
    "@/lib/edupi-runtime-supervisor": supervisor,
    "@/lib/safe-mode": safeMode,
  };
  new Function("require", "module", "exports", routeCode)(name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected route dependency ${name}`);
    return modules[name];
  }, routeModule, routeModule.exports);
  const aliasBefore = config.readEduPiProactivityActivation({ dataRoot, stateDir, domain: "calendar_administration" });
  const aliasResponse = await routeModule.exports.POST(new Request("http://localhost/api/edupi/proactivity", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false, classId: null,
      subject: null, expectedUpdatedAt: aliasBefore.updatedAt, domain: "calendar_administration" }) }));
  assert.equal(aliasResponse.status, 200, JSON.stringify(await aliasResponse.json()));
  assert.equal((await aliasResponse.json()).grantPaused, false, "the aliased G1 grant cannot be paused by G3 stop");
  assert.equal(config.readEduPiProactivityActivation({ dataRoot, stateDir, domain: "calendar_administration" }).enabled, false);
  assert.equal(config.readEduPiProactivityActivation({ dataRoot, stateDir }).enabled, true);
  host = await supervisor.ensureEduPiRuntime({ runtime: runtimeRoot, dataRoot: dataRootDescriptor });
  const g1After = await runtime.readProactivityGrantDomainProof(host, active.result.data_root_fingerprint, g1Binding.grantId);
  assert.equal(g1After.status, "active");
  assert.equal(g1After.domain, "teaching_preparation");
  assert.deepEqual(fs.readdirSync(agentDir), [], "G3–G5 require no model config, credential file or paid provider");
  console.log(JSON.stringify({ status: "passed", coreCommit: stagedCommit,
    domains: results.map(item => ({ domain: item.domain, goalId: item.goalId, workCaseId: item.workCaseId })),
    drafts: casesReady.length, publicTaskReviews: 3, syntheticFeedback: 3, restartStable: true, replayNoNewQueue: true,
    stoppedDomain: "calendar_administration", remainingDomainsActive: 2, sameDomainForeignGrantQueued: false,
    realConfigAliasStopPreservedG1: true,
    modelCalls: 0, externalSend: false }));
} finally {
  if (admission) await admission.release();
  if (supervisor) await supervisor.closeAllEduPiRuntimes();
  globalThis.fetch = originalFetch;
  fs.rmSync(temporary, { recursive: true, force: true });
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
