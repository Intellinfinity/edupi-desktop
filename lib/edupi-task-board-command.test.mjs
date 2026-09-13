import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const commands = await jiti.import("./edupi-task-board-command.ts");
const contract = await jiti.import("./edupi-bridge-contract.ts");
const { activeBridgeIdentity } = await jiti.import("./edupi-bridge-manifest.ts");

const source = {
  source_id: "desktop-task-create-1",
  source_kind: "teacher_message",
  source_hash: `sha256:${"a".repeat(64)}`,
  evidence_ids: ["task-create-evidence"],
};
const createCommand = {
  command_type: "create_task",
  source,
  task: { task_id: "teacher-task-1", title: "准备第一次单元检测", due_date: "2026-09-10", note: "先整理范围", preparation_source: { kind: "teaching_before_class", timetable_slot_id: "slot-1", lesson_date: "2026-09-11", material_ids: ["material-1"], deliverables: ["检测卷", "参考答案"] } },
};

function successfulResponse(envelope, { commandType, status, afterSnapshotId = "snapshot-after", afterStateHash = "sha256:after", targetId = "teacher-task-1", appliedIds = ["teacher-task-1"] }) {
  const identity = activeBridgeIdentity();
  const teacherReview = { state: "accepted", reviewer_id: "teacher", reviewed_at: envelope.issued_at, note: null, revision: 0 };
  return {
    ok: true,
    operation: "command",
    request_id: envelope.request_id,
    supported_commands: identity.contract.supported_commands,
    supported_projections: identity.contract.supported_projections,
    receipt: {
      contract_version: "1.1",
      message_id: `receipt-${commandType}`,
      request_id: envelope.request_id,
      issued_at: envelope.issued_at,
      producer: "edupi-core",
      schema_hash: identity.contract.schema_hash,
      snapshot_id: afterSnapshotId,
      provenance: envelope.provenance,
      teacher_review: teacherReview,
      external_send: false,
      payload: {
        receipt_id: `receipt-${commandType}`,
        command_id: envelope.message_id,
        request_id: envelope.request_id,
        command_type: commandType,
        target: { target_kind: "task", target_id: targetId, command_type: commandType },
        receipt_phase: "mutation",
        decision: null,
        status,
        applied_ids: appliedIds,
        rejected_ids: [],
        reason_code: null,
        evidence_ids: source.evidence_ids,
        before_snapshot_id: "snapshot-before",
        after_snapshot_id: afterSnapshotId,
        before_state_hash: "sha256:before",
        after_state_hash: afterStateHash,
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

test("builds strict source-bound create and move task commands", () => {
  const create = commands.buildTaskBoardCommandEnvelope({ snapshotId: "snapshot-before", command: createCommand, issuedAt: "2026-08-30T10:00:00.000Z", requestId: "request-create", messageId: "message-create", idempotencyKey: "idempotency-create" });
  assert.equal(contract.validateCoreEnvelopeSchema(create), true);
  assert.equal(create.external_send, false);
  assert.equal(create.provenance[0].source_id, source.source_id);
  assert.deepEqual(create.command, createCommand);

  assert.throws(() => commands.buildTaskBoardCommandEnvelope({ snapshotId: "snapshot-before", command: { ...createCommand, task: { ...createCommand.task, preparation_source: { ...createCommand.task.preparation_source, material_ids: [] } } } }), (error) => error?.code === "invalid_envelope");

  const moveCommand = { command_type: "move_task_stage", source: { ...source, source_id: "desktop-task-move-1" }, task_id: "teacher-task-1", expected_revision: 0, to_stage: "progress", note: null };
  const move = commands.buildTaskBoardCommandEnvelope({ snapshotId: "snapshot-before", command: moveCommand, issuedAt: "2026-08-30T10:01:00.000Z", requestId: "request-move", messageId: "message-move", idempotencyKey: "idempotency-move" });
  assert.equal(contract.validateCoreEnvelopeSchema(move), true);
  assert.deepEqual(move.command, moveCommand);
});

test("accepts only a receipt-bound task mutation followed by the exact refreshed task stage", async () => {
  let captured;
  const result = await commands.issueTaskBoardCommand(createCommand, {
    readSnapshot: async () => ({ payload: { snapshot_id: "snapshot-before", state_hash: "sha256:before", education_workspace: { tasks: [] } }, roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async (envelope) => {
      captured = envelope;
      return successfulResponse(envelope, { commandType: "create_task", status: "accepted" });
    },
    refreshSnapshot: async () => ({ snapshot_id: "snapshot-after", state_hash: "sha256:after", education_workspace: { tasks: [{ task_id: "teacher-task-1", board_stage: "todo", board_revision: 0 }] } }),
    envelopeOptions: { idempotencyKey: "stable-create-idempotency" },
  });
  assert.equal(contract.validateCoreEnvelopeSchema(captured), true);
  assert.equal(result.receipt.status, "accepted");
  assert.equal(result.task.board_stage, "todo");
  assert.equal(result.task.board_revision, 0);
  assert.equal(captured.idempotency_key, "stable-create-idempotency");
});

test("rejects a create receipt bound to another task before any automatic start", async () => {
  await assert.rejects(commands.issueTaskBoardCommand(createCommand, {
    readSnapshot: async () => ({ payload: { snapshot_id: "snapshot-before", state_hash: "sha256:before", education_workspace: { tasks: [] } }, roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async (envelope) => successfulResponse(envelope, { commandType: "create_task", status: "accepted", targetId: "teacher-task-other", appliedIds: ["teacher-task-other"] }),
    refreshSnapshot: async () => { throw new Error("must not refresh an unbound receipt"); },
  }), (error) => error?.code === "invalid_envelope");
});

test("rejects a refreshed snapshot that does not contain the requested stage", async () => {
  await assert.rejects(commands.issueTaskBoardCommand({ command_type: "move_task_stage", source, task_id: "teacher-task-1", expected_revision: 0, to_stage: "progress", note: null }, {
    readSnapshot: async () => ({ payload: { snapshot_id: "snapshot-before", state_hash: "sha256:before", education_workspace: { tasks: [{ task_id: "teacher-task-1", board_stage: "todo", board_revision: 0 }] } }, roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async (envelope) => successfulResponse(envelope, { commandType: "move_task_stage", status: "modified" }),
    refreshSnapshot: async () => ({ snapshot_id: "snapshot-after", state_hash: "sha256:after", education_workspace: { tasks: [{ task_id: "teacher-task-1", board_stage: "todo", board_revision: 0 }] } }),
  }), (error) => error?.code === "invalid_envelope");
});
