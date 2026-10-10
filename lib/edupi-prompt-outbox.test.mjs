import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  prepareEduPiPromptOutbox,
  readEduPiPromptOutbox,
  listEduPiPromptOutbox,
  recordEduPiPromptOutboxRegistration,
  recordEduPiPromptOutboxCapture,
  markEduPiPromptOutboxPiDispatching,
  markEduPiPromptOutboxPiAccepted,
  markEduPiPromptOutboxPiUnknown,
  markEduPiPromptOutboxCancelled,
  markEduPiPromptOutboxSourceWithdrawn,
  removeEduPiPromptOutboxForSession,
  consumesEduPiPromptOutboxQuota,
} from "./edupi-prompt-outbox.ts";

const MESSAGE_REF_A = `owner_message:${"a".repeat(64)}`;
const MESSAGE_REF_B = `owner_message:${"b".repeat(64)}`;
const EPOCH = "c".repeat(64);

test("only unresolved prompts consume the recovery quota; terminal IDs remain reserved", () => {
  for (const stage of ["prepared", "registered", "captured", "pi_dispatching", "pi_unknown", "pi_unverified_withdrawn"]) {
    assert.equal(consumesEduPiPromptOutboxQuota(stage), true, stage);
  }
  for (const stage of ["pi_accepted", "pi_accepted_withdrawn", "cancelled"]) {
    assert.equal(consumesEduPiPromptOutboxQuota(stage), false, stage);
  }
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-prompt-outbox-test-"));
  const stateDir = path.join(root, "state");
  const dataRoot = path.join(root, "teacher");
  fs.mkdirSync(stateDir, { mode: 0o700 });
  fs.mkdirSync(dataRoot, { mode: 0o700 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, stateDir, dataRoot, options: { stateDir, dataRoot } };
}

function input(twoDomains = false) {
  const bindings = [{ domain: "teaching_preparation", ownerId: "owner-1", grantId: "grant-g1",
    grantVersion: 3, captureMessageId: "capture-g1", carrierId: "edupi.desktop.v1", planId: "plan.g1" }];
  if (twoDomains) bindings.push({ domain: "student_followup", ownerId: "owner-1", grantId: "grant-g2",
    grantVersion: 4, captureMessageId: "capture-g2", carrierId: "edupi.desktop.g2", planId: "plan.g2" });
  return { sessionId: "session-1", clientRequestId: "request-1", messageId: "message-1",
    occurredAt: "2026-10-10T08:00:00.000Z",
    command: { type: "prompt", message: "Synthetic teacher prompt", clientRequestId: "request-1",
      images: [{ type: "image", data: Buffer.from("image").toString("base64"), mimeType: "image/png" }] }, bindings };
}

function registration(messageRef) {
  return { messageRef, producerEpoch: EPOCH, sequence: 1, fencingGeneration: 2, instanceNonce: "nonce-1" };
}

function capturedRequest(request, options, ref = MESSAGE_REF_A) {
  prepareEduPiPromptOutbox(request, options);
  recordEduPiPromptOutboxRegistration(request.sessionId, request.clientRequestId,
    "teaching_preparation", registration(ref), options);
  recordEduPiPromptOutboxCapture(request.sessionId, request.clientRequestId,
    "teaching_preparation", { captured: true, messageRef: ref }, options);
}

function files(stateDir) {
  const parent = path.join(stateDir, "edupi-prompt-outbox-v1");
  const roots = fs.readdirSync(parent).filter((name) => /^[a-f0-9]{64}$/u.test(name));
  assert.equal(roots.length, 1);
  const outboxDir = path.join(parent, roots[0]);
  const entries = fs.readdirSync(outboxDir).filter((name) => name.endsWith(".entry"));
  assert.equal(entries.length, 1);
  const entryDir = path.join(outboxDir, entries[0]);
  return { outboxDir, entryDir, payloadFile: path.join(entryDir, "payload.json"),
    stateFile: path.join(entryDir, "state.json"), summaryFile: path.join(entryDir, "summary.json") };
}

test("persists the exact Pi command and private root-bound identity before dispatch", (t) => {
  const { stateDir, dataRoot, options } = fixture(t);
  const original = input();
  const prepared = prepareEduPiPromptOutbox(original, options);
  assert.equal(prepared.stage, "prepared");
  assert.deepEqual(prepared.command, original.command);
  assert.equal(prepared.bindings[0].grantVersion, 3);
  assert.equal(prepared.bindings[0].registration, null);
  assert.equal(prepared.bindings[0].messageRef, null);
  assert.deepEqual(readEduPiPromptOutbox(original.sessionId, original.clientRequestId, options), prepared);
  const storage = files(stateDir);
  if (process.platform !== "win32") {
    for (const target of [storage.outboxDir, storage.entryDir]) assert.equal(fs.statSync(target).mode & 0o077, 0);
    for (const target of [storage.payloadFile, storage.stateFile, storage.summaryFile]) assert.equal(fs.statSync(target).mode & 0o077, 0);
  }
  const summaries = listEduPiPromptOutbox(options);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].stage, "prepared");
  assert.ok(!JSON.stringify(summaries).includes(original.command.message));
  assert.ok(!JSON.stringify(summaries).includes(original.command.images[0].data));
  assert.ok(!JSON.stringify(summaries).includes("grant-g1"));
  const otherRoot = path.join(dataRoot, "other");
  fs.mkdirSync(otherRoot);
  assert.equal(readEduPiPromptOutbox(original.sessionId, original.clientRequestId, { stateDir, dataRoot: otherRoot }), null);
});

test("idempotent replay preserves original prompt and refuses altered text, images, and binding", (t) => {
  const { options } = fixture(t);
  const original = input();
  const first = prepareEduPiPromptOutbox(original, options);
  assert.deepEqual(prepareEduPiPromptOutbox(original, options), first);
  for (const changed of [
    { ...original, command: { ...original.command, message: "changed" } },
    { ...original, command: { ...original.command, images: [{ ...original.command.images[0], data: "YQ==" }] } },
    { ...original, bindings: [{ ...original.bindings[0], grantVersion: 5 }] },
  ]) assert.throws(() => prepareEduPiPromptOutbox(changed, options), { code: "prompt_outbox_conflict" });
});

test("two domains can register and capture independently, but Pi dispatch waits for both", (t) => {
  const { options } = fixture(t);
  const request = input(true);
  prepareEduPiPromptOutbox(request, options);
  let state = recordEduPiPromptOutboxRegistration(request.sessionId, request.clientRequestId,
    "teaching_preparation", registration(MESSAGE_REF_A), options);
  assert.equal(state.stage, "prepared");
  state = recordEduPiPromptOutboxCapture(request.sessionId, request.clientRequestId,
    "teaching_preparation", { captured: true, messageRef: MESSAGE_REF_A }, options);
  assert.equal(state.stage, "prepared");
  assert.throws(() => markEduPiPromptOutboxPiDispatching(request.sessionId, request.clientRequestId, options),
    { code: "prompt_outbox_conflict" });
  state = recordEduPiPromptOutboxRegistration(request.sessionId, request.clientRequestId,
    "student_followup", registration(MESSAGE_REF_B), options);
  assert.equal(state.stage, "registered");
  assert.throws(() => recordEduPiPromptOutboxCapture(request.sessionId, request.clientRequestId,
    "student_followup", { captured: true, messageRef: MESSAGE_REF_A }, options), { code: "prompt_outbox_conflict" });
  state = recordEduPiPromptOutboxCapture(request.sessionId, request.clientRequestId,
    "student_followup", { captured: true, messageRef: MESSAGE_REF_B }, options);
  assert.equal(state.stage, "captured");
  assert.deepEqual(state.bindings.map((binding) => binding.messageRef), [MESSAGE_REF_B, MESSAGE_REF_A]);
  assert.equal(markEduPiPromptOutboxPiDispatching(request.sessionId, request.clientRequestId, options).stage, "pi_dispatching");
  assert.equal(markEduPiPromptOutboxPiUnknown(request.sessionId, request.clientRequestId, options).stage, "pi_unknown");
  assert.equal(readEduPiPromptOutbox(request.sessionId, request.clientRequestId, options)?.stage, "pi_unknown");
  assert.throws(() => markEduPiPromptOutboxPiDispatching(request.sessionId, request.clientRequestId, options),
    { code: "prompt_outbox_conflict" });
  assert.equal(markEduPiPromptOutboxPiAccepted(request.sessionId, request.clientRequestId, options).stage, "pi_accepted");
});

test("registration and capture require exact receipts and are idempotent after persisted reread", (t) => {
  const { options } = fixture(t);
  const request = input();
  prepareEduPiPromptOutbox(request, options);
  const registered = recordEduPiPromptOutboxRegistration(request.sessionId, request.clientRequestId,
    "teaching_preparation", registration(MESSAGE_REF_A), options);
  assert.equal(registered.stage, "registered");
  assert.deepEqual(recordEduPiPromptOutboxRegistration(request.sessionId, request.clientRequestId,
    "teaching_preparation", registration(MESSAGE_REF_A), options), registered);
  const afterRestart = { ...registration(MESSAGE_REF_A), fencingGeneration: 3, instanceNonce: "nonce-2" };
  const refreshed = recordEduPiPromptOutboxRegistration(request.sessionId, request.clientRequestId,
    "teaching_preparation", afterRestart, options);
  assert.equal(refreshed.stage, "registered");
  assert.deepEqual(refreshed.bindings[0].registration, afterRestart);
  assert.throws(() => recordEduPiPromptOutboxRegistration(request.sessionId, request.clientRequestId,
    "teaching_preparation", { ...afterRestart, producerEpoch: "d".repeat(64) }, options), { code: "prompt_outbox_conflict" });
  assert.throws(() => recordEduPiPromptOutboxRegistration(request.sessionId, request.clientRequestId,
    "teaching_preparation", registration(MESSAGE_REF_B), options), { code: "prompt_outbox_conflict" });
  assert.throws(() => recordEduPiPromptOutboxCapture(request.sessionId, request.clientRequestId,
    "teaching_preparation", { captured: false, messageRef: MESSAGE_REF_A }, options), { code: "prompt_outbox_invalid" });
  const captured = recordEduPiPromptOutboxCapture(request.sessionId, request.clientRequestId,
    "teaching_preparation", { captured: true, messageRef: MESSAGE_REF_A }, options);
  assert.equal(captured.stage, "captured");
  assert.deepEqual(recordEduPiPromptOutboxCapture(request.sessionId, request.clientRequestId,
    "teaching_preparation", { captured: true, messageRef: MESSAGE_REF_A }, options), captured);
});

test("tampered payload and symlinked state are rejected without returning teacher content", (t) => {
  const { stateDir, options } = fixture(t);
  const request = input();
  prepareEduPiPromptOutbox(request, options);
  const storage = files(stateDir);
  const payload = JSON.parse(fs.readFileSync(storage.payloadFile, "utf8"));
  payload.command.message = "tampered";
  fs.writeFileSync(storage.payloadFile, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  assert.throws(() => readEduPiPromptOutbox(request.sessionId, request.clientRequestId, options),
    { code: "prompt_outbox_unavailable" });
  assert.throws(() => listEduPiPromptOutbox(options), { code: "prompt_outbox_unavailable" });
  fs.writeFileSync(storage.payloadFile, `${JSON.stringify({ ...payload, command: request.command })}\n`, { mode: 0o600 });
  if (process.platform !== "win32") {
    const renamed = `${storage.stateFile}.held`;
    fs.renameSync(storage.stateFile, renamed);
    fs.symlinkSync(renamed, storage.stateFile);
    assert.throws(() => readEduPiPromptOutbox(request.sessionId, request.clientRequestId, options),
      { code: "prompt_outbox_unavailable" });
  }
});

test("private outbox works within an owner-controlled readable config root", (t) => {
  const { stateDir, options } = fixture(t);
  if (process.platform === "win32") return;
  fs.chmodSync(stateDir, 0o755);
  prepareEduPiPromptOutbox(input(), options);
  assert.equal(readEduPiPromptOutbox("session-1", "request-1", options)?.stage, "prepared");
  assert.equal(fs.statSync(path.join(stateDir, "edupi-prompt-outbox-v1")).mode & 0o077, 0);
});

test("switching an isolated Core data root cannot make the other root's outbox unreadable", (t) => {
  const { stateDir, dataRoot, options } = fixture(t);
  const secondRoot = path.join(path.dirname(dataRoot), "data-second");
  fs.mkdirSync(secondRoot, { mode: 0o700 });
  const other = { stateDir, dataRoot: secondRoot };
  prepareEduPiPromptOutbox(input(), options);
  prepareEduPiPromptOutbox({ ...input(), command: { ...input().command, message: "第二隔离根" } }, other);
  assert.equal(listEduPiPromptOutbox(options).length, 1);
  assert.equal(listEduPiPromptOutbox(other).length, 1);
  assert.equal(readEduPiPromptOutbox("session-1", "request-1", options)?.command.message, "Synthetic teacher prompt");
  assert.equal(readEduPiPromptOutbox("session-1", "request-1", other)?.command.message, "第二隔离根");
});

test("image-only commands stay exact; malformed or oversized requests fail closed", (t) => {
  const { options } = fixture(t);
  const request = input();
  request.command.message = "";
  assert.equal(prepareEduPiPromptOutbox(request, options).command.message, "");
  const second = { ...input(), clientRequestId: "request-2", command: { ...input().command, clientRequestId: "request-2", images: [] } };
  second.command.message = "";
  assert.throws(() => prepareEduPiPromptOutbox(second, options), { code: "prompt_outbox_invalid" });
  const tooLong = { ...input(), clientRequestId: "request-3", command: { ...input().command,
    clientRequestId: "request-3", message: "x".repeat(4001) } };
  assert.throws(() => prepareEduPiPromptOutbox(tooLong, options), { code: "prompt_outbox_invalid" });
  const tooMany = { ...input(), clientRequestId: "request-4", command: { ...input().command,
    clientRequestId: "request-4", images: Array.from({ length: 11 }, () => ({ type: "image", data: "YQ==", mimeType: "image/png" })) } };
  assert.throws(() => prepareEduPiPromptOutbox(tooMany, options), { code: "prompt_outbox_invalid" });
});

test("entry directory is complete at commit; missing or replaced state fails closed", (t) => {
  const { stateDir, options } = fixture(t);
  const request = input();
  assert.equal(readEduPiPromptOutbox(request.sessionId, request.clientRequestId, options), null);
  prepareEduPiPromptOutbox(request, options);
  const storage = files(stateDir);
  assert.deepEqual(fs.readdirSync(storage.entryDir).sort(), ["payload.json", "state.json", "summary.json"]);
  fs.unlinkSync(storage.stateFile);
  assert.throws(() => readEduPiPromptOutbox(request.sessionId, request.clientRequestId, options),
    { code: "prompt_outbox_unavailable" });
  assert.throws(() => prepareEduPiPromptOutbox(request, options), { code: "prompt_outbox_unavailable" });
});

test("listing a large image request reads summary and state but not the payload", (t) => {
  const { options } = fixture(t);
  const request = input();
  request.command.images[0].data = Buffer.alloc(512 * 1024, 7).toString("base64");
  prepareEduPiPromptOutbox(request, options);
  const originalRead = fs.readFileSync;
  let attemptedLargeRead = false;
  fs.readFileSync = function (file, ...args) {
    if (typeof file === "number" && fs.fstatSync(file).size > 100 * 1024) {
      attemptedLargeRead = true;
      throw new Error("list attempted to read image payload");
    }
    return originalRead.call(this, file, ...args);
  };
  try {
    assert.equal(listEduPiPromptOutbox(options)[0].stage, "prepared");
  } finally {
    fs.readFileSync = originalRead;
  }
  assert.equal(attemptedLargeRead, false);
  assert.equal(readEduPiPromptOutbox(request.sessionId, request.clientRequestId, options)?.command.images[0].data,
    request.command.images[0].data);
});

test("summary tampering or omission blocks list and action reads", (t) => {
  const { stateDir, options } = fixture(t);
  const request = input();
  prepareEduPiPromptOutbox(request, options);
  const storage = files(stateDir);
  const summary = JSON.parse(fs.readFileSync(storage.summaryFile, "utf8"));
  summary.sessionId = "other-session";
  fs.writeFileSync(storage.summaryFile, `${JSON.stringify(summary)}\n`, { mode: 0o600 });
  assert.throws(() => listEduPiPromptOutbox(options), { code: "prompt_outbox_unavailable" });
  assert.throws(() => readEduPiPromptOutbox(request.sessionId, request.clientRequestId, options),
    { code: "prompt_outbox_unavailable" });
  fs.unlinkSync(storage.summaryFile);
  assert.throws(() => listEduPiPromptOutbox(options), { code: "prompt_outbox_unavailable" });
  assert.throws(() => prepareEduPiPromptOutbox(request, options), { code: "prompt_outbox_unavailable" });
});

test("session removal refuses pending and uncertain requests without deleting anything", (t) => {
  const { options } = fixture(t);
  const pending = input();
  prepareEduPiPromptOutbox(pending, options);
  assert.throws(() => removeEduPiPromptOutboxForSession(pending.sessionId, options),
    { code: "prompt_outbox_conflict" });
  assert.equal(readEduPiPromptOutbox(pending.sessionId, pending.clientRequestId, options)?.stage, "prepared");
  const uncertain = { ...input(), sessionId: "session-2", clientRequestId: "request-2",
    command: { ...input().command, clientRequestId: "request-2" } };
  capturedRequest(uncertain, options, MESSAGE_REF_B);
  markEduPiPromptOutboxPiDispatching(uncertain.sessionId, uncertain.clientRequestId, options);
  markEduPiPromptOutboxPiUnknown(uncertain.sessionId, uncertain.clientRequestId, options);
  assert.throws(() => removeEduPiPromptOutboxForSession(uncertain.sessionId, options),
    { code: "prompt_outbox_conflict" });
  assert.equal(readEduPiPromptOutbox(uncertain.sessionId, uncertain.clientRequestId, options)?.stage, "pi_unknown");
});

test("session removal deletes only exact accepted entries and preserves another session", (t) => {
  const { stateDir, options } = fixture(t);
  const first = input();
  const second = { ...input(), sessionId: "session-2", clientRequestId: "request-2",
    command: { ...input().command, clientRequestId: "request-2" } };
  for (const [request, ref] of [[first, MESSAGE_REF_A], [second, MESSAGE_REF_B]]) {
    capturedRequest(request, options, ref);
    markEduPiPromptOutboxPiDispatching(request.sessionId, request.clientRequestId, options);
    markEduPiPromptOutboxPiAccepted(request.sessionId, request.clientRequestId, options);
  }
  assert.equal(removeEduPiPromptOutboxForSession(first.sessionId, options), 1);
  assert.equal(readEduPiPromptOutbox(first.sessionId, first.clientRequestId, options), null);
  assert.equal(readEduPiPromptOutbox(second.sessionId, second.clientRequestId, options)?.stage, "pi_accepted");
  assert.equal(removeEduPiPromptOutboxForSession(first.sessionId, options), 0);
  assert.deepEqual(listEduPiPromptOutbox(options).map((summary) => summary.sessionId), [second.sessionId]);
  assert.equal(fs.readdirSync(files(stateDir).outboxDir).filter((name) => name.endsWith(".entry")).length, 1);
});

test("session removal refuses tampered accepted entry", (t) => {
  const { stateDir, options } = fixture(t);
  const request = input();
  capturedRequest(request, options);
  markEduPiPromptOutboxPiDispatching(request.sessionId, request.clientRequestId, options);
  markEduPiPromptOutboxPiAccepted(request.sessionId, request.clientRequestId, options);
  const storage = files(stateDir);
  const payload = JSON.parse(fs.readFileSync(storage.payloadFile, "utf8"));
  payload.command.message = "altered after acceptance";
  fs.writeFileSync(storage.payloadFile, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  assert.throws(() => removeEduPiPromptOutboxForSession(request.sessionId, options),
    { code: "prompt_outbox_unavailable" });
  assert.equal(fs.existsSync(storage.entryDir), true);
});

test("cancellation requires an exact Core settlement proof for every domain", (t) => {
  const { options } = fixture(t);
  const request = input(true);
  prepareEduPiPromptOutbox(request, options);
  recordEduPiPromptOutboxRegistration(request.sessionId, request.clientRequestId,
    "teaching_preparation", registration(MESSAGE_REF_A), options);
  assert.throws(() => markEduPiPromptOutboxCancelled(request.sessionId, request.clientRequestId,
    [{ domain: "teaching_preparation", messageRef: MESSAGE_REF_A, status: "sealed_absent" }], options),
  { code: "prompt_outbox_conflict" });
  assert.throws(() => markEduPiPromptOutboxCancelled(request.sessionId, request.clientRequestId,
    [{ domain: "teaching_preparation", messageRef: MESSAGE_REF_A, status: "sealed_absent" },
      { domain: "student_followup", messageRef: MESSAGE_REF_B, status: "sealed_absent" }], options),
  { code: "prompt_outbox_conflict" });
  recordEduPiPromptOutboxRegistration(request.sessionId, request.clientRequestId,
    "student_followup", registration(MESSAGE_REF_B), options);
  recordEduPiPromptOutboxCapture(request.sessionId, request.clientRequestId,
    "teaching_preparation", { captured: true, messageRef: MESSAGE_REF_A }, options);
  assert.throws(() => markEduPiPromptOutboxCancelled(request.sessionId, request.clientRequestId,
    [{ domain: "teaching_preparation", messageRef: MESSAGE_REF_A, status: "sealed_absent" },
      { domain: "student_followup", messageRef: MESSAGE_REF_B, status: "sealed_absent" }], options),
  { code: "prompt_outbox_conflict" });
  const proofs = [{ domain: "student_followup", messageRef: MESSAGE_REF_B, status: "sealed_absent" },
    { domain: "teaching_preparation", messageRef: MESSAGE_REF_A, status: "withdrawn" }];
  const cancelled = markEduPiPromptOutboxCancelled(request.sessionId, request.clientRequestId, proofs, options);
  assert.equal(cancelled.stage, "cancelled");
  assert.deepEqual(cancelled.cancellationProofs, [proofs[0], proofs[1]]);
  assert.deepEqual(readEduPiPromptOutbox(request.sessionId, request.clientRequestId, options)?.cancellationProofs,
    cancelled.cancellationProofs);
  assert.equal(listEduPiPromptOutbox(options)[0].stage, "cancelled");
  assert.deepEqual(markEduPiPromptOutboxCancelled(request.sessionId, request.clientRequestId, proofs, options), cancelled);
  assert.throws(() => markEduPiPromptOutboxPiDispatching(request.sessionId, request.clientRequestId, options),
    { code: "prompt_outbox_conflict" });
});

test("Pi uncertainty and acceptance cannot be relabelled as cancellation", (t) => {
  const { options } = fixture(t);
  const request = input();
  capturedRequest(request, options);
  markEduPiPromptOutboxPiDispatching(request.sessionId, request.clientRequestId, options);
  const proofs = [{ domain: "teaching_preparation", messageRef: MESSAGE_REF_A, status: "withdrawn" }];
  assert.throws(() => markEduPiPromptOutboxCancelled(request.sessionId, request.clientRequestId, proofs, options),
    { code: "prompt_outbox_conflict" });
  markEduPiPromptOutboxPiUnknown(request.sessionId, request.clientRequestId, options);
  assert.throws(() => markEduPiPromptOutboxCancelled(request.sessionId, request.clientRequestId, proofs, options),
    { code: "prompt_outbox_conflict" });
  markEduPiPromptOutboxPiAccepted(request.sessionId, request.clientRequestId, options);
  assert.throws(() => markEduPiPromptOutboxCancelled(request.sessionId, request.clientRequestId, proofs, options),
    { code: "prompt_outbox_conflict" });
  assert.equal(readEduPiPromptOutbox(request.sessionId, request.clientRequestId, options)?.stage, "pi_accepted");
});

test("Core withdrawal proof can resolve a capture whose Desktop response was lost", (t) => {
  const { options } = fixture(t);
  const request = input();
  prepareEduPiPromptOutbox(request, options);
  recordEduPiPromptOutboxRegistration(request.sessionId, request.clientRequestId,
    "teaching_preparation", registration(MESSAGE_REF_A), options);
  assert.equal(readEduPiPromptOutbox(request.sessionId, request.clientRequestId, options)?.bindings[0].captured, false);
  const result = markEduPiPromptOutboxCancelled(request.sessionId, request.clientRequestId,
    [{ domain: "teaching_preparation", messageRef: MESSAGE_REF_A, status: "withdrawn" }], options);
  assert.equal(result.stage, "cancelled");
  assert.equal(result.bindings[0].captured, false);
  assert.equal(result.cancellationProofs[0].status, "withdrawn");
});

test("session removal deletes terminal cancelled entry without touching accepted other session", (t) => {
  const { options } = fixture(t);
  const cancelled = input();
  const accepted = { ...input(), sessionId: "session-2", clientRequestId: "request-2",
    command: { ...input().command, clientRequestId: "request-2" } };
  prepareEduPiPromptOutbox(cancelled, options);
  recordEduPiPromptOutboxRegistration(cancelled.sessionId, cancelled.clientRequestId,
    "teaching_preparation", registration(MESSAGE_REF_A), options);
  markEduPiPromptOutboxCancelled(cancelled.sessionId, cancelled.clientRequestId,
    [{ domain: "teaching_preparation", messageRef: MESSAGE_REF_A, status: "sealed_absent" }], options);
  capturedRequest(accepted, options, MESSAGE_REF_B);
  markEduPiPromptOutboxPiDispatching(accepted.sessionId, accepted.clientRequestId, options);
  markEduPiPromptOutboxPiAccepted(accepted.sessionId, accepted.clientRequestId, options);
  assert.equal(removeEduPiPromptOutboxForSession(cancelled.sessionId, options), 1);
  assert.equal(readEduPiPromptOutbox(cancelled.sessionId, cancelled.clientRequestId, options), null);
  assert.equal(readEduPiPromptOutbox(accepted.sessionId, accepted.clientRequestId, options)?.stage, "pi_accepted");
});

test("uncertain Pi dispatch stays unverified after exact Core withdrawals", (t) => {
  const { options } = fixture(t);
  const request = input(true);
  prepareEduPiPromptOutbox(request, options);
  for (const [domain, ref] of [["teaching_preparation", MESSAGE_REF_A], ["student_followup", MESSAGE_REF_B]]) {
    recordEduPiPromptOutboxRegistration(request.sessionId, request.clientRequestId, domain, registration(ref), options);
    recordEduPiPromptOutboxCapture(request.sessionId, request.clientRequestId, domain,
      { captured: true, messageRef: ref }, options);
  }
  assert.throws(() => markEduPiPromptOutboxSourceWithdrawn(request.sessionId, request.clientRequestId,
    [{ domain: "teaching_preparation", messageRef: MESSAGE_REF_A, status: "withdrawn" },
      { domain: "student_followup", messageRef: MESSAGE_REF_B, status: "withdrawn" }], options),
  { code: "prompt_outbox_conflict" });
  markEduPiPromptOutboxPiDispatching(request.sessionId, request.clientRequestId, options);
  markEduPiPromptOutboxPiUnknown(request.sessionId, request.clientRequestId, options);
  assert.throws(() => markEduPiPromptOutboxSourceWithdrawn(request.sessionId, request.clientRequestId,
    [{ domain: "teaching_preparation", messageRef: MESSAGE_REF_A, status: "withdrawn" }], options),
  { code: "prompt_outbox_conflict" });
  assert.throws(() => markEduPiPromptOutboxSourceWithdrawn(request.sessionId, request.clientRequestId,
    [{ domain: "teaching_preparation", messageRef: MESSAGE_REF_A, status: "withdrawn" },
      { domain: "student_followup", messageRef: MESSAGE_REF_B, status: "sealed_absent" }], options),
  { code: "prompt_outbox_invalid" });
  assert.throws(() => markEduPiPromptOutboxSourceWithdrawn(request.sessionId, request.clientRequestId,
    [{ domain: "teaching_preparation", messageRef: MESSAGE_REF_A, status: "withdrawn" },
      { domain: "student_followup", messageRef: MESSAGE_REF_A, status: "withdrawn" }], options),
  { code: "prompt_outbox_conflict" });
  const proofs = [{ domain: "student_followup", messageRef: MESSAGE_REF_B, status: "withdrawn" },
    { domain: "teaching_preparation", messageRef: MESSAGE_REF_A, status: "withdrawn" }];
  const withdrawn = markEduPiPromptOutboxSourceWithdrawn(request.sessionId, request.clientRequestId, proofs, options);
  assert.equal(withdrawn.stage, "pi_unverified_withdrawn");
  assert.deepEqual(withdrawn.cancellationProofs, proofs);
  assert.equal(readEduPiPromptOutbox(request.sessionId, request.clientRequestId, options)?.stage, "pi_unverified_withdrawn");
  assert.equal(listEduPiPromptOutbox(options)[0].stage, "pi_unverified_withdrawn");
  assert.deepEqual(markEduPiPromptOutboxSourceWithdrawn(request.sessionId, request.clientRequestId, proofs, options), withdrawn);
  assert.throws(() => markEduPiPromptOutboxPiDispatching(request.sessionId, request.clientRequestId, options),
    { code: "prompt_outbox_conflict" });
  assert.equal(markEduPiPromptOutboxPiAccepted(request.sessionId, request.clientRequestId, options).stage,
    "pi_accepted_withdrawn");
  assert.equal(readEduPiPromptOutbox(request.sessionId, request.clientRequestId, options)?.cancellationProofs?.length, 2);
  assert.throws(() => markEduPiPromptOutboxPiUnknown(request.sessionId, request.clientRequestId, options),
    { code: "prompt_outbox_conflict" });
});

test("session deletion preserves withdrawn sources until exact Pi delivery is verified", (t) => {
  const { options } = fixture(t);
  const withdrawn = input();
  capturedRequest(withdrawn, options);
  markEduPiPromptOutboxPiDispatching(withdrawn.sessionId, withdrawn.clientRequestId, options);
  markEduPiPromptOutboxSourceWithdrawn(withdrawn.sessionId, withdrawn.clientRequestId,
    [{ domain: "teaching_preparation", messageRef: MESSAGE_REF_A, status: "withdrawn" }], options);
  const other = { ...input(), sessionId: "session-2", clientRequestId: "request-2",
    command: { ...input().command, clientRequestId: "request-2" } };
  capturedRequest(other, options, MESSAGE_REF_B);
  markEduPiPromptOutboxPiDispatching(other.sessionId, other.clientRequestId, options);
  markEduPiPromptOutboxPiAccepted(other.sessionId, other.clientRequestId, options);
  assert.throws(() => removeEduPiPromptOutboxForSession(withdrawn.sessionId, options),
    { code: "prompt_outbox_conflict" });
  assert.equal(readEduPiPromptOutbox(withdrawn.sessionId, withdrawn.clientRequestId, options)?.stage, "pi_unverified_withdrawn");
  assert.equal(readEduPiPromptOutbox(other.sessionId, other.clientRequestId, options)?.stage, "pi_accepted");
  markEduPiPromptOutboxPiAccepted(withdrawn.sessionId, withdrawn.clientRequestId, options);
  assert.equal(removeEduPiPromptOutboxForSession(withdrawn.sessionId, options), 1);
  assert.equal(readEduPiPromptOutbox(withdrawn.sessionId, withdrawn.clientRequestId, options), null);
});
