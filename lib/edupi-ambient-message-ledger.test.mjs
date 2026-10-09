import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createJiti } from "jiti";

const ledger = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-message-ledger.ts");

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-ambient-ledger-")));
  const stateDir = path.join(root, "state"), dataRoot = path.join(root, "data");
  fs.mkdirSync(stateDir, { mode: 0o700 }); fs.mkdirSync(dataRoot, { mode: 0o700 });
  return { root, stateDir, dataRoot };
}

const binding = { sessionId: "session-1", messageId: "message-1", messageRef: `owner_message:${"a".repeat(64)}`,
  ownerId: `owner_${"b".repeat(32)}`, grantId: "grant-1", captureGrantVersion: 2, occurredAt: "2026-09-24T00:00:00.000Z" };

test("session withdrawal retains both independently captured domain receipts", () => {
  const value = fixture();
  const g2 = { ...binding, messageId: `g2_${"c".repeat(64)}`, messageRef: `owner_message:${"d".repeat(64)}`, grantId: "grant-g2" };
  try {
    ledger.recordEduPiAmbientMessageBinding(binding, value);
    ledger.recordEduPiAmbientMessageBinding(g2, value);
    const entries = ledger.readWithdrawableEduPiAmbientMessages(binding.sessionId, value);
    assert.equal(entries.length, 2);
    assert.deepEqual(new Set(entries.map(entry => entry.messageRef)), new Set([binding.messageRef, g2.messageRef]));
    for (const entry of entries) ledger.markEduPiAmbientMessageWithdrawn(entry.sessionId, entry.messageRef, "2026-09-24T01:00:00.000Z", value);
    assert.deepEqual(ledger.readWithdrawableEduPiAmbientMessages(binding.sessionId, value), []);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("one Pi message can have independent domain receipts under its original recoverable ID", () => {
  const value = fixture();
  const other = { ...binding, messageRef: `owner_message:${"d".repeat(64)}`, grantId: "grant-g3" };
  try {
    ledger.recordEduPiAmbientMessageBinding(binding, value);
    assert.equal(ledger.recordEduPiAmbientMessageBinding(other, value).messageRef, other.messageRef);
    assert.deepEqual(new Set(ledger.readWithdrawableEduPiAmbientMessages(binding.sessionId, value).map(item => item.messageRef)),
      new Set([binding.messageRef, other.messageRef]));
    assert.throws(() => ledger.recordEduPiAmbientMessageBinding({ ...other, occurredAt: "2026-09-24T00:00:01.000Z",
      messageRef: `owner_message:${"e".repeat(64)}` }, value), error => error?.code === "ambient_message_ledger_unavailable");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("an exact Core seal terminalizes only its absent domain in one durable ledger write", () => {
  const value = fixture();
  const g2 = { ...binding, messageRef: `owner_message:${"d".repeat(64)}`, grantId: "grant-g2" };
  try {
    ledger.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: binding.messageId,
      occurredAt: binding.occurredAt, domains: [
        { domain: "teaching_preparation", grantId: binding.grantId, scopeHash: `sha256:${"1".repeat(64)}` },
        { domain: "student_followup", grantId: g2.grantId, scopeHash: `sha256:${"2".repeat(64)}` },
      ] }, value);
    ledger.prepareEduPiAmbientPlanDomainBinding({ ...binding, domain: "teaching_preparation" }, value);
    ledger.finishEduPiAmbientPlanDomain(binding.sessionId, binding.messageId,
      "teaching_preparation", binding.messageRef, value);
    ledger.prepareEduPiAmbientPlanDomainBinding({ ...g2, domain: "student_followup" }, value);
    const settled = ledger.sealEduPiAmbientPlanDomainAbsent(binding.sessionId, binding.messageId,
      "student_followup", g2.messageRef, value);
    assert.equal(settled.status, "complete");
    assert.equal(settled.domains[1].state, "sealed_absent");
    assert.equal(JSON.parse(fs.readFileSync(path.join(value.stateDir, "edupi-ambient-message-ledger.json"), "utf8")).version, 3);
    assert.deepEqual(ledger.readPendingEduPiAmbientMessages(binding.sessionId, value), []);
    assert.deepEqual(ledger.readCompletedEduPiAmbientMessages(binding.sessionId, value),
      [{ messageId: binding.messageId, occurredAt: binding.occurredAt }]);
    assert.deepEqual(ledger.readWithdrawableEduPiAmbientMessages(binding.sessionId, value).map(item => item.messageRef),
      [binding.messageRef], "a sealed absence cannot be withdrawn as if it were a captured source");
    assert.throws(() => ledger.markEduPiAmbientMessageWithdrawn(binding.sessionId, g2.messageRef,
      "2026-09-24T01:00:00.000Z", value), error => error?.code === "ambient_message_ledger_unavailable");
    const file = path.join(value.stateDir, "edupi-ambient-message-ledger.json");
    const downgraded = JSON.parse(fs.readFileSync(file, "utf8"));
    downgraded.version = 2;
    fs.writeFileSync(file, `${JSON.stringify(downgraded, null, 2)}\n`, { mode: 0o600 });
    assert.throws(() => ledger.readPendingEduPiAmbientMessages(binding.sessionId, value),
      error => error?.code === "ambient_message_ledger_unavailable",
      "a v3 seal cannot be interpreted as an old v2 terminal state");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a sealed first domain leaves later unstarted domains visibly unavailable, not falsely complete or blocking", () => {
  const value = fixture();
  try {
    ledger.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: binding.messageId,
      occurredAt: binding.occurredAt, domains: [
        { domain: "teaching_preparation", grantId: binding.grantId, scopeHash: `sha256:${"1".repeat(64)}` },
        { domain: "student_followup", grantId: "grant-g2", scopeHash: `sha256:${"2".repeat(64)}` },
      ] }, value);
    ledger.prepareEduPiAmbientPlanDomainBinding({ ...binding, domain: "teaching_preparation" }, value);
    const plan = ledger.sealEduPiAmbientPlanDomainAbsent(binding.sessionId, binding.messageId,
      "teaching_preparation", binding.messageRef, value);
    assert.equal(plan.status, "pending");
    assert.deepEqual(plan.domains.map(item => item.state), ["sealed_absent", "unavailable"]);
    assert.deepEqual(ledger.readCompletedEduPiAmbientMessages(binding.sessionId, value), []);
    assert.deepEqual(ledger.readPendingEduPiAmbientMessages(binding.sessionId, value), [{
      messageId: binding.messageId, occurredAt: binding.occurredAt,
      nonBlocking: true, partiallyHandled: false, unprocessed: true,
    }]);
    assert.equal(ledger.readUnsettledEduPiAmbientMessages(binding.sessionId, value).length, 0);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a captured non-actionable message completes its exact plan but remains withdrawable", () => {
  const value = fixture();
  try {
    ledger.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: binding.messageId,
      occurredAt: binding.occurredAt, domains: [
        { domain: "teaching_preparation", grantId: binding.grantId, scopeHash: `sha256:${"1".repeat(64)}` },
      ] }, value);
    ledger.prepareEduPiAmbientPlanDomainBinding({ ...binding, domain: "teaching_preparation" }, value);
    const plan = ledger.finishEduPiAmbientPlanDomainCapturedNoAction(binding.sessionId, binding.messageId,
      "teaching_preparation", binding.messageRef, value);
    assert.equal(plan.status, "complete");
    assert.deepEqual(ledger.readPendingEduPiAmbientMessages(binding.sessionId, value), []);
    assert.deepEqual(ledger.readCompletedEduPiAmbientMessages(binding.sessionId, value),
      [{ messageId: binding.messageId, occurredAt: binding.occurredAt }]);
    assert.deepEqual(ledger.readWithdrawableEduPiAmbientMessages(binding.sessionId, value).map(item => item.messageRef),
      [binding.messageRef], "the Core source was captured and must still be withdrawn before session deletion");
    assert.equal(JSON.parse(fs.readFileSync(path.join(value.stateDir, "edupi-ambient-message-ledger.json"), "utf8")).version, 2);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a captured non-actionable first domain keeps later domains unprocessed but non-blocking", () => {
  const value = fixture();
  try {
    ledger.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: binding.messageId,
      occurredAt: binding.occurredAt, domains: [
        { domain: "teaching_preparation", grantId: binding.grantId, scopeHash: `sha256:${"1".repeat(64)}` },
        { domain: "student_followup", grantId: "grant-g2", scopeHash: `sha256:${"2".repeat(64)}` },
      ] }, value);
    ledger.prepareEduPiAmbientPlanDomainBinding({ ...binding, domain: "teaching_preparation" }, value);
    const plan = ledger.finishEduPiAmbientPlanDomainCapturedNoAction(binding.sessionId, binding.messageId,
      "teaching_preparation", binding.messageRef, value);
    assert.equal(plan.status, "pending");
    assert.deepEqual(plan.domains.map(item => item.state), ["terminal", "unavailable"]);
    assert.deepEqual(ledger.readCompletedEduPiAmbientMessages(binding.sessionId, value), []);
    assert.deepEqual(ledger.readPendingEduPiAmbientMessages(binding.sessionId, value), [{
      messageId: binding.messageId, occurredAt: binding.occurredAt,
      nonBlocking: true, partiallyHandled: true, unprocessed: false,
    }]);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a v2 pending plan remains v2 until a Core-sealed absence needs v3", () => {
  const value = fixture();
  try {
    const first = { session_id: binding.sessionId, message_id: binding.messageId, occurred_at: binding.occurredAt,
      status: "pending", acknowledged: false, domains: [{ domain: "teaching_preparation", grant_id: binding.grantId,
        scope_hash: `sha256:${"1".repeat(64)}`, state: "unattempted", message_ref: null }] };
    const rootHash = `sha256:${crypto.createHash("sha256").update(fs.realpathSync(value.dataRoot)).digest("hex")}`;
    const file = path.join(value.stateDir, "edupi-ambient-message-ledger.json");
    fs.writeFileSync(file, `${JSON.stringify({ version: 2, data_root_hash: rootHash, revision: 1,
      entries: [], plans: [first] }, null, 2)}\n`, { mode: 0o600 });
    assert.equal(ledger.readEduPiAmbientMessagePlan(binding.sessionId, binding.messageId, value).status, "pending");
    ledger.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: "later-message",
      occurredAt: binding.occurredAt, domains: [{ domain: "teaching_preparation",
        grantId: binding.grantId, scopeHash: `sha256:${"2".repeat(64)}` }] }, value);
    const migrated = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(migrated.version, 2);
    assert.equal(migrated.plans.length, 2);
    assert.equal(migrated.plans[0].status, "pending");
    assert.equal(migrated.plans[0].domains[0].state, "unattempted");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a capture remains pending until the server persists a completed outcome receipt", () => {
  const value = fixture();
  try {
    ledger.recordEduPiAmbientMessageBinding(binding, value);
    assert.deepEqual(ledger.readUnsettledEduPiAmbientMessages(binding.sessionId, value).map(item => item.messageId), [binding.messageId]);
    assert.deepEqual(ledger.readSettledEduPiAmbientMessages(binding.sessionId, value), []);
    assert.equal(ledger.markEduPiAmbientMessageOutcomeSettled(binding.sessionId, binding.messageRef, value).status, "settled");
    assert.deepEqual(ledger.readUnsettledEduPiAmbientMessages(binding.sessionId, value), []);
    assert.deepEqual(ledger.readSettledEduPiAmbientMessages(binding.sessionId, value).map(item => item.messageId), [binding.messageId]);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("an acknowledged complete plan is retained for dedupe but omitted from later outbox reconciliation", () => {
  const value = fixture();
  try {
    ledger.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: binding.messageId,
      occurredAt: binding.occurredAt, domains: [{ domain: "teaching_preparation", grantId: binding.grantId,
        scopeHash: `sha256:${"c".repeat(64)}` }] }, value);
    ledger.prepareEduPiAmbientPlanDomainBinding({ ...binding, domain: "teaching_preparation" }, value);
    ledger.confirmEduPiAmbientMessageBinding(binding.sessionId, binding.messageId, binding.messageRef, value);
    ledger.finishEduPiAmbientPlanDomain(binding.sessionId, binding.messageId, "teaching_preparation", binding.messageRef, value);
    assert.equal(ledger.readCompletedEduPiAmbientMessages(binding.sessionId, value).length, 1);
    ledger.acknowledgeEduPiAmbientMessagePlan(binding.sessionId, binding.messageId, binding.occurredAt, value);
    assert.equal(ledger.readCompletedEduPiAmbientMessages(binding.sessionId, value).length, 0);
    assert.equal(ledger.readEduPiAmbientMessagePlan(binding.sessionId, binding.messageId, value).status, "complete");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a definite unsent cancellation remains durably provable until the native outbox ACK", () => {
  const value = fixture();
  try {
    ledger.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: binding.messageId,
      occurredAt: binding.occurredAt, domains: [{ domain: "teaching_preparation", grantId: binding.grantId,
        scopeHash: `sha256:${"c".repeat(64)}` }] }, value);
    ledger.cancelEduPiAmbientMessagePlan(binding.sessionId, binding.messageId, binding.occurredAt, value);
    assert.equal(ledger.readEduPiAmbientMessagePlan(binding.sessionId, binding.messageId, value).status, "cancelled");
    assert.equal(ledger.readPendingEduPiAmbientMessages(binding.sessionId, value).length, 0);
    assert.deepEqual(ledger.readCancelledEduPiAmbientMessages(binding.sessionId, value),
      [{ messageId: binding.messageId, occurredAt: binding.occurredAt }]);
    ledger.cancelEduPiAmbientMessagePlan(binding.sessionId, binding.messageId, binding.occurredAt, value);
    ledger.acknowledgeEduPiAmbientMessagePlan(binding.sessionId, binding.messageId, binding.occurredAt, value);
    assert.deepEqual(ledger.readCancelledEduPiAmbientMessages(binding.sessionId, value), []);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("the private root-bound ledger stores identity only and supports idempotent withdrawal", () => {
  const value = fixture();
  try {
    assert.deepEqual(ledger.readCapturedEduPiAmbientMessages("session-1", value), []);
    assert.equal(ledger.recordEduPiAmbientMessageBinding(binding, value).status, "captured");
    assert.equal(ledger.recordEduPiAmbientMessageBinding(binding, value).messageRef, binding.messageRef);
    const file = path.join(value.stateDir, "edupi-ambient-message-ledger.json");
    const source = fs.readFileSync(file, "utf8");
    assert.equal(source.includes("帮我备课"), false);
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o077, 0);
    assert.equal(ledger.readCapturedEduPiAmbientMessages("session-2", value).length, 0);
    const withdrawn = ledger.markEduPiAmbientMessageWithdrawn("session-1", binding.messageRef, "2026-09-24T01:00:00.000Z", value);
    assert.equal(withdrawn.status, "withdrawn");
    assert.equal(ledger.markEduPiAmbientMessageWithdrawn("session-1", binding.messageRef, "2026-09-24T02:00:00.000Z", value).withdrawnAt,
      "2026-09-24T01:00:00.000Z");
    assert.deepEqual(ledger.readCapturedEduPiAmbientMessages("session-1", value), []);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("conflicts, foreign roots, corrupt state, and symlinks fail closed", () => {
  const value = fixture();
  try {
    ledger.recordEduPiAmbientMessageBinding(binding, value);
    assert.throws(() => ledger.recordEduPiAmbientMessageBinding({ ...binding, occurredAt: "2026-09-24T00:00:01.000Z",
      messageRef: `owner_message:${"c".repeat(64)}` }, value),
      (error) => error?.code === "ambient_message_ledger_unavailable");
    const otherData = path.join(value.root, "other"); fs.mkdirSync(otherData);
    assert.throws(() => ledger.readCapturedEduPiAmbientMessages("session-1", { ...value, dataRoot: otherData }),
      (error) => error?.code === "ambient_message_ledger_unavailable");
    fs.writeFileSync(path.join(value.stateDir, "edupi-ambient-message-ledger.json"), "{broken", { mode: 0o600 });
    assert.throws(() => ledger.readCapturedEduPiAmbientMessages("session-1", value),
      (error) => error?.code === "ambient_message_ledger_unavailable");
    const link = path.join(value.root, "linked"); fs.symlinkSync(value.stateDir, link);
    assert.throws(() => ledger.readCapturedEduPiAmbientMessages("session-1", { ...value, stateDir: link }),
      (error) => error?.code === "ambient_message_ledger_unavailable");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("prepared identities survive a capture crash; old abandoned rows remain readable but cannot be newly written", () => {
  const value = fixture();
  try {
    const pending = { ...binding, sessionId: "session-pending", messageId: "message-pending",
      messageRef: `owner_message:${"d".repeat(64)}` };
    assert.equal(ledger.prepareEduPiAmbientMessageBinding(pending, value).status, "pending");
    assert.equal(ledger.readWithdrawableEduPiAmbientMessages("session-pending", value)[0].status, "pending");
    assert.equal(ledger.confirmEduPiAmbientMessageBinding(pending.sessionId, pending.messageId, pending.messageRef, value).status, "captured");
    const abandoned = { ...binding, sessionId: "session-abandoned", messageId: "message-abandoned",
      messageRef: `owner_message:${"e".repeat(64)}` };
    ledger.prepareEduPiAmbientMessageBinding(abandoned, value);
    assert.equal(ledger.markEduPiAmbientMessageAbandoned, undefined, "there is no writer for an unproved absence");
    const file = path.join(value.stateDir, "edupi-ambient-message-ledger.json");
    const prior = JSON.parse(fs.readFileSync(file, "utf8"));
    const historical = prior.entries.find(item => item.message_ref === abandoned.messageRef);
    historical.status = "abandoned";
    historical.withdrawn_at = "2026-09-24T02:00:00.000Z";
    prior.revision += 1;
    fs.writeFileSync(file, `${JSON.stringify(prior, null, 2)}\n`, { mode: 0o600 });
    assert.equal(ledger.readWithdrawableEduPiAmbientMessages(abandoned.sessionId, value)[0]?.status, "abandoned",
      "a historical abandoned marker is not proof that Core never captured the message");
    assert.deepEqual(ledger.readPendingEduPiAmbientMessages(abandoned.sessionId, value).map(item => item.messageId),
      [abandoned.messageId]);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("an unknown Core outcome survives a fresh ledger read and exact capture replay", async () => {
  const value = fixture();
  try {
    ledger.recordEduPiAmbientMessageBinding(binding, value);
    const uncertain = ledger.markEduPiAmbientMessageOutcomeUnknown(binding.sessionId, binding.messageRef, value);
    assert.equal(uncertain.status, "outcome_unknown");
    assert.deepEqual(ledger.readUncertainEduPiAmbientMessages(binding.sessionId, value).map(item => item.messageId), [binding.messageId]);
    assert.equal(ledger.confirmEduPiAmbientMessageBinding(binding.sessionId, binding.messageId, binding.messageRef, value).status,
      "outcome_unknown", "same message replay cannot silently clear an unverified outcome");
    const readAgain = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-message-ledger.ts");
    assert.deepEqual(readAgain.readUncertainEduPiAmbientMessages(binding.sessionId, value).map(item => item.messageRef), [binding.messageRef]);
    assert.equal(ledger.readWithdrawableEduPiAmbientMessages(binding.sessionId, value).length, 1);
    assert.equal(ledger.markEduPiAmbientMessageOutcomeVerified(binding.sessionId, binding.messageRef, value).status, "settled");
    assert.deepEqual(ledger.readUncertainEduPiAmbientMessages(binding.sessionId, value), []);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a frozen five-domain plan survives a restart and one settled domain never completes its message", async () => {
  const value = fixture();
  try {
    const domains = ["teaching_preparation", "student_followup", "calendar_administration", "lesson_reflection", "parent_communication"]
      .map(domain => ({ domain, grantId: `grant-${domain}`, scopeHash: `sha256:${"c".repeat(64)}` }));
    ledger.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: binding.messageId,
      occurredAt: binding.occurredAt, domains }, value);
    ledger.prepareEduPiAmbientPlanDomainBinding({ ...binding, grantId: domains[0].grantId,
      domain: "teaching_preparation" }, value);
    ledger.confirmEduPiAmbientMessageBinding(binding.sessionId, binding.messageId, binding.messageRef, value);
    ledger.finishEduPiAmbientPlanDomain(binding.sessionId, binding.messageId, "teaching_preparation", binding.messageRef, value);
    const reopened = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-message-ledger.ts");
    const plan = reopened.readEduPiAmbientMessagePlan(binding.sessionId, binding.messageId, value);
    assert.equal(plan.status, "pending");
    assert.deepEqual(plan.domains.map(item => item.state), ["terminal", "unattempted", "unattempted", "unattempted", "unattempted"]);
    assert.equal(reopened.readCompletedEduPiAmbientMessages(binding.sessionId, value).length, 0);
    assert.equal(reopened.readPendingEduPiAmbientMessages(binding.sessionId, value)[0].messageId, binding.messageId);
    assert.throws(() => reopened.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: binding.messageId,
      occurredAt: binding.occurredAt, domains: domains.slice(0, 1) }, value), error => error?.code === "ambient_message_ledger_unavailable");
    const stored = fs.readFileSync(path.join(value.stateDir, "edupi-ambient-message-ledger.json"), "utf8");
    assert.equal(stored.includes("class-1"), false);
    assert.equal(stored.includes("数学"), false);
    assert.equal(stored.includes("合成教师"), false);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("an in-flight domain and an unavailable later domain remain pending across restart", async () => {
  const value = fixture();
  try {
    const domains = ["teaching_preparation", "student_followup"]
      .map(domain => ({ domain, grantId: `grant-${domain}`, scopeHash: `sha256:${"c".repeat(64)}` }));
    ledger.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: binding.messageId,
      occurredAt: binding.occurredAt, domains }, value);
    ledger.prepareEduPiAmbientPlanDomainBinding({ ...binding, grantId: domains[0].grantId,
      domain: "teaching_preparation" }, value);
    const reopened = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-message-ledger.ts");
    assert.equal(reopened.readEduPiAmbientMessagePlan(binding.sessionId, binding.messageId, value).domains[0].state, "unknown");
    reopened.markEduPiAmbientPlanDomainUnavailable(binding.sessionId, binding.messageId, "student_followup", value);
    assert.equal(reopened.readEduPiAmbientMessagePlan(binding.sessionId, binding.messageId, value).status, "pending");
    assert.deepEqual(reopened.readEduPiAmbientMessagePlan(binding.sessionId, binding.messageId, value).domains.map(item => item.state),
      ["unknown", "unavailable"]);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("domain unknown and its prepared receipt become durable in one ledger revision", () => {
  const value = fixture();
  try {
    ledger.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: binding.messageId,
      occurredAt: binding.occurredAt, domains: [{ domain: "teaching_preparation", grantId: binding.grantId,
        scopeHash: `sha256:${"c".repeat(64)}` }] }, value);
    const file = path.join(value.stateDir, "edupi-ambient-message-ledger.json");
    const before = JSON.parse(fs.readFileSync(file, "utf8"));
    ledger.prepareEduPiAmbientPlanDomainBinding({ ...binding, domain: "teaching_preparation" }, value);
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.plans[0].domains[0].state, "unknown");
    assert.equal(after.entries[0].message_ref, binding.messageRef);
    assert.equal(after.entries[0].status, "pending");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("an exact positive Core proof can settle a prepared receipt left pending at process exit", () => {
  const value = fixture();
  try {
    ledger.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: binding.messageId,
      occurredAt: binding.occurredAt, domains: [{ domain: "teaching_preparation", grantId: binding.grantId,
        scopeHash: `sha256:${"c".repeat(64)}` }] }, value);
    ledger.prepareEduPiAmbientPlanDomainBinding({ ...binding, domain: "teaching_preparation" }, value);
    assert.equal(ledger.readUnsettledEduPiAmbientMessages(binding.sessionId, value)[0].status, "pending");
    ledger.finishEduPiAmbientPlanDomain(binding.sessionId, binding.messageId, "teaching_preparation", binding.messageRef, value);
    assert.equal(ledger.readEduPiAmbientMessagePlan(binding.sessionId, binding.messageId, value).status, "complete");
    assert.equal(ledger.readSettledEduPiAmbientMessages(binding.sessionId, value)[0].status, "settled");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("hard exit around atomic ledger replacement yields either unattempted or unknown with a receipt", () => {
  for (const phase of ["before", "after"]) {
    const value = fixture();
    try {
      ledger.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: binding.messageId,
        occurredAt: binding.occurredAt, domains: [{ domain: "teaching_preparation", grantId: binding.grantId,
          scopeHash: `sha256:${"c".repeat(64)}` }] }, value);
      const source = new URL("./edupi-ambient-message-ledger.ts", import.meta.url).pathname;
      const child = `import fs from "node:fs";
import { createJiti } from "jiti";
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (!String(to).endsWith("edupi-ambient-message-ledger.json")) return rename(from, to);
  if (${JSON.stringify(phase)} === "after") rename(from, to);
  if (process.platform === "win32") process.exit(71);
  process.kill(process.pid, "SIGKILL");
};
const ledger = await createJiti(import.meta.url, { tsconfigPaths: true }).import(${JSON.stringify(source)});
ledger.prepareEduPiAmbientPlanDomainBinding(${JSON.stringify({ ...binding, domain: "teaching_preparation" })},
  ${JSON.stringify({ stateDir: value.stateDir, dataRoot: value.dataRoot })});`;
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", child], { cwd: process.cwd(), encoding: "utf8" });
      assert.equal(process.platform === "win32" ? result.status : result.signal, process.platform === "win32" ? 71 : "SIGKILL", result.stderr);
      const plan = ledger.readEduPiAmbientMessagePlan(binding.sessionId, binding.messageId, value);
      const rows = ledger.readUnsettledEduPiAmbientMessages(binding.sessionId, value);
      assert.equal(plan.domains[0].state, phase === "before" ? "unattempted" : "unknown");
      assert.equal(rows.length, phase === "before" ? 0 : 1);
      if (rows.length) assert.equal(rows[0].messageRef, binding.messageRef);
    } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
  }
});

test("a full unretirable ledger refuses preparation without stranding an unknown domain", () => {
  const value = fixture();
  try {
    const entries = Array.from({ length: 4096 }, (_, index) => ({ session_id: binding.sessionId,
      message_id: `legacy-${index}`, message_ref: `owner_message:${index.toString(16).padStart(64, "0")}`,
      owner_id: binding.ownerId, grant_id: binding.grantId, capture_grant_version: 2,
      occurred_at: binding.occurredAt, status: "settled", withdrawn_at: null }));
    const plan = { session_id: binding.sessionId, message_id: binding.messageId, occurred_at: binding.occurredAt,
      status: "pending", acknowledged: false,
      domains: [{ domain: "teaching_preparation", grant_id: binding.grantId, scope_hash: `sha256:${"c".repeat(64)}`,
        state: "unattempted", message_ref: null }] };
    const hash = crypto.createHash("sha256").update(fs.realpathSync(value.dataRoot), "utf8").digest("hex");
    fs.writeFileSync(path.join(value.stateDir, "edupi-ambient-message-ledger.json"),
      JSON.stringify({ version: 2, data_root_hash: `sha256:${hash}`, revision: 1, entries, plans: [plan] }), { mode: 0o600 });
    assert.throws(() => ledger.prepareEduPiAmbientPlanDomainBinding({ ...binding, domain: "teaching_preparation" }, value),
      error => error?.code === "ambient_message_ledger_unavailable");
    assert.equal(ledger.readEduPiAmbientMessagePlan(binding.sessionId, binding.messageId, value).domains[0].state, "unattempted");
    assert.equal(ledger.readUnsettledEduPiAmbientMessages(binding.sessionId, value).length, 0);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a process exiting after G1 cannot make unattempted G2 look complete on restart", () => {
  const value = fixture();
  try {
    const source = new URL("./edupi-ambient-message-ledger.ts", import.meta.url).pathname;
    const child = `import { createJiti } from "jiti";
const ledger = await createJiti(import.meta.url, { tsconfigPaths: true }).import(${JSON.stringify(source)});
const options = ${JSON.stringify({ stateDir: value.stateDir, dataRoot: value.dataRoot })};
const binding = ${JSON.stringify(binding)};
ledger.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: binding.messageId, occurredAt: binding.occurredAt,
  domains: [{ domain: "teaching_preparation", grantId: binding.grantId, scopeHash: "sha256:${"c".repeat(64)}" },
    { domain: "student_followup", grantId: "grant-g2", scopeHash: "sha256:${"d".repeat(64)}" }] }, options);
ledger.prepareEduPiAmbientPlanDomainBinding({ ...binding, domain: "teaching_preparation" }, options);
ledger.confirmEduPiAmbientMessageBinding(binding.sessionId, binding.messageId, binding.messageRef, options);
ledger.finishEduPiAmbientPlanDomain(binding.sessionId, binding.messageId, "teaching_preparation", binding.messageRef, options);
process.exit(71);`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", child], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(result.status, 71, result.stderr);
    const reopened = ledger.readEduPiAmbientMessagePlan(binding.sessionId, binding.messageId, value);
    assert.deepEqual(reopened.domains.map(item => item.state), ["terminal", "unattempted"]);
    assert.equal(reopened.status, "pending");
    assert.equal(ledger.readCompletedEduPiAmbientMessages(binding.sessionId, value).length, 0);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("exact recovery settles its unknown receipt and planned domain in one restart-safe write", () => {
  const value = fixture();
  try {
    ledger.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: binding.messageId,
      occurredAt: binding.occurredAt, domains: [{ domain: "teaching_preparation", grantId: binding.grantId,
        scopeHash: `sha256:${"c".repeat(64)}` }] }, value);
    ledger.prepareEduPiAmbientPlanDomainBinding({ ...binding, domain: "teaching_preparation" }, value);
    ledger.confirmEduPiAmbientMessageBinding(binding.sessionId, binding.messageId, binding.messageRef, value);
    ledger.markEduPiAmbientMessageOutcomeUnknown(binding.sessionId, binding.messageRef, value);
    const source = new URL("./edupi-ambient-message-ledger.ts", import.meta.url).pathname;
    const child = `import { createJiti } from "jiti";
const ledger = await createJiti(import.meta.url, { tsconfigPaths: true }).import(${JSON.stringify(source)});
ledger.finishEduPiAmbientPlanDomain(${JSON.stringify(binding.sessionId)}, ${JSON.stringify(binding.messageId)},
  "teaching_preparation", ${JSON.stringify(binding.messageRef)},
  ${JSON.stringify({ stateDir: value.stateDir, dataRoot: value.dataRoot })});
process.exit(71);`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", child], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(result.status, 71, result.stderr);
    assert.equal(ledger.readEduPiAmbientMessagePlan(binding.sessionId, binding.messageId, value).status, "complete");
    assert.equal(ledger.readSettledEduPiAmbientMessages(binding.sessionId, value)[0].status, "settled");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("a v1 settled row survives migration but lacks message-level completion proof", () => {
  const value = fixture();
  try {
    const hash = crypto.createHash("sha256").update(fs.realpathSync(value.dataRoot), "utf8").digest("hex");
    const old = { version: 1, data_root_hash: `sha256:${hash}`, revision: 1,
      entries: [{ session_id: binding.sessionId, message_id: binding.messageId, message_ref: binding.messageRef,
        owner_id: binding.ownerId, grant_id: binding.grantId, capture_grant_version: binding.captureGrantVersion,
        occurred_at: binding.occurredAt, status: "settled", withdrawn_at: null }] };
    fs.writeFileSync(path.join(value.stateDir, "edupi-ambient-message-ledger.json"), JSON.stringify(old), { mode: 0o600 });
    assert.equal(ledger.readPendingEduPiAmbientMessages(binding.sessionId, value).length, 0,
      "a historical settled row cannot block a new prompt without a native outbox identity");
    assert.equal(ledger.readCompletedEduPiAmbientMessages(binding.sessionId, value).length, 0);
    const fresh = { ...binding, messageId: "new-message", occurredAt: "2026-10-08T00:00:01.000Z" };
    ledger.armEduPiAmbientMessagePlan({ sessionId: fresh.sessionId, messageId: fresh.messageId,
      occurredAt: fresh.occurredAt, domains: [{ domain: "teaching_preparation", grantId: fresh.grantId,
        scopeHash: `sha256:${"c".repeat(64)}` }] }, value);
    const migrated = JSON.parse(fs.readFileSync(path.join(value.stateDir, "edupi-ambient-message-ledger.json"), "utf8"));
    assert.equal(migrated.version, 2);
    assert.equal(migrated.entries.length, 1);
    assert.equal(migrated.entries[0].message_ref, binding.messageRef);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("session deletion can withdraw completed multi-domain receipts one at a time", () => {
  const value = fixture();
  try {
    const second = { ...binding, messageRef: `owner_message:${"d".repeat(64)}`, grantId: "grant-g2" };
    ledger.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: binding.messageId,
      occurredAt: binding.occurredAt,
      domains: [{ domain: "teaching_preparation", grantId: binding.grantId, scopeHash: `sha256:${"c".repeat(64)}` },
        { domain: "student_followup", grantId: second.grantId, scopeHash: `sha256:${"d".repeat(64)}` }] }, value);
    for (const [domain, receipt] of [["teaching_preparation", binding], ["student_followup", second]]) {
      ledger.prepareEduPiAmbientPlanDomainBinding({ ...receipt, domain }, value);
      ledger.confirmEduPiAmbientMessageBinding(binding.sessionId, binding.messageId, receipt.messageRef, value);
      ledger.finishEduPiAmbientPlanDomain(binding.sessionId, binding.messageId, domain, receipt.messageRef, value);
    }
    for (const receipt of [binding, second]) ledger.markEduPiAmbientMessageWithdrawn(binding.sessionId,
      receipt.messageRef, "2026-10-08T01:00:00.000Z", value);
    assert.deepEqual(ledger.readWithdrawableEduPiAmbientMessages(binding.sessionId, value), []);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("only native-acknowledged complete plans can release old domain rows at capacity", () => {
  const value = fixture();
  try {
    const domain = { domain: "teaching_preparation", grantId: "grant-1", scopeHash: `sha256:${"c".repeat(64)}` };
    const entries = [], plans = [];
    for (let index = 0; index < 4096; index++) {
      const messageId = `message-${index}`;
      const messageRef = `owner_message:${index.toString(16).padStart(64, "0")}`;
      const pending = index === 4094, unacknowledged = index === 4095;
      entries.push({ session_id: binding.sessionId, message_id: messageId, message_ref: messageRef,
        owner_id: binding.ownerId, grant_id: domain.grantId, capture_grant_version: 2,
        occurred_at: binding.occurredAt, status: pending ? "outcome_unknown" : "settled", withdrawn_at: null });
      plans.push({ session_id: binding.sessionId, message_id: messageId, occurred_at: binding.occurredAt,
        status: pending ? "pending" : "complete", acknowledged: !pending && !unacknowledged,
        domains: [{ domain: domain.domain, grant_id: domain.grantId, scope_hash: domain.scopeHash,
          state: pending ? "unknown" : "terminal", message_ref: pending ? null : messageRef }] });
    }
    const hash = crypto.createHash("sha256").update(fs.realpathSync(value.dataRoot), "utf8").digest("hex");
    fs.writeFileSync(path.join(value.stateDir, "edupi-ambient-message-ledger.json"),
      JSON.stringify({ version: 2, data_root_hash: `sha256:${hash}`, revision: 1, entries, plans }), { mode: 0o600 });
    ledger.armEduPiAmbientMessagePlan({ sessionId: binding.sessionId, messageId: "new-message",
      occurredAt: binding.occurredAt, domains: [domain] }, value);
    assert.equal(ledger.readEduPiAmbientMessagePlan(binding.sessionId, "message-0", value), null);
    assert.equal(ledger.readEduPiAmbientMessagePlan(binding.sessionId, "message-4094", value).status, "pending");
    assert.equal(ledger.readEduPiAmbientMessagePlan(binding.sessionId, "message-4095", value).status, "complete");
    assert.equal(ledger.readEduPiAmbientMessagePlan(binding.sessionId, "new-message", value).status, "pending");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test("one hundred acknowledged messages require no completed-row reconciliation after restart", () => {
  const value = fixture();
  try {
    const entries = [], plans = [];
    for (let index = 0; index < 100; index++) {
      const messageId = `ack-${index}`, messageRef = `owner_message:${index.toString(16).padStart(64, "0")}`;
      entries.push({ session_id: binding.sessionId, message_id: messageId, message_ref: messageRef,
        owner_id: binding.ownerId, grant_id: binding.grantId, capture_grant_version: 2,
        occurred_at: binding.occurredAt, status: "settled", withdrawn_at: null });
      plans.push({ session_id: binding.sessionId, message_id: messageId, occurred_at: binding.occurredAt,
        status: "complete", acknowledged: true,
        domains: [{ domain: "teaching_preparation", grant_id: binding.grantId, scope_hash: `sha256:${"c".repeat(64)}`,
          state: "terminal", message_ref: messageRef }] });
    }
    const hash = crypto.createHash("sha256").update(fs.realpathSync(value.dataRoot), "utf8").digest("hex");
    fs.writeFileSync(path.join(value.stateDir, "edupi-ambient-message-ledger.json"),
      JSON.stringify({ version: 2, data_root_hash: `sha256:${hash}`, revision: 100, entries, plans }), { mode: 0o600 });
    assert.deepEqual(ledger.readCompletedEduPiAmbientMessages(binding.sessionId, value), []);
    assert.equal(ledger.readEduPiAmbientMessagePlan(binding.sessionId, "ack-99", value).status, "complete");
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});
