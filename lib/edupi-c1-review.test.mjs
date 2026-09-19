import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { validateCoreEnvelopeSchema } = await jiti.import("./edupi-bridge-contract.ts");
const { buildC1ReviewCommandEnvelope, issueC1Review } = await jiti.import("./edupi-c1-review.ts");

const SCHEMA_HASH = "sha256:d4702ef3bb303996cea137f9f1337a20a8c6853b0b7d215cca64265bf2cd4daa";
const ISSUED_AT = "2026-08-27T00:00:00.000Z";

function teacherReview(state = "pending_review", reviewerId = null, note = null, revision = 0) {
  return { state, reviewer_id: reviewerId, reviewed_at: reviewerId ? ISSUED_AT : null, note, revision };
}

function provenance(sourceKind = "teacher_message", sourceId = "teacher-message-1") {
  return [{
    source_kind: sourceKind,
    source_id: sourceId,
    source_path: null,
    source_hash: `sha256:${sourceId}`,
    observed_at: ISSUED_AT,
    actor: sourceKind === "teacher_message" ? "teacher" : "core",
    evidence_ids: ["evidence-1"],
    parent_ids: sourceKind === "memory_candidate" ? ["observation-1"] : [],
  }];
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function stateHash(value) {
  const state = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "state_hash"));
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(state))).digest("hex")}`;
}

/**
 * This is a small, schema-valid v1.1 bridge fixture kept in the test so the
 * pure command contract can run without a Core checkout or a filesystem read.
 * The capability list is the post-C1 exact pair; the review helper must still
 * gate dispatch against its pinned manifest rather than trusting this fixture.
 */
function makeSnapshotEnvelope() {
  const review = teacherReview();
  const observationProvenance = provenance();
  const observation = {
    observation_id: "observation-1",
    text: "学生在移项时写反符号。",
    subject: "math",
    class_id: "class-1",
    student_ids: [],
    observed_at: ISSUED_AT,
    provenance: observationProvenance,
    evidence_ids: ["evidence-1"],
    inference_status: "observed",
    teacher_review: review,
  };
  const candidate = {
    candidate_id: "candidate-1",
    category: "teaching",
    proposed_content: "下一课先复习移项符号变化。",
    tags: ["移项"],
    based_on_observation_ids: ["observation-1"],
    conflicts_with_memory_ids: [],
    evidence_ids: ["evidence-1"],
    inference_status: "candidate_only",
    teacher_review: review,
    external_send: false,
  };
  const workspace = {
    projection_kind: "education_workspace",
    projection_version: "1.1",
    state_hash: "sha256:placeholder",
    generated_at: ISSUED_AT,
    scope: "teacher_internal",
    external_send: false,
    requires_teacher_review: true,
    freshness: { state: "current", observed_at: ISSUED_AT, source_hash: "sha256:source" },
    source_summaries: [],
    students: [],
    timetable: [],
    calendar: [],
    tasks: [],
    continuity: {
      memories: [],
      signals: [],
      insights: [],
      themes: [],
      subject_knowledge: [],
      teaching_priorities: [],
      family_contacts: [],
      documents: [],
      last_dream: null,
    },
  };
  workspace.state_hash = stateHash(workspace);
  const payload = {
    snapshot_id: "snapshot-c1-1",
    state_hash: "sha256:placeholder",
    generated_at: ISSUED_AT,
    core_commit: "core-c1",
    observations: [observation],
    memory_candidates: [candidate],
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
      supported_commands: ["review_observation", "review_memory_candidate"],
      supported_projections: ["education_workspace"],
    },
    education_workspace: workspace,
  };
  payload.state_hash = stateHash(payload);
  return {
    contract_version: "1.1",
    message_id: "snapshot-message-1",
    request_id: "snapshot-request-1",
    issued_at: ISSUED_AT,
    producer: "edupi-core",
    schema_hash: SCHEMA_HASH,
    snapshot_id: payload.snapshot_id,
    provenance: observationProvenance,
    teacher_review: review,
    external_send: false,
    payload,
  };
}

const snapshot = makeSnapshotEnvelope();

function reviewInput(overrides = {}) {
  return {
    snapshot,
    targetKind: "memory_candidate",
    targetId: "candidate-1",
    decision: "accept",
    reviewerId: "teacher-1",
    note: "教师确认该候选记忆。",
    patch: null,
    issuedAt: ISSUED_AT,
    ...overrides,
  };
}

function snapshotWithTargetRevision(targetKind, revision) {
  const next = structuredClone(snapshot);
  const target = targetKind === "observation"
    ? next.payload.observations[0]
    : next.payload.memory_candidates[0];
  target.teacher_review.revision = revision;
  next.payload.education_workspace.state_hash = stateHash(next.payload.education_workspace);
  next.payload.state_hash = stateHash(next.payload);
  return next;
}

function validReceiptEnvelope(overrides = {}) {
  const reviewed = teacherReview("accepted", "teacher-1", "教师确认该候选记忆。", 1);
  const payload = {
    receipt_id: "receipt-1",
    command_id: "command-1",
    request_id: "request-c1-review",
    command_type: "review_memory_candidate",
    target: { target_kind: "memory_candidate", target_id: "candidate-1", command_type: "review_memory_candidate" },
    receipt_phase: "mutation",
    decision: "accept",
    status: "accepted",
    applied_ids: ["memory-1"],
    rejected_ids: [],
    reason_code: null,
    evidence_ids: ["evidence-1"],
    before_snapshot_id: "snapshot-c1-1",
    after_snapshot_id: "snapshot-c1-2",
    before_state_hash: "sha256:before",
    after_state_hash: "sha256:after",
    teacher_review: reviewed,
    external_send: false,
    rollback: { available: false, rollback_id: null, expires_at: null },
    preview_token: null,
    action_authorization: null,
    created_at: ISSUED_AT,
  };
  return {
    contract_version: "1.1",
    message_id: "receipt-message-1",
    request_id: "request-c1-review",
    issued_at: ISSUED_AT,
    producer: "edupi-core",
    schema_hash: SCHEMA_HASH,
    snapshot_id: "snapshot-c1-2",
    provenance: provenance("memory_candidate", "candidate-1"),
    teacher_review: reviewed,
    external_send: false,
    payload: { ...payload, ...overrides },
  };
}

test("uses the validated v1.1 snapshot and emits schema-valid C1 command envelopes", () => {
  assert.equal(validateCoreEnvelopeSchema(snapshot), true);
  for (const [targetKind, targetId, decision, patch] of [
    ["observation", "observation-1", "accept", null],
    ["observation", "observation-1", "modify", { text: "学生在移项时写反符号，需要再核对。" }],
    ["observation", "observation-1", "reject", null],
    ["observation", "observation-1", "hold", null],
    ["memory_candidate", "candidate-1", "accept", null],
    ["memory_candidate", "candidate-1", "modify", { proposed_content: "下一课先复习移项符号变化。", tags: ["移项", "七年级"] }],
    ["memory_candidate", "candidate-1", "reject", null],
    ["memory_candidate", "candidate-1", "hold", null],
  ]) {
    const envelope = buildC1ReviewCommandEnvelope(reviewInput({ targetKind, targetId, decision, patch }));
    assert.equal(validateCoreEnvelopeSchema(envelope), true, `${targetKind}/${decision} must validate as v1.1`);
    assert.equal(envelope.contract_version, "1.1");
    assert.equal(envelope.producer, "edupi-desktop");
    assert.equal(envelope.external_send, false);
    assert.equal(envelope.snapshot_id, snapshot.payload.snapshot_id);
    assert.equal(envelope.command.command_type, targetKind === "observation" ? "review_observation" : "review_memory_candidate");
    assert.equal(envelope.command[targetKind === "observation" ? "observation_id" : "candidate_id"], targetId);
    assert.equal(envelope.command.expected_revision, 0);
    assert.equal(envelope.command.decision, decision);
    assert.deepEqual(envelope.command.patch, patch);
    const target = targetKind === "observation"
      ? snapshot.payload.observations[0]
      : snapshot.payload.memory_candidates[0];
    const expectedSourceId = targetKind === "observation" ? "teacher-message-1" : "candidate-1";
    const expectedSourceKind = targetKind === "observation" ? "teacher_message" : "memory_candidate";
    assert.equal(envelope.command.source.source_id, expectedSourceId);
    assert.equal(envelope.command.source.source_kind, expectedSourceKind);
    assert.deepEqual(envelope.command.source.evidence_ids, target.evidence_ids);
    assert.ok(envelope.provenance.some((entry) => entry.source_id === expectedSourceId || entry.parent_ids.includes(targetId)));
    assert.equal(envelope.teacher_review.reviewer_id, "teacher-1");
    assert.equal(envelope.teacher_review.note, "教师确认该候选记忆。");
  }
});

test("derives a deterministic semantic idempotency key independent of issuance metadata", () => {
  const first = buildC1ReviewCommandEnvelope(reviewInput());
  const retry = buildC1ReviewCommandEnvelope(reviewInput({ issuedAt: "2026-08-27T00:01:00.000Z" }));
  const changedDecision = buildC1ReviewCommandEnvelope(reviewInput({ decision: "hold" }));
  const changedRevision = buildC1ReviewCommandEnvelope(reviewInput({ snapshot: snapshotWithTargetRevision("memory_candidate", 1) }));
  assert.equal(first.idempotency_key, retry.idempotency_key);
  assert.notEqual(first.idempotency_key, changedDecision.idempotency_key);
  assert.notEqual(first.idempotency_key, changedRevision.idempotency_key);
  assert.match(first.idempotency_key, /^sha256:[A-Za-z0-9_-]+$/);
});

test("rejects unsupported C1 targets, decisions, and unbounded patches before dispatch", () => {
  assert.throws(() => buildC1ReviewCommandEnvelope(reviewInput({ targetKind: "task", targetId: "task-1" })));
  assert.throws(() => buildC1ReviewCommandEnvelope(reviewInput({ decision: "rollback" })));
  assert.throws(() => buildC1ReviewCommandEnvelope(reviewInput({ patch: { proposed_content: "x".repeat(4001) } })));
  assert.throws(() => buildC1ReviewCommandEnvelope(reviewInput({ note: "x".repeat(1001) })));
});

test("derives target revision from the validated snapshot and rejects an unknown target", () => {
  const changed = buildC1ReviewCommandEnvelope(reviewInput({
    snapshot: snapshotWithTargetRevision("memory_candidate", 3),
  }));
  assert.equal(changed.command.expected_revision, 3);
  assert.throws(() => buildC1ReviewCommandEnvelope(reviewInput({ targetId: "missing-candidate" })));
});

test("capability-gates C1 review and does not call Core when the pinned command is absent", async () => {
  let dispatches = 0;
  let refreshes = 0;
  await assert.rejects(
    issueC1Review(reviewInput(), {
      supportedCommands: [],
      dispatch: async () => { dispatches += 1; return validReceiptEnvelope(); },
      refreshSnapshot: async () => { refreshes += 1; return snapshot; },
    }),
    (error) => error?.code === "unsupported_command",
  );
  assert.equal(dispatches, 0);
  assert.equal(refreshes, 0);
});

test("sends one typed command, trusts only a valid receipt, then refreshes the validated snapshot", async () => {
  const sent = [];
  const refreshed = { ...snapshot, snapshot_id: "snapshot-c1-2" };
  const result = await issueC1Review(reviewInput(), {
    supportedCommands: ["review_observation", "review_memory_candidate"],
    dispatch: async (envelope) => { sent.push(envelope); return validReceiptEnvelope(); },
    refreshSnapshot: async () => refreshed,
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].command.command_type, "review_memory_candidate");
  assert.equal(result.receipt.receipt_id, "receipt-1");
  assert.equal(result.data, refreshed);
});

test("reports stale receipts distinctly and does not refresh after a stale revision", async () => {
  await assert.rejects(
    issueC1Review(reviewInput(), {
      supportedCommands: ["review_observation", "review_memory_candidate"],
      dispatch: async () => validReceiptEnvelope({
        status: "stale_snapshot",
        reason_code: "stale_snapshot",
        after_snapshot_id: null,
        after_state_hash: null,
      }),
      refreshSnapshot: async () => { throw new Error("refresh must not run for stale receipt"); },
    }),
    (error) => error?.code === "stale_snapshot",
  );
});

test("reports an invalid Core receipt distinctly before trusting or refreshing it", async () => {
  await assert.rejects(
    issueC1Review(reviewInput(), {
      supportedCommands: ["review_observation", "review_memory_candidate"],
      dispatch: async () => ({ ...validReceiptEnvelope(), external_send: true }),
      refreshSnapshot: async () => { throw new Error("refresh must not run for invalid receipt"); },
    }),
    (error) => error?.code === "invalid_envelope",
  );
});
