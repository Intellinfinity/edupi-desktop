import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const withdrawal = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-message-withdrawal.ts");
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

test("a pending owner_identity_mismatch cannot certify absence or permit session deletion", async () => {
  const marked = [];
  const host = {
    async call() { return { ok: true, result: { data_root_fingerprint: rootRef } }; },
    async callOwnerControl() { return { ok: false, result: null, error_code: "owner_identity_mismatch" }; },
  };
  await assert.rejects(withdrawal.withdrawEduPiAmbientMessagesForSession("session-1", {
    roots: { dataRoot: { root: "/data" } }, host, read: () => [{ ...entry, status: "pending" }],
    mark: (...args) => marked.push(args),
  }), (error) => error?.code === "ambient_message_withdrawal_unavailable");
  assert.deepEqual(marked, [], "the pending entry remains available for exact Core settlement later");
});

test("a rejected pending withdrawal survives a real ledger write and fresh read", async () => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-delete-pending-")));
  const dataRoot = path.join(temporary, "data"), stateDir = path.join(temporary, "state");
  fs.mkdirSync(dataRoot, { mode: 0o700 });
  fs.mkdirSync(stateDir, { mode: 0o700 });
  try {
    ledger.prepareEduPiAmbientMessageBinding(entry, { stateDir, dataRoot });
    const actualRootRef = `sha256:${crypto.createHash("sha256").update(fs.realpathSync(dataRoot)).digest("hex")}`;
    const host = { async call() { return { ok: true, result: { data_root_fingerprint: actualRootRef } }; },
      async callOwnerControl() { return { ok: false, result: null, error_code: "owner_identity_mismatch" }; } };
    await assert.rejects(withdrawal.withdrawEduPiAmbientMessagesForSession(entry.sessionId, {
      stateDir, roots: { dataRoot: { root: dataRoot } }, host,
    }), (error) => error?.code === "ambient_message_withdrawal_unavailable");
    assert.equal(ledger.readWithdrawableEduPiAmbientMessages(entry.sessionId, { stateDir, dataRoot })[0]?.status, "pending");
    const file = path.join(stateDir, "edupi-ambient-message-ledger.json");
    const historical = JSON.parse(fs.readFileSync(file, "utf8"));
    historical.revision += 1;
    historical.entries[0].status = "abandoned";
    historical.entries[0].withdrawn_at = "2026-09-24T02:00:00.000Z";
    fs.writeFileSync(file, `${JSON.stringify(historical, null, 2)}\n`, { mode: 0o600 });
    await assert.rejects(withdrawal.withdrawEduPiAmbientMessagesForSession(entry.sessionId, {
      stateDir, roots: { dataRoot: { root: dataRoot } }, host,
    }), (error) => error?.code === "ambient_message_withdrawal_unavailable");
    assert.equal(ledger.readWithdrawableEduPiAmbientMessages(entry.sessionId, { stateDir, dataRoot })[0]?.status, "abandoned",
      "an older weak abandonment marker cannot be used to delete a still-unknown conversation");
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
