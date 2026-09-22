import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const intake = await jiti.import("./edupi-education-intake.ts");
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
