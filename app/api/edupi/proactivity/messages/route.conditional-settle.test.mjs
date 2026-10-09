import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createJiti } from "jiti";
import ts from "typescript";

test("GET verify keeps a pending capture until Core returns an exact current seal", async t => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-conditional-seal-")));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const dataRoot = path.join(temporary, "data"), stateDir = path.join(temporary, "state");
  fs.mkdirSync(dataRoot, { mode: 0o700 });
  fs.mkdirSync(stateDir, { mode: 0o700 });
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const ledger = await jiti.import("../../../../../lib/edupi-ambient-message-ledger.ts");
  const ambient = await jiti.import("../../../../../lib/edupi-ambient-message-runtime.ts");
  const recovery = await jiti.import("../../../../../lib/edupi-ambient-message-recovery.ts");
  const options = { stateDir, dataRoot };
  const sessionId = "synthetic-session", messageId = "synthetic-message";
  const ownerId = "owner-1", grantId = "grant-1", domain = "teaching_preparation";
  const occurredAt = "2026-10-09T00:00:00.000Z", rootRef = `sha256:${"a".repeat(64)}`;
  const messageRef = ambient.predictEduPiOwnerMessageRef(rootRef, ownerId, messageId, domain);
  ledger.armEduPiAmbientMessagePlan({ sessionId, messageId, occurredAt,
    domains: [{ domain, grantId, scopeHash: `sha256:${"b".repeat(64)}` }] }, options);
  ledger.prepareEduPiAmbientPlanDomainBinding({ sessionId, messageId, occurredAt, domain,
    messageRef, ownerId, grantId, captureGrantVersion: 1 }, options);
  const health = { lifecycle: "ready", data_root_fingerprint: rootRef, instance_nonce: "instance-7",
    fencing_generation: 7, capabilities: { supported_operations: ["owner_message_settle"] } };
  const sourceRef = `conversation:${crypto.createHash("sha256")
    .update(ambient.eduPiAmbientConversationId(domain)).digest("hex")}`;
  let exact = false, settleCalls = 0;
  const host = { async call() { return { ok: true, result: health }; },
    async callOwnerControl(operation) {
      assert.equal(operation, "owner_message_settle");
      settleCalls++;
      return { ok: true, result: { version: 1, status: "sealed_absent", root_ref: rootRef,
        owner_id: ownerId, grant_id: grantId, grant_version: 1, source_ref: sourceRef,
        message_ref: messageRef, occurred_at: occurredAt, fencing_generation: 7,
        instance_nonce: exact ? "instance-7" : "wrong-instance", receipt: null, replayed: false,
        apply: false, live_authority: false, model_execute: false, external_send: false } };
    } };
  const ledgerExports = ["acknowledgeEduPiAmbientMessagePlan", "armEduPiAmbientMessagePlan",
    "cancelEduPiAmbientMessagePlan", "confirmEduPiAmbientMessageBinding", "finishEduPiAmbientPlanDomain",
    "markEduPiAmbientMessageOutcomeUnknown", "markEduPiAmbientMessageOutcomeVerified",
    "markEduPiAmbientPlanDomainUnavailable", "prepareEduPiAmbientPlanDomainBinding",
    "readCompletedEduPiAmbientMessages", "readEduPiAmbientMessagePlan", "readCancelledEduPiAmbientMessages",
    "readPendingEduPiAmbientMessages", "readLegacySettledEduPiAmbientMessages",
    "readUnsettledEduPiAmbientMessages", "sealEduPiAmbientPlanDomainAbsent"];
  const modules = {
    "next/server": { NextResponse: { json: (value, init = {}) => ({ status: init.status ?? 200, json: async () => value }) } },
    "node:crypto": crypto,
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/edupi-ambient-message-runtime": { ...ambient, EduPiAmbientMessageError: class extends Error {} },
    "@/lib/edupi-ambient-message-ledger": Object.fromEntries(ledgerExports.map(name =>
      [name, (...args) => ledger[name](...args.slice(0, -1), options)])),
    "@/lib/edupi-ambient-message-recovery": { ...recovery,
      readExactEduPiAmbientGoalBinding: async () => ({ status: "outcome_unknown" }),
      readExactEduPiG2Execution: async () => ({ status: "outcome_unknown" }) },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ runtime: { coreCommit: "synthetic-pin" },
      dataRoot: { root: dataRoot } }) },
    "@/lib/edupi-proactivity-control": { isCapabilityGrantBindingIdentity: () => true },
    "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: () => ({ enabled: false }) },
    "@/lib/edupi-proactivity-runtime": { readProactivityOwnerContext: async () => null },
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: async () => host,
      isEduPiG3ExactRuntimeSupported: () => false },
    "@/lib/session-reader": { resolveSessionPath: async () => "synthetic-session.jsonl" },
    "@/lib/edupi-ambient-session-lock": { withEduPiAmbientSessionLock: async (_id, action) => action() },
    "@/lib/safe-mode": { canStartEduPiStudentFollowup: () => false },
  };
  const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const route = {};
  vm.runInNewContext(compiled, { exports: route, URL,
    require: name => { assert.ok(modules[name], name); return modules[name]; } });
  const read = () => route.GET(new Request(`http://localhost/api/edupi/proactivity/messages?sessionId=${sessionId}&verify=1`));
  const first = await (await read()).json();
  assert.equal(first.status, "outcome_unknown");
  assert.equal(first.pending.length, 1);
  assert.deepEqual(first.settled, []);
  assert.equal(ledger.readEduPiAmbientMessagePlan(sessionId, messageId, options).status, "pending");
  exact = true;
  const second = await (await read()).json();
  assert.equal(second.status, "clear");
  assert.deepEqual(second.pending, []);
  assert.deepEqual(second.settled, [{ messageId, occurredAt }]);
  assert.equal(ledger.readEduPiAmbientMessagePlan(sessionId, messageId, options).domains[0].state, "sealed_absent");
  assert.equal(ledger.readWithdrawableEduPiAmbientMessages(sessionId, options).length, 0);
  const cold = await (await read()).json();
  assert.deepEqual(cold.settled, [{ messageId, occurredAt }]);
  assert.equal(settleCalls, 2, "a settled receipt is reread from disk without another Core write");
  const retry = await route.POST(new Request("http://localhost/api/edupi/proactivity/messages", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, messageId, occurredAt, text: "synthetic retry" }),
  }));
  assert.equal(retry.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(await retry.json())), { status: "sealed_absent", resolutionStatus: "sealed_absent",
    reason: null, messageComplete: true, messageId, occurredAt, externalSend: false });
  assert.equal(settleCalls, 2, "a repeated POST cannot turn a Core-sealed absence into a capture");
});

test("GET verify finishes a captured question without claiming a Goal or replaying text", async t => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-captured-question-")));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const dataRoot = path.join(temporary, "data"), stateDir = path.join(temporary, "state");
  fs.mkdirSync(dataRoot, { mode: 0o700 }); fs.mkdirSync(stateDir, { mode: 0o700 });
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const ledger = await jiti.import("../../../../../lib/edupi-ambient-message-ledger.ts");
  const ambient = await jiti.import("../../../../../lib/edupi-ambient-message-runtime.ts");
  const recovery = await jiti.import("../../../../../lib/edupi-ambient-message-recovery.ts");
  const options = { stateDir, dataRoot };
  const sessionId = "synthetic-question-session", messageId = "synthetic-question-message";
  const ownerId = "owner-1", grantId = "grant-1", domain = "teaching_preparation";
  const occurredAt = "2026-10-09T00:00:00.000Z", rootRef = `sha256:${"a".repeat(64)}`;
  const messageRef = ambient.predictEduPiOwnerMessageRef(rootRef, ownerId, messageId, domain);
  ledger.armEduPiAmbientMessagePlan({ sessionId, messageId, occurredAt,
    domains: [{ domain, grantId, scopeHash: `sha256:${"b".repeat(64)}` }] }, options);
  ledger.prepareEduPiAmbientPlanDomainBinding({ sessionId, messageId, occurredAt, domain,
    messageRef, ownerId, grantId, captureGrantVersion: 1 }, options);
  const sourceRef = `conversation:${crypto.createHash("sha256")
    .update(ambient.eduPiAmbientConversationId(domain)).digest("hex")}`;
  const health = { lifecycle: "ready", data_root_fingerprint: rootRef, instance_nonce: "instance-7",
    fencing_generation: 7, capabilities: { supported_operations: ["owner_message_settle", "owner_intent_read"] } };
  const receipt = { action: "capture", revision: 1, message_ref: messageRef, owner_id: ownerId,
    root_ref: rootRef, source_ref: sourceRef, capture_grant_version: 1,
    received_at: occurredAt, recorded_at: occurredAt, sender_kind: "local_owner_authenticated",
    apply: false, live_authority: false, external_send: false };
  const calls = [];
  const host = { async call() { return { ok: true, result: health }; },
    async callOwnerControl(operation) {
      calls.push(operation);
      if (operation === "owner_message_settle") return { ok: true, result: {
        version: 1, status: "captured", root_ref: rootRef, owner_id: ownerId,
        grant_id: grantId, grant_version: 1, source_ref: sourceRef,
        message_ref: messageRef, occurred_at: occurredAt, fencing_generation: 7,
        instance_nonce: "instance-7", receipt, replayed: true,
        apply: false, live_authority: false, model_execute: false, external_send: false } };
      assert.equal(operation, "owner_intent_read");
      return { ok: true, result: { version: 1, intent_id: `owner_intent:${"c".repeat(64)}`,
        message_ref: messageRef, status: "current", action: "abstain", reason: "question_only",
        candidate: { domain, interpretation: "question", time_reference: { kind: "none", value: null },
          ambiguities: [], evidence_ids: [messageRef], policy_version: "ambient-intent-rules-v1",
          basis_hash: `sha256:${"d".repeat(64)}` }, observed_at: occurredAt,
        apply: false, live_authority: false, model_execute: false, external_send: false } };
    } };
  const ledgerExports = ["acknowledgeEduPiAmbientMessagePlan", "armEduPiAmbientMessagePlan",
    "cancelEduPiAmbientMessagePlan", "confirmEduPiAmbientMessageBinding", "finishEduPiAmbientPlanDomain",
    "finishEduPiAmbientPlanDomainCapturedNoAction", "markEduPiAmbientMessageOutcomeUnknown",
    "markEduPiAmbientMessageOutcomeVerified", "markEduPiAmbientPlanDomainUnavailable",
    "prepareEduPiAmbientPlanDomainBinding", "readCompletedEduPiAmbientMessages", "readEduPiAmbientMessagePlan",
    "readCancelledEduPiAmbientMessages", "readPendingEduPiAmbientMessages", "readLegacySettledEduPiAmbientMessages",
    "readUnsettledEduPiAmbientMessages", "sealEduPiAmbientPlanDomainAbsent"];
  const modules = {
    "next/server": { NextResponse: { json: (value, init = {}) => ({ status: init.status ?? 200, json: async () => value }) } },
    "node:crypto": crypto,
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/edupi-ambient-message-runtime": { ...ambient, EduPiAmbientMessageError: class extends Error {} },
    "@/lib/edupi-ambient-message-ledger": Object.fromEntries(ledgerExports.map(name =>
      [name, (...args) => ledger[name](...args.slice(0, -1), options)])),
    "@/lib/edupi-ambient-message-recovery": { ...recovery,
      readExactEduPiAmbientGoalBinding: async () => ({ status: "outcome_unknown" }),
      readExactEduPiG2Execution: async () => ({ status: "outcome_unknown" }) },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ runtime: { coreCommit: "synthetic-pin" },
      dataRoot: { root: dataRoot } }) },
    "@/lib/edupi-proactivity-control": { isCapabilityGrantBindingIdentity: () => true },
    "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: () => ({ enabled: false }) },
    "@/lib/edupi-proactivity-runtime": { readProactivityOwnerContext: async () => null },
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: async () => host,
      isEduPiG3ExactRuntimeSupported: () => false },
    "@/lib/session-reader": { resolveSessionPath: async () => "synthetic-question.jsonl" },
    "@/lib/edupi-ambient-session-lock": { withEduPiAmbientSessionLock: async (_id, action) => action() },
    "@/lib/safe-mode": { canStartEduPiStudentFollowup: () => false },
  };
  const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const route = {};
  vm.runInNewContext(compiled, { exports: route, URL,
    require: name => { assert.ok(modules[name], name); return modules[name]; } });
  const read = () => route.GET(new Request(`http://localhost/api/edupi/proactivity/messages?sessionId=${sessionId}&verify=1`));
  const first = await (await read()).json();
  assert.equal(first.status, "clear");
  assert.deepEqual(first.pending, []);
  assert.equal(first.recovered.length, 0, "capture-only proof must not claim a Goal");
  assert.deepEqual(first.settled, [{ messageId, occurredAt }]);
  assert.equal(ledger.readEduPiAmbientMessagePlan(sessionId, messageId, options).status, "complete");
  assert.equal(ledger.readWithdrawableEduPiAmbientMessages(sessionId, options)[0]?.messageRef, messageRef);
  assert.deepEqual(calls, ["owner_message_settle", "owner_intent_read"]);
  const cold = await (await read()).json();
  assert.deepEqual(cold.settled, [{ messageId, occurredAt }]);
  assert.equal(calls.length, 2, "cold read uses durable completion rather than a second Core call");
  const retry = await route.POST(new Request("http://localhost/api/edupi/proactivity/messages", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, messageId, occurredAt, text: "question repeated after restart" }),
  }));
  const repeated = await retry.json();
  assert.equal(retry.status, 200);
  assert.equal(repeated.status, "captured");
  assert.equal(repeated.messageComplete, true);
  assert.equal(Object.hasOwn(repeated, "goalId"), false);
  assert.equal(calls.length, 2, "a repeated POST cannot create a Goal for a captured question");
});
