import crypto from "node:crypto";
import { validateCoreEnvelopeSchema } from "./edupi-bridge-contract";
import { activeBridgeIdentity, scheduleOccurrenceIdentity } from "./edupi-bridge-manifest";
import { callEduPiCore } from "./edupi-core-process-client";
import { readEduPiEducationSnapshot, validateScheduleOccurrenceV12Envelope, type CoreEducationSnapshotPayload, type EduPiBridgeRoots } from "./edupi-core-snapshot";

type IntakeSource = {
  source_id: string;
  source_kind: "teacher_message" | "teacher_file" | "core_event";
  source_hash: string | null;
  evidence_ids: string[];
};

export type CalendarImportEvent = {
  event_id: string;
  date: string;
  end_date: string | null;
  name: string;
  type: "exam" | "activity" | "meeting" | "holiday" | "festival" | "teaching" | "custom";
  confidence: "confirmed" | "teacher_confirmed" | "inferred";
  notes: string | null;
  source_occurrence_ref?: string;
  time_interval?: { start: string; end: string; time_zone: string };
  location?: string | null;
};

export type CalendarIntakeInput = {
  eventId: string | null;
  date: string;
  endDate: string | null;
  name: string;
  type: string;
  notes: string | null;
  sourceOccurrenceRef: string | null;
  startAt: string | null;
  endAt: string | null;
  timeZone: string | null;
  location: string | null;
};

export type TimetableImportSlot = {
  slot_id: string;
  day_of_week: number;
  period: number;
  subject: string;
  class_name: string | null;
  kind: "class" | "routine";
  notes: string | null;
};

export type MaterialIntake = {
  material_id: string;
  staging_id: string;
  staging_path: string;
  source_path: null;
  source_hash: string;
  expected_size_bytes: number;
  kind: "worksheet" | "lesson_note" | "assessment" | "classroom_record" | "other";
  title: string;
  subject: string | null;
  class_id: string | null;
  source_scope: "desktop_staging";
};

export type EducationIntakeCommand =
  | { command_type: "import_calendar"; source: IntakeSource; events: CalendarImportEvent[] }
  | { command_type: "import_timetable"; source: IntakeSource; slots: TimetableImportSlot[] }
  | { command_type: "intake_material"; source: IntakeSource; material: MaterialIntake };

type RawRecord = Record<string, unknown>;

export class EducationIntakeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "EducationIntakeError";
  }
}

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function sameList(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function snapshotContainsReceipt(snapshot: CoreEducationSnapshotPayload, expected: RawRecord): boolean {
  const receipts = Array.isArray(snapshot.receipts) ? snapshot.receipts : [];
  return receipts.some((value) => {
    const receipt = record(value);
    if (!receipt) return false;
    return receipt.receipt_id === expected.receipt_id
      && receipt.command_id === expected.command_id
      && receipt.request_id === expected.request_id
      && receipt.command_type === expected.command_type
      && receipt.status === expected.status
      && receipt.before_snapshot_id === expected.before_snapshot_id
      && receipt.after_snapshot_id === expected.after_snapshot_id
      && receipt.before_state_hash === expected.before_state_hash
      && receipt.after_state_hash === expected.after_state_hash
      && receipt.external_send === false
      && sameList(receipt.applied_ids, Array.isArray(expected.applied_ids) ? expected.applied_ids.map(String) : [])
      && sameList(receipt.rejected_ids, Array.isArray(expected.rejected_ids) ? expected.rejected_ids.map(String) : []);
  });
}

function boundedId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function contentHash(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function usesScheduleOccurrenceV12(command: EducationIntakeCommand): boolean {
  return command.command_type === "import_calendar" && command.events.some((event) =>
    event.source_occurrence_ref !== undefined || event.time_interval !== undefined || event.location !== undefined);
}

export function buildEducationIntakeCommandEnvelope({
  snapshotId,
  command,
  issuedAt = new Date().toISOString(),
  requestId = boundedId("intake-request"),
  messageId = boundedId("intake-message"),
  idempotencyKey = boundedId("intake-idempotency"),
}: {
  snapshotId: string;
  command: EducationIntakeCommand;
  issuedAt?: string;
  requestId?: string;
  messageId?: string;
  idempotencyKey?: string;
}): RawRecord {
  const occurrence = usesScheduleOccurrenceV12(command);
  const identity = occurrence ? scheduleOccurrenceIdentity() : activeBridgeIdentity().contract;
  const provenance = [{
    source_kind: command.source.source_kind,
    source_id: command.source.source_id,
    source_path: null,
    source_hash: command.source.source_hash,
    observed_at: issuedAt,
    actor: "teacher",
    evidence_ids: [...command.source.evidence_ids],
    parent_ids: [],
  }];
  const envelope = {
    contract_version: identity.contract_version,
    message_id: messageId,
    request_id: requestId,
    issued_at: issuedAt,
    producer: "edupi-desktop",
    schema_hash: identity.schema_hash,
    snapshot_id: snapshotId,
    idempotency_key: idempotencyKey,
    provenance,
    teacher_review: { state: "pending_review", reviewer_id: null, reviewed_at: null, note: null, revision: 0 },
    external_send: false,
    command,
  };
  if (!(occurrence ? validateScheduleOccurrenceV12Envelope(envelope) : validateCoreEnvelopeSchema(envelope))) {
    throw new EducationIntakeError("invalid_envelope", "教育导入请求无效。");
  }
  return envelope;
}

type SnapshotResult = {
  payload: CoreEducationSnapshotPayload;
  roots: EduPiBridgeRoots;
};

type IntakeDependencies = {
  readSnapshot?: () => Promise<SnapshotResult>;
  dispatch?: (envelope: RawRecord, roots: EduPiBridgeRoots) => Promise<unknown>;
  refreshSnapshot?: (roots: EduPiBridgeRoots) => Promise<CoreEducationSnapshotPayload>;
};

async function productionSnapshot(): Promise<SnapshotResult> {
  const snapshot = await readEduPiEducationSnapshot();
  return { payload: snapshot.payload, roots: { runtime: snapshot.runtime, dataRoot: snapshot.dataRoot } };
}

function validateReceiptResponse(value: unknown, envelope: RawRecord): { receiptEnvelope: RawRecord; receipt: RawRecord } {
  const response = record(value);
  const bridge = activeBridgeIdentity();
  const occurrence = envelope.contract_version === "1.2";
  const identity = occurrence ? scheduleOccurrenceIdentity() : bridge.contract;
  if (!response || response.ok !== true || response.operation !== "command"
    || !sameList(response.supported_commands, bridge.contract.supported_commands)
    || !sameList(response.supported_projections, bridge.contract.supported_projections)) {
    throw new EducationIntakeError("unavailable", "Core 教育导入回执不可用。");
  }
  const receiptEnvelope = record(response.receipt);
  if (!receiptEnvelope || !(occurrence ? validateScheduleOccurrenceV12Envelope(receiptEnvelope) : validateCoreEnvelopeSchema(receiptEnvelope))
    || receiptEnvelope.producer !== "edupi-core" || receiptEnvelope.external_send !== false
    || receiptEnvelope.contract_version !== identity.contract_version || receiptEnvelope.schema_hash !== identity.schema_hash
    || receiptEnvelope.request_id !== envelope.request_id) {
    throw new EducationIntakeError("invalid_envelope", "Core 教育导入回执无效。");
  }
  const receipt = record(receiptEnvelope.payload);
  if (!receipt || receipt.command_id !== envelope.message_id || receipt.request_id !== envelope.request_id
    || receipt.command_type !== record(envelope.command)?.command_type
    || receipt.before_snapshot_id !== envelope.snapshot_id || receipt.before_state_hash === undefined
    || receipt.external_send !== false || receipt.decision !== null) {
    throw new EducationIntakeError("invalid_envelope", "Core 教育导入回执绑定无效。");
  }
  return { receiptEnvelope, receipt };
}

export async function issueEducationIntake(command: EducationIntakeCommand, dependencies: IntakeDependencies = {}): Promise<{
  receipt: RawRecord;
  data: CoreEducationSnapshotPayload | null;
}> {
  const identity = activeBridgeIdentity();
  if (!identity.contract.supported_commands.includes(command.command_type)) {
    throw new EducationIntakeError("unsupported_command", "当前 Core 尚未启用教育导入。");
  }
  const initial = await (dependencies.readSnapshot || productionSnapshot)();
  const snapshotId = String(initial.payload.snapshot_id || "");
  if (!snapshotId) throw new EducationIntakeError("unavailable", "Core 教育快照不可用。");
  const envelope = buildEducationIntakeCommandEnvelope({ snapshotId, command });
  const dispatch = dependencies.dispatch || ((nextEnvelope, roots) => callEduPiCore({
    operation: "command",
    requestId: String(nextEnvelope.request_id),
    runtime: roots.runtime,
    dataRoot: roots.dataRoot,
    envelope: nextEnvelope,
  }));
  let rawReceipt: unknown;
  try {
    rawReceipt = await dispatch(envelope, initial.roots);
  } catch {
    throw new EducationIntakeError("unavailable", "Core 教育导入暂不可用。");
  }
  const { receiptEnvelope, receipt } = validateReceiptResponse(rawReceipt, envelope);
  const status = String(receipt.status || "");
  if (status === "failed" || status === "stale_snapshot") {
    if (receipt.after_snapshot_id !== null || receipt.after_state_hash !== null || receiptEnvelope.snapshot_id !== receipt.before_snapshot_id) {
      throw new EducationIntakeError("invalid_envelope", "Core 失败回执绑定无效。");
    }
    if (status === "stale_snapshot") throw new EducationIntakeError("stale_snapshot", "教育数据已更新，请重试。");
    throw new EducationIntakeError(String(receipt.reason_code || "failed"), "Core 未接收这次教育导入。");
  }
  if (!["accepted", "modified", "held"].includes(status)
    || typeof receipt.after_snapshot_id !== "string" || typeof receipt.after_state_hash !== "string"
    || receiptEnvelope.snapshot_id !== receipt.after_snapshot_id) {
    throw new EducationIntakeError("invalid_envelope", "Core 成功回执绑定无效。");
  }
  const refresh = dependencies.refreshSnapshot || (async (roots) => (await readEduPiEducationSnapshot({ roots })).payload);
  const data = await refresh(initial.roots);
  const exactAfterSnapshot = data.snapshot_id === receipt.after_snapshot_id && data.state_hash === receipt.after_state_hash;
  if (!exactAfterSnapshot && !snapshotContainsReceipt(data, receipt)) {
    throw new EducationIntakeError("invalid_envelope", "Core 导入后的快照与回执不一致。");
  }
  return { receipt, data };
}
