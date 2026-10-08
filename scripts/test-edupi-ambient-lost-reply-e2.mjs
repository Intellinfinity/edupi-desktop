#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
const expectExactBinding = process.env.EDUPI_EXPECT_NO_EXACT_BINDING !== "1";
assert.ok(configuredCoreRoot && path.isAbsolute(configuredCoreRoot), "EDUPI_CORE_ROOT must name an isolated Core checkout");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-ambient-lost-reply-")));
const dataRoot = path.join(temp, "data"), home = path.join(dataRoot, ".edupi");
const outputDir = path.join(home, "output"), memoryDir = path.join(home, "memory"), lockDir = path.join(home, "locks");
const stateDir = path.join(temp, "state"), agentDir = path.join(temp, "agent");
for (const directory of [outputDir, memoryDir, lockDir, stateDir, agentDir]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const environment = { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_HOME: home,
  EDUPI_OUTPUT_DIR: outputDir, EDUPI_MEMORY_DIR: memoryDir, EDUPI_LOCK_DIR: lockDir,
  PI_DESKTOP_STATE_DIR: stateDir, PI_CODING_AGENT_DIR: agentDir };
const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
Object.assign(process.env, environment);
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const fixtureEpoch = Date.now() - 120_000;
const at = (offset = 0) => new Date(fixtureEpoch + offset).toISOString();
const lesson = new Date(fixtureEpoch + 7 * 86_400_000);
lesson.setUTCDate(lesson.getUTCDate() + (5 - lesson.getUTCDay() + 7) % 7);
const lessonDate = lesson.toISOString().slice(0, 10);
let daemon;
try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const ambient = await jiti.import("../lib/edupi-ambient-message-runtime.ts");
  const ledger = await jiti.import("../lib/edupi-ambient-message-ledger.ts");
  const recovery = await jiti.import("../lib/edupi-ambient-message-recovery.ts");
  const control = await jiti.import("../lib/edupi-proactivity-control.ts");
  const protocol = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_protocol.mjs")).href);
  const { createCoreRuntimeDaemon } = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_daemon.mjs")).href);
  const token = crypto.randomBytes(32).toString("base64url"), ownerControlToken = crypto.randomBytes(32).toString("base64url");
  const conversationId = control.EDUPI_PROACTIVITY_CONVERSATION_ID;
  const source = kind => `${kind}:${hash(kind === "conversation" ? conversationId : kind === "timetable" ? "slot-friday" : "material-1")}`;
  fs.writeFileSync(path.join(outputDir, "education_intake_state.json"), `${JSON.stringify({
    schema_version: 1, updated_at: at(), calendar_events: [],
    timetable_slots: [{ slot_id: "slot-friday", day_of_week: 5, period: 1, subject: "数学", class_name: "隔离七一班",
      kind: "class", notes: null, created_at: "2026-09-01T00:00:00.000Z", source_ids: ["synthetic-timetable"],
      evidence_ids: ["synthetic-slot"], class_id: "class-7-1", start_time: "08:30", time_zone: "Asia/Shanghai" }],
    materials: [{ material_id: "material-1", staging_id: "stg_0123456789abcdef0123456789abcdef",
      source_hash: `sha256:${"1".repeat(64)}`, expected_size_bytes: 128, kind: "pdf", title: "隔离数学材料",
      subject: "数学", class_id: "class-7-1", relative_path: ".edupi/inbox/teacher-materials/material-1.pdf",
      source_id: "synthetic-material", evidence_ids: ["synthetic-material-evidence"], intake_state: "accepted",
      created_at: "2026-09-24T00:00:00.000Z" }],
    receipts: [], review_history: [], review_targets: [], idempotency_records: [],
  })}\n`, { mode: 0o600 });
  const options = { dataRoot, token, supervisorSessionId: "ambient-lost-reply-e2",
    coreCommit: "a".repeat(40), componentManifestHash: protocol.CORE_RUNTIME_SCHEMA_HASH, port: 0,
    ambientPlanning: true, ownerControlToken };
  daemon = await createCoreRuntimeDaemon(options);
  let sequence = 0, applyCalls = 0, dropReply = true;
  async function call(operation, payload, controlRequest = false) {
    const response = await fetch(daemon.endpoint, { method: "POST", headers: { "content-type": "application/json",
      authorization: `Bearer ${token}`, ...(controlRequest ? { "x-edupi-owner-control": ownerControlToken } : {}) },
    body: JSON.stringify({ protocol: protocol.CORE_RUNTIME_PROTOCOL,
      protocol_version: protocol.CORE_RUNTIME_PROTOCOL_VERSION, schema_hash: protocol.CORE_RUNTIME_SCHEMA_HASH,
      request_id: `desktop-lost-reply-${++sequence}`, operation, payload }) });
    const body = await response.json();
    assert.deepEqual(protocol.validateRuntimeResponse(body), { ok: true }, JSON.stringify(body));
    return body;
  }
  const owner = (await call("owner_control", { command_id: "synthetic-bootstrap", root_ref: daemon.dataRootFingerprint,
    expected_owner_id: null, action: "bootstrap" }, true)).result;
  const grantId = "synthetic-desktop-canary";
  const grant = await call("owner_control", { command_id: "synthetic-grant", root_ref: daemon.dataRootFingerprint,
    expected_owner_id: owner.owner_id, action: "create", grant_id: grantId, expected_version: 0,
    spec: { scope: { class_id: "class-7-1", subject: "数学" }, domains: ["teaching_preparation"],
      actions: ["prepare", "update"], source_ids: [source("conversation"), source("timetable"), source("material")],
      starts_at: at(-16 * 3600_000), ends_at: at(31 * 86_400_000 - 16 * 3600_000),
      budget: { id: "synthetic-budget", max_calls: 8 } } }, true);
  assert.equal(grant.ok, true, JSON.stringify(grant));
  const host = { call: (operation, payload) => call(operation, payload),
    async callOwnerControl(operation, payload) {
      if (operation === "owner_intent_route_apply") {
        applyCalls++;
        const committed = await call(operation, payload, true);
        assert.equal(committed.result.application?.status, "applied", JSON.stringify(committed));
        if (dropReply) { dropReply = false; throw new Error("synthetic_transport_reply_lost_after_commit"); }
        return committed;
      }
      return call(operation, payload, true);
    } };
  const sessionId = "synthetic-session", messageId = "prompt-synthetic-stable";
  const occurredAt = at(60_000), text = `帮我准备${lessonDate}的数学教案`;
  const binding = { sessionId, messageId, occurredAt };
  let messageRef = null;
  const received = await ambient.captureAndApplyAmbientMessage(host, { rootRef: daemon.dataRootFingerprint,
    grantId, messageId, text, occurredAt, domain: "teaching_preparation" }, {
    controlScope: { classId: "class-7-1", subject: "数学" },
    onPrepared: async value => { messageRef = value.messageRef;
      ledger.prepareEduPiAmbientMessageBinding({ ...binding, ...value }, { stateDir, dataRoot }); },
    onCaptured: async value => { ledger.confirmEduPiAmbientMessageBinding(sessionId, messageId, value.messageRef, { stateDir, dataRoot }); },
    onApplyPending: async value => { ledger.markEduPiAmbientMessageOutcomeUnknown(sessionId, value.messageRef, { stateDir, dataRoot }); },
  });
  assert.equal(received.status, "outcome_unknown");
  assert.equal(applyCalls, 1);
  assert.equal(ledger.readUncertainEduPiAmbientMessages(sessionId, { stateDir, dataRoot })[0]?.messageRef, messageRef);
  const planningFile = path.join(outputDir, "ambient-planning-v1.json");
  const committedPlanning = fs.readFileSync(planningFile);
  assert.equal(JSON.parse(committedPlanning).state.goals.length, 1);
  await daemon.close(); daemon = null;
  daemon = await createCoreRuntimeDaemon({ ...options, supervisorSessionId: "ambient-lost-reply-restarted" });
  const unknown = ledger.readUncertainEduPiAmbientMessages(sessionId, { stateDir, dataRoot });
  assert.equal(unknown.length, 1);
  const proof = await recovery.readExactEduPiAmbientGoalBinding(host, daemon.dataRootFingerprint, unknown[0]);
  assert.equal(proof.status, expectExactBinding ? "applied" : "outcome_unknown", JSON.stringify(proof));
  if (expectExactBinding) ledger.markEduPiAmbientMessageOutcomeVerified(sessionId, messageRef, { stateDir, dataRoot });
  assert.equal(ledger.readUncertainEduPiAmbientMessages(sessionId, { stateDir, dataRoot }).length,
    expectExactBinding ? 0 : 1);
  assert.deepEqual(fs.readFileSync(planningFile), committedPlanning, "read-only recovery cannot add a Goal or planning event");
  assert.equal(applyCalls, 1, "recovery never retries route_apply");
  console.log(JSON.stringify({ status: "passed", core: path.basename(coreRoot),
    persisted_unknown_across_restart: true, exact_message_goal_binding: expectExactBinding,
    goal_count: 1, apply_calls: applyCalls, model_calls: 0, external_send: false }));
} finally {
  if (daemon) await daemon.close();
  fs.rmSync(temp, { recursive: true, force: true });
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
