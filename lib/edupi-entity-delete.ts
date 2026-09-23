import { createHash, randomUUID } from "node:crypto";
import type { ResolvedEduPiCore, ResolvedEduPiDataRoot } from "./edupi-core-root";

export const ENTITY_DELETE_KINDS = ["calendar", "timetable", "memory", "student", "task", "material", "teaching_priority"] as const;
export type EntityDeleteKind = typeof ENTITY_DELETE_KINDS[number];

type RawRecord = Record<string, unknown>;

type DeleteSnapshot = {
  envelope: RawRecord;
  payload: RawRecord & { education_workspace: RawRecord };
  roots?: { runtime: ResolvedEduPiCore; dataRoot: ResolvedEduPiDataRoot };
};

type DeleteCoreResponse = {
  ok?: boolean;
  operation?: string;
  request_id?: string;
  code?: string;
  action?: string;
  target?: { kind?: string; id?: string };
  external_send?: boolean;
  deleted_at?: string;
  restored_at?: string;
  tombstone_revision?: number;
  target_fingerprint?: string | null;
  snapshot?: RawRecord & { education_workspace?: RawRecord };
};

export type EntityDeletionRecord = {
  kind: EntityDeleteKind;
  id: string;
  label: string | null;
  studentId: string | null;
  reviewTargetId: string | null;
  targetFingerprint: string;
  tombstoneRevision: number;
  deletedAt: string;
  reviewer: string;
  note: string | null;
};

export type EntityDeletionHistory = {
  historyId: string;
  requestId: string;
  action: "delete" | "restore";
  kind: EntityDeleteKind;
  targetId: string;
  targetLabel: string | null;
  targetFingerprint: string;
  tombstoneRevision: number;
  beforeSnapshotId: string | null;
  afterSnapshotId: string | null;
  occurredAt: string;
  reviewer: string;
  note: string | null;
};

export type EntityDeletionLedger = {
  snapshotId: string;
  deletions: EntityDeletionRecord[];
  history: EntityDeletionHistory[];
  historyTruncated: boolean;
};

export type EntityDeletionSummary = { activeCount: number; historyCount: number };
export type EntityDeletionRestoreRecord = EntityDeletionRecord & { restoreRequestId: string };

export function entityRestoreRequestId(record: Pick<EntityDeletionRecord, "kind" | "id" | "targetFingerprint" | "tombstoneRevision">): string {
  const value = `${record.kind}\0${record.id}\0${record.tombstoneRevision}\0${record.targetFingerprint}`;
  return `entity-restore-${createHash("sha256").update(value).digest("base64url")}`;
}

type EntityBridgeRoots = { runtime: ResolvedEduPiCore; dataRoot: ResolvedEduPiDataRoot };

type DeleteListCoreResponse = {
  ok?: boolean;
  operation?: string;
  request_id?: string;
  action?: string;
  code?: string;
  snapshot_id?: string;
  external_send?: boolean;
  deletions?: unknown[];
  history?: unknown[];
  history_truncated?: boolean;
};

export class EntityDeleteError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "EntityDeleteError";
  }
}

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isDeleteKind(value: unknown): value is EntityDeleteKind {
  return typeof value === "string" && ENTITY_DELETE_KINDS.includes(value as EntityDeleteKind);
}

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  return validText(value, max) ? value : undefined;
}

function validFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function optionalFingerprint(value: unknown): string | null | undefined {
  if (value === null) return null;
  return validFingerprint(value) ? value : undefined;
}

function parseDeletion(value: unknown): EntityDeletionRecord | null {
  const source = record(value);
  const target = record(source?.target);
  const studentId = optionalText(source?.student_id, 160);
  const reviewTargetId = optionalText(source?.review_target_id, 160);
  const label = optionalText(source?.label, 240);
  const note = optionalText(source?.note, 1000);
  if (!source || !target || !isDeleteKind(target.kind) || !validText(target.id, 160)
    || !validFingerprint(source.target_fingerprint)
    || !Number.isInteger(source.tombstone_revision) || Number(source.tombstone_revision) < 1
    || !validText(source.deleted_at, 64) || !validText(source.reviewer, 160)
    || studentId === undefined || reviewTargetId === undefined || label === undefined || note === undefined) return null;
  return {
    kind: target.kind,
    id: target.id,
    label,
    studentId,
    reviewTargetId,
    targetFingerprint: source.target_fingerprint,
    tombstoneRevision: Number(source.tombstone_revision),
    deletedAt: source.deleted_at,
    reviewer: source.reviewer,
    note,
  };
}

function parseDeletionHistory(value: unknown): EntityDeletionHistory | null {
  const source = record(value);
  const action = source?.action;
  const beforeSnapshotId = optionalText(source?.before_snapshot_id, 160);
  const afterSnapshotId = optionalText(source?.after_snapshot_id, 160);
  const targetLabel = optionalText(source?.target_label, 240);
  const note = optionalText(source?.note, 1000);
  const beforeStateHash = optionalFingerprint(source?.before_state_hash);
  const afterStateHash = optionalFingerprint(source?.after_state_hash);
  if (!source || !validText(source.mutation_id, 160) || !validText(source.request_id, 160)
    || (action !== "delete" && action !== "restore") || !isDeleteKind(source.target_kind)
    || !validText(source.target_id, 160) || !validFingerprint(source.target_fingerprint)
    || !Number.isInteger(source.tombstone_revision) || Number(source.tombstone_revision) < 1
    || beforeSnapshotId === undefined || afterSnapshotId === undefined || targetLabel === undefined
    || beforeStateHash === undefined || afterStateHash === undefined
    || !validText(source.occurred_at, 64) || !validText(source.reviewer, 160) || note === undefined
    || (source.evidence_quality !== "bound" && source.evidence_quality !== "legacy_tombstone") || source.external_send !== false) return null;
  return {
    historyId: source.mutation_id,
    requestId: source.request_id,
    action,
    kind: source.target_kind,
    targetId: source.target_id,
    targetLabel,
    targetFingerprint: source.target_fingerprint,
    tombstoneRevision: Number(source.tombstone_revision),
    beforeSnapshotId,
    afterSnapshotId,
    occurredAt: source.occurred_at,
    reviewer: source.reviewer,
    note,
  };
}

export function parseEntityDeletionProjection(value: unknown): Pick<EntityDeletionLedger, "deletions" | "history"> {
  const source = record(value);
  if (!source || !Array.isArray(source.entityDeletions) || source.entityDeletions.length > 500
    || !Array.isArray(source.entityDeletionHistory) || source.entityDeletionHistory.length > 50) {
    throw new EntityDeleteError("invalid_response", "Core 删除记录无效。");
  }
  const deletions = source.entityDeletions.map(parseDeletion);
  const history = source.entityDeletionHistory.map(parseDeletionHistory);
  if (deletions.some((item) => item === null) || history.some((item) => item === null)
    || new Set(deletions.map((item) => `${item?.kind}:${item?.id}`)).size !== deletions.length
    || new Set(history.map((item) => item?.historyId)).size !== history.length) {
    throw new EntityDeleteError("invalid_response", "Core 删除记录无效。");
  }
  return { deletions: deletions as EntityDeletionRecord[], history: history as EntityDeletionHistory[] };
}

export function parseEntityDeletionSummary(value: unknown): EntityDeletionSummary {
  const source = record(value);
  const summary = record(source?.entityDeletionSummary);
  if (!summary || !Number.isInteger(summary.active_count) || Number(summary.active_count) < 0 || Number(summary.active_count) > 500
    || !Number.isInteger(summary.history_count) || Number(summary.history_count) < 0 || Number(summary.history_count) > 500) {
    throw new EntityDeleteError("invalid_response", "Core 删除记录摘要无效。");
  }
  return { activeCount: Number(summary.active_count), historyCount: Number(summary.history_count) };
}

function parseDeletionLedger(response: DeleteListCoreResponse, requestId: string): EntityDeletionLedger {
  if (response.ok !== true || response.operation !== "delete" || response.action !== "list"
    || response.request_id !== requestId || response.external_send !== false || !validText(response.snapshot_id, 160)
    || typeof response.history_truncated !== "boolean"
    || !Array.isArray(response.deletions) || response.deletions.length > 500
    || !Array.isArray(response.history) || response.history.length > 50) {
    throw new EntityDeleteError(response.code || "invalid_response", "Core 删除记录无效。");
  }
  const projection = parseEntityDeletionProjection({ entityDeletions: response.deletions, entityDeletionHistory: response.history });
  return { snapshotId: response.snapshot_id, ...projection, historyTruncated: response.history_truncated };
}

export function buildEntityDeletionListRequest(requestId: string) {
  if (!validText(requestId, 160)) throw new EntityDeleteError("invalid_request", "删除记录请求无效。");
  return {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation: "delete",
    request_id: requestId,
    action: "list",
  } as const;
}

export function buildEntityRestoreRequest(input: { record: EntityDeletionRecord; snapshotId: string; note: string | null }, requestId: string) {
  if (!isDeleteKind(input.record.kind) || !validText(input.record.id, 160) || !validText(input.snapshotId, 160)
    || !validFingerprint(input.record.targetFingerprint) || !Number.isInteger(input.record.tombstoneRevision) || input.record.tombstoneRevision < 1
    || !validText(requestId, 160) || (input.note !== null && !validText(input.note, 1000))) {
    throw new EntityDeleteError("invalid_request", "恢复对象无效。");
  }
  return {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation: "delete",
    request_id: requestId,
    action: "restore",
    target_kind: input.record.kind,
    target_id: input.record.id,
    snapshot_id: input.snapshotId,
    expected_tombstone_revision: input.record.tombstoneRevision,
    expected_target_fingerprint: input.record.targetFingerprint,
    reviewer: "teacher",
    note: input.note,
  } as const;
}

export function buildEntityDeleteRequest(input: { kind: EntityDeleteKind | string; id: string; snapshotId: string; note: string | null }, requestId: string) {
  if (!isDeleteKind(input.kind) || !validText(input.id, 160) || !validText(input.snapshotId, 160) || !validText(requestId, 160)
    || (input.note !== null && (!validText(input.note, 1000)))) {
    throw new EntityDeleteError("invalid_request", "删除对象无效。");
  }
  return {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation: "delete",
    request_id: requestId,
    action: "delete",
    target_kind: input.kind,
    target_id: input.id.trim(),
    snapshot_id: input.snapshotId,
    reviewer: "teacher",
    note: input.note,
  } as const;
}

type EntityDeletionLedgerDependencies = {
  roots?: EntityBridgeRoots;
  callCore?: (request: ReturnType<typeof buildEntityDeletionListRequest>, roots: EntityBridgeRoots, signal?: AbortSignal) => Promise<DeleteListCoreResponse>;
};

export async function readEntityDeletionLedger(
  options: { signal?: AbortSignal } = {},
  dependencies: EntityDeletionLedgerDependencies = {},
): Promise<EntityDeletionLedger> {
  const roots = dependencies.roots || (await import("./edupi-core-snapshot.ts")).resolveEduPiBridgeRoots();
  const requestId = `entity-deletions-${randomUUID()}`;
  const request = buildEntityDeletionListRequest(requestId);
  const callCore = dependencies.callCore || (async (nextRequest, currentRoots, signal) => {
    const { runCoreProcess } = await import("./edupi-core-process-client.ts");
    return await runCoreProcess<DeleteListCoreResponse>({
      runtime: currentRoots.runtime,
      dataRoot: currentRoots.dataRoot,
      request: nextRequest,
      timeoutMs: 15_000,
      signal,
    });
  });
  return parseDeletionLedger(await callCore(request, roots, options.signal), requestId);
}

function itemsFor(workspace: RawRecord, kind: EntityDeleteKind): unknown[] {
  if (kind === "calendar") return Array.isArray(workspace.calendar) ? workspace.calendar : [];
  if (kind === "timetable") return Array.isArray(workspace.timetable) ? workspace.timetable : [];
  if (kind === "student") return Array.isArray(workspace.students) ? workspace.students : [];
  if (kind === "task") return Array.isArray(workspace.tasks) ? workspace.tasks : [];
  const continuity = workspace.continuity && typeof workspace.continuity === "object" && !Array.isArray(workspace.continuity) ? workspace.continuity as RawRecord : {};
  if (kind === "teaching_priority") return Array.isArray(continuity.teaching_priorities) ? continuity.teaching_priorities : [];
  return Array.isArray(continuity.memories) ? continuity.memories : [];
}

function itemId(kind: EntityDeleteKind, value: unknown): string | null {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
  const candidate = kind === "calendar" ? item.event_id
    : kind === "timetable" ? item.slot_id
      : kind === "memory" ? item.memory_id
        : kind === "student" ? item.student_id || item.name
          : kind === "teaching_priority" ? item.priority_id
            : item.task_id;
  return typeof candidate === "string" ? candidate : null;
}

function hasTarget(workspace: RawRecord, kind: EntityDeleteKind, id: string): boolean {
  return itemsFor(workspace, kind).some((item) => itemId(kind, item) === id || kind === "student" && Boolean(item && typeof item === "object" && (item as RawRecord).name === id));
}

function hasTargetInPayload(payload: RawRecord, kind: EntityDeleteKind, id: string): boolean {
  if (kind === "material") {
    const targets = Array.isArray(payload.review_targets) ? payload.review_targets : [];
    return targets.some((value) => {
      const target = value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
      const ref = target.target && typeof target.target === "object" && !Array.isArray(target.target) ? target.target as RawRecord : {};
      return target.projection_kind === "material_intake" && ref.target_id === id;
    });
  }
  const workspace = payload.education_workspace && typeof payload.education_workspace === "object" && !Array.isArray(payload.education_workspace)
    ? payload.education_workspace as RawRecord
    : payload;
  return hasTarget(workspace, kind, id);
}

type EntityDeleteDependencies = {
  readSnapshot?: () => Promise<DeleteSnapshot>;
  callCore?: (request: ReturnType<typeof buildEntityDeleteRequest>, snapshot: DeleteSnapshot, signal?: AbortSignal) => Promise<DeleteCoreResponse>;
};

function operationError(code: string, action: "delete" | "restore"): EntityDeleteError {
  const message = code === "stale_snapshot" ? "内容已经更新，请刷新后重试。"
    : code === "stale_tombstone" ? "删除记录已经变化，请刷新后重试。"
      : code === "target_not_found" || code === "target_not_deleted" ? (action === "delete" ? "对象不存在或已经删除。" : "删除记录已经不存在。")
        : code === "target_changed" ? "原对象已经变化，不能直接恢复。"
          : code === "legacy_identity_unresolvable" ? "旧记录无法唯一对应当前对象。"
            : code === "material_unavailable" ? "材料文件已移动或内容已经变化。"
              : action === "delete" ? "删除暂不可用。" : "恢复暂不可用。";
  return new EntityDeleteError(code, message);
}

export async function issueEntityDelete(
  input: { kind: EntityDeleteKind; id: string; note: string | null; signal?: AbortSignal },
  dependencies: EntityDeleteDependencies = {},
): Promise<{ target: { kind: EntityDeleteKind; id: string }; deletedAt: string | null; data: RawRecord & { education_workspace: RawRecord } }> {
  if (!isDeleteKind(input.kind) || !validText(input.id, 160)) throw new EntityDeleteError("invalid_request", "删除对象无效。");
  const readSnapshot = dependencies.readSnapshot || (async () => {
    const { readEduPiEducationSnapshot } = await import("./edupi-core-snapshot.ts");
    const snapshot = await readEduPiEducationSnapshot({ signal: input.signal });
    return { ...snapshot, roots: { runtime: snapshot.runtime, dataRoot: snapshot.dataRoot } } as DeleteSnapshot;
  });
  const snapshot = await readSnapshot();
  const snapshotId = typeof snapshot.envelope?.snapshot_id === "string" ? snapshot.envelope.snapshot_id : null;
  if (!snapshotId) throw new EntityDeleteError("invalid_response", "Core 教育快照无效。");
  const requestId = `entity-delete-${randomUUID()}`;
  const request = buildEntityDeleteRequest({ kind: input.kind, id: input.id, snapshotId, note: input.note }, requestId);
  const callCore = dependencies.callCore || (async (nextRequest, currentSnapshot, signal) => {
    const [{ runCoreProcess }, { resolveEduPiBridgeRoots }] = await Promise.all([
      import("./edupi-core-process-client.ts"),
      import("./edupi-core-snapshot.ts"),
    ]);
    const roots = currentSnapshot.roots || resolveEduPiBridgeRoots();
    return await runCoreProcess<DeleteCoreResponse>({
      runtime: roots.runtime,
      dataRoot: roots.dataRoot,
      request: nextRequest,
      timeoutMs: 15_000,
      signal,
    });
  });
  const response = await callCore(request, snapshot, input.signal);
  if (response.ok !== true) {
    const code = response.code || "unavailable";
    throw operationError(code, "delete");
  }
  const refreshed = response.snapshot;
  const refreshedWorkspace = refreshed?.education_workspace;
  const responseTargetId = response.target?.id;
  if (response.operation !== "delete" || response.request_id !== requestId || response.external_send !== false
    || (response.action !== undefined && response.action !== "delete")
    || response.target?.kind !== input.kind || !validText(responseTargetId, 160)
    || !refreshed || !refreshedWorkspace || hasTargetInPayload(refreshed, input.kind, responseTargetId)) {
    throw new EntityDeleteError("invalid_response", "Core 删除结果无效。");
  }
  return { target: { kind: input.kind, id: responseTargetId }, deletedAt: typeof response.deleted_at === "string" ? response.deleted_at : null, data: refreshed as RawRecord & { education_workspace: RawRecord } };
}

type EntityRestoreDependencies = {
  roots?: EntityBridgeRoots;
  readLedger?: (roots: EntityBridgeRoots, signal?: AbortSignal) => Promise<EntityDeletionLedger>;
  readCurrentSnapshot?: (roots: EntityBridgeRoots, signal?: AbortSignal) => Promise<RawRecord & { education_workspace: RawRecord }>;
  callCore?: (request: ReturnType<typeof buildEntityRestoreRequest>, roots: EntityBridgeRoots, signal?: AbortSignal) => Promise<DeleteCoreResponse>;
};

function findExactDeletion(deletions: EntityDeletionRecord[], kind: EntityDeleteKind, id: string): EntityDeletionRecord | null {
  const exact = deletions.filter((record) => record.kind === kind && record.id === id);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new EntityDeleteError("invalid_response", "Core 删除记录无效。");
  return null;
}

function findDeletion(deletions: EntityDeletionRecord[], kind: EntityDeleteKind, id: string, restoreRequestId?: string): EntityDeletionRecord | null {
  const exact = findExactDeletion(deletions, kind, id);
  if (exact) return exact;
  const aliases = deletions.filter((record) => record.kind === kind && (record.studentId === id || record.reviewTargetId === id));
  if (aliases.length > 1) throw operationError("legacy_identity_unresolvable", "restore");
  return aliases[0] && (!restoreRequestId || entityRestoreRequestId(aliases[0]) === restoreRequestId) ? aliases[0] : null;
}

async function currentRestorePayload(roots: EntityBridgeRoots, signal: AbortSignal | undefined, dependencies: EntityRestoreDependencies) {
  if (dependencies.readCurrentSnapshot) return await dependencies.readCurrentSnapshot(roots, signal);
  const { readEduPiEducationSnapshot } = await import("./edupi-core-snapshot.ts");
  return (await readEduPiEducationSnapshot({ signal })).payload;
}

async function reconciledRestore(
  input: { kind: EntityDeleteKind; id: string; restoreRequestId: string; signal?: AbortSignal },
  ledger: EntityDeletionLedger,
  roots: EntityBridgeRoots,
  dependencies: EntityRestoreDependencies,
  expectedRecord?: EntityDeletionRecord,
): Promise<{ target: { kind: EntityDeleteKind; id: string }; restoredAt: string | null; data: RawRecord & { education_workspace: RawRecord } } | null> {
  const history = ledger.history.find((item) => item.requestId === input.restoreRequestId && item.action === "restore"
    && item.kind === input.kind
    && (expectedRecord
      ? item.targetId === expectedRecord.id && item.tombstoneRevision === expectedRecord.tombstoneRevision && item.targetFingerprint === expectedRecord.targetFingerprint
      : entityRestoreRequestId({ kind: item.kind, id: item.targetId, tombstoneRevision: item.tombstoneRevision, targetFingerprint: item.targetFingerprint }) === input.restoreRequestId)) || null;
  if (!history || findExactDeletion(ledger.deletions, history.kind, history.targetId)) return null;
  const payload = await currentRestorePayload(roots, input.signal, dependencies);
  if (!payload?.education_workspace || (history.kind !== "material" && !hasTargetInPayload(payload, history.kind, history.targetId))) return null;
  return { target: { kind: history.kind, id: history.targetId }, restoredAt: history.occurredAt, data: payload };
}

export async function issueEntityRestore(
  input: { kind: EntityDeleteKind; id: string; note: string | null; restoreRequestId: string; signal?: AbortSignal },
  dependencies: EntityRestoreDependencies = {},
): Promise<{ target: { kind: EntityDeleteKind; id: string }; restoredAt: string | null; data: RawRecord & { education_workspace: RawRecord } }> {
  if (!isDeleteKind(input.kind) || !validText(input.id, 160)
    || !/^entity-restore-[A-Za-z0-9_-]{43}$/u.test(input.restoreRequestId)
    || (input.note !== null && !validText(input.note, 1000))) {
    throw new EntityDeleteError("invalid_request", "恢复对象无效。");
  }
  const roots = dependencies.roots || (await import("./edupi-core-snapshot.ts")).resolveEduPiBridgeRoots();
  const ledger = dependencies.readLedger
    ? await dependencies.readLedger(roots, input.signal)
    : await readEntityDeletionLedger({ signal: input.signal }, { roots });
  const deletion = findDeletion(ledger.deletions, input.kind, input.id, input.restoreRequestId);
  if (!deletion) {
    const replayed = await reconciledRestore(input, ledger, roots, dependencies);
    if (replayed) return replayed;
    throw operationError("target_not_deleted", "restore");
  }
  if (entityRestoreRequestId(deletion) !== input.restoreRequestId) throw operationError("stale_tombstone", "restore");
  const requestId = input.restoreRequestId;
  const request = buildEntityRestoreRequest({ record: deletion, snapshotId: ledger.snapshotId, note: input.note }, requestId);
  const callCore = dependencies.callCore || (async (nextRequest, currentRoots, signal) => {
    const { runCoreProcess } = await import("./edupi-core-process-client.ts");
    return await runCoreProcess<DeleteCoreResponse>({
      runtime: currentRoots.runtime,
      dataRoot: currentRoots.dataRoot,
      request: nextRequest,
      timeoutMs: 15_000,
      signal,
    });
  });
  let response;
  try {
    response = await callCore(request, roots, input.signal);
  } catch (error) {
    try {
      const currentLedger = dependencies.readLedger
        ? await dependencies.readLedger(roots, input.signal)
        : await readEntityDeletionLedger({ signal: input.signal }, { roots });
      const committed = await reconciledRestore(input, currentLedger, roots, dependencies, deletion);
      if (committed) return committed;
    } catch { /* Preserve the original transport failure when reconciliation is unavailable. */ }
    throw error;
  }
  if (response.ok !== true) throw operationError(response.code || "unavailable", "restore");
  const refreshed = response.snapshot;
  const refreshedWorkspace = refreshed?.education_workspace;
  const responseTargetId = response.target?.id;
  const visibleId = input.kind === "material" ? null : responseTargetId;
  if (response.operation !== "delete" || response.action !== "restore" || response.request_id !== requestId
    || response.external_send !== false || response.target?.kind !== input.kind || !validText(responseTargetId, 160)
    || response.tombstone_revision !== deletion.tombstoneRevision || response.target_fingerprint !== deletion.targetFingerprint
    || !refreshed || !refreshedWorkspace || (typeof visibleId === "string" && !hasTargetInPayload(refreshed, input.kind, visibleId))) {
    throw new EntityDeleteError("invalid_response", "Core 恢复结果无效。");
  }
  return {
    target: { kind: input.kind, id: responseTargetId },
    restoredAt: typeof response.restored_at === "string" ? response.restored_at : null,
    data: refreshed as RawRecord & { education_workspace: RawRecord },
  };
}
