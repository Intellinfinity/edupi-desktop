import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const bridge = await jiti.import("./edupi-bridge-contract.ts");
const review = await jiti.import("./edupi-work-candidate-review.ts");

const commands = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"];
const source = {
  source_kind: "core_task",
  source_id: "work-client",
  source_path: null,
  source_hash: "sha256:work-client-source",
  observed_at: "2026-08-28T04:00:00.000Z",
  actor: "core",
  evidence_ids: ["work-client-evidence"],
  parent_ids: [],
};
const reviewState = { state: "pending_review", reviewer_id: null, reviewed_at: null, note: null, revision: 0 };
const taskStatus = { pending_review: "planned", accepted: "accepted", modified: "modified", rejected: "rejected", held: "hold", snoozed: "hold", suppressed: "rejected", accept: "accepted", modify: "modified", reject: "rejected", hold: "hold", snooze: "hold", suppress: "rejected" };
const receiptStatus = { accept: "accepted", modify: "modified", reject: "rejected", hold: "held", snooze: "held", suppress: "rejected" };
const reviewStatus = { accept: "accepted", modify: "modified", reject: "rejected", hold: "held", snooze: "held", suppress: "rejected" };
const matchingReasonPolicyId = `work_suppression_${"a".repeat(32)}`;

function taskFor({ status = "planned", dueDate = "2026-09-03", revision = 0, teacherReview = reviewState, title = "准备复习", sourceDate = "2026-09-03" } = {}) {
  return {
    task_id: "work-client",
    title,
    trigger: "calendar_review",
    status,
    content_status: "not_generated",
    delivery_status: "not_approved",
    source_event_id: "calendar-client",
    source_event_name: "校历复习节点",
    source_event_date: sourceDate,
    trigger_date: dueDate,
    due_date: dueDate,
    deliverables: ["内部准备清单"],
    audience: ["teacher"],
    requires_teacher_review: true,
    external_send: false,
    scope: "teacher_internal",
    student: null,
    student_event_type: null,
    material_id: null,
    material_kind: null,
    topic: null,
    revision,
    reviewed_at: teacherReview.reviewed_at,
    reviewer: teacherReview.reviewer_id,
    review_note: teacherReview.note,
    review_history: [],
    evidence: {
      rule: "fixture_calendar",
      source_memory: null,
      source_entry_id: "work-client-evidence",
      source_event_type: "festival",
      material_kind: null,
      source_date_status: sourceDate ? "explicit" : "missing",
      source_summary: "校历复习节点",
      inference_status: null,
      file_path: null,
      file_sha256: null,
    },
  };
}

function snapshotEnvelope({ status = "pending_review", revision = 0, dueDate = "2026-09-03", snoozeUntil = null, suppressionScope = null, nextCycleState = "awaiting_teacher", title = "准备复习", summary = "依据校历准备下一节课", sourceDate = "2026-09-03", teacherReview = reviewState } = {}) {
  const workspace = {
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
    tasks: [taskFor({ status: taskStatus[status], dueDate, revision, teacherReview, title, sourceDate })],
    continuity: { memories: [], signals: [], insights: [], themes: [], subject_knowledge: [], teaching_priorities: [], family_contacts: [], documents: [], last_dream: null },
  };
  workspace.state_hash = bridge.computeLegacySnapshotStateHash(workspace);
  const payload = {
    snapshot_id: "snapshot-work-client",
    state_hash: "sha256:pending",
    generated_at: workspace.generated_at,
    core_commit: "fixture-core",
    observations: [],
    memory_candidates: [],
    memories: [],
    receipts: [],
    review_history: [],
    review_targets: [{
      projection_kind: "work_candidate",
      target: { target_kind: "work_candidate", target_id: "work-client", command_type: "review_work_candidate" },
      revision,
      title,
      summary,
      status,
      source_ids: ["work-client"],
      evidence_ids: ["work-client-evidence"],
      teacher_review: teacherReview,
      external_send: false,
      reason: "下一节课需要教师准备",
      snooze_until: snoozeUntil,
      suppression_scope: suppressionScope,
      next_cycle_state: nextCycleState,
    }],
    action_states: [],
    tasks: [{
      task_id: "work-client",
      title,
      status: status === "pending_review" ? "pending_review" : taskStatus[status] === "hold" ? "held" : taskStatus[status],
      source_ids: ["calendar-client"],
      evidence_ids: ["work-client-evidence"],
      teacher_review: teacherReview,
      external_send: false,
    }],
    capabilities: {
      can_review_memory: true,
      can_execute_actions: false,
      external_send_enabled: false,
      supported_commands: commands,
      supported_projections: ["education_workspace"],
    },
    education_workspace: workspace,
  };
  const identity = bridge.computeSnapshotIdentity(payload);
  payload.snapshot_id = identity.snapshot_id;
  payload.state_hash = identity.state_hash;
  const envelope = {
    contract_version: "1.1",
    message_id: "snapshot-work-client",
    request_id: "snapshot-work-client",
    issued_at: workspace.generated_at,
    producer: "edupi-core",
    schema_hash: "sha256:7f0cffd21c60f9ffa3409dcdb56c3b6683e81377ca3290741344c87a80123e7f",
    snapshot_id: payload.snapshot_id,
    provenance: [structuredClone(source)],
    teacher_review: { state: "not_required", reviewer_id: null, reviewed_at: null, note: null, revision: 0 },
    external_send: false,
    payload,
  };
  assert.equal(bridge.validateCoreEnvelopeSchema(envelope), true);
  return envelope;
}

const initialSnapshot = snapshotEnvelope();
const baseInput = {
  snapshot: initialSnapshot,
  targetId: "work-client",
  expectedSnapshotId: initialSnapshot.payload.snapshot_id,
  expectedRevision: 0,
  decision: "accept",
  patch: null,
  note: "教师复核",
  reviewerId: "teacher",
  issuedAt: "2026-08-28T04:01:00.000Z",
};
const systemHeldSnapshot = snapshotEnvelope({
  status: "held",
  dueDate: null,
  sourceDate: null,
  nextCycleState: "held",
  teacherReview: reviewState,
});
const systemHeldInput = {
  ...baseInput,
  snapshot: systemHeldSnapshot,
  expectedSnapshotId: systemHeldSnapshot.payload.snapshot_id,
  decision: "modify",
  patch: { title: "补日期准备", summary: "补日期说明", dueAt: "2026-09-08" },
};

function receiptFor(command, { status = receiptStatus[command.command.decision], targetStatus = command.command.decision === "accept" ? "accepted" : command.command.decision === "modify" ? "modified" : command.command.decision === "reject" ? "rejected" : command.command.decision === "hold" ? "held" : command.command.decision === "snooze" ? "snoozed" : "suppressed", after = true, beforeSnapshot = initialSnapshot } = {}) {
  const nextReview = { state: reviewStatus[command.command.decision], reviewer_id: "teacher", reviewed_at: "2026-08-28T04:01:00.000Z", note: command.command.note, revision: command.command.expected_revision + 1 };
  const nextCycleState = command.command.decision === "snooze" ? "snoozed" : command.command.decision === "suppress" ? `suppressed_${command.command.patch.suppression_scope}` : targetStatus === "accepted" ? "closed_accepted" : targetStatus === "modified" ? "closed_modified" : targetStatus === "rejected" ? "closed_rejected" : "held";
  const afterSnapshot = snapshotEnvelope({ status: targetStatus, revision: nextReview.revision, dueDate: command.command.decision === "modify" ? command.command.patch.due_at : "2026-09-03", snoozeUntil: command.command.decision === "snooze" ? command.command.patch.snooze_until : null, suppressionScope: command.command.decision === "suppress" ? command.command.patch.suppression_scope : null, nextCycleState, title: command.command.decision === "modify" ? command.command.patch.title : "准备复习", summary: command.command.decision === "modify" ? command.command.patch.summary : "依据校历准备下一节课", teacherReview: nextReview });
  const payload = {
    receipt_id: `receipt-${command.command.decision}`,
    command_id: command.message_id,
    request_id: command.request_id,
    command_type: "review_work_candidate",
    target: { target_kind: "work_candidate", target_id: "work-client", command_type: "review_work_candidate" },
    receipt_phase: "mutation",
    decision: command.command.decision,
    status,
    applied_ids: command.command.decision === "suppress" && command.command.patch.suppression_scope === "matching_reason"
      ? ["work-client", matchingReasonPolicyId]
      : ["work-client"],
    rejected_ids: command.command.decision === "reject" || command.command.decision === "suppress" ? ["work-client"] : [],
    reason_code: null,
    evidence_ids: ["work-client-evidence"],
    before_snapshot_id: beforeSnapshot.payload.snapshot_id,
    after_snapshot_id: after ? afterSnapshot.payload.snapshot_id : null,
    before_state_hash: beforeSnapshot.payload.state_hash,
    after_state_hash: after ? afterSnapshot.payload.state_hash : null,
    teacher_review: nextReview,
    external_send: false,
    rollback: { available: false, rollback_id: null, expires_at: null },
    preview_token: null,
    action_authorization: null,
    created_at: "2026-08-28T04:01:00.000Z",
  };
  return {
    contract_version: "1.1",
    message_id: payload.receipt_id,
    request_id: command.request_id,
    issued_at: "2026-08-28T04:01:00.000Z",
    producer: "edupi-core",
    schema_hash: initialSnapshot.schema_hash,
    snapshot_id: after ? afterSnapshot.payload.snapshot_id : beforeSnapshot.payload.snapshot_id,
    provenance: [source],
    teacher_review: nextReview,
    external_send: false,
    payload,
  };
}

test("builds all six strict source-bound work commands and stable semantic idempotency", () => {
  const decisions = [
    ["accept", null], ["reject", null], ["hold", null],
    ["modify", { title: "调整复习", summary: "调整说明", dueAt: "2026-09-04" }],
    ["snooze", { snoozeUntil: "2026-09-08" }],
    ["suppress", { suppressionScope: "matching_reason" }],
  ];
  for (const [decision, patch] of decisions) {
    const input = { ...baseInput, decision, patch };
    const envelope = review.buildWorkCandidateReviewCommandEnvelope(input);
    assert.equal(envelope.command.command_type, "review_work_candidate");
    assert.equal(envelope.command.candidate_id, "work-client");
    assert.deepEqual(envelope.provenance, [source]);
    assert.equal(envelope.external_send, false);
    assert.deepEqual(envelope.command.source, { source_id: "work-client", source_kind: "core_task", source_hash: source.source_hash, evidence_ids: source.evidence_ids });
    if (decision === "modify") assert.deepEqual(envelope.command.patch, { title: "调整复习", summary: "调整说明", due_at: "2026-09-04" });
    if (decision === "snooze") assert.deepEqual(envelope.command.patch, { snooze_until: "2026-09-08" });
    if (decision === "suppress") assert.deepEqual(envelope.command.patch, { suppression_scope: "matching_reason" });
    assert.deepEqual(bridge.validateCommand(envelope.command), { ok: true });
    const retry = review.buildWorkCandidateReviewCommandEnvelope({ ...input, issuedAt: "2026-08-28T05:00:00.000Z" });
    assert.equal(retry.idempotency_key, envelope.idempotency_key);
  }
});

test("amended decisions still require source evidence and the current revision", () => {
  for (const [status, decision] of [["accepted", "reject"], ["rejected", "accept"]]) {
    const snapshot = snapshotEnvelope({ status, revision: 2, nextCycleState: `closed_${status}`, teacherReview: { state: status, reviewer_id: "teacher", reviewed_at: baseInput.issuedAt, note: "原决定", revision: 2 } });
    const input = { ...baseInput, snapshot, expectedSnapshotId: snapshot.snapshot_id, expectedRevision: 2, decision };
    const command = review.buildWorkCandidateReviewCommandEnvelope(input);
    assert.deepEqual(command.provenance, [source]);
    assert.equal(command.command.expected_revision, 2);
    assert.throws(() => review.buildWorkCandidateReviewCommandEnvelope({ ...input, expectedRevision: 1 }), error => error.code === "stale_revision");
    const unbound = structuredClone(snapshot);
    unbound.provenance = [];
    assert.throws(() => review.buildWorkCandidateReviewCommandEnvelope({ ...input, snapshot: unbound }), error => error.code === "invalid_envelope");
  }
});

test("rejects richer callers, invalid patches, missing source, and incomplete capability", async () => {
  for (const patch of [{ provider: "secret" }, { dueAt: "2026-09-04T09:00:00.000Z" }, { snoozeUntil: "2026-08-28" }, { suppressionScope: "bad" }]) {
    assert.throws(() => review.buildWorkCandidateReviewCommandEnvelope({ ...baseInput, decision: "modify", patch }), (error) => error?.code === "invalid_envelope");
  }
  assert.throws(() => review.buildWorkCandidateReviewCommandEnvelope({ ...baseInput, decision: "accept", patch: {} }), (error) => error?.code === "invalid_envelope");
  assert.throws(() => review.buildWorkCandidateReviewCommandEnvelope({ ...baseInput, decision: "modify", patch: null }), (error) => error?.code === "invalid_envelope");
  assert.throws(() => review.buildWorkCandidateReviewCommandEnvelope({ ...baseInput, decision: "snooze", patch: { snoozeUntil: "2026-08-28" } }), (error) => error?.code === "invalid_envelope");
  assert.throws(() => review.buildWorkCandidateReviewCommandEnvelope({ ...baseInput, decision: "suppress", patch: { suppressionScope: "next_cycle" }, note: null }), (error) => error?.code === "invalid_envelope");
  assert.throws(() => review.buildWorkCandidateReviewCommandEnvelope({ ...baseInput, targetId: "other" }), (error) => error?.code === "invalid_envelope");
  const duplicateSource = snapshotEnvelope();
  duplicateSource.provenance.push(structuredClone(source));
  assert.throws(() => review.buildWorkCandidateReviewCommandEnvelope({ ...baseInput, snapshot: duplicateSource, expectedSnapshotId: duplicateSource.payload.snapshot_id }), (error) => error?.code === "invalid_envelope");
  const forgedSource = snapshotEnvelope();
  forgedSource.provenance[0].actor = "teacher";
  assert.throws(() => review.buildWorkCandidateReviewCommandEnvelope({ ...baseInput, snapshot: forgedSource, expectedSnapshotId: forgedSource.payload.snapshot_id }), (error) => error?.code === "invalid_envelope");
  await assert.rejects(review.issueWorkCandidateReview(baseInput, { supportedCommands: ["review_observation", "review_memory_candidate", "review_teacher_context"], dispatch() { throw new Error("must not dispatch"); }, refreshSnapshot() { throw new Error("must not refresh"); } }), (error) => error?.code === "unsupported_command");
});

test("issues all six decisions only after trusted receipt and refreshed task join", async () => {
  for (const [decision, patch] of [
    ["accept", null], ["modify", { title: "调整复习", summary: "调整说明", dueAt: "2026-09-04" }], ["reject", null], ["hold", null], ["snooze", { snoozeUntil: "2026-09-08" }], ["suppress", { suppressionScope: "matching_reason" }],
  ]) {
    const fixtureCommand = review.buildWorkCandidateReviewCommandEnvelope({ ...baseInput, decision, patch });
    let fixtureReceipt;
    try { fixtureReceipt = receiptFor(fixtureCommand); } catch (error) { throw new Error(`${decision}: ${error instanceof Error ? error.message : String(error)}`); }
    assert.equal(bridge.validateCoreEnvelopeSchema(fixtureReceipt), true, `fixture receipt ${decision}`);
    let refreshed = 0;
    const result = await review.issueWorkCandidateReview({ ...baseInput, decision, patch }, {
      supportedCommands: commands,
      dispatch(command) { return { ok: false, receipt: receiptFor(command) }; },
      refreshSnapshot() {
        refreshed += 1;
        const targetStatus = decision === "accept" ? "accepted" : decision === "modify" ? "modified" : decision === "reject" ? "rejected" : decision === "hold" ? "held" : decision === "snooze" ? "snoozed" : "suppressed";
        const nextCycleState = decision === "snooze" ? "snoozed" : decision === "suppress" ? `suppressed_${patch.suppressionScope}` : targetStatus === "accepted" ? "closed_accepted" : targetStatus === "modified" ? "closed_modified" : targetStatus === "rejected" ? "closed_rejected" : "held";
        return snapshotEnvelope({ status: targetStatus, revision: 1, dueDate: decision === "modify" ? "2026-09-04" : "2026-09-03", snoozeUntil: decision === "snooze" ? patch.snoozeUntil : null, suppressionScope: decision === "suppress" ? patch.suppressionScope : null, nextCycleState, title: decision === "modify" ? patch.title : "准备复习", summary: decision === "modify" ? patch.summary : "依据校历准备下一节课", teacherReview: { state: reviewStatus[decision], reviewer_id: "teacher", reviewed_at: "2026-08-28T04:01:00.000Z", note: "教师复核", revision: 1 } });
      },
    });
    assert.equal(result.receipt.command_type, "review_work_candidate");
    assert.equal(result.receipt.decision, decision);
    assert.equal(result.data.payload.snapshot_id, result.receipt.after_snapshot_id);
    assert.equal(refreshed, 1);
  }
});

test("accepts Core system-held missing-date work and modifies it with a date", async () => {
  let refreshed = 0;
  const result = await review.issueWorkCandidateReview(systemHeldInput, {
    supportedCommands: commands,
    dispatch(command) { return receiptFor(command, { beforeSnapshot: systemHeldSnapshot }); },
    refreshSnapshot() {
      refreshed += 1;
      return snapshotEnvelope({
        status: "modified",
        revision: 1,
        dueDate: "2026-09-08",
        nextCycleState: "closed_modified",
        title: "补日期准备",
        summary: "补日期说明",
        teacherReview: { state: "modified", reviewer_id: "teacher", reviewed_at: "2026-08-28T04:01:00.000Z", note: "教师复核", revision: 1 },
      });
    },
  });
  assert.equal(result.receipt.status, "modified");
  assert.equal(result.data.payload.review_targets[0].status, "modified");
  assert.equal(result.data.payload.education_workspace.tasks[0].due_date, "2026-09-08");
  assert.equal(refreshed, 1);

  const datedSystemHeld = snapshotEnvelope({ status: "held", dueDate: "2026-09-03", sourceDate: "2026-09-03", nextCycleState: "held", teacherReview: reviewState });
  assert.throws(() => review.buildWorkCandidateReviewCommandEnvelope({ ...systemHeldInput, snapshot: datedSystemHeld, expectedSnapshotId: datedSystemHeld.payload.snapshot_id }), (error) => error?.code === "invalid_envelope");
  const reviewedSystemHeld = snapshotEnvelope({ status: "held", dueDate: null, sourceDate: null, nextCycleState: "held", teacherReview: { state: "pending_review", reviewer_id: "teacher", reviewed_at: null, note: null, revision: 0 } });
  assert.throws(() => review.buildWorkCandidateReviewCommandEnvelope({ ...systemHeldInput, snapshot: reviewedSystemHeld, expectedSnapshotId: reviewedSystemHeld.payload.snapshot_id }), (error) => error?.code === "invalid_envelope");
});

test("requires unambiguous aliases and exact successful receipt bindings", async () => {
  let refreshCount = 0;
  const aliased = await review.issueWorkCandidateReview(baseInput, {
    supportedCommands: commands,
    dispatch(command) {
      const receipt = receiptFor(command);
      return { receipt, receipt_envelope: structuredClone(receipt), envelope: structuredClone(receipt) };
    },
    refreshSnapshot() {
      refreshCount += 1;
      return snapshotEnvelope({ status: "accepted", revision: 1, nextCycleState: "closed_accepted", teacherReview: { state: "accepted", reviewer_id: "teacher", reviewed_at: "2026-08-28T04:01:00.000Z", note: "教师复核", revision: 1 } });
    },
  });
  assert.equal(aliased.receipt.status, "accepted");
  assert.equal(refreshCount, 1);

  async function rejectsReceipt(mutator, input = baseInput, refreshed = snapshotEnvelope({ status: "accepted", revision: 1, nextCycleState: "closed_accepted", teacherReview: { state: "accepted", reviewer_id: "teacher", reviewed_at: "2026-08-28T04:01:00.000Z", note: "教师复核", revision: 1 } })) {
    let calls = 0;
    await assert.rejects(review.issueWorkCandidateReview(input, {
      supportedCommands: commands,
      dispatch(command) {
        const receipt = receiptFor(command);
        return mutator(receipt, command);
      },
      refreshSnapshot() {
        calls += 1;
        return refreshed;
      },
    }), (error) => error?.code === "invalid_envelope");
    assert.equal(calls, 0);
  }

  await rejectsReceipt((receipt) => ({ receipt, envelope: { ...structuredClone(receipt), payload: { ...receipt.payload, status: "rejected" } } }));
  await rejectsReceipt((receipt) => { receipt.payload.applied_ids = []; return receipt; });
  await rejectsReceipt((receipt) => { receipt.payload.applied_ids = ["work-client", "unexpected"]; return receipt; });
  await rejectsReceipt((receipt) => { receipt.payload.rejected_ids = ["work-client"]; return receipt; });
  await rejectsReceipt((receipt) => { receipt.issued_at = "2026-08-28T04:02:00.000Z"; return receipt; });
  await rejectsReceipt((receipt) => { receipt.payload.created_at = "2026-08-28T04:02:00.000Z"; return receipt; });
  await rejectsReceipt((receipt) => { receipt.payload.teacher_review.reviewed_at = "2026-08-28T04:02:00.000Z"; receipt.teacher_review.reviewed_at = "2026-08-28T04:02:00.000Z"; return receipt; });
  await rejectsReceipt((receipt) => { receipt.payload.rollback = { available: true, rollback_id: "rollback", expires_at: null }; return receipt; });
  await rejectsReceipt((receipt) => { receipt.payload.preview_token = "preview"; return receipt; });
  await rejectsReceipt((receipt) => { receipt.payload.action_authorization = { execution_owner: "desktop_native", execution_token: "secret", action_spec_hash: "sha256:" + "a".repeat(64), expires_at: "2026-08-28T05:00:00.000Z", authorization_revision: 1, authorization_snapshot_id: "snapshot", authorization_state_hash: "sha256:" + "b".repeat(64) }; return receipt; });
  await rejectsReceipt((receipt) => { receipt.payload.applied_ids = ["work-client", "work_suppression_" + "A".repeat(32)]; return receipt; }, { ...baseInput, decision: "suppress", patch: { suppressionScope: "matching_reason" } });
  await rejectsReceipt((receipt) => { receipt.payload.applied_ids = ["work-client"]; return receipt; }, { ...baseInput, decision: "suppress", patch: { suppressionScope: "matching_reason" } });
  let refreshedMismatchCalls = 0;
  await assert.rejects(review.issueWorkCandidateReview(baseInput, {
    supportedCommands: commands,
    dispatch(command) { return receiptFor(command); },
    refreshSnapshot() {
      refreshedMismatchCalls += 1;
      return snapshotEnvelope({ status: "accepted", revision: 1, nextCycleState: "closed_accepted", teacherReview: { state: "accepted", reviewer_id: "other", reviewed_at: "2026-08-28T04:01:00.000Z", note: "教师复核", revision: 1 } });
    },
  }), (error) => error?.code === "invalid_envelope");
  assert.equal(refreshedMismatchCalls, 1);
});

test("maps stale and rejects forged receipts before refresh", async () => {
  for (const [code, receiptOptions] of [["stale_snapshot", { status: "stale_snapshot", after: false }], ["stale_revision", { status: "failed", reasonCode: "stale_revision", after: false }]]) {
    await assert.rejects(review.issueWorkCandidateReview(baseInput, {
      supportedCommands: commands,
      dispatch(command) {
        const receipt = receiptFor(command, receiptOptions);
        receipt.payload.reason_code = code;
        return { ok: false, code, receipt };
      },
      refreshSnapshot() { throw new Error("must not refresh"); },
    }), (error) => error?.code === code);
  }
  await assert.rejects(review.issueWorkCandidateReview(baseInput, {
    supportedCommands: commands,
    dispatch(command) {
      const receipt = receiptFor(command);
      receipt.payload.target.target_id = "forged-target";
      return { ok: false, code: "stale_snapshot", receipt };
    },
    refreshSnapshot() { throw new Error("must not refresh"); },
  }), (error) => error?.code === "invalid_envelope");
  await assert.rejects(review.issueWorkCandidateReview(baseInput, {
    supportedCommands: commands,
    dispatch(command) {
      const receipt = receiptFor(command);
      receipt.payload.evidence_ids = ["forged-evidence"];
      return { ok: false, code: "stale_snapshot", receipt };
    },
    refreshSnapshot() { throw new Error("must not refresh"); },
  }), (error) => error?.code === "invalid_envelope");
  await assert.rejects(review.issueWorkCandidateReview(baseInput, {
    supportedCommands: commands,
    dispatch(command) {
      const receipt = receiptFor(command);
      receipt.payload.receipt_phase = "review";
      return receipt;
    },
    refreshSnapshot() { throw new Error("must not refresh"); },
  }), (error) => error?.code === "invalid_envelope");
  await assert.rejects(review.issueWorkCandidateReview(baseInput, {
    supportedCommands: commands,
    dispatch() { return { ok: false, code: "stale_snapshot", receipt: "not-an-envelope", envelope: null }; },
    refreshSnapshot() { throw new Error("must not refresh"); },
  }), (error) => error?.code === "invalid_envelope");
  await assert.rejects(review.issueWorkCandidateReview(baseInput, {
    supportedCommands: commands,
    dispatch() { return { ok: false, code: "stale_snapshot", receipt: null, envelope: null }; },
    refreshSnapshot() { throw new Error("must not refresh"); },
  }), (error) => error?.code === "stale_snapshot");
  await assert.rejects(review.issueWorkCandidateReview(baseInput, {
    supportedCommands: commands,
    dispatch() { return { ok: false, code: "invalid_envelope", receipt: null, envelope: null }; },
    refreshSnapshot() { throw new Error("must not refresh"); },
  }), (error) => error?.code === "invalid_envelope");
  await assert.rejects(review.issueWorkCandidateReview(baseInput, {
    supportedCommands: commands,
    dispatch(command) { return { ok: false, code: "stale_snapshot", receipt: "not-an-envelope", envelope: receiptFor(command, { status: "stale_snapshot", after: false }) }; },
    refreshSnapshot() { throw new Error("must not refresh"); },
  }), (error) => error?.code === "invalid_envelope");
});

test("rejects false-success status/revision/task-join mismatches and never refreshes", async () => {
  await assert.rejects(review.issueWorkCandidateReview(baseInput, {
    supportedCommands: commands,
    dispatch(command) { return receiptFor(command, { status: "rejected" }); },
    refreshSnapshot() { throw new Error("must not refresh"); },
  }), (error) => error?.code === "invalid_envelope");
  await assert.rejects(review.issueWorkCandidateReview(baseInput, {
    supportedCommands: commands,
    dispatch(command) {
      const receipt = receiptFor(command);
      receipt.payload.teacher_review.revision = 9;
      return receipt;
    },
    refreshSnapshot() { throw new Error("must not refresh"); },
  }), (error) => error?.code === "invalid_envelope");
  await assert.rejects(review.issueWorkCandidateReview(baseInput, {
    supportedCommands: commands,
    dispatch(command) { return receiptFor(command); },
    refreshSnapshot() { return snapshotEnvelope({ status: "accepted", revision: 1, teacherReview: { state: "accepted", reviewer_id: "teacher", reviewed_at: "2026-08-28T04:01:00.000Z", note: "教师复核", revision: 1 }, title: "错误任务" }); },
  }), (error) => error?.code === "invalid_envelope");
});
