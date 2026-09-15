import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const methods = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-teaching-methods.server.ts");

function skill(overrides = {}) {
  return {
    skill_id: "teaching_method_1",
    title: "错因分组讲评",
    lifecycle_state: "trial",
    trial_count: 1,
    evidence_ids: ["teacher_feedback_1"],
    can_reuse: false,
    origin: "managed",
    revision: 1,
    content_revision: 1,
    available_actions: ["update", "record_trial", "validate", "retire"],
    updated_at: "2026-09-15T01:00:00.000Z",
    details: { content: "先独立作答，再按错因分组讲评。", truncated: false, retirement_reason: null, approval: null, evaluation: null, trials: [{ trial_id: "method_trial_1", content_revision: 1, task_id: "task-1", task_title: "703班单元检测", at: "2026-09-15T01:00:00.000Z", outcome: "helpful", prompt: "讲评更集中。", evidence: ["task:task-1"], artifact_ids: [] }], files: [] },
    ...overrides,
  };
}

function response(requestId, method, receipt) {
  return { ok: true, operation: "teaching-skills", request_id: requestId, projection: { projection_kind: "teaching_skill_lifecycle", projection_version: 2, mutation_enabled: true, generated_at: "2026-09-15T01:00:00.000Z", summary: { total: 1, draft: 0, trial: 1, validated: 0, published: 0, retired: 0 }, skills: [method], teacher_growth: [], mutation_receipts: [receipt], external_send: false } };
}

test("parses exact bounded mutations and derives semantic request IDs", () => {
  const parsed = methods.parseTeachingMethodMutation({ action: "record_trial", method_id: "teaching_method_1", expected_revision: 1, task_id: "task-1", outcome: "helpful", feedback: " 讲评更集中。 " });
  assert.deepEqual(parsed, { action: "record_trial", methodId: "teaching_method_1", expectedRevision: 1, taskId: "task-1", outcome: "helpful", feedback: "讲评更集中。" });
  assert.equal(methods.teachingMethodMutationRequestId(parsed), methods.teachingMethodMutationRequestId({ feedback: "讲评更集中。", outcome: "helpful", taskId: "task-1", expectedRevision: 1, methodId: "teaching_method_1", action: "record_trial" }));
  assert.throws(() => methods.parseTeachingMethodMutation({ action: "publish", method_id: "teaching_method_1", expected_revision: 1, api_key: "secret" }), { code: "invalid_request" });
  assert.throws(() => methods.parseTeachingMethodMutation({ action: "record_trial", method_id: "teaching_method_1", expected_revision: 1, task_id: "task-1", outcome: "invented", feedback: "反馈" }), { code: "invalid_request" });
});

test("accepts only a matching Core receipt and verifies the trial postcondition", () => {
  const input = { action: "record_trial", methodId: "teaching_method_1", expectedRevision: 0, taskId: "task-1", outcome: "helpful", feedback: "讲评更集中。" };
  const requestId = methods.teachingMethodMutationRequestId(input);
  const receipt = { request_id: requestId, action: "record_trial", method_id: "teaching_method_1", revision: 1, content_revision: 1, status: "trial", trial_id: "method_trial_1", replayed: false, external_send: false };
  const result = methods.validateTeachingMethodMutationResponse(response(requestId, skill(), receipt), requestId, input);
  assert.equal(result.lifecycle.skills[0].details.trials[0].taskId, "task-1");
  assert.equal(result.lifecycle.mutationReceipts[0].requestId, requestId);
  assert.throws(() => methods.validateTeachingMethodMutationResponse(response(requestId, skill(), { ...receipt, trial_id: "other" }), requestId, input), { code: "invalid_response" });
  assert.throws(() => methods.validateTeachingMethodMutationResponse(response(requestId, skill(), { ...receipt, external_send: true }), requestId, input), { code: "invalid_response" });
});

test("detects a rejected or stale mutation from the authoritative projection", () => {
  const input = { action: "update", methodId: "teaching_method_1", expectedRevision: 0, title: "改名", content: "新正文" };
  const requestId = methods.teachingMethodMutationRequestId(input);
  const withoutReceipt = response(requestId, skill(), { request_id: "older", action: "record_trial", method_id: "teaching_method_1", revision: 1, content_revision: 1, status: "trial", trial_id: "method_trial_1", replayed: false, external_send: false });
  assert.throws(() => methods.validateTeachingMethodMutationResponse(withoutReceipt, requestId, input), { code: "stale_method" });
  assert.throws(() => methods.validateTeachingMethodMutationResponse({ ...withoutReceipt, extra: true }, requestId, input), { code: "invalid_response" });
});

test("checks publish and retire outcomes rather than trusting success status", () => {
  const publish = { action: "publish", methodId: "teaching_method_1", expectedRevision: 1 };
  const publishId = methods.teachingMethodMutationRequestId(publish);
  const published = skill({ lifecycle_state: "published", revision: 2, can_reuse: true, available_actions: ["update", "record_trial", "retire"] });
  const publishReceipt = { request_id: publishId, action: "publish", method_id: "teaching_method_1", revision: 2, content_revision: 1, status: "published", trial_id: null, replayed: false, external_send: false };
  assert.equal(methods.validateTeachingMethodMutationResponse(response(publishId, published, publishReceipt), publishId, publish).lifecycle.skills[0].canReuse, true);
  assert.throws(() => methods.validateTeachingMethodMutationResponse(response(publishId, { ...published, can_reuse: false }, publishReceipt), publishId, publish), { code: "invalid_response" });

  const retire = { action: "retire", methodId: "teaching_method_1", expectedRevision: 2, reason: "本学期停用" };
  const retireId = methods.teachingMethodMutationRequestId(retire);
  const retired = skill({ lifecycle_state: "retired", revision: 3, details: { ...skill().details, retirement_reason: "本学期停用" }, available_actions: [] });
  const retireReceipt = { request_id: retireId, action: "retire", method_id: "teaching_method_1", revision: 3, content_revision: 1, status: "retired", trial_id: null, replayed: false, external_send: false };
  assert.equal(methods.validateTeachingMethodMutationResponse(response(retireId, retired, retireReceipt), retireId, retire).lifecycle.skills[0].lifecycleState, "retired");
});
