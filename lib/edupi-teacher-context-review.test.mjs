import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const bridgeContract = await jiti.import("./edupi-bridge-contract.ts");
const review = await jiti.import("./edupi-teacher-context-review.ts");
const commands = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"];

const baseFixture = {
  contract_version: "1.1",
  message_id: "snapshot-message-client",
  request_id: "snapshot-request-client",
  issued_at: "2026-08-28T04:00:00.000Z",
  producer: "edupi-core",
    schema_hash: "sha256:7f0cffd21c60f9ffa3409dcdb56c3b6683e81377ca3290741344c87a80123e7f",
  snapshot_id: "snapshot-client-base",
  provenance: [],
  teacher_review: { state: "not_required", reviewer_id: null, reviewed_at: null, note: null, revision: 0 },
  external_send: false,
  payload: {
    snapshot_id: "snapshot-client-base",
    state_hash: "sha256:pending",
    generated_at: "2026-08-28T04:00:00.000Z",
    core_commit: "fixture-core",
    observations: [],
    memory_candidates: [],
    memories: [],
    receipts: [],
    review_history: [],
    review_targets: [],
    action_states: [],
    tasks: [],
    capabilities: {
      can_review_memory: true,
      can_execute_actions: false,
      external_send_enabled: false,
      supported_commands: [],
      supported_projections: [],
    },
    education_workspace: {
      projection_kind: "education_workspace",
      projection_version: "1.1",
      state_hash: "sha256:pending",
      generated_at: "2026-08-28T04:00:00.000Z",
      scope: "teacher_internal",
      external_send: false,
      requires_teacher_review: true,
      freshness: { state: "current", observed_at: "2026-08-28T04:00:00.000Z", source_hash: "sha256:workspace-source" },
      source_summaries: [],
      students: [],
      timetable: [],
      calendar: [],
      tasks: [],
      continuity: { memories: [], signals: [], insights: [], themes: [], subject_knowledge: [], teaching_priorities: [], family_contacts: [], documents: [], last_dream: null },
    },
  },
};
baseFixture.payload.education_workspace.state_hash = bridgeContract.computeLegacySnapshotStateHash(baseFixture.payload.education_workspace);

const activeSource = {
  source_kind: "teacher_message",
  source_id: "teacher-context-client-source",
  source_path: null,
  source_hash: "sha256:teacher-context-client-source",
  observed_at: "2026-08-28T04:00:00.000Z",
  actor: "teacher",
  evidence_ids: ["teacher-context-client-evidence"],
  parent_ids: [],
};

function snapshotEnvelope({ revision = 0, status = "pending_review", sourceIds = [activeSource.source_id] } = {}) {
  const payload = structuredClone(baseFixture.payload);
  payload.capabilities.supported_commands = commands;
  payload.capabilities.supported_projections = ["education_workspace"];
  payload.capabilities.can_review_memory = true;
  payload.review_targets = [{
    projection_kind: "teacher_context",
    target: { target_kind: "teacher_context", target_id: "context-client", command_type: "review_teacher_context" },
    revision,
    title: "教师背景信息",
    summary: "当前教师背景：name=李老师；role=教师；subject=数学；grade=七年级；class_name=七年级二班",
    status,
    source_ids: sourceIds,
    evidence_ids: activeSource.evidence_ids,
    teacher_review: { state: status, reviewer_id: null, reviewed_at: null, note: null, revision },
    external_send: false,
    field_keys: ["class_name", "grade", "name", "role", "subject"],
    value_summary: "name=李老师；role=教师；subject=数学；grade=七年级；class_name=七年级二班",
    conflict_ids: [],
  }];
  const identity = bridgeContract.computeSnapshotIdentity(payload);
  payload.snapshot_id = identity.snapshot_id;
  payload.state_hash = identity.state_hash;
  const envelope = {
    ...structuredClone(baseFixture),
    snapshot_id: identity.snapshot_id,
    provenance: [activeSource],
    payload,
  };
  assert.equal(bridgeContract.validateCoreEnvelopeSchema(envelope), true);
  return envelope;
}

function receiptFor(command, snapshot, {
  status = "accepted",
  decision = command.command.decision,
  reasonCode = null,
  beforeSnapshot = snapshot,
  afterBindings = true,
  envelopeSnapshotId,
} = {}) {
  const after = snapshotEnvelope({ revision: command.command.expected_revision + 1, status: decision === "hold" ? "held" : decision === "reject" ? "rejected" : decision === "modify" ? "modified" : "accepted" });
  const payload = {
    receipt_id: "receipt-context-client",
    command_id: command.message_id,
    request_id: command.request_id,
    command_type: "review_teacher_context",
    target: { target_kind: "teacher_context", target_id: "context-client", command_type: "review_teacher_context" },
    receipt_phase: "mutation",
    decision,
    status,
    applied_ids: ["context-client"],
    rejected_ids: [],
    reason_code: reasonCode,
    evidence_ids: activeSource.evidence_ids,
    before_snapshot_id: beforeSnapshot.payload.snapshot_id,
    after_snapshot_id: afterBindings ? after.payload.snapshot_id : null,
    before_state_hash: beforeSnapshot.payload.state_hash,
    after_state_hash: afterBindings ? after.payload.state_hash : null,
    teacher_review: { state: after.payload.review_targets[0].status, reviewer_id: "teacher", reviewed_at: "2026-08-28T04:01:00.000Z", note: null, revision: command.command.expected_revision + 1 },
    external_send: false,
    rollback: { available: false, rollback_id: null, expires_at: null },
    preview_token: null,
    action_authorization: null,
    created_at: "2026-08-28T04:01:00.000Z",
  };
  return {
    ...structuredClone(baseFixture),
    message_id: payload.receipt_id,
    request_id: command.request_id,
    snapshot_id: envelopeSnapshotId || (afterBindings ? after.payload.snapshot_id : snapshot.payload.snapshot_id),
    producer: "edupi-core",
    provenance: [activeSource],
    teacher_review: payload.teacher_review,
    payload,
  };
}

const snapshot = snapshotEnvelope();
const input = {
  snapshot,
  targetId: "context-client",
  expectedSnapshotId: snapshot.payload.snapshot_id,
  expectedRevision: 0,
  decision: "accept",
  reviewerId: "teacher",
  issuedAt: "2026-08-28T04:00:30.000Z",
};

test("builds a strict source-bound teacher-context command from the validated snapshot", () => {
  const envelope = review.buildTeacherContextReviewCommandEnvelope(input);
  assert.equal(envelope.command.command_type, "review_teacher_context");
  assert.equal(envelope.command.context_id, "context-client");
  assert.equal(envelope.command.expected_revision, 0);
  assert.equal(envelope.command.source.source_id, activeSource.source_id);
  assert.equal(envelope.command.source.source_hash, activeSource.source_hash);
  assert.deepEqual(envelope.command.source.evidence_ids, activeSource.evidence_ids);
  assert.deepEqual(envelope.provenance, [activeSource]);
  assert.equal(envelope.external_send, false);
  assert.equal(bridgeContract.validateCoreEnvelopeSchema(envelope), true);
});

test("rejects stale UI snapshot/revision and richer patches before dispatch", () => {
  assert.throws(() => review.buildTeacherContextReviewCommandEnvelope({ ...input, expectedSnapshotId: "snapshot-stale" }), (error) => error?.code === "stale_snapshot");
  assert.throws(() => review.buildTeacherContextReviewCommandEnvelope({ ...input, expectedRevision: 7 }), (error) => error?.code === "stale_revision");
  assert.throws(() => review.buildTeacherContextReviewCommandEnvelope({ ...input, patch: { provider: "secret" } }), (error) => error?.code === "invalid_envelope");
  assert.throws(() => review.buildTeacherContextReviewCommandEnvelope({ ...input, patch: { name: "x".repeat(121) } }), (error) => error?.code === "invalid_envelope");
  const multiSource = snapshotEnvelope({ sourceIds: [activeSource.source_id, "historical-source"] });
  assert.throws(() => review.buildTeacherContextReviewCommandEnvelope({ ...input, snapshot: multiSource, expectedSnapshotId: multiSource.payload.snapshot_id }), (error) => error?.code === "invalid_envelope");
});

test("issues only when the cumulative capability is present and validates the bound receipt", async () => {
  let dispatched = null;
  const result = await review.issueTeacherContextReview(input, {
      supportedCommands: commands,
    dispatch(envelope) {
      dispatched = envelope;
      return receiptFor(envelope, snapshot);
    },
    refreshSnapshot() { return snapshotEnvelope({ revision: 1, status: "accepted" }); },
  });
  assert.ok(dispatched);
  assert.equal(result.receipt.command_type, "review_teacher_context");
  assert.equal(result.receipt.status, "accepted");
  assert.equal(result.data.payload.snapshot_id, result.receipt.after_snapshot_id);
  await assert.rejects(
    review.issueTeacherContextReview(input, { supportedCommands: ["review_observation", "review_memory_candidate"], dispatch() { throw new Error("must not dispatch"); }, refreshSnapshot() { throw new Error("must not refresh"); } }),
    (error) => error?.code === "unsupported_command",
  );
});

test("maps a real stale receipt before success-only state bindings and never refreshes", async () => {
  const currentCoreSnapshot = snapshotEnvelope({ revision: 4, status: "pending_review" });
  await assert.rejects(
    review.issueTeacherContextReview(input, {
      supportedCommands: commands,
      dispatch(envelope) {
        return {
          ok: false,
          code: "stale_snapshot",
          reason_code: "stale_snapshot",
          receipt: null,
          envelope: receiptFor(envelope, snapshot, {
            status: "stale_snapshot",
            reasonCode: "stale_snapshot",
            beforeSnapshot: currentCoreSnapshot,
            afterBindings: false,
            envelopeSnapshotId: snapshot.payload.snapshot_id,
          }),
        };
      },
      refreshSnapshot() { throw new Error("must not refresh"); },
    }),
    (error) => error?.code === "stale_snapshot",
  );
  await assert.rejects(
    review.issueTeacherContextReview(input, {
      supportedCommands: commands,
      dispatch(envelope) {
        return {
          ok: false,
          code: "stale_revision",
          reason_code: "stale_revision",
          receipt_envelope: receiptFor(envelope, snapshot, {
            status: "failed",
            reasonCode: "stale_revision",
            beforeSnapshot: currentCoreSnapshot,
            afterBindings: false,
            envelopeSnapshotId: snapshot.payload.snapshot_id,
          }),
        };
      },
      refreshSnapshot() { throw new Error("must not refresh"); },
    }),
    (error) => error?.code === "stale_revision",
  );
});

test("rejects mismatched stale target or evidence before mapping stale status", async () => {
  const currentCoreSnapshot = snapshotEnvelope({ revision: 4, status: "pending_review" });
  await assert.rejects(
    review.issueTeacherContextReview(input, {
      supportedCommands: commands,
      dispatch(envelope) {
        const forged = receiptFor(envelope, snapshot, {
          status: "stale_snapshot",
          reasonCode: "stale_snapshot",
          beforeSnapshot: currentCoreSnapshot,
          afterBindings: false,
          envelopeSnapshotId: snapshot.payload.snapshot_id,
        });
        forged.payload.target.target_id = "other-context";
        return { ok: false, code: "stale_snapshot", receipt: forged };
      },
      refreshSnapshot() { throw new Error("must not refresh"); },
    }),
    (error) => error?.code === "invalid_envelope",
  );
  await assert.rejects(
    review.issueTeacherContextReview(input, {
      supportedCommands: commands,
      dispatch(envelope) {
        const forged = receiptFor(envelope, snapshot, {
          status: "stale_snapshot",
          reasonCode: "stale_snapshot",
          beforeSnapshot: currentCoreSnapshot,
          afterBindings: false,
          envelopeSnapshotId: snapshot.payload.snapshot_id,
        });
        forged.payload.evidence_ids = ["different-evidence"];
        return { ok: false, code: "stale_snapshot", receipt: forged };
      },
      refreshSnapshot() { throw new Error("must not refresh"); },
    }),
    (error) => error?.code === "invalid_envelope",
  );
  await assert.rejects(
    review.issueTeacherContextReview(input, {
      supportedCommands: commands,
      dispatch(envelope) {
        return receiptFor(envelope, snapshot, {
          status: "accepted",
          reasonCode: "stale_snapshot",
          beforeSnapshot: currentCoreSnapshot,
        });
      },
      refreshSnapshot() { throw new Error("must not refresh"); },
    }),
    (error) => error?.code === "invalid_envelope",
  );
  await assert.rejects(
    review.issueTeacherContextReview(input, {
      supportedCommands: commands,
      dispatch(envelope) { return receiptFor(envelope, snapshot, { decision: "hold", status: "accepted" }); },
      refreshSnapshot() { throw new Error("must not refresh"); },
    }),
    (error) => error?.code === "invalid_envelope",
  );
});

test("uses outer dispatch errors only when no receipt envelope is present", async () => {
  await assert.rejects(
    review.issueTeacherContextReview(input, {
      supportedCommands: commands,
      dispatch() { return { ok: false, code: "stale_snapshot", reason_code: "stale_snapshot", receipt: null, envelope: null }; },
      refreshSnapshot() { throw new Error("must not refresh"); },
    }),
    (error) => error?.code === "stale_snapshot",
  );
  await assert.rejects(
    review.issueTeacherContextReview(input, {
      supportedCommands: commands,
      dispatch() { return { ok: false, code: "stale_snapshot", receipt: "malformed-receipt" }; },
      refreshSnapshot() { throw new Error("must not refresh"); },
    }),
    (error) => error?.code === "invalid_envelope",
  );
});
