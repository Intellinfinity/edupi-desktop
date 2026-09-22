import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const bridge = await jiti.import("./edupi-bridge-contract.ts");
const review = await jiti.import("./edupi-follow-up-review.ts");
const SCHEMA_HASH = "sha256:7861fffd15d32074a8021ad98e7e082c841910118cfc50918f812816e5710da6";
const COMMANDS = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"];
const SOURCE = {
  source_kind: "core_event",
  source_id: "follow-up-client",
  source_path: null,
  source_hash: `sha256:${"a".repeat(64)}`,
  observed_at: "2026-09-20T03:00:00.000Z",
  actor: "core",
  evidence_ids: ["follow-up-evidence"],
  parent_ids: ["observation-client"],
};

function snapshotEnvelope({ revision = 0, status = "pending_review", internalDraftSummary = "下次课核对一个可复核例证。", nextStep = undefined, teacherReview = { state: status, reviewer_id: null, reviewed_at: null, note: null, revision } } = {}) {
  const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/bridge/v1.1/snapshot-education-workspace.json", import.meta.url), "utf8"));
  const payload = fixture.payload;
  payload.capabilities = { can_review_memory: true, can_execute_actions: false, external_send_enabled: false, supported_commands: COMMANDS, supported_projections: ["education_workspace"] };
  const projection = {
    projection_kind: "follow_up",
    target: { target_kind: "follow_up", target_id: "follow-up-client", command_type: "review_follow_up" },
    revision,
    title: "学生跟进候选",
    summary: "已记录一条需要教师核对的学生观察。",
    status,
    source_ids: ["follow-up-client"],
    evidence_ids: ["follow-up-evidence"],
    teacher_review: teacherReview,
    external_send: false,
    observed_event_ids: ["observation-client"],
    internal_draft_summary: internalDraftSummary,
    permission_state: "not_required",
  };
  if (nextStep !== undefined) projection.next_step = nextStep;
  payload.review_targets = [projection];
  const identity = bridge.computeSnapshotIdentity(payload);
  payload.snapshot_id = identity.snapshot_id;
  payload.state_hash = identity.state_hash;
  return {
    ...fixture,
    message_id: `snapshot-message-${revision}`,
    request_id: `snapshot-request-${revision}`,
    schema_hash: SCHEMA_HASH,
    snapshot_id: identity.snapshot_id,
    provenance: [SOURCE],
    payload,
  };
}

function receiptFor(command, before, after) {
  const reviewState = command.command.decision === "accept" ? "accepted" : command.command.decision === "modify" ? "modified" : command.command.decision === "reject" ? "rejected" : "held";
  const teacherReview = { state: reviewState, reviewer_id: "teacher", reviewed_at: "2026-09-20T04:00:00.000Z", note: command.command.note, revision: 1 };
  return {
    contract_version: "1.1",
    message_id: "receipt-follow-up",
    request_id: command.request_id,
    issued_at: "2026-09-20T04:00:00.000Z",
    producer: "edupi-core",
    schema_hash: SCHEMA_HASH,
    snapshot_id: after.payload.snapshot_id,
    provenance: [SOURCE],
    teacher_review: teacherReview,
    external_send: false,
    payload: {
      receipt_id: "receipt-follow-up",
      command_id: command.message_id,
      request_id: command.request_id,
      command_type: "review_follow_up",
      target: { target_kind: "follow_up", target_id: "follow-up-client", command_type: "review_follow_up" },
      receipt_phase: "mutation",
      decision: command.command.decision,
      status: reviewState,
      applied_ids: ["follow-up-client"],
      rejected_ids: command.command.decision === "reject" ? ["follow-up-client"] : [],
      reason_code: null,
      evidence_ids: ["follow-up-evidence"],
      before_snapshot_id: before.payload.snapshot_id,
      after_snapshot_id: after.payload.snapshot_id,
      before_state_hash: before.payload.state_hash,
      after_state_hash: after.payload.state_hash,
      teacher_review: teacherReview,
      external_send: false,
      rollback: { available: false, rollback_id: null, expires_at: null },
      preview_token: null,
      action_authorization: null,
      created_at: "2026-09-20T04:00:00.000Z",
    },
  };
}

test("builds a source-bound follow-up review command and stays teacher-internal", () => {
  const snapshot = snapshotEnvelope();
  assert.equal(bridge.validateCoreEnvelopeSchema(snapshot), true);
  const command = review.buildFollowUpReviewCommandEnvelope({
    snapshot,
    targetId: "follow-up-client",
    expectedSnapshotId: snapshot.payload.snapshot_id,
    expectedRevision: 0,
    decision: "modify",
    patch: { internalDraftSummary: "下节课核对学生的原始表现。", nextStep: "记录一个可复核例证" },
    reviewerId: "teacher",
    issuedAt: "2026-09-20T04:00:00.000Z",
  });
  assert.equal(command.command.command_type, "review_follow_up");
  assert.equal(command.command.source.source_kind, "core_event");
  assert.equal(command.external_send, false);
  assert.equal(bridge.validateCoreEnvelopeSchema(command), true);
  assert.throws(() => review.buildFollowUpReviewCommandEnvelope({
    snapshot,
    targetId: "follow-up-client",
    expectedSnapshotId: snapshot.payload.snapshot_id,
    expectedRevision: 0,
    decision: "modify",
    patch: { internalDraftSummary: "这名学生有诊断问题" },
    reviewerId: "teacher",
  }), (error) => error?.code === "invalid_envelope");
});

test("accepts only a receipt-bound refreshed follow-up revision", async () => {
  const before = snapshotEnvelope();
  const after = snapshotEnvelope({ revision: 1, status: "accepted", teacherReview: { state: "accepted", reviewer_id: "teacher", reviewed_at: "2026-09-20T04:00:00.000Z", note: null, revision: 1 } });
  assert.equal(bridge.validateCoreEnvelopeSchema(before), true);
  assert.deepEqual(bridge.validateSnapshotSemantics(before.payload, { supportedCommands: COMMANDS, supportedProjections: ["education_workspace"] }), { ok: true });
  assert.doesNotThrow(() => review.buildFollowUpReviewCommandEnvelope({ snapshot: before, targetId: "follow-up-client", expectedSnapshotId: before.payload.snapshot_id, expectedRevision: 0, decision: "accept", reviewerId: "teacher", issuedAt: "2026-09-20T04:00:00.000Z" }));
  let dispatched;
  const result = await review.issueFollowUpReview({ snapshot: before, targetId: "follow-up-client", expectedSnapshotId: before.payload.snapshot_id, expectedRevision: 0, decision: "accept", reviewerId: "teacher", issuedAt: "2026-09-20T04:00:00.000Z" }, {
    supportedCommands: COMMANDS,
    dispatch: async (command) => { dispatched = command; return receiptFor(command, before, after); },
    refreshSnapshot: async () => after,
  });
  assert.equal(dispatched.command.command_type, "review_follow_up");
  assert.equal(result.receipt.status, "accepted");
  assert.equal(result.data.payload.snapshot_id, after.payload.snapshot_id);
  assert.equal(result.receipt.external_send, false);
});

test("rejects stale revisions before dispatch", async () => {
  const snapshot = snapshotEnvelope({ revision: 1, status: "held", teacherReview: { state: "held", reviewer_id: null, reviewed_at: null, note: null, revision: 1 } });
  await assert.rejects(review.issueFollowUpReview({ snapshot, targetId: "follow-up-client", expectedSnapshotId: snapshot.payload.snapshot_id, expectedRevision: 0, decision: "hold", reviewerId: "teacher" }, { supportedCommands: COMMANDS, dispatch() { throw new Error("must not dispatch"); }, refreshSnapshot() { throw new Error("must not refresh"); } }), (error) => error?.code === "stale_revision");
});
