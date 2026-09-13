import crypto from "node:crypto";
import { validateCoreEnvelopeSchema } from "./edupi-bridge-contract";
import { activeBridgeIdentity } from "./edupi-bridge-manifest";
import { callEduPiCore } from "./edupi-core-process-client";
import { readEduPiEducationSnapshot, type CoreEducationSnapshotPayload, type EduPiBridgeRoots } from "./edupi-core-snapshot";

type RawRecord = Record<string, unknown>;
export type TaskBoardStage = "todo" | "progress" | "review" | "done";
export type TaskBoardSource = { source_id: string; source_kind: "teacher_message"; source_hash: string; evidence_ids: string[] };
export type TeacherCreatedPreparationSource = { kind: "teaching_before_class"; timetable_slot_id: string; lesson_date: string; material_ids: string[]; deliverables: string[] };
export type TeacherCreatedPreparationInput = { kind: "teaching_before_class"; timetableSlotId: string; lessonDate: string; materialIds: string[]; deliverables: string[] };
export type CreateTeacherTaskInput = { clientRequestId: string; title: string; dueDate: string | null; note: string | null; preparationSource: TeacherCreatedPreparationInput | null };
export type CreateTeacherTaskOutcome = { preparationState: "running" | "ready" | "error" | null; preparationError: string | null };
export type CreateTaskCommand = { command_type: "create_task"; source: TaskBoardSource; task: { task_id: string; title: string; due_date: string | null; note: string | null; preparation_source?: TeacherCreatedPreparationSource | null } };
export type MoveTaskStageCommand = { command_type: "move_task_stage"; source: TaskBoardSource; task_id: string; expected_revision: number; to_stage: TaskBoardStage; note: string | null };
export type TaskBoardCommand = CreateTaskCommand | MoveTaskStageCommand;

export class TaskBoardCommandError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "TaskBoardCommandError";
  }
}

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function sameList(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function taskBoardContentHash(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function buildTaskBoardCommandEnvelope({
  snapshotId,
  command,
  issuedAt = new Date().toISOString(),
  requestId = id("task-board-request"),
  messageId = id("task-board-message"),
  idempotencyKey = id("task-board-idempotency"),
}: {
  snapshotId: string;
  command: TaskBoardCommand;
  issuedAt?: string;
  requestId?: string;
  messageId?: string;
  idempotencyKey?: string;
}): RawRecord {
  const identity = activeBridgeIdentity();
  const envelope = {
    contract_version: identity.contract.contract_version,
    message_id: messageId,
    request_id: requestId,
    issued_at: issuedAt,
    producer: "edupi-desktop",
    schema_hash: identity.contract.schema_hash,
    snapshot_id: snapshotId,
    idempotency_key: idempotencyKey,
    provenance: [{
      source_kind: command.source.source_kind,
      source_id: command.source.source_id,
      source_path: null,
      source_hash: command.source.source_hash,
      observed_at: issuedAt,
      actor: "teacher",
      evidence_ids: [...command.source.evidence_ids],
      parent_ids: [],
    }],
    teacher_review: { state: "pending_review", reviewer_id: null, reviewed_at: null, note: null, revision: 0 },
    external_send: false,
    command,
  };
  if (!validateCoreEnvelopeSchema(envelope)) throw new TaskBoardCommandError("invalid_envelope", "任务板命令无效。");
  return envelope;
}

type SnapshotResult = { payload: CoreEducationSnapshotPayload; roots: EduPiBridgeRoots };
type Dependencies = {
  readSnapshot?: () => Promise<SnapshotResult>;
  dispatch?: (envelope: RawRecord, roots: EduPiBridgeRoots) => Promise<unknown>;
  refreshSnapshot?: (roots: EduPiBridgeRoots) => Promise<CoreEducationSnapshotPayload>;
  envelopeOptions?: { requestId?: string; messageId?: string; idempotencyKey?: string; issuedAt?: string };
};

async function productionSnapshot(): Promise<SnapshotResult> {
  const snapshot = await readEduPiEducationSnapshot();
  return { payload: snapshot.payload, roots: { runtime: snapshot.runtime, dataRoot: snapshot.dataRoot } };
}

function taskFromPayload(payload: RawRecord, taskId: string): RawRecord | null {
  const workspace = record(payload.education_workspace);
  const tasks = Array.isArray(workspace?.tasks) ? workspace.tasks.map(record).filter((task): task is RawRecord => task !== null) : [];
  const matches = tasks.filter((task) => task.task_id === taskId);
  if (matches.length !== 1) return null;
  return matches[0];
}

export async function issueTaskBoardCommand(command: TaskBoardCommand, dependencies: Dependencies = {}): Promise<{ receipt: RawRecord; data: CoreEducationSnapshotPayload | null; task: RawRecord | null; replayed: boolean; refreshPending: boolean }> {
  const identity = activeBridgeIdentity();
  if (!identity.contract.supported_commands.includes(command.command_type)) throw new TaskBoardCommandError("unsupported_command", "当前 Core 尚未启用可写任务板。");
  const initial = await (dependencies.readSnapshot || productionSnapshot)();
  const snapshotId = String(initial.payload.snapshot_id || "");
  if (!snapshotId) throw new TaskBoardCommandError("unavailable", "Core 教育快照不可用。");
  const envelope = buildTaskBoardCommandEnvelope({ snapshotId, command, ...dependencies.envelopeOptions });
  const dispatch = dependencies.dispatch || ((nextEnvelope, roots) => callEduPiCore({ operation: "command", requestId: String(nextEnvelope.request_id), runtime: roots.runtime, dataRoot: roots.dataRoot, envelope: nextEnvelope }));
  let rawResponse: unknown;
  try {
    rawResponse = await dispatch(envelope, initial.roots);
  } catch {
    throw new TaskBoardCommandError("unavailable", "Core 任务板暂不可用。");
  }
  const response = record(rawResponse);
  if (!response || response.ok !== true || response.operation !== "command"
    || response.request_id !== envelope.request_id
    || !sameList(response.supported_commands, identity.contract.supported_commands)
    || !sameList(response.supported_projections, identity.contract.supported_projections)) {
    throw new TaskBoardCommandError("unavailable", "Core 任务板回执不可用。");
  }
  const replayed = response.replayed === true;
  const receiptEnvelope = record(response.receipt);
  const receipt = record(receiptEnvelope?.payload);
  const taskId = command.command_type === "create_task" ? command.task.task_id : command.task_id;
  const target = record(receipt?.target);
  if (!receiptEnvelope || !receipt || !validateCoreEnvelopeSchema(receiptEnvelope)
    || receiptEnvelope.producer !== "edupi-core" || receiptEnvelope.external_send !== false
    || receipt.command_type !== command.command_type
    || target?.target_kind !== "task" || target.target_id !== taskId || target.command_type !== command.command_type
    || receipt.external_send !== false || receipt.decision !== null) {
    throw new TaskBoardCommandError("invalid_envelope", "Core 任务板回执绑定无效。");
  }
  if (!replayed && (receiptEnvelope.request_id !== envelope.request_id || receipt.command_id !== envelope.message_id || receipt.before_snapshot_id !== snapshotId)) {
    throw new TaskBoardCommandError("invalid_envelope", "Core 任务板回执绑定无效。");
  }
  const status = String(receipt.status || "");
  if (status === "failed" || status === "stale_snapshot") {
    if (replayed) throw new TaskBoardCommandError("invalid_envelope", "Core 任务板重放回执无效。");
    if (receipt.after_snapshot_id !== null || receipt.after_state_hash !== null || receiptEnvelope.snapshot_id !== receipt.before_snapshot_id
      || !sameList(receipt.applied_ids, []) || !sameList(receipt.rejected_ids, [])) {
      throw new TaskBoardCommandError("invalid_envelope", "Core 任务板失败回执绑定无效。");
    }
    const reasonCode = String(receipt.reason_code || status);
    throw new TaskBoardCommandError(reasonCode, status === "stale_snapshot"
      ? "任务数据已更新，请刷新后重试。"
      : reasonCode === "invalid_preparation_context"
        ? "上课日期与所选课次不一致，请重新选择。"
        : "Core 未接受这次任务板操作。");
  }
  if (!((command.command_type === "create_task" && status === "accepted") || (command.command_type === "move_task_stage" && status === "modified"))
    || typeof receipt.after_snapshot_id !== "string" || typeof receipt.after_state_hash !== "string"
    || receiptEnvelope.snapshot_id !== receipt.after_snapshot_id || !sameList(receipt.applied_ids, [taskId]) || !sameList(receipt.rejected_ids, [])) {
    throw new TaskBoardCommandError("invalid_envelope", "Core 任务板成功回执无效。");
  }
  const refresh = dependencies.refreshSnapshot || (async (roots) => (await readEduPiEducationSnapshot({ roots })).payload);
  let data: CoreEducationSnapshotPayload;
  try {
    data = await refresh(initial.roots);
  } catch {
    if (command.command_type === "create_task") return { receipt, data: null, task: null, replayed, refreshPending: true };
    throw new TaskBoardCommandError("unavailable", "Core 任务板结果暂不可读。");
  }
  const task = taskFromPayload(data as unknown as RawRecord, taskId);
  if (replayed) {
    if (!task) throw new TaskBoardCommandError("invalid_envelope", "Core 重放后的任务不可用。");
    return { receipt, data, task, replayed: true, refreshPending: false };
  }
  if (data.snapshot_id !== receipt.after_snapshot_id || data.state_hash !== receipt.after_state_hash) throw new TaskBoardCommandError("invalid_envelope", "Core 任务板快照与回执不一致。");
  const expectedStage = command.command_type === "create_task" ? "todo" : command.to_stage;
  const expectedRevision = command.command_type === "create_task" ? 0 : command.expected_revision + 1;
  if (!task || task.board_stage !== expectedStage || task.board_revision !== expectedRevision) throw new TaskBoardCommandError("invalid_envelope", "Core 刷新后的任务阶段与回执不一致。");
  return { receipt, data, task, replayed: false, refreshPending: false };
}
