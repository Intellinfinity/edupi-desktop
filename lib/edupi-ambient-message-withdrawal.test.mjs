import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const withdrawal = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-message-withdrawal.ts");
const outbox = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-prompt-outbox.ts");
const ledger = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-message-ledger.ts");
const rootRef = `sha256:${"a".repeat(64)}`;
const entry = { sessionId: "session-1", messageId: "message-1", messageRef: `owner_message:${"b".repeat(64)}`,
  ownerId: `owner_${"c".repeat(32)}`, grantId: "grant-1", captureGrantVersion: 1,
  occurredAt: "2026-09-24T00:00:00.000Z", status: "captured", withdrawnAt: null };

test("session withdrawal binds every message to the current root and marks only verified Core receipts", async () => {
  const calls = [], marked = [];
  const host = {
    async call() { return { ok: true, result: { data_root_fingerprint: rootRef } }; },
    async callOwnerControl(operation, payload) {
      calls.push([operation, payload]);
      return { ok: true, result: { replayed: false, receipt: { action: "withdraw", message_ref: entry.messageRef,
        revision: 2, owner_id: entry.ownerId, root_ref: rootRef, recorded_at: "2026-09-24T01:00:00.000Z",
        apply: false, live_authority: false, external_send: false } } };
    },
  };
  assert.deepEqual(await withdrawal.withdrawEduPiAmbientMessagesForSession("session-1", {
    roots: { dataRoot: { root: "/data" } }, host, read: () => [entry], mark: (...args) => marked.push(args),
  }), { withdrawn: 1, abandoned: 0 });
  assert.deepEqual(calls[0], ["owner_message", { action: "withdraw", root_ref: rootRef,
    expected_owner_id: entry.ownerId, message_ref: entry.messageRef, expected_revision: 1 }]);
  assert.deepEqual(marked, [["session-1", entry.messageRef, "2026-09-24T01:00:00.000Z", "withdrawn"]]);
});

test("malformed or externally authoritative receipts fail before the ledger is marked", async () => {
  let marked = false;
  const host = {
    async call() { return { ok: true, result: { data_root_fingerprint: rootRef } }; },
    async callOwnerControl() { return { ok: true, result: { receipt: { action: "withdraw", message_ref: entry.messageRef,
      revision: 2, owner_id: entry.ownerId, root_ref: rootRef, recorded_at: "2026-09-24T01:00:00.000Z",
      apply: false, live_authority: false, external_send: true } } }; },
  };
  await assert.rejects(withdrawal.withdrawEduPiAmbientMessagesForSession("session-1", {
    roots: { dataRoot: { root: "/data" } }, host, read: () => [entry], mark: () => { marked = true; },
  }), (error) => error?.code === "ambient_message_withdrawal_unavailable");
  assert.equal(marked, false);
});

test("web mode and sessions without captured messages do not start Core", async () => {
  assert.deepEqual(await withdrawal.withdrawEduPiAmbientMessagesForSession("session-1", { stateDir: "" }), { withdrawn: 0, abandoned: 0 });
  assert.deepEqual(await withdrawal.withdrawEduPiAmbientMessagesForSession("session-1", {
    roots: { dataRoot: { root: "/data" } }, read: () => [], host: { call: async () => { throw new Error("must not call"); } },
  }), { withdrawn: 0, abandoned: 0 });
});

test("a prepared message that never reached Core is terminalized without blocking deletion", async () => {
  const marked = [];
  const host = {
    async call() { return { ok: true, result: { data_root_fingerprint: rootRef } }; },
    async callOwnerControl() { return { ok: false, result: null, error_code: "owner_identity_mismatch" }; },
  };
  assert.deepEqual(await withdrawal.withdrawEduPiAmbientMessagesForSession("session-1", {
    roots: { dataRoot: { root: "/data" } }, host, read: () => [{ ...entry, status: "pending" }],
    mark: (...args) => marked.push(args), now: () => "2026-09-24T02:00:00.000Z",
  }), { withdrawn: 0, abandoned: 1 });
  assert.deepEqual(marked, [["session-1", entry.messageRef, "2026-09-24T02:00:00.000Z", "abandoned"]]);
});

test("session deletion refuses uncertain Pi and removes accepted private outbox only after Core withdrawal", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-outbox-withdraw-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateDir = path.join(root, "state"), dataRoot = path.join(root, "data");
  fs.mkdirSync(stateDir, { mode: 0o700 }); fs.mkdirSync(dataRoot, { mode: 0o700 });
  const options = { stateDir, dataRoot };
  const sessionId = "session-outbox", clientRequestId = "request-outbox";
  const messageRef = `owner_message:${"f".repeat(64)}`;
  outbox.prepareEduPiPromptOutbox({ sessionId, clientRequestId, messageId: "prompt-outbox",
    occurredAt: "2026-10-10T08:00:00.000Z",
    command: { type: "prompt", message: "合成教师问题", clientRequestId },
    bindings: [{ domain: "teaching_preparation", ownerId: entry.ownerId, grantId: entry.grantId,
      grantVersion: 1, captureMessageId: "prompt-outbox", carrierId: "desktop.g1", planId: "plan.outbox" }] }, options);
  const host = { async call() { return { ok: true, result: { data_root_fingerprint: rootRef } }; },
    async callOwnerControl(operation) {
      assert.equal(operation, "owner_message");
      return { ok: true, result: { receipt: { action: "withdraw", message_ref: messageRef,
        revision: 2, owner_id: entry.ownerId, root_ref: rootRef, recorded_at: "2026-10-10T08:01:00.000Z",
        apply: false, live_authority: false, external_send: false } } };
    } };
  await assert.rejects(withdrawal.withdrawEduPiAmbientMessagesForSession(sessionId,
    { stateDir, roots: { dataRoot: { root: dataRoot } }, host }), { code: "ambient_message_withdrawal_unavailable" });
  assert.ok(outbox.readEduPiPromptOutbox(sessionId, clientRequestId, options));
  outbox.recordEduPiPromptOutboxRegistration(sessionId, clientRequestId, "teaching_preparation",
    { messageRef, producerEpoch: "a".repeat(64), sequence: 1, fencingGeneration: 1, instanceNonce: "nonce-1" }, options);
  ledger.prepareEduPiAmbientMessageBinding({ sessionId, messageId: "prompt-outbox", messageRef,
    ownerId: entry.ownerId, grantId: entry.grantId, captureGrantVersion: 1,
    occurredAt: "2026-10-10T08:00:00.000Z" }, options);
  ledger.confirmEduPiAmbientMessageBinding(sessionId, "prompt-outbox", messageRef, options);
  outbox.recordEduPiPromptOutboxCapture(sessionId, clientRequestId, "teaching_preparation", { captured: true, messageRef }, options);
  outbox.markEduPiPromptOutboxPiDispatching(sessionId, clientRequestId, options);
  outbox.markEduPiPromptOutboxPiAccepted(sessionId, clientRequestId, options);
  assert.deepEqual(await withdrawal.withdrawEduPiAmbientMessagesForSession(sessionId,
    { stateDir, roots: { dataRoot: { root: dataRoot } }, host }), { withdrawn: 1, abandoned: 0 });
  assert.equal(outbox.readEduPiPromptOutbox(sessionId, clientRequestId, options), null);
  assert.equal(ledger.readEduPiAmbientMessagesForSession(sessionId, options)[0].status, "withdrawn");
});
