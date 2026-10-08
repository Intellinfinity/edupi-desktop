#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const configured = process.env.EDUPI_CORE_ROOT;
const expectExactProof = process.env.EDUPI_EXPECT_NO_G2_PROOF !== "1";
assert.ok(configured && path.isAbsolute(configured), "EDUPI_CORE_ROOT must name an isolated Core checkout");
const coreRoot = fs.realpathSync(configured);
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-g2-desktop-lost-reply-")));
const dataRoot = path.join(temp, "data"), home = path.join(dataRoot, ".edupi");
const memory = path.join(home, "memory"), output = path.join(home, "output"), locks = path.join(home, "locks");
const stateDir = path.join(temp, "state"), agentDir = path.join(temp, "agent");
for (const directory of [memory, output, locks, stateDir, agentDir]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const environment = { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: memory, EDUPI_OUTPUT_DIR: output, EDUPI_LOCK_DIR: locks,
  PI_DESKTOP_STATE_DIR: stateDir, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" };
const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
Object.assign(process.env, environment);
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const address = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  assert.equal(address.hostname, "127.0.0.1", "G2 recovery cannot contact a paid provider or external service");
  return originalFetch(input, options);
};
let daemon, admission;
try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const ambient = await jiti.import("../lib/edupi-ambient-message-runtime.ts");
  const ledger = await jiti.import("../lib/edupi-ambient-message-ledger.ts");
  const recovery = await jiti.import("../lib/edupi-ambient-message-recovery.ts");
  const control = await jiti.import("../lib/edupi-proactivity-control.ts");
  const core = async name => import(pathToFileURL(path.join(coreRoot, "scripts", name)).href);
  const { prepareCoreRuntimeRoot } = await core("core_runtime_root.mjs");
  const { acquireCoreRuntimeWriterAdmission } = await core("core_runtime_writer_admission.mjs");
  const { handleStudentRosterRequest } = await core("student_roster_store.mjs");
  const { loadEducationIntakeState, saveEducationIntakeState } = await core("education_intake_store.mjs");
  const { createStudentFollowUpModelAdapter } = await core("student_followup_model_adapter.mjs");
  const protocol = await core("core_runtime_protocol.mjs");
  const { createCoreRuntimeDaemon } = await core("core_runtime_daemon.mjs");
  const expectedCommit = process.env.EDUPI_EXPECTED_CORE_COMMIT;
  assert.ok(expectedCommit && /^[a-f0-9]{40}$/u.test(expectedCommit));
  const root = prepareCoreRuntimeRoot(dataRoot);
  admission = await acquireCoreRuntimeWriterAdmission({ root, kind: "legacy_g2_natural_intake_seed" });
  const slot = { slot_id: "slot-natural-g2", day_of_week: 1, period: 1, subject: "math",
    class_id: "class-7b", class_name: "七年级二班", kind: "class", notes: null, start_time: "08:30",
    time_zone: "Asia/Shanghai", created_at: new Date().toISOString(), intake_state: "accepted",
    source_ids: ["teacher-timetable-desktop-g2"], evidence_ids: ["evidence-timetable-desktop-g2"] };
  try {
    const roster = await handleStudentRosterRequest({ action: "import", request_id: "desktop-g2-roster-seed",
      source_name: "隔离跟进名单", students: [{ name: "张三", class_name: "七年级二班" }] });
    assert.equal(roster.ok, true, JSON.stringify(roster));
    const intake = loadEducationIntakeState();
    intake.updated_at = new Date().toISOString();
    intake.timetable_slots = [slot];
    saveEducationIntakeState(intake);
  } finally { await admission.release(); admission = null; }
  const token = crypto.randomBytes(32).toString("base64url"), ownerControlToken = crypto.randomBytes(32).toString("base64url");
  const options = { dataRoot, token, ownerControlToken, supervisorSessionId: "desktop-g2-lost-reply",
    coreCommit: expectedCommit, componentManifestHash: protocol.CORE_RUNTIME_SCHEMA_HASH, port: 0, ambientPlanning: true };
  const modelRuns = [];
  const modelAdapter = createStudentFollowUpModelAdapter({ async runModel({ prompt }) {
    const observationId = prompt.match(/observation_[a-f0-9]{32}/u)?.[0];
    assert.ok(observationId);
    modelRuns.push(observationId);
    return { output: JSON.stringify({ internal_draft_summary: "核对移项负号并记录步骤。",
      next_step: "明天下课后核对移项步骤。", evidence_ids: [observationId], external_send: false }) };
  } });
  daemon = await createCoreRuntimeDaemon({ ...options, g2Live: { modelAdapter, intervalMs: 1000, leaseMs: 30_000 } });
  let sequence = 0, enqueueCalls = 0;
  async function call(operation, payload, controlRequest = true) {
    const response = await fetch(daemon.endpoint, { method: "POST", headers: { "content-type": "application/json",
      authorization: `Bearer ${token}`, ...(controlRequest ? { "x-edupi-owner-control": ownerControlToken } : {}) },
    body: JSON.stringify({ protocol: protocol.CORE_RUNTIME_PROTOCOL, protocol_version: protocol.CORE_RUNTIME_PROTOCOL_VERSION,
      schema_hash: protocol.CORE_RUNTIME_SCHEMA_HASH, request_id: `desktop-g2-${++sequence}`, operation, payload }) });
    const body = await response.json();
    assert.deepEqual(protocol.validateRuntimeResponse(body), { ok: true }, JSON.stringify(body));
    return body;
  }
  const owner = await call("owner_control", { command_id: "desktop-g2-bootstrap", root_ref: daemon.dataRootFingerprint,
    expected_owner_id: null, action: "bootstrap" });
  assert.equal(owner.ok, true, JSON.stringify(owner));
  const ownerId = owner.result.owner_id;
  const grantId = "desktop-g2-lost-reply-grant", conversationId = control.EDUPI_STUDENT_FOLLOWUP_CONVERSATION_ID;
  const grant = await call("owner_control", { command_id: "desktop-g2-grant", root_ref: daemon.dataRootFingerprint,
    expected_owner_id: ownerId, action: "create", grant_id: grantId, expected_version: 0,
    spec: { scope: { class_id: "class-7b", subject: "math" }, domains: ["student_followup"], actions: ["update"],
      source_ids: [`conversation:${crypto.createHash("sha256").update(conversationId).digest("hex")}`],
      starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      budget: { id: "desktop-g2-lost-reply-budget", max_calls: 4 } } });
  assert.equal(grant.ok, true, JSON.stringify(grant));
  const sessionId = "synthetic-g2-session", messageId = `g2_${crypto.createHash("sha256").update(`${sessionId}\0prompt-stable`).digest("hex")}`;
  const occurredAt = new Date().toISOString();
  const source = { rootRef: daemon.dataRootFingerprint, grantId, messageId,
    text: "张三今天移项漏写负号，明天请帮我跟进学生张三。", occurredAt, domain: "student_followup" };
  const host = { call: (operation, payload) => call(operation, payload, false),
    async callOwnerControl(operation, payload) {
      if (operation === "student_followup_intent_execution_enqueue") {
        enqueueCalls++;
        const committed = await call(operation, payload);
        assert.equal(committed.ok, true, JSON.stringify(committed));
        throw new Error("synthetic_reply_lost_after_committed_enqueue");
      }
      return call(operation, payload);
    } };
  const result = await ambient.captureAndApplyAmbientMessage(host, source, {
    controlScope: { classId: "class-7b", subject: "math" },
    onPrepared: async binding => ledger.prepareEduPiAmbientMessageBinding({ sessionId, messageId, occurredAt, ...binding }, { dataRoot, stateDir }),
    onCaptured: async binding => ledger.confirmEduPiAmbientMessageBinding(sessionId, messageId, binding.messageRef, { dataRoot, stateDir }),
    onApplyPending: async binding => ledger.markEduPiAmbientMessageOutcomeUnknown(sessionId, binding.messageRef, { dataRoot, stateDir }),
  });
  assert.equal(result.status, "outcome_unknown");
  assert.equal(enqueueCalls, 1);
  const pending = ledger.readUncertainEduPiAmbientMessages(sessionId, { dataRoot, stateDir });
  assert.equal(pending.length, 1);
  const executionFile = path.join(output, "student-followup-execution-v1.json");
  assert.equal(JSON.parse(fs.readFileSync(executionFile, "utf8")).records.length, 1);
  const until = Date.now() + 10_000;
  while (Date.now() < until && JSON.parse(fs.readFileSync(executionFile, "utf8")).records[0].status !== "completed") {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(JSON.parse(fs.readFileSync(executionFile, "utf8")).records[0].status, "completed",
    "the same authorized queue must publish one local synthetic draft");
  assert.equal(modelRuns.length, 1);
  await daemon.close(); daemon = null;
  daemon = await createCoreRuntimeDaemon({ ...options, supervisorSessionId: "desktop-g2-lost-reply-restarted" });
  const beforeRead = fs.readFileSync(executionFile);
  const proof = await recovery.readExactEduPiG2Execution(host, daemon.dataRootFingerprint, pending[0]);
  assert.equal(proof.status, expectExactProof ? "applied" : "outcome_unknown", JSON.stringify(proof));
  if (expectExactProof) {
    assert.equal(proof.executionId, JSON.parse(beforeRead).records[0].execution_id);
    ledger.markEduPiAmbientMessageOutcomeVerified(sessionId, pending[0].messageRef, { dataRoot, stateDir });
  }
  assert.equal(ledger.readUncertainEduPiAmbientMessages(sessionId, { dataRoot, stateDir }).length, expectExactProof ? 0 : 1);
  assert.deepEqual(fs.readFileSync(executionFile), beforeRead, "read-only recovery cannot mutate the Core execution queue");
  assert.equal(enqueueCalls, 1, "recovery cannot re-enqueue a G2 intent");
  assert.equal(modelRuns.length, 1, "restart and exact read cannot call the local fake model twice");
  console.log(JSON.stringify({ status: "passed", coreCommit: expectedCommit,
    persistedUnknownAcrossRestart: true, exactCurrentG2Proof: expectExactProof, enqueueCalls,
    currentExecution: expectExactProof ? proof.executionId : null,
    localFakeModelCalls: modelRuns.length, paidModelCalls: 0, externalSend: false }));
} finally {
  if (admission) await admission.release();
  if (daemon) await daemon.close();
  globalThis.fetch = originalFetch;
  fs.rmSync(temp, { recursive: true, force: true });
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
