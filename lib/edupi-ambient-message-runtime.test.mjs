import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const ambient = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-message-runtime.ts");
const rootRef = `sha256:${"a".repeat(64)}`;
const ownerId = `owner_${"b".repeat(32)}`;
const base = { rootRef, grantId: "desktop_canary_1234", messageId: "prompt-1", text: "帮我准备明天的数学教案", occurredAt: "2026-09-23T08:00:00.000Z" };
const messageRef = ambient.predictEduPiOwnerMessageRef(rootRef, ownerId, base.messageId);
const bindingProjection = (bindings) => ({ ok: true, result: { version: 1, root_ref: rootRef, owner_id: ownerId, grant_id: base.grantId,
  grant_version: 2, scope: { class_id: "class-7-1", subject: "数学" }, bindings: bindings.map((item) => ({
    goal_id: item.goalId, goal_version: item.goalVersion, goal_status: item.status, work_case_id: item.workCaseId, task_id: item.taskId || `task-${item.goalId}`,
  })), observed_at: "2026-09-23T08:00:00.000Z", apply: false, live_authority: false, model_execute: false, external_send: false } });

test("captures, resolves, and applies one ordinary owner message without external send", async () => {
  const calls = [];
  const ledger = [];
  const host = {
    async call() { return { ok: true, result: { root_ref: rootRef, owner: { id: ownerId }, grants: [{ id: base.grantId, version: 2, status: "active", ends_at: "2026-09-30T00:00:00.000Z" }] } }; },
    async callOwnerControl(operation, payload) {
      calls.push([operation, payload]);
      if (operation === "owner_message") return { ok: true, result: { receipt: { message_ref: messageRef, owner_id: ownerId, grant_id: base.grantId, capture_grant_version: 2, external_send: false }, replayed: false } };
      if (operation === "owner_intent_resolve") return { ok: true, result: { status: "source_bound", reason: "current_sources_resolved", target: { work_case_id: "work-1" }, external_send: false } };
      if (operation === "owner_intent_apply") return { ok: true, result: { status: "applied", goal_id: "goal-1", work_case_id: "work-1", external_send: false } };
      throw new Error("unexpected operation");
    },
  };
  const result = await ambient.captureAndApplyAmbientMessage(host, base, {
    onPrepared: async (binding) => { ledger.push(["pending", binding]); },
    onCaptured: async (binding) => { ledger.push(["captured", binding]); },
  });
  assert.deepEqual(result, { status: "applied", resolutionStatus: "source_bound", reason: "current_sources_resolved", goalId: "goal-1", workCaseId: "work-1", externalSend: false });
  assert.deepEqual(calls.map((item) => item[0]), ["owner_message", "owner_intent_resolve", "owner_intent_apply"]);
  assert.equal(calls[0][1].conversation_id, "desktop-ambient-canary-v1");
  assert.equal(calls[0][1].text, base.text);
  assert.equal(calls[2][1].expected_goal_version, 0);
  assert.deepEqual(ledger.map(([status]) => status), ["pending", "captured"]);
  assert.equal(ledger[0][1].messageRef, messageRef);
  assert.equal(ledger[0][1].messageRef, ledger[1][1].messageRef);
});

test("a non-actionable resolution is captured without goal application", async () => {
  const calls = [];
  const host = {
    async call() { return { ok: true, result: { root_ref: rootRef, owner: { id: ownerId }, grants: [{ id: base.grantId, version: 2, status: "active", ends_at: "2026-09-30T00:00:00.000Z" }] } }; },
    async callOwnerControl(operation) {
      calls.push(operation);
      if (operation === "owner_message") return { ok: true, result: { receipt: { message_ref: messageRef, owner_id: ownerId, grant_id: base.grantId, capture_grant_version: 2, external_send: false }, replayed: false } };
      return { ok: true, result: { status: "held", reason: "source_unavailable", external_send: false } };
    },
  };
  assert.deepEqual(await ambient.captureAndApplyAmbientMessage(host, base), {
    status: "captured", resolutionStatus: "held", reason: "source_unavailable", goalId: null, workCaseId: null, externalSend: false,
  });
  assert.deepEqual(calls, ["owner_message", "owner_intent_resolve"]);
});

test("a ledger failure withdraws the just-captured private source before any intent can apply", async () => {
  const calls = [];
  const host = {
    async call() { return { ok: true, result: { root_ref: rootRef, owner: { id: ownerId }, grants: [{ id: base.grantId, version: 2, status: "active", ends_at: "2026-09-30T00:00:00.000Z" }] } }; },
    async callOwnerControl(operation, payload) {
      calls.push([operation, payload]);
      if (operation === "owner_message" && payload.action === "capture") return { ok: true, result: { receipt: { message_ref: messageRef, owner_id: ownerId, grant_id: base.grantId, capture_grant_version: 2, external_send: false }, replayed: false } };
      if (operation === "owner_message" && payload.action === "withdraw") return { ok: true, result: { receipt: { message_ref: messageRef, revision: 2, external_send: false }, replayed: false } };
      throw new Error("intent processing must not start");
    },
  };
  await assert.rejects(ambient.captureAndApplyAmbientMessage(host, base, {
    onCaptured: async () => { throw new Error("ledger unavailable"); },
  }), (error) => error?.code === "proactivity_runtime_unavailable" && error?.stage === "capture");
  assert.deepEqual(calls.map(([operation, payload]) => `${operation}:${payload.action || ""}`), ["owner_message:capture", "owner_message:withdraw"]);
});

test("a prepared-ledger failure prevents private text from reaching Core", async () => {
  let ownerMessageCalls = 0;
  const host = {
    async call() { return { ok: true, result: { root_ref: rootRef, owner: { id: ownerId }, grants: [{ id: base.grantId, version: 2, status: "active", ends_at: "2026-09-30T00:00:00.000Z" }] } }; },
    async callOwnerControl() { ownerMessageCalls += 1; throw new Error("must not capture"); },
  };
  await assert.rejects(ambient.captureAndApplyAmbientMessage(host, base, {
    onPrepared: async () => { throw new Error("ledger unavailable"); },
  }), (error) => error?.code === "proactivity_runtime_unavailable" && error?.stage === "capture");
  assert.equal(ownerMessageCalls, 0);
});

test("a replay reads the durable work-case binding instead of reapplying with a stale version", async () => {
  const calls = [];
  const host = {
    async call() { return { ok: true, result: { root_ref: rootRef, owner: { id: ownerId }, grants: [{ id: base.grantId, version: 2, status: "active", ends_at: "2026-09-30T00:00:00.000Z" }] } }; },
    async callOwnerControl(operation) {
      calls.push(operation);
      if (operation === "owner_message") return { ok: true, result: { receipt: { message_ref: messageRef, owner_id: ownerId, capture_grant_version: 2, external_send: false }, replayed: true } };
      if (operation === "owner_intent_resolve") return { ok: true, result: { status: "source_bound", reason: "current_sources_resolved", target: { work_case_id: "work-1" }, external_send: false } };
      throw new Error("must not reapply");
    },
  };
  const result = await ambient.captureAndApplyAmbientMessage(host, base, { findAppliedGoal: async () => ({ goalId: "goal-1" }) });
  assert.equal(result.goalId, "goal-1");
  assert.deepEqual(calls, ["owner_message", "owner_intent_resolve"]);
});

test("a uniquely bound natural cancellation revokes the current goal without model execution or external send", async () => {
  const calls = [];
  const host = {
    async call() { return { ok: true, result: { root_ref: rootRef, owner: { id: ownerId }, grants: [{ id: base.grantId, version: 2, status: "active", ends_at: "2026-09-30T00:00:00.000Z" }] } }; },
    async callOwnerControl(operation, payload) {
      calls.push([operation, payload]);
      if (operation === "owner_message") return { ok: true, result: { receipt: { message_ref: messageRef, owner_id: ownerId, capture_grant_version: 2, external_send: false }, replayed: false } };
      if (operation === "owner_intent_read") return { ok: true, result: { status: "current", message_ref: messageRef, external_send: false, candidate: { domain: "teaching_preparation", interpretation: "cancel" } } };
      if (operation === "owner_goal_bindings_read") return bindingProjection([{ goalId: "goal-1", workCaseId: "work-1", goalVersion: 1, status: "active" }]);
      if (operation === "owner_intent_cancel") return { ok: true, result: { status: "applied", reason: "cancellation_applied", goal_id: "goal-1", goal_version: 2, work_case_id: "work-1", planning_applied: true, execution_started: false, model_execute: false, notify: false, live_authority: false, external_send: false, queue_cancellation: { requested: true, results: [] } } };
      throw new Error(`unexpected operation ${operation}`);
    },
  };
  const result = await ambient.captureAndApplyAmbientMessage(host, { ...base, text: "取消这节数学备课" }, {
    controlScope: { classId: "class-7-1", subject: "数学" },
  });
  assert.deepEqual(result, { status: "cancelled", resolutionStatus: "cancelled", reason: "cancellation_applied", goalId: "goal-1", workCaseId: "work-1", externalSend: false });
  assert.deepEqual(calls.map((item) => item[0]), ["owner_message", "owner_intent_read", "owner_goal_bindings_read", "owner_intent_cancel"]);
  assert.deepEqual(calls[3][1], { root_ref: rootRef, expected_owner_id: ownerId, message_ref: messageRef,
    expected_goal_id: "goal-1", expected_work_case_id: "work-1", expected_goal_version: 1 });
});

test("a cancellation replay stays bound to the goal it already revoked when another goal is now active", async () => {
  const calls = [];
  const host = {
    async call() { return { ok: true, result: { root_ref: rootRef, owner: { id: ownerId }, grants: [{ id: base.grantId, version: 2, status: "active", ends_at: "2026-09-30T00:00:00.000Z" }] } }; },
    async callOwnerControl(operation, payload) {
      calls.push([operation, payload]);
      if (operation === "owner_message") return { ok: true, result: { receipt: { message_ref: messageRef, owner_id: ownerId, capture_grant_version: 2, external_send: false }, replayed: true } };
      if (operation === "owner_intent_read") return { ok: true, result: { status: "current", message_ref: messageRef, external_send: false, candidate: { domain: "teaching_preparation", interpretation: "cancel" } } };
      if (operation === "owner_goal_bindings_read") return bindingProjection([
        { goalId: "goal-old", workCaseId: "work-old", goalVersion: 2, status: "revoked" },
        { goalId: "goal-new", workCaseId: "work-new", goalVersion: 1, status: "active" },
      ]);
      if (operation === "owner_intent_cancel") return { ok: true, result: { status: "replayed", reason: "cancellation_already_applied", goal_id: "goal-old", goal_version: 2, work_case_id: "work-old", planning_applied: true, execution_started: false, model_execute: false, notify: false, live_authority: false, external_send: false, queue_cancellation: { requested: true, results: [] } } };
      throw new Error(`unexpected operation ${operation}`);
    },
  };
  const result = await ambient.captureAndApplyAmbientMessage(host, { ...base, text: "取消这节数学备课" }, {
    controlScope: { classId: "class-7-1", subject: "数学" },
  });
  assert.deepEqual(result, { status: "cancelled", resolutionStatus: "cancelled", reason: "cancellation_already_applied", goalId: "goal-old", workCaseId: "work-old", externalSend: false });
  assert.equal(calls.at(-1)[1].expected_goal_id, "goal-old");
  assert.equal(calls.at(-1)[1].expected_goal_version, 1);
});

test("natural cancellation stays captured when more than one current goal could be affected", async () => {
  const calls = [];
  const host = {
    async call() { return { ok: true, result: { root_ref: rootRef, owner: { id: ownerId }, grants: [{ id: base.grantId, version: 2, status: "active", ends_at: "2026-09-30T00:00:00.000Z" }] } }; },
    async callOwnerControl(operation) {
      calls.push(operation);
      if (operation === "owner_message") return { ok: true, result: { receipt: { message_ref: messageRef, owner_id: ownerId, capture_grant_version: 2, external_send: false }, replayed: false } };
      if (operation === "owner_intent_read") return { ok: true, result: { status: "current", message_ref: messageRef, external_send: false, candidate: { domain: "teaching_preparation", interpretation: "cancel" } } };
      if (operation === "owner_goal_bindings_read") return bindingProjection([
        { goalId: "goal-1", workCaseId: "work-1", goalVersion: 1, status: "active" },
        { goalId: "goal-2", workCaseId: "work-2", goalVersion: 1, status: "active" },
      ]);
      throw new Error("must not mutate an ambiguous target");
    },
  };
  const result = await ambient.captureAndApplyAmbientMessage(host, { ...base, text: "取消数学备课" }, {
    controlScope: { classId: "class-7-1", subject: "数学" },
  });
  assert.deepEqual(result, { status: "captured", resolutionStatus: "ask", reason: "cancellation_target_required", goalId: null, workCaseId: null, externalSend: false });
  assert.deepEqual(calls, ["owner_message", "owner_intent_read", "owner_goal_bindings_read"]);
});

test("a uniquely bound correction replaces the old goal and validates the new source-bound work case", async () => {
  const calls = [];
  const host = {
    async call() { return { ok: true, result: { root_ref: rootRef, owner: { id: ownerId }, grants: [{ id: base.grantId, version: 2, status: "active", ends_at: "2026-09-30T00:00:00.000Z" }] } }; },
    async callOwnerControl(operation, payload) {
      calls.push([operation, payload]);
      if (operation === "owner_message") return { ok: true, result: { receipt: { message_ref: messageRef, owner_id: ownerId, capture_grant_version: 2, external_send: false }, replayed: false } };
      if (operation === "owner_intent_read") return { ok: true, result: { status: "current", message_ref: messageRef, external_send: false, candidate: { domain: "teaching_preparation", interpretation: "correction" } } };
      if (operation === "owner_intent_resolve") return { ok: true, result: { status: "source_bound", reason: "current_sources_resolved", target: { work_case_id: "work-2" }, external_send: false } };
      if (operation === "owner_goal_bindings_read") return bindingProjection([{ goalId: "goal-1", workCaseId: "work-1", goalVersion: 1, status: "active" }]);
      if (operation === "owner_intent_correct") return { ok: true, result: { status: "applied", reason: "correction_applied", old_goal_id: "goal-1", old_goal_version: 2, old_work_case_id: "work-1", new_goal_id: "goal-2", new_goal_version: 1, new_work_case_id: "work-2", planning_applied: true, execution_started: false, model_execute: false, notify: false, live_authority: false, external_send: false, old_queue_cancellation: { requested: true, results: [] }, new_execution: null } };
      throw new Error(`unexpected operation ${operation}`);
    },
  };
  const result = await ambient.captureAndApplyAmbientMessage(host, { ...base, text: "改到周三再准备数学课" }, {
    controlScope: { classId: "class-7-1", subject: "数学" },
  });
  assert.deepEqual(result, { status: "corrected", resolutionStatus: "source_bound", reason: "correction_applied", goalId: "goal-2", workCaseId: "work-2", externalSend: false });
  assert.deepEqual(calls.map((item) => item[0]), ["owner_message", "owner_intent_read", "owner_intent_resolve", "owner_goal_bindings_read", "owner_intent_correct"]);
  assert.deepEqual(calls[4][1], { root_ref: rootRef, expected_owner_id: ownerId, message_ref: messageRef,
    expected_goal_id: "goal-1", expected_work_case_id: "work-1", expected_goal_version: 1, expected_new_goal_version: 0 });
});

test("an exact correction replay uses Core canonical bindings and does not infer from opportunity cross-products", async () => {
  const calls = [];
  const host = {
    async call() { return { ok: true, result: { root_ref: rootRef, owner: { id: ownerId }, grants: [{ id: base.grantId, version: 2, status: "active", ends_at: "2026-09-30T00:00:00.000Z" }] } }; },
    async callOwnerControl(operation) {
      calls.push(operation);
      if (operation === "owner_message") return { ok: true, result: { receipt: { message_ref: messageRef, owner_id: ownerId, capture_grant_version: 2, external_send: false }, replayed: true } };
      if (operation === "owner_intent_read") return { ok: true, result: { status: "current", message_ref: messageRef, external_send: false, candidate: { domain: "teaching_preparation", interpretation: "correction" } } };
      if (operation === "owner_intent_resolve") return { ok: true, result: { status: "source_bound", reason: "current_sources_resolved", target: { work_case_id: "work-2" }, external_send: false } };
      if (operation === "owner_goal_bindings_read") return bindingProjection([
        { goalId: "goal-1", workCaseId: "work-1", goalVersion: 2, status: "revoked" },
        { goalId: "goal-2", workCaseId: "work-2", goalVersion: 1, status: "active" },
      ]);
      if (operation === "owner_intent_correct") return { ok: true, result: { status: "replayed", reason: "correction_already_applied", old_goal_id: "goal-1", old_goal_version: 2, old_work_case_id: "work-1", new_goal_id: "goal-2", new_goal_version: 1, new_work_case_id: "work-2", planning_applied: true, execution_started: false, model_execute: false, notify: false, live_authority: false, external_send: false, old_queue_cancellation: { requested: true, results: [] }, new_execution: null } };
      throw new Error(`unexpected ${operation}`);
    },
  };
  const result = await ambient.captureAndApplyAmbientMessage(host, { ...base, text: "改到周三再准备数学课" }, {
    controlScope: { classId: "class-7-1", subject: "数学" },
  });
  assert.equal(result.status, "corrected");
  assert.equal(result.goalId, "goal-2");
  assert.deepEqual(calls, ["owner_message", "owner_intent_read", "owner_intent_resolve", "owner_goal_bindings_read", "owner_intent_correct"]);
});

test("a correction replay stays bound to its revoked predecessor when a later unrelated goal is active", async () => {
  const calls = [];
  const host = {
    async call() { return { ok: true, result: { root_ref: rootRef, owner: { id: ownerId }, grants: [{ id: base.grantId, version: 2, status: "active", ends_at: "2026-09-30T00:00:00.000Z" }] } }; },
    async callOwnerControl(operation, payload) {
      calls.push([operation, payload]);
      if (operation === "owner_message") return { ok: true, result: { receipt: { message_ref: messageRef, owner_id: ownerId, capture_grant_version: 2, external_send: false }, replayed: true } };
      if (operation === "owner_intent_read") return { ok: true, result: { status: "current", message_ref: messageRef, external_send: false, candidate: { domain: "teaching_preparation", interpretation: "correction" } } };
      if (operation === "owner_intent_resolve") return { ok: true, result: { status: "source_bound", reason: "current_sources_resolved", target: { work_case_id: "work-corrected" }, external_send: false } };
      if (operation === "owner_goal_bindings_read") return bindingProjection([
        { goalId: "goal-original", workCaseId: "work-original", goalVersion: 2, status: "revoked" },
        { goalId: "goal-corrected", workCaseId: "work-corrected", goalVersion: 1, status: "active" },
        { goalId: "goal-later", workCaseId: "work-later", goalVersion: 1, status: "active" },
      ]);
      if (operation === "owner_intent_correct") return { ok: true, result: { status: "replayed", reason: "correction_already_applied",
        old_goal_id: "goal-original", old_goal_version: 2, old_work_case_id: "work-original",
        new_goal_id: "goal-corrected", new_goal_version: 1, new_work_case_id: "work-corrected",
        planning_applied: true, execution_started: false, model_execute: false, notify: false, live_authority: false,
        external_send: false, old_queue_cancellation: { requested: true, results: [] }, new_execution: null } };
      throw new Error(`unexpected ${operation}`);
    },
  };
  const result = await ambient.captureAndApplyAmbientMessage(host, { ...base, text: "改到周三再准备数学课" }, {
    controlScope: { classId: "class-7-1", subject: "数学" },
  });
  assert.equal(result.goalId, "goal-corrected");
  assert.equal(calls.at(-1)[1].expected_goal_id, "goal-original");
  assert.equal(calls.at(-1)[1].expected_work_case_id, "work-original");
});

test("canonical binding projections are root, grant, scope, time, and external-send bound", async () => {
  const mutations = [
    (value) => { value.result.root_ref = `sha256:${"f".repeat(64)}`; },
    (value) => { value.result.scope.class_id = "class-other"; },
    (value) => { value.result.external_send = true; },
    (value) => { value.result.observed_at = "not-a-time"; },
  ];
  for (const mutate of mutations) {
    const host = {
      async call() { return { ok: true, result: { root_ref: rootRef, owner: { id: ownerId }, grants: [{ id: base.grantId, version: 2, status: "active", ends_at: "2026-09-30T00:00:00.000Z" }] } }; },
      async callOwnerControl(operation) {
        if (operation === "owner_message") return { ok: true, result: { receipt: { message_ref: messageRef, owner_id: ownerId, capture_grant_version: 2, external_send: false }, replayed: false } };
        if (operation === "owner_intent_read") return { ok: true, result: { status: "current", message_ref: messageRef, external_send: false, candidate: { domain: "teaching_preparation", interpretation: "cancel" } } };
        if (operation === "owner_goal_bindings_read") { const value = structuredClone(bindingProjection([{ goalId: "goal-1", workCaseId: "work-1", goalVersion: 1, status: "active" }])); mutate(value); return value; }
        throw new Error("must fail before mutation");
      },
    };
    await assert.rejects(ambient.captureAndApplyAmbientMessage(host, { ...base, text: "取消数学备课" }, {
      controlScope: { classId: "class-7-1", subject: "数学" },
    }), (error) => error?.code === "proactivity_response_invalid" && error?.stage === "binding");
  }
});

test("Core binding clock or grant denial is exposed as unavailable authorization", async () => {
  const host = {
    async call() { return { ok: true, result: { root_ref: rootRef, owner: { id: ownerId }, grants: [{ id: base.grantId, version: 2, status: "active", ends_at: "2026-09-30T00:00:00.000Z" }] } }; },
    async callOwnerControl(operation) {
      if (operation === "owner_message") return { ok: true, result: { receipt: { message_ref: messageRef, owner_id: ownerId, capture_grant_version: 2, external_send: false }, replayed: false } };
      if (operation === "owner_intent_read") return { ok: true, result: { status: "current", message_ref: messageRef, external_send: false, candidate: { domain: "teaching_preparation", interpretation: "cancel" } } };
      if (operation === "owner_goal_bindings_read") return { ok: false, result: null, error_code: "owner_clock_rollback" };
      throw new Error("unexpected");
    },
  };
  await assert.rejects(ambient.captureAndApplyAmbientMessage(host, { ...base, text: "取消数学备课" }, {
    controlScope: { classId: "class-7-1", subject: "数学" },
  }), (error) => error?.code === "proactivity_grant_unavailable" && error?.stage === "binding");
});

test("inactive grants and malformed or external results fail closed", async () => {
  const inactive = { call: async () => ({ ok: true, result: { root_ref: rootRef, owner: { id: ownerId }, grants: [{ id: base.grantId, version: 2, status: "paused", ends_at: "2026-09-30T00:00:00.000Z" }] } }), callOwnerControl: async () => ({ ok: true }) };
  await assert.rejects(ambient.captureAndApplyAmbientMessage(inactive, base), (error) => error?.code === "proactivity_grant_unavailable");
  const external = { call: async () => ({ ok: true, result: { root_ref: rootRef, owner: { id: ownerId }, grants: [{ id: base.grantId, version: 2, status: "active", ends_at: "2026-09-30T00:00:00.000Z" }] } }), callOwnerControl: async () => ({ ok: true, result: { receipt: { message_ref: messageRef, owner_id: ownerId, grant_id: base.grantId, capture_grant_version: 2, external_send: true } } }) };
  await assert.rejects(ambient.captureAndApplyAmbientMessage(external, base), (error) => error?.code === "proactivity_response_invalid");
});
