import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { registerAndCapturePrompt, settleRegisteredPrompt } = await jiti.import("./edupi-registered-prompt.ts");
const { predictEduPiOwnerMessageRef } = await jiti.import("./edupi-ambient-message-runtime.ts");

const rootRef = `sha256:${"a".repeat(64)}`;
const ownerId = `owner_${"b".repeat(32)}`;
const occurredAt = "2026-10-10T08:00:00.000Z";
const input = { rootRef, grantId: "grant-1", sessionId: "session-1", messageId: "prompt-1",
  text: "准备下周的数学课", occurredAt, domain: "teaching_preparation",
  carrierId: "desktop.install.1", planId: "desktop.plan.1" };
const messageRef = predictEduPiOwnerMessageRef(rootRef, ownerId, input.messageId);

function host(events, captureFailure = false) {
  return {
    async call(operation) {
      assert.equal(operation, "owner_read");
      events.push("owner_read");
      return { ok: true, result: { root_ref: rootRef, owner: { id: ownerId },
        grants: [{ id: "grant-1", version: 2, status: "active", ends_at: "2026-10-17T00:00:00.000Z" }] } };
    },
    async callOwnerControl(operation, payload) {
      events.push(operation);
      if (operation === "owner_message_register") return { ok: true, result: {
        version: 1, status: "registered", root_ref: rootRef, owner_id: ownerId,
        grant_id: "grant-1", grant_version: 2, source_ref: `conversation:${"c".repeat(64)}`,
        message_ref: messageRef, occurred_at: occurredAt, carrier_id: input.carrierId,
        plan_id: input.planId, producer_epoch: "d".repeat(64), sequence: 1,
        fencing_generation: 1, instance_nonce: "nonce-1", replayed: false,
        apply: false, live_authority: false, model_execute: false, external_send: false,
      } };
      assert.equal(operation, "owner_message");
      assert.deepEqual(payload.registration, { carrier_id: input.carrierId, plan_id: input.planId,
        producer_epoch: "d".repeat(64), sequence: 1 });
      if (captureFailure) return { ok: false, error_code: "owner_gate_pending" };
      return { ok: true, result: { receipt: { action: "capture", message_ref: messageRef, revision: 1,
        owner_id: ownerId, root_ref: rootRef, capture_grant_version: 2,
        source_ref: `conversation:${"c".repeat(64)}`, received_at: occurredAt, recorded_at: occurredAt,
        sender_kind: "local_owner_authenticated", apply: false, live_authority: false, external_send: false }, replayed: false } };
    },
  };
}

test("registration and affirmative capture are persisted before caller may dispatch Pi", async () => {
  const events = [];
  const proof = await registerAndCapturePrompt(host(events), input, {
    onBound: () => events.push("persist_bound"),
    onRegistered: () => events.push("persist_registered"),
    onCaptured: () => events.push("persist_captured"),
  });
  assert.equal(proof.messageRef, messageRef);
  assert.deepEqual(events, ["owner_read", "persist_bound", "owner_message_register", "persist_registered", "owner_message", "persist_captured"]);
});

test("missing capture receipt never advances to captured or Pi dispatch", async () => {
  const events = [];
  await assert.rejects(registerAndCapturePrompt(host(events, true), input, {
    onBound: () => events.push("persist_bound"),
    onRegistered: () => events.push("persist_registered"),
    onCaptured: () => events.push("persist_captured"),
  }), /owner_message_unavailable/);
  assert.equal(events.includes("persist_captured"), false);
});

test("a persisted owner binding survives restart without selecting a new grant", async () => {
  const events = [];
  const binding = { ownerId, grantId: "grant-1", grantVersion: 2 };
  const client = host(events);
  client.call = async () => { throw new Error("must not reread a different owner binding"); };
  await registerAndCapturePrompt(client, { ...input, previousBinding: binding }, {
    onBound: () => { throw new Error("must not rewrite binding"); },
    onRegistered: () => events.push("persist_registered"),
    onCaptured: () => events.push("persist_captured"),
  });
  assert.deepEqual(events, ["owner_message_register", "persist_registered", "owner_message", "persist_captured"]);
});

test("exact fenced settlement seals an unclaimed plan without Pi dispatch", async () => {
  const calls = [];
  const binding = { ownerId, grantId: "grant-1", grantVersion: 2 };
  const registration = { carrier_id: input.carrierId, plan_id: input.planId,
    producer_epoch: "d".repeat(64), sequence: 1 };
  const runtime = {
    async call() { return { ok: true, result: { data_root_fingerprint: rootRef,
      fencing_generation: 3, instance_nonce: "nonce-3" } }; },
    async callOwnerControl(operation, payload) {
      calls.push(operation);
      assert.equal(operation, "owner_message_settle");
      assert.equal(payload.expected_fencing_generation, 3);
      assert.equal(payload.expected_instance_nonce, "nonce-3");
      assert.deepEqual(payload.registration, registration);
      return { ok: true, result: { version: 1, status: "sealed_absent", receipt: null,
        root_ref: rootRef, owner_id: ownerId, grant_id: "grant-1", grant_version: 2,
        message_ref: messageRef, occurred_at: occurredAt, fencing_generation: 3,
        instance_nonce: "nonce-3", apply: false, live_authority: false,
        model_execute: false, external_send: false } };
    },
  };
  assert.deepEqual(await settleRegisteredPrompt(runtime, { ...input,
    previousBinding: binding, previousRegistration: registration }, { onRegistered() { throw new Error("must not register"); } }),
  { status: "sealed_absent", messageRef, recordedAt: null });
  assert.deepEqual(calls, ["owner_message_settle"]);
});

test("captured settlement requires a verified withdrawal before cancellation completes", async () => {
  const binding = { ownerId, grantId: "grant-1", grantVersion: 2 };
  const registration = { carrier_id: input.carrierId, plan_id: input.planId,
    producer_epoch: "d".repeat(64), sequence: 1 };
  const calls = [];
  const runtime = {
    async call() { return { ok: true, result: { data_root_fingerprint: rootRef,
      fencing_generation: 3, instance_nonce: "nonce-3" } }; },
    async callOwnerControl(operation) {
      calls.push(operation);
      if (operation === "owner_message_settle") return { ok: true, result: { version: 1, status: "captured",
        root_ref: rootRef, owner_id: ownerId, grant_id: "grant-1", grant_version: 2,
        message_ref: messageRef, occurred_at: occurredAt, fencing_generation: 3,
        instance_nonce: "nonce-3", apply: false, live_authority: false,
        model_execute: false, external_send: false } };
      return { ok: true, result: { receipt: { action: "withdraw", message_ref: messageRef,
        root_ref: rootRef, owner_id: ownerId, revision: 2, recorded_at: occurredAt,
        apply: false, live_authority: false, external_send: false } } };
    },
  };
  assert.deepEqual(await settleRegisteredPrompt(runtime, { ...input,
    previousBinding: binding, previousRegistration: registration }, { onRegistered() {} }),
  { status: "withdrawn", messageRef, recordedAt: occurredAt });
  assert.deepEqual(calls, ["owner_message_settle", "owner_message"]);
});
