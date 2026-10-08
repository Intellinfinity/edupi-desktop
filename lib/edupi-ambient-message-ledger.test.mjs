import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

test("prepared identities survive a capture crash and can be confirmed or abandoned without private text", () => {
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
    assert.equal(ledger.markEduPiAmbientMessageAbandoned(abandoned.sessionId, abandoned.messageRef,
      "2026-09-24T02:00:00.000Z", value).status, "abandoned");
    assert.deepEqual(ledger.readWithdrawableEduPiAmbientMessages(abandoned.sessionId, value), []);
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
