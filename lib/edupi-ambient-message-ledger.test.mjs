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
    assert.throws(() => ledger.recordEduPiAmbientMessageBinding({ ...binding, messageRef: `owner_message:${"c".repeat(64)}` }, value),
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
