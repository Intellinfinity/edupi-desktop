import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const recovery = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-message-recovery.ts");
const ambient = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-message-runtime.ts");
const rootRef = `sha256:${"a".repeat(64)}`;
const messageRef = ambient.predictEduPiOwnerMessageRef(rootRef, "owner-1", "prompt-stable");
const entry = { sessionId: "session-1", messageId: "prompt-stable", messageRef,
  ownerId: "owner-1", grantId: "grant-1", captureGrantVersion: 2,
  occurredAt: "2026-10-08T00:00:00.000Z", status: "outcome_unknown", withdrawnAt: null };

test("only a fenced, exact Core seal closes a reserved-but-absent capture", async () => {
  const pending = { ...entry, status: "pending" };
  const health = { lifecycle: "ready", data_root_fingerprint: rootRef, fencing_generation: 7,
    instance_nonce: "nonce-7", capabilities: { supported_operations: ["owner_message_settle"] } };
  const sourceRef = `conversation:${crypto.createHash("sha256")
    .update(ambient.eduPiAmbientConversationId("teaching_preparation")).digest("hex")}`;
  const sealed = { version: 1, status: "sealed_absent", root_ref: rootRef, owner_id: pending.ownerId,
    grant_id: pending.grantId, grant_version: pending.captureGrantVersion, source_ref: sourceRef,
    message_ref: pending.messageRef, occurred_at: pending.occurredAt, fencing_generation: 7,
    instance_nonce: "nonce-7", receipt: null, replayed: false,
    apply: false, live_authority: false, model_execute: false, external_send: false };
  const calls = [];
  const host = { async callOwnerControl(operation, payload) {
    calls.push([operation, payload]);
    return { ok: true, result: sealed };
  } };
  assert.equal(await recovery.settleExactEduPiAmbientAbsentCapture(host, health, rootRef, pending,
    "teaching_preparation"), "sealed_absent");
  assert.deepEqual(calls, [["owner_message_settle", { root_ref: rootRef, expected_owner_id: pending.ownerId,
    grant_id: pending.grantId, expected_grant_version: pending.captureGrantVersion,
    conversation_id: ambient.eduPiAmbientConversationId("teaching_preparation"),
    message_id: pending.messageId, occurred_at: pending.occurredAt,
    expected_message_ref: pending.messageRef, expected_fencing_generation: 7, expected_instance_nonce: "nonce-7" }]]);
  for (const result of [{ ...sealed, owner_id: "another-owner" }, { ...sealed, fencing_generation: 8 },
    { ...sealed, source_ref: `conversation:${"f".repeat(64)}` }, { ...sealed, external_send: true },
    { ...sealed, receipt: { action: "capture" } }, { ...sealed, status: "unknown" }]) {
    assert.equal(await recovery.settleExactEduPiAmbientAbsentCapture({ callOwnerControl: async () => ({ ok: true, result }) },
      health, rootRef, pending, "teaching_preparation"), "outcome_unknown");
  }
  const noCall = { async callOwnerControl() { throw new Error("old or mismatched binding must not call Core"); } };
  assert.equal(await recovery.settleExactEduPiAmbientAbsentCapture(noCall,
    { ...health, capabilities: { supported_operations: [] } }, rootRef, pending,
    "teaching_preparation"), "outcome_unknown");
  assert.equal(await recovery.settleExactEduPiAmbientAbsentCapture(noCall, health, rootRef,
    { ...pending, messageId: "another-message" }, "teaching_preparation"), "outcome_unknown");
  assert.equal(await recovery.settleExactEduPiAmbientAbsentCapture(noCall, health, rootRef,
    { ...pending, status: "abandoned" }, "teaching_preparation"), "outcome_unknown");
});

test("only an exact captured receipt plus a current question or quote can close a no-action message", async () => {
  const conversationId = ambient.eduPiAmbientConversationId("teaching_preparation");
  const sourceRef = `conversation:${crypto.createHash("sha256").update(conversationId).digest("hex")}`;
  const health = { lifecycle: "ready", data_root_fingerprint: rootRef, fencing_generation: 7,
    instance_nonce: "nonce-7", capabilities: { supported_operations: ["owner_message_settle", "owner_intent_read"] } };
  const receipt = { action: "capture", revision: 1, message_ref: entry.messageRef,
    owner_id: entry.ownerId, root_ref: rootRef, source_ref: sourceRef,
    capture_grant_version: entry.captureGrantVersion, received_at: entry.occurredAt,
    recorded_at: entry.occurredAt, sender_kind: "local_owner_authenticated",
    apply: false, live_authority: false, external_send: false };
  const captured = { version: 1, status: "captured", root_ref: rootRef, owner_id: entry.ownerId,
    grant_id: entry.grantId, grant_version: entry.captureGrantVersion, source_ref: sourceRef,
    message_ref: entry.messageRef, occurred_at: entry.occurredAt, fencing_generation: 7,
    instance_nonce: "nonce-7", receipt, replayed: true,
    apply: false, live_authority: false, model_execute: false, external_send: false };
  const question = { version: 1, intent_id: `owner_intent:${"b".repeat(64)}`,
    message_ref: entry.messageRef, status: "current", action: "abstain", reason: "question_only",
    candidate: { domain: "teaching_preparation", interpretation: "question",
      time_reference: { kind: "none", value: null }, ambiguities: [],
      evidence_ids: [entry.messageRef], policy_version: "ambient-intent-rules-v1",
      basis_hash: `sha256:${"c".repeat(64)}` },
    observed_at: entry.occurredAt, apply: false, live_authority: false,
    model_execute: false, external_send: false };
  const calls = [];
  const host = { async callOwnerControl(operation, payload) {
    calls.push([operation, payload]);
    return { ok: true, result: operation === "owner_message_settle" ? captured : question };
  } };
  assert.equal(await recovery.settleExactEduPiAmbientCaptureOutcome(host, health, rootRef, entry,
    "teaching_preparation"), "captured_nonactionable");
  assert.deepEqual(calls.map(([operation]) => operation), ["owner_message_settle", "owner_intent_read"]);
  assert.deepEqual(calls[1][1], { root_ref: rootRef, expected_owner_id: entry.ownerId, message_ref: entry.messageRef });
  const quote = { ...question, reason: "quoted_or_other_scope",
    candidate: { ...question.candidate, interpretation: "quote" } };
  assert.equal(await recovery.settleExactEduPiAmbientCaptureOutcome({ callOwnerControl: async operation =>
    ({ ok: true, result: operation === "owner_message_settle" ? captured : quote }) }, health, rootRef, entry,
  "teaching_preparation"), "captured_nonactionable");
  for (const unsafe of [
    { ...question, status: "held", candidate: null },
    { ...question, action: "ask" },
    { ...question, reason: "request_needs_resolution" },
    { ...question, candidate: { ...question.candidate, interpretation: "request" } },
    { ...question, candidate: { ...question.candidate, evidence_ids: [`owner_message:${"d".repeat(64)}`] } },
    { ...question, candidate: { ...question.candidate, policy_version: "later-policy" } },
    { ...question, external_send: true },
  ]) {
    assert.equal(await recovery.settleExactEduPiAmbientCaptureOutcome({ callOwnerControl: async operation =>
      ({ ok: true, result: operation === "owner_message_settle" ? captured : unsafe }) }, health, rootRef, entry,
    "teaching_preparation"), "outcome_unknown");
  }
  assert.equal(await recovery.settleExactEduPiAmbientCaptureOutcome({ callOwnerControl: async operation =>
    ({ ok: true, result: operation === "owner_message_settle" ? { ...captured, receipt: { ...receipt, owner_id: "another" } } : question }) },
  health, rootRef, entry, "teaching_preparation"), "outcome_unknown");
});

function projection(bindings) {
  return { ok: true, result: { version: 1, root_ref: rootRef, owner_id: entry.ownerId,
    grant_id: entry.grantId, grant_version: 2, scope: { class_id: "class-1", subject: "数学" },
    bindings, observed_at: entry.occurredAt, apply: false, live_authority: false,
    model_execute: false, external_send: false } };
}

test("only an exact Core message-to-Goal binding can resolve a lost apply reply", async () => {
  const calls = [];
  const host = { async callOwnerControl(operation, request) {
    calls.push([operation, request]);
    assert.equal(operation, "owner_goal_bindings_read", "recovery cannot issue a new route_apply");
    return projection([{ message_ref: messageRef, goal_id: "goal-1", goal_version: 1,
      goal_status: "active", work_case_id: "work-1", task_id: "task-1" }]);
  } };
  assert.deepEqual(await recovery.readExactEduPiAmbientGoalBinding(host, rootRef, entry),
    { status: "applied", goalId: "goal-1", goalVersion: 1, workCaseId: "work-1" });
  assert.deepEqual(calls, [["owner_goal_bindings_read", { root_ref: rootRef,
    expected_owner_id: entry.ownerId, grant_id: entry.grantId, expected_grant_version: 2 }]]);
});

test("a current Goal binding may have no queued task yet", async () => {
  const host = { callOwnerControl: async () => projection([{ message_ref: messageRef,
    goal_id: "goal-1", goal_version: 1, goal_status: "active", work_case_id: "work-1", task_id: null }]) };
  assert.deepEqual(await recovery.readExactEduPiAmbientGoalBinding(host, rootRef, entry),
    { status: "applied", goalId: "goal-1", goalVersion: 1, workCaseId: "work-1" });
});

test("old Core rows, mismatched sources and ambiguous bindings remain unknown", async () => {
  for (const rows of [
    [{ goal_id: "goal-1", goal_version: 1, goal_status: "active", work_case_id: "work-1", task_id: "task-1" }],
    [{ message_ref: `owner_message:${"c".repeat(64)}`, goal_id: "goal-1", goal_version: 1,
      goal_status: "active", work_case_id: "work-1", task_id: "task-1" }],
    [{ message_ref: messageRef, goal_id: "goal-1", goal_version: 1, goal_status: "active", work_case_id: "work-1", task_id: "task-1" },
      { message_ref: messageRef, goal_id: "goal-2", goal_version: 1, goal_status: "active", work_case_id: "work-2", task_id: "task-2" }],
  ]) {
    const host = { callOwnerControl: async () => projection(rows) };
    assert.deepEqual(await recovery.readExactEduPiAmbientGoalBinding(host, rootRef, entry), { status: "outcome_unknown" });
  }
});

test("a changed persistent client message ID cannot borrow another message's Goal", async () => {
  const host = { callOwnerControl: async () => projection([{ message_ref: messageRef,
    goal_id: "goal-1", goal_version: 1, goal_status: "active", work_case_id: "work-1", task_id: "task-1" }]) };
  assert.deepEqual(await recovery.readExactEduPiAmbientGoalBinding(host, rootRef,
    { ...entry, messageId: "prompt-different" }), { status: "outcome_unknown" });
});

test("unavailable or unsafe Core reads never certify the Goal", async () => {
  for (const response of [new Error("synthetic_offline"), { ok: false, error_code: "owner_grant_unavailable" },
    { ...projection([]), result: { ...projection([]).result, external_send: true } }]) {
    const host = { async callOwnerControl() { if (response instanceof Error) throw response; return response; } };
    assert.deepEqual(await recovery.readExactEduPiAmbientGoalBinding(host, rootRef, entry), { status: "outcome_unknown" });
  }
});

test("G2 loss recovers only its exact current Core execution without another enqueue", async () => {
  const g2Entry = { ...entry, messageId: "g2_synthetic", messageRef: ambient.predictEduPiOwnerMessageRef(rootRef,
    entry.ownerId, "g2_synthetic", "student_followup") };
  const calls = [];
  const host = { async callOwnerControl(operation, request) {
    calls.push([operation, request]);
    return { ok: true, result: { version: 1, status: "current", follow_up_id: "followup-1",
      goal_id: "goal-1", goal_version: 2, execution_id: "execution-1",
      apply: false, model_execute: false, live_authority: false, external_send: false } };
  } };
  assert.deepEqual(await recovery.readExactEduPiG2Execution(host, rootRef, g2Entry), {
    status: "applied", goalId: "goal-1", goalVersion: 2, followUpId: "followup-1", executionId: "execution-1" });
  assert.deepEqual(calls, [["student_followup_intent_execution_read", { root_ref: rootRef,
    expected_owner_id: entry.ownerId, grant_id: entry.grantId, expected_grant_version: 2,
    message_ref: g2Entry.messageRef }]]);
});

test("G2 old Core, cross-message and non-current reads stay unknown", async () => {
  const g2Entry = { ...entry, messageId: "g2_synthetic", messageRef: ambient.predictEduPiOwnerMessageRef(rootRef,
    entry.ownerId, "g2_synthetic", "student_followup") };
  let calls = 0;
  const current = { ok: true, result: { version: 1, status: "current", follow_up_id: "followup-1",
    goal_id: "goal-1", goal_version: 2, execution_id: "execution-1",
    apply: false, model_execute: false, live_authority: false, external_send: false } };
  for (const response of [new Error("old_core_unknown_operation"), { ok: true, result: { ...current.result, status: "unknown",
    follow_up_id: null, goal_id: null, goal_version: null, execution_id: null } },
  { ok: true, result: { ...current.result, external_send: true } }]) {
    const host = { async callOwnerControl() { calls++; if (response instanceof Error) throw response; return response; } };
    assert.deepEqual(await recovery.readExactEduPiG2Execution(host, rootRef, g2Entry), { status: "outcome_unknown" });
  }
  const host = { async callOwnerControl() { calls++; return current; } };
  assert.deepEqual(await recovery.readExactEduPiG2Execution(host, rootRef, { ...g2Entry, messageId: "g2_other" }),
    { status: "outcome_unknown" });
  assert.equal(calls, 3, "a changed persistent message ID is rejected before contacting Core");
});
