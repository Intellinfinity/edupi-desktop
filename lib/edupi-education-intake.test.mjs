import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const intake = await jiti.import("./edupi-education-intake.ts");
const { EduPiCoreProcessError } = await jiti.import("./edupi-core-process-client.ts");
const contract = await jiti.import("./edupi-bridge-contract.ts");
const { activeBridgeIdentity, scheduleOccurrenceIdentity } = await jiti.import("./edupi-bridge-manifest.ts");

const source = {
  source_id: "teacher-calendar-form",
  source_kind: "teacher_message",
  source_hash: `sha256:${"a".repeat(64)}`,
  evidence_ids: ["teacher-calendar-evidence"],
};
const command = {
  command_type: "import_calendar",
  source,
  events: [{ event_id: "event-1", date: "2026-09-01", end_date: null, name: "开学", type: "teaching", confidence: "teacher_confirmed", notes: null }],
};

function acceptedResponse(envelope) {
  const bridge = activeBridgeIdentity().contract;
  const identity = envelope.contract_version === "1.2" ? scheduleOccurrenceIdentity() : activeBridgeIdentity().contract;
  const teacherReview = { state: "accepted", reviewer_id: "teacher", reviewed_at: envelope.issued_at, note: null, revision: 1 };
  const target = { target_kind: "calendar_import", target_id: "calendar-import-1", command_type: "import_calendar" };
  return {
    ok: true,
    operation: "command",
    request_id: envelope.request_id,
    supported_commands: bridge.supported_commands,
    supported_projections: bridge.supported_projections,
    receipt: {
      contract_version: envelope.contract_version,
      message_id: "receipt-1",
      request_id: envelope.request_id,
      issued_at: envelope.issued_at,
      producer: "edupi-core",
      schema_hash: identity.schema_hash,
      snapshot_id: "snapshot-after",
      provenance: envelope.provenance,
      teacher_review: teacherReview,
      external_send: false,
      payload: {
        receipt_id: "receipt-1",
        command_id: envelope.message_id,
        request_id: envelope.request_id,
        command_type: "import_calendar",
        target,
        receipt_phase: "mutation",
        decision: null,
        status: "accepted",
        applied_ids: ["event-1"],
        rejected_ids: [],
        reason_code: null,
        evidence_ids: source.evidence_ids,
        before_snapshot_id: "snapshot-before",
        after_snapshot_id: "snapshot-after",
        before_state_hash: "sha256:before",
        after_state_hash: "sha256:after",
        teacher_review: teacherReview,
        external_send: false,
        rollback: { available: false, rollback_id: null, expires_at: null },
        preview_token: null,
        action_authorization: null,
        created_at: envelope.issued_at,
      },
    },
  };
}

test("builds a pinned, source-bound and teacher-internal education intake command", () => {
  const envelope = intake.buildEducationIntakeCommandEnvelope({
    snapshotId: "snapshot-before",
    command,
    issuedAt: "2026-08-28T10:00:00.000Z",
    requestId: "request-1",
    messageId: "message-1",
    idempotencyKey: "idempotency-1",
  });
  assert.equal(contract.validateCoreEnvelopeSchema(envelope), true);
  assert.equal(envelope.external_send, false);
  assert.equal(envelope.provenance[0].source_path, null);
  assert.equal(envelope.provenance[0].source_hash, source.source_hash);
  assert.deepEqual(envelope.command, command);
});

test("uses the separate v1.2 identity only for typed calendar occurrences", async () => {
  const occurrence = { ...command, events: [{ ...command.events[0], source_occurrence_ref: "manual-42",
    time_interval: { start: "2026-09-01T09:00+08:00", end: "2026-09-01T10:00+08:00", time_zone: "Asia/Shanghai" },
    location: "东楼" }] };
  const envelope = intake.buildEducationIntakeCommandEnvelope({ snapshotId: "snapshot-before", command: occurrence,
    issuedAt: "2026-08-28T10:00:00.000Z", requestId: "request-occurrence", messageId: "message-occurrence", idempotencyKey: "idem-occurrence" });
  assert.equal(envelope.contract_version, "1.2");
  assert.equal(envelope.schema_hash, scheduleOccurrenceIdentity().schema_hash);
  assert.equal(intake.buildEducationIntakeCommandEnvelope({ snapshotId: "snapshot-before", command }).contract_version, "1.1");
  const result = await intake.issueEducationIntake(occurrence, {
    readSnapshot: async () => ({ payload: { snapshot_id: "snapshot-before", state_hash: "sha256:before", education_workspace: {} }, roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async (request) => acceptedResponse(request),
    refreshSnapshot: async () => ({ snapshot_id: "snapshot-after", state_hash: "sha256:after", education_workspace: {} }),
  });
  assert.equal(result.receipt.status, "accepted");
});

test("accepts only a bound Core receipt followed by its exact refreshed snapshot", async () => {
  let captured;
  const result = await intake.issueEducationIntake(command, {
    readSnapshot: async () => ({ payload: { snapshot_id: "snapshot-before", state_hash: "sha256:before", education_workspace: {} }, roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async (envelope) => {
      captured = envelope;
      return acceptedResponse(envelope);
    },
    refreshSnapshot: async () => ({ snapshot_id: "snapshot-after", state_hash: "sha256:after", education_workspace: {} }),
  });
  assert.equal(contract.validateCoreEnvelopeSchema(captured), true);
  assert.equal(result.receipt.status, "accepted");
  assert.equal(result.data.snapshot_id, "snapshot-after");
});

test("material proposal metadata is exposed independently after the original intake receipt and canonical readback", async () => {
  const material = { command_type: "intake_material", source: { ...source, source_kind: "teacher_file" }, material: {
    material_id: "material-original", staging_id: "stage-original", staging_path: ".edupi/inbox/.desktop-staging/material-original.txt",
    source_path: null, source_hash: source.source_hash, expected_size_bytes: 20, kind: "other", title: "Synthetic", subject: null, class_id: null, source_scope: "desktop_staging",
  } };
  const proposal = { status: "unavailable", material_id: material.material.material_id, read_result: null, reason_code: "owner_control_disabled",
    read_only: true, automatic_import: false, external_send: false };
  const lesson = { status: "held", material_id: material.material.material_id, lesson: null, reason_code: "lesson_date_required",
    read_only: true, automatic_prepare: false, external_send: false };
  let original, dispatched = 0;
  const responseFor = envelope => {
    const value = acceptedResponse(envelope);
    value.receipt.payload.command_type = "intake_material";
    value.receipt.payload.target = { target_kind: "material_intake", target_id: material.material.material_id, command_type: "intake_material" };
    value.receipt.payload.applied_ids = [material.material.material_id];
    return value;
  };
  const result = await intake.issueEducationIntake(material, {
    readSnapshot: async () => ({ payload: { snapshot_id: "snapshot-before", state_hash: "sha256:before", education_workspace: {} }, roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async envelope => { dispatched++; original = responseFor(envelope); return original; },
    dispatchWithMetadata: async envelope => { dispatched++; original = responseFor(envelope); return { response: original, bridgeFrame: `${JSON.stringify(original)}\n`, runtimeMetadata: { materialScheduleProposal: proposal, materialLessonProposal: lesson } }; },
    refreshSnapshot: async () => ({ snapshot_id: "snapshot-after", state_hash: "sha256:after", education_workspace: {} }),
  });
  assert.deepEqual(result.receipt, original.receipt.payload);
  assert.deepEqual(result.materialScheduleProposal, proposal, "do not discard the Runtime sidecar or turn it into a receipt field");
  assert.deepEqual(result.materialLessonProposal, lesson, "DOCX suggestion remains a separate read-only sidecar");
  assert.equal(result.receipt.material_schedule_proposal, undefined);
  assert.equal(result.receipt.materialScheduleProposal, undefined);
  assert.equal(result.receipt.material_lesson_proposal, undefined);
  assert.equal(dispatched, 1);
  assert.equal(result.data.snapshot_id, "snapshot-after");
});

test("a transient material source replay accepts newer readback only with its exact canonical source proof", async () => {
  const material = { command_type: "intake_material", source: { ...source, source_kind: "teacher_file", source_id: "synthetic-material-source", evidence_ids: ["new-staging"] }, material: {
    material_id: "replayed-material", staging_id: "new-staging", staging_path: ".edupi/inbox/.desktop-staging/replayed-material.ics",
    source_path: null, source_hash: source.source_hash, expected_size_bytes: 20, kind: "other", title: "Synthetic replay", subject: null, class_id: null, source_scope: "desktop_staging",
  } };
  const replayTarget = { target_kind: "material_intake", target_id: "canonical-material-target", command_type: "intake_material" };
  const canonical = { receipt_id: "canonical-material-receipt", command_id: "canonical-material-command", request_id: "canonical-material-request",
    command_type: "intake_material", target: replayTarget, receipt_phase: "mutation", decision: null, revision: 1, status: "accepted",
    applied_ids: [material.material.material_id], rejected_ids: [], evidence_ids: ["old-staging"], external_send: false };
  const target = { projection_kind: "material_intake", target: replayTarget, revision: 1, status: "accepted", source_ids: [material.source.source_id],
    evidence_ids: ["old-staging"], staging_id: "old-staging", source_hash: source.source_hash, expected_size_bytes: 20, intake_state: "accepted", external_send: false };
  const run = async ({ alterSnapshot = value => value, alterResponse = value => value, input = material } = {}) => {
    let captured;
    const result = await intake.issueEducationIntake(input, {
      readSnapshot: async () => ({ payload: { snapshot_id: "snapshot-before", state_hash: "sha256:before", education_workspace: {} }, roots: { runtime: {}, dataRoot: {} } }),
      dispatchWithMetadata: async envelope => {
        const original = acceptedResponse(envelope);
        Object.assign(original.receipt.payload, { command_type: "intake_material", target: replayTarget, applied_ids: [material.material.material_id],
          reason_code: "already_applied", after_snapshot_id: "snapshot-before", after_state_hash: "sha256:before" });
        original.receipt.snapshot_id = "snapshot-before";
        captured = alterResponse(original);
        return { response: captured, bridgeFrame: JSON.stringify(captured), runtimeMetadata: {} };
      },
      refreshSnapshot: async () => alterSnapshot({ snapshot_id: "snapshot-newer", state_hash: "sha256:newer", education_workspace: {},
        receipts: [structuredClone(canonical)], review_targets: [structuredClone(target)] }),
    });
    assert.deepEqual(result.receipt, captured.receipt.payload, "a source replay observation stays unchanged and is not replaced by the earlier canonical receipt");
    assert.equal(result.data.snapshot_id, "snapshot-newer");
    return result;
  };
  const result = await run();
  assert.equal(result.receipt.reason_code, "already_applied");
  assert.notEqual(result.receipt.receipt_id, canonical.receipt_id);
  for (const alterSnapshot of [
    data => ({ ...data, receipts: [] }),
    data => ({ ...data, receipts: [data.receipts[0], structuredClone(data.receipts[0])] }),
    data => ({ ...data, receipts: [{ ...data.receipts[0], applied_ids: ["other-material"] }] }),
    data => ({ ...data, receipts: [{ ...data.receipts[0], target: { ...replayTarget, target_id: "other-target" } }] }),
    data => ({ ...data, receipts: [{ ...data.receipts[0], receipt_phase: "authorization" }] }),
    data => ({ ...data, receipts: [{ ...data.receipts[0], status: "held" }] }),
    data => ({ ...data, review_targets: [] }),
    data => ({ ...data, review_targets: [{ ...data.review_targets[0], source_hash: `sha256:${"b".repeat(64)}` }] }),
    data => ({ ...data, review_targets: [{ ...data.review_targets[0], source_ids: ["other-source"] }] }),
    data => ({ ...data, review_targets: [{ ...data.review_targets[0], expected_size_bytes: 21 }] }),
    data => ({ ...data, review_targets: [{ ...data.review_targets[0], intake_state: "pending" }] }),
    data => ({ ...data, review_targets: [{ ...data.review_targets[0], evidence_ids: ["different-canonical-staging"] }] }),
    data => ({ ...data, review_targets: [{ ...data.review_targets[0], external_send: true }] }),
  ]) await assert.rejects(run({ alterSnapshot }), error => error.code === "invalid_envelope");
  for (const reason of [null, "accepted", "unrecognized_replay"]) {
    await assert.rejects(run({ alterResponse: value => { value.receipt.payload.reason_code = reason; return value; } }), error => error.code === "invalid_envelope");
  }
  await assert.rejects(run({ input: { ...material, source: { ...material.source, source_kind: "teacher_message" } } }), error => error.code === "invalid_envelope");
});

test("known Core writer denials preserve the code without exposing diagnostic text", async () => {
  for (const code of ["writer_admission_required", "writer_admission_unavailable", "writer_admission_invalidated", "writer_admission_layout_mismatch"]) {
    let readbacks = 0;
    await assert.rejects(intake.issueEducationIntake(command, {
      readSnapshot: async () => ({ payload: { snapshot_id: "snapshot-before", education_workspace: {} }, roots: { runtime: {}, dataRoot: {} } }),
      dispatch: async () => ({ ok: false, operation: "command", code, error: "private diagnostic /private/teacher-data/secret.json" }),
      refreshSnapshot: async () => { readbacks++; throw new Error("must not read a success snapshot"); },
    }), error => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /private|secret/);
      return true;
    });
    assert.equal(readbacks, 0);
  }
  await assert.rejects(intake.issueEducationIntake(command, {
    readSnapshot: async () => ({ payload: { snapshot_id: "snapshot-before", education_workspace: {} }, roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async () => ({ ok: false, operation: "command", code: "writer_admission_unknown_secret", error: "private secret" }),
  }), error => error.code === "unavailable" && !error.message.includes("secret"));
  await assert.rejects(intake.issueEducationIntake(command, {
    readSnapshot: async () => ({ payload: { snapshot_id: "snapshot-before", education_workspace: {} }, roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async () => { throw new EduPiCoreProcessError("writer_admission_unavailable", "private diagnostic /private/teacher-data/secret.json"); },
  }), error => error.code === "writer_admission_unavailable" && !error.message.includes("private"));
});

test("accepts a newer Core snapshot when it persists the exact accepted receipt", async () => {
  let accepted;
  const result = await intake.issueEducationIntake(command, {
    readSnapshot: async () => ({ payload: { snapshot_id: "snapshot-before", state_hash: "sha256:before", education_workspace: {} }, roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async (envelope) => {
      accepted = acceptedResponse(envelope);
      return accepted;
    },
    refreshSnapshot: async () => ({
      snapshot_id: "snapshot-newer",
      state_hash: "sha256:newer",
      education_workspace: {},
      receipts: [{ ...accepted.receipt.payload }],
    }),
  });
  assert.equal(result.receipt.receipt_id, "receipt-1");
  assert.equal(result.data.snapshot_id, "snapshot-newer");
});

test("rejects a newer Core snapshot when the accepted receipt is absent", async () => {
  await assert.rejects(
    () => intake.issueEducationIntake(command, {
      readSnapshot: async () => ({ payload: { snapshot_id: "snapshot-before", state_hash: "sha256:before", education_workspace: {} }, roots: { runtime: {}, dataRoot: {} } }),
      dispatch: async (envelope) => acceptedResponse(envelope),
      refreshSnapshot: async () => ({ snapshot_id: "snapshot-newer", state_hash: "sha256:newer", education_workspace: {}, receipts: [] }),
    }),
    (error) => error instanceof intake.EducationIntakeError && error.code === "invalid_envelope",
  );
});
