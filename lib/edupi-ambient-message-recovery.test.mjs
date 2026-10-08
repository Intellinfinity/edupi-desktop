import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const recovery = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-message-recovery.ts");
const ambient = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-message-runtime.ts");
const rootRef = `sha256:${"a".repeat(64)}`;
const messageRef = ambient.predictEduPiOwnerMessageRef(rootRef, "owner-1", "prompt-stable");
const entry = { sessionId: "session-1", messageId: "prompt-stable", messageRef,
  ownerId: "owner-1", grantId: "grant-1", captureGrantVersion: 2,
  occurredAt: "2026-10-08T00:00:00.000Z", status: "outcome_unknown", withdrawnAt: null };

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
