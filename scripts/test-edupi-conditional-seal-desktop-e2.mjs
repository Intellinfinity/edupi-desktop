#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const configured = process.env.EDUPI_CORE_ROOT;
const expectedCommit = process.env.EDUPI_EXPECTED_CORE_COMMIT;
assert.ok(configured && path.isAbsolute(configured));
assert.match(expectedCommit || "", /^[a-f0-9]{40}$/u);
const coreRoot = fs.realpathSync(configured);
assert.equal(execFileSync("git", ["-C", coreRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), expectedCommit);
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-desktop-core-seal-")));
const dataRoot = path.join(temporary, "data"), home = path.join(dataRoot, ".edupi");
const stateDir = path.join(temporary, "state");
for (const directory of [dataRoot, home, path.join(home, "memory"), path.join(home, "output"),
  path.join(home, "locks"), stateDir]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const environment = { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: path.join(home, "memory"), EDUPI_OUTPUT_DIR: path.join(home, "output"),
  EDUPI_LOCK_DIR: path.join(home, "locks"), PI_DESKTOP_STATE_DIR: stateDir, PI_OFFLINE: "1" };
const prior = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
Object.assign(process.env, environment);
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const address = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  assert.equal(address.hostname, "127.0.0.1", "the test must not call a model or an external account");
  return originalFetch(input, options);
};
let daemon;
let originalPlan;
let CoreRuntimeStore;
try {
  const core = async file => import(pathToFileURL(path.join(coreRoot, "scripts", file)).href);
  const protocol = await core("core_runtime_protocol.mjs");
  ({ CoreRuntimeStore } = await core("core_runtime_store.mjs"));
  const { createCoreRuntimeDaemon } = await core("core_runtime_daemon.mjs");
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const ambient = await jiti.import("../lib/edupi-ambient-message-runtime.ts");
  const recovery = await jiti.import("../lib/edupi-ambient-message-recovery.ts");
  const ledger = await jiti.import("../lib/edupi-ambient-message-ledger.ts");
  const control = await jiti.import("../lib/edupi-proactivity-control.ts");
  const token = crypto.randomBytes(32).toString("base64url");
  const ownerControlToken = crypto.randomBytes(32).toString("base64url");
  const options = { dataRoot, token, ownerControlToken, supervisorSessionId: "desktop-seal-first",
    coreCommit: expectedCommit, componentManifestHash: protocol.CORE_RUNTIME_SCHEMA_HASH, port: 0,
    ambientPlanning: true };
  daemon = await createCoreRuntimeDaemon(options);
  let sequence = 0;
  async function call(operation, payload, ownerControl = true) {
    const response = await fetch(daemon.endpoint, { method: "POST", headers: { "content-type": "application/json",
      authorization: `Bearer ${token}`, ...(ownerControl ? { "x-edupi-owner-control": ownerControlToken } : {}) },
    body: JSON.stringify({ protocol: protocol.CORE_RUNTIME_PROTOCOL,
      protocol_version: protocol.CORE_RUNTIME_PROTOCOL_VERSION, schema_hash: protocol.CORE_RUNTIME_SCHEMA_HASH,
      request_id: `desktop-seal-${++sequence}`, operation, payload }) });
    const result = await response.json();
    assert.deepEqual(protocol.validateRuntimeResponse(result), { ok: true }, JSON.stringify(result));
    return result;
  }
  const health = (await call("health", null, false)).result;
  const rootRef = health.data_root_fingerprint;
  const owner = await call("owner_control", { command_id: "synthetic-owner-bootstrap", root_ref: rootRef,
    expected_owner_id: null, action: "bootstrap" });
  assert.equal(owner.ok, true, JSON.stringify(owner));
  const ownerId = owner.result.owner_id;
  const conversationId = control.EDUPI_PROACTIVITY_CONVERSATION_ID;
  const sourceRef = `conversation:${crypto.createHash("sha256").update(conversationId).digest("hex")}`;
  const now = Date.now();
  const grantId = "synthetic-seal-grant";
  const grant = await call("owner_control", { command_id: "synthetic-seal-grant-create", root_ref: rootRef,
    expected_owner_id: ownerId, action: "create", grant_id: grantId, expected_version: 0,
    spec: { scope: { class_id: "synthetic-class", subject: "数学" },
      domains: ["teaching_preparation"], actions: ["prepare"], source_ids: [sourceRef],
      starts_at: new Date(now - 60_000).toISOString(), ends_at: new Date(now + 86_400_000).toISOString(),
      budget: { id: "synthetic-seal-budget", max_calls: 3 } } });
  assert.equal(grant.ok, true, JSON.stringify(grant));
  const capture = (messageId, text) => ({ action: "capture", root_ref: rootRef, expected_owner_id: ownerId,
    grant_id: grantId, expected_grant_version: 1, conversation_id: conversationId,
    message_id: messageId, occurred_at: new Date(now).toISOString(), text });
  const priming = await call("owner_message", capture("priming-message", "请准备数学课"));
  assert.equal(priming.ok, true, JSON.stringify(priming));
  const sessionId = "synthetic-seal-session", messageId = "interrupted-message";
  const occurredAt = new Date(now).toISOString();
  const messageRef = ambient.predictEduPiOwnerMessageRef(rootRef, ownerId, messageId, "teaching_preparation");
  const ledgerOptions = { stateDir, dataRoot };
  ledger.armEduPiAmbientMessagePlan({ sessionId, messageId, occurredAt,
    domains: [{ domain: "teaching_preparation", grantId, scopeHash: `sha256:${"b".repeat(64)}` }] }, ledgerOptions);
  ledger.prepareEduPiAmbientPlanDomainBinding({ sessionId, messageId, occurredAt, domain: "teaching_preparation",
    messageRef, ownerId, grantId, captureGrantVersion: 1 }, ledgerOptions);
  originalPlan = CoreRuntimeStore.prototype.planOwnerMessageGate;
  CoreRuntimeStore.prototype.planOwnerMessageGate = function () { throw new Error("synthetic pre-JSON interruption"); };
  let interrupted;
  try { interrupted = await call("owner_message", { ...capture(messageId, "请准备另一节数学课"), occurred_at: occurredAt }); }
  finally { CoreRuntimeStore.prototype.planOwnerMessageGate = originalPlan; originalPlan = null; }
  assert.equal(interrupted.ok, false, JSON.stringify(interrupted));
  assert.equal(interrupted.error_code, "internal_error");
  const host = { callOwnerControl: (operation, payload) => call(operation, payload) };
  const pending = ledger.readUnsettledEduPiAmbientMessages(sessionId, ledgerOptions)[0];
  const currentHealth = (await call("health", null, false)).result;
  assert.equal(await recovery.settleExactEduPiAmbientAbsentCapture(host, currentHealth, rootRef, pending,
    "teaching_preparation"), "sealed_absent");
  ledger.sealEduPiAmbientPlanDomainAbsent(sessionId, messageId, "teaching_preparation", messageRef, ledgerOptions);
  assert.equal(ledger.readEduPiAmbientMessagePlan(sessionId, messageId, ledgerOptions).status, "complete");
  assert.equal(ledger.readWithdrawableEduPiAmbientMessages(sessionId, ledgerOptions).length, 0);
  const lateCapture = await call("owner_message", { ...capture(messageId, "迟到的同一请求"), occurred_at: occurredAt });
  assert.equal(lateCapture.ok, false);
  assert.equal(lateCapture.error_code, "owner_gate_unavailable");
  await daemon.close(); daemon = null;
  daemon = await createCoreRuntimeDaemon({ ...options, supervisorSessionId: "desktop-seal-restarted" });
  const restartedHealth = (await call("health", null, false)).result;
  assert.equal(await recovery.settleExactEduPiAmbientAbsentCapture(host, restartedHealth, rootRef, pending,
    "teaching_preparation"), "sealed_absent");
  assert.equal(ledger.readCompletedEduPiAmbientMessages(sessionId, ledgerOptions).length, 1);
  console.log(JSON.stringify({ status: "passed", coreCommit: expectedCommit, syntheticRoot: true,
    exactSealAcrossRestart: true, lateCaptureRejected: true, paidModelCalls: 0, externalSend: false }));
} finally {
  if (originalPlan && CoreRuntimeStore) CoreRuntimeStore.prototype.planOwnerMessageGate = originalPlan;
  if (daemon) await daemon.close();
  globalThis.fetch = originalFetch;
  fs.rmSync(temporary, { recursive: true, force: true });
  for (const [key, value] of prior) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
