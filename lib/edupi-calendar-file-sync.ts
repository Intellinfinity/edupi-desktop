import crypto from "node:crypto";
import { readEntityDeletionLedger, type EntityDeletionLedger } from "./edupi-entity-delete";
import { issueEducationIntake, type EducationIntakeCommand } from "./edupi-education-intake";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import { runCoreProcess } from "./edupi-core-process-client";
import {
  CalendarSourceError,
  calendarOccurrenceContentFingerprint,
  calendarOccurrenceSeriesRef,
  calendarSourceFingerprintForOccurrences,
  calendarSourceSelectionCandidates,
  readCoreCalendarSources,
  type CoreCalendarSourceRead,
} from "./edupi-calendar-sources";
import { intakeRecognizedMaterial } from "./edupi-material-intake-flow";
import { MaterialRecognitionError, recognizeStagedMaterial, type MaterialRecognitionResult } from "./edupi-material-recognition";
import type { MaterialStagingDescriptor } from "./edupi-material-staging";
import { stableOccurrenceCalendarEventId, stableScheduleSourceHash } from "./edupi-schedule-upload";

type IssueResult = { receipt: Record<string, unknown>; data: unknown };

type CalendarSyncDependencies = {
  recognize?: (descriptor: MaterialStagingDescriptor) => Promise<MaterialRecognitionResult>;
  issue?: (command: EducationIntakeCommand) => Promise<IssueResult>;
  deleteCalendarBatch?: (eventIds: string[], guard: CoreCalendarSourceRead) => Promise<void>;
  readSources?: () => Promise<CoreCalendarSourceRead>;
  readSourcesAfter?: () => Promise<CoreCalendarSourceRead>;
  readDeletions?: (sourceRead: CoreCalendarSourceRead) => Promise<EntityDeletionLedger>;
};

function includesImportedEvidence(
  source: CoreCalendarSourceRead["sources"][number],
  expected: Array<{ sourceOccurrenceRef: string; eventId: string; contentFingerprint: string }>,
  evidenceId: string,
): boolean {
  return expected.length > 0 && expected.every((incoming) => source.occurrences.some((current) =>
    current.sourceOccurrenceRef === incoming.sourceOccurrenceRef
    && current.eventId === incoming.eventId
    && current.contentFingerprint === incoming.contentFingerprint
    && current.evidenceIds.includes(evidenceId)));
}

function calendarDeletionNote(sourceId: string, evidenceId: string): string {
  return `ICS-SYNC:${crypto.createHash("sha256").update(`${sourceId}\0${evidenceId}`, "utf8").digest("hex")}`;
}

export async function deleteCalendarOccurrences(
  eventIds: string[],
  signal: AbortSignal | undefined,
  dependencies: {
    callCore?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
    expectedSnapshotId: string;
    roots?: CoreCalendarSourceRead["snapshot"]["roots"];
    sourceId?: string;
    expectedSourceFingerprint?: string;
    evidenceId?: string;
  },
): Promise<void> {
  const requested = [...new Set(eventIds)].sort();
  if (requested.length === 0) return;
  if (requested.length > 200 || requested.some((id) => typeof id !== "string" || !id || id.length > 160)) {
    throw new MaterialRecognitionError("too_large", "一次最多撤回 200 项日历安排。");
  }
  const roots = dependencies.roots || resolveEduPiBridgeRoots();
  const snapshotId = dependencies.expectedSnapshotId;
  if (typeof snapshotId !== "string" || !snapshotId || snapshotId.length > 160
    || !dependencies.sourceId || !/^(?:calendar|document)-source-[a-f0-9]{32}$/u.test(dependencies.sourceId)
    || !dependencies.expectedSourceFingerprint || !/^sha256:[a-f0-9]{64}$/u.test(dependencies.expectedSourceFingerprint)
    || !dependencies.evidenceId || !/^calendar-evidence-[a-f0-9]{32}$/u.test(dependencies.evidenceId)) {
    throw new CalendarSourceError("invalid_calendar_source_projection", "日历来源批量撤回绑定无效。");
  }
  const token = crypto.createHash("sha256").update(JSON.stringify([
    snapshotId, dependencies.sourceId, dependencies.expectedSourceFingerprint, requested,
  ])).digest("hex").slice(0, 32);
  const request = {
      protocol: "edupi-desktop-bridge",
      protocol_version: 1,
      producer: "edupi-desktop",
      operation: "delete",
      request_id: `calendar-batch-delete-${token}`,
      action: "delete_batch",
      target_kind: "calendar",
      target_ids: requested,
      source_id: dependencies.sourceId,
      expected_source_fingerprint: dependencies.expectedSourceFingerprint,
      snapshot_id: snapshotId,
      reviewer: "teacher",
      note: calendarDeletionNote(dependencies.sourceId, dependencies.evidenceId),
  };
  const response = await (dependencies.callCore || ((nextRequest) => runCoreProcess<Record<string, unknown>>({
      runtime: roots.runtime,
      dataRoot: roots.dataRoot,
      request: nextRequest,
      timeoutMs: 30_000,
      signal,
  })))(request);
  if (response.ok !== true) throw new CalendarSourceError("stale_calendar_source", "日历撤回期间内容已变化，请刷新后重试。");
  const targets = Array.isArray(response.target_ids) ? response.target_ids : [];
  const revisions = Array.isArray(response.tombstone_revisions) ? response.tombstone_revisions : [];
  const snapshot = response.snapshot && typeof response.snapshot === "object" && !Array.isArray(response.snapshot) ? response.snapshot as Record<string, unknown> : null;
  const workspace = snapshot?.education_workspace && typeof snapshot.education_workspace === "object" && !Array.isArray(snapshot.education_workspace)
    ? snapshot.education_workspace as Record<string, unknown> : null;
  const calendar = workspace && Array.isArray(workspace.calendar) ? workspace.calendar : null;
  if (response.operation !== "delete" || response.action !== "delete_batch" || response.request_id !== request.request_id
    || response.external_send !== false || response.source_id !== dependencies.sourceId
    || response.source_fingerprint !== dependencies.expectedSourceFingerprint || !snapshot || !workspace || !calendar
    || JSON.stringify([...targets].sort()) !== JSON.stringify(requested)
    || revisions.length !== requested.length
    || revisions.some((value) => !value || typeof value !== "object" || Array.isArray(value)
      || !requested.includes(String((value as Record<string, unknown>).target_id))
      || !Number.isSafeInteger((value as Record<string, unknown>).tombstone_revision))
    || requested.some((id) => calendar.some((value) => value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).event_id === id))) {
    throw new CalendarSourceError("invalid_calendar_source_projection", "Core 日历批量撤回回执无效。");
  }
}

export async function syncCalendarFile(input: {
  descriptor: MaterialStagingDescriptor;
  requestedSourceId: string | null;
  expectedSourceFingerprint: string | null;
  signal?: AbortSignal;
}, dependencies: CalendarSyncDependencies = {}): Promise<{
  sourceId: string;
  committed: boolean;
  removedEventIds: string[];
  receipts: Record<string, unknown>[];
  data: unknown;
  recognition: { eventCount: number; slotCount: number };
  scheduleNeedsReview: boolean;
  calendarOccurrences: Array<{ sourceOccurrenceRef: string; eventId: string }>;
  cancelledOccurrenceRefs: string[];
}> {
  if (input.descriptor.kind !== "calendar") throw new MaterialRecognitionError("invalid_output", "所选文件不是 ICS 日历。");
  const recognition = await (dependencies.recognize || recognizeStagedMaterial)(input.descriptor);
  if (recognition.events.length === 0 && (recognition.cancelled_occurrence_refs || []).length === 0
    && (recognition.affected_series_refs || []).length === 0) {
    throw new MaterialRecognitionError("invalid_output", "ICS 日历没有可导入或撤回的事项。");
  }
  if (recognition.events.some((event) => !event.source_occurrence_ref)) {
    throw new MaterialRecognitionError("invalid_output", "ICS 日历缺少稳定事项身份。");
  }
  const semanticHash = stableScheduleSourceHash([
    { calendar_mode: recognition.calendar_mode || "full_snapshot" },
    ...recognition.events as unknown as Record<string, unknown>[],
    ...(recognition.cancelled_occurrence_refs || []).map((source_occurrence_ref) => ({ cancelled_source_occurrence_ref: source_occurrence_ref })),
    ...(recognition.affected_series_refs || []).map((source_series_ref) => ({ affected_source_series_ref: source_series_ref })),
  ]);
  const derivedSourceId = `calendar-source-${semanticHash.slice("sha256:".length, "sha256:".length + 32)}`;
  const materialEvidenceId = `calendar-evidence-${input.descriptor.source_hash.slice("sha256:".length, "sha256:".length + 32)}`;
  const sourceRead = await (dependencies.readSources || (() => readCoreCalendarSources(input.signal)))();
  const requested = input.requestedSourceId
    ? sourceRead.sources.find((source) => source.sourceId === input.requestedSourceId) || null
    : null;
  const sourceId = requested?.sourceId || input.requestedSourceId || derivedSourceId;
  const selectionCandidates = calendarSourceSelectionCandidates(sourceRead.sources,
    recognition.events as Array<Record<string, unknown> & { source_occurrence_ref?: string }>, recognition.affected_series_refs || [], null);
  const expectedOccurrences = recognition.events.map((event) => ({
    sourceOccurrenceRef: event.source_occurrence_ref as string,
    eventId: stableOccurrenceCalendarEventId(sourceId, event.source_occurrence_ref),
    contentFingerprint: calendarOccurrenceContentFingerprint(event as unknown as Record<string, unknown>),
    evidenceIds: [materialEvidenceId],
    content: {
      date: event.date,
      end_date: event.end_date,
      name: event.name,
      type: event.type,
      confidence: event.confidence,
      notes: event.notes,
      time_interval: event.time_interval ?? null,
      location: event.location ?? null,
    },
  }));
  const incomingFingerprint = calendarSourceFingerprintForOccurrences(expectedOccurrences);
  const deletionLedger = await (dependencies.readDeletions || ((current) => readEntityDeletionLedger({ signal: input.signal }, { roots: current.snapshot.roots })))(sourceRead);
  const cancellationRefs = recognition.cancelled_occurrence_refs || [];
  const cancellationIds = cancellationRefs.map((ref) => stableOccurrenceCalendarEventId(sourceId, ref));
  const affectedSeriesRefsList = recognition.affected_series_refs || [];
  const cancellationReplayState = (currentSource: CoreCalendarSourceRead["sources"][number] | null, ledger: EntityDeletionLedger) => {
    const currentDeletedIds = new Set(ledger.deletions.filter((record) => record.kind === "calendar").map((record) => record.id));
    const occurrenceAlreadyApplied = cancellationIds.length > 0
      && cancellationIds.every((id) => currentDeletedIds.has(id))
      && (!currentSource || cancellationRefs.every((ref) => !currentSource.occurrences.some((occurrence) => occurrence.sourceOccurrenceRef === ref)));
    const seriesDeleteHistory = ledger.history.filter((entry) => entry.action === "delete" && entry.kind === "calendar"
      && /^calendar-batch-delete-[a-f0-9]{32}$/u.test(entry.requestId)
      && entry.note === calendarDeletionNote(sourceId, materialEvidenceId));
    const seriesAlreadyApplied = Boolean(recognition.calendar_mode === "delta_cancel"
      && affectedSeriesRefsList.length > 0
      && !ledger.historyTruncated
      && seriesDeleteHistory.length > 0
      && seriesDeleteHistory.every((entry) => currentDeletedIds.has(entry.targetId)));
    const seriesNoopReplay = seriesAlreadyApplied
      && (!currentSource || affectedSeriesRefsList.every((seriesRef) => !currentSource.occurrences.some((occurrence) =>
        calendarOccurrenceSeriesRef(occurrence.sourceOccurrenceRef) === seriesRef)));
    const noopReplay = recognition.calendar_mode === "delta_cancel"
      && (cancellationRefs.length > 0 || affectedSeriesRefsList.length > 0)
      && (cancellationRefs.length === 0 || occurrenceAlreadyApplied)
      && (affectedSeriesRefsList.length === 0 || seriesNoopReplay);
    return { deletedIds: currentDeletedIds, noopReplay, seriesAlreadyApplied };
  };
  const replayState = cancellationReplayState(requested, deletionLedger);
  const deletedIds = replayState.deletedIds;
  const seriesCancellationAlreadyApplied = replayState.seriesAlreadyApplied;
  const cancellationNoopReplay = replayState.noopReplay;
  const recoveredMissingCancellation = Boolean(input.requestedSourceId && !requested && cancellationNoopReplay);
  if (input.requestedSourceId) {
    if (!requested && !recoveredMissingCancellation) throw new CalendarSourceError("calendar_source_not_found", "所选日历来源已经不存在，请刷新后重试。");
    if (selectionCandidates.length > 0
      && (selectionCandidates.length !== 1 || selectionCandidates[0].sourceId !== requested?.sourceId)) {
      throw new CalendarSourceError("calendar_source_selection_required", "文件事项属于另一个或多个日历来源，请重新选择。");
    }
    if (requested && !cancellationNoopReplay
      && (!input.expectedSourceFingerprint || requested.fingerprint !== input.expectedSourceFingerprint)
      && requested.fingerprint !== incomingFingerprint) {
      throw new CalendarSourceError("stale_calendar_source", "日历来源已更新，请重新选择后再导入。");
    }
  } else {
    const derived = sourceRead.sources.find((source) => source.sourceId === derivedSourceId) || null;
    if (derived && derived.fingerprint !== incomingFingerprint) {
      throw new CalendarSourceError("calendar_source_selection_required", "这份文件是既有日历的不同修订，请明确选择要更新的日历。");
    }
    if (selectionCandidates.length > 0
      && (!derived || selectionCandidates.length !== 1 || selectionCandidates[0].sourceId !== derived.sourceId)) {
      throw new CalendarSourceError("calendar_source_selection_required", "检测到与既有日历重复的事项，请选择要更新的日历后再导入。");
    }
  }
  const baseline = requested || sourceRead.sources.find((source) => source.sourceId === sourceId) || null;
  if (!baseline && recognition.events.length === 0 && !recoveredMissingCancellation) {
    throw new MaterialRecognitionError("ambiguous_schedule", "撤回日历必须明确选择此前导入的日历来源。");
  }
  if (baseline && (recognition.calendar_mode === "delta_cancel" || recognition.calendar_mode === "delta_upsert")
    && cancellationRefs.some((ref) => !baseline?.occurrences.some((occurrence) => occurrence.sourceOccurrenceRef === ref)
      && !deletedIds.has(stableOccurrenceCalendarEventId(sourceId, ref)))) {
    throw new MaterialRecognitionError("ambiguous_schedule", "取消事项不属于所选日历，请核对来源后重试。");
  }
  if (baseline && recognition.calendar_mode === "delta_cancel"
    && (recognition.affected_series_refs || []).some((seriesRef) => !baseline.occurrences.some((occurrence) =>
      calendarOccurrenceSeriesRef(occurrence.sourceOccurrenceRef) === seriesRef))
    && !seriesCancellationAlreadyApplied) {
    throw new MaterialRecognitionError("ambiguous_schedule", "取消系列不属于所选日历，请核对来源后重试。");
  }
  if (expectedOccurrences.some((occurrence) => deletedIds.has(occurrence.eventId))) {
    throw new MaterialRecognitionError("ambiguous_schedule", "此前撤回的日历事项重新出现，请先在回收记录中明确恢复。");
  }
  let chainedSnapshot = sourceRead.snapshot;
  const issue = dependencies.issue || (async (command: EducationIntakeCommand) => {
    const response = await issueEducationIntake(command, { readSnapshot: async () => chainedSnapshot });
    if (response.data) chainedSnapshot = { payload: response.data, roots: sourceRead.snapshot.roots };
    return response;
  });
  const result = await intakeRecognizedMaterial({
    descriptor: input.descriptor,
    scheduleSourceId: sourceId,
    materialKind: "other",
    subject: null,
    classId: null,
    recognize: true,
  }, { recognize: async () => recognition, issue });
  const expectedReceiptCount = result.calendarOccurrences.length === 0 ? 1 : 2;
  const importAccepted = result.receipts.length === expectedReceiptCount
    && result.receipts.every((receipt) => ["accepted", "modified"].includes(String(receipt.status)));
  if (!importAccepted || result.scheduleNeedsReview) {
    return { ...result, sourceId, committed: false, removedEventIds: [] };
  }
  if (cancellationNoopReplay) {
    const verificationRead = await (dependencies.readSourcesAfter || dependencies.readSources
      || (() => readCoreCalendarSources(input.signal)))();
    const verificationSource = verificationRead.sources.find((source) => source.sourceId === sourceId) || null;
    const verificationLedger = await (dependencies.readDeletions
      || ((current) => readEntityDeletionLedger({ signal: input.signal }, { roots: current.snapshot.roots })))(verificationRead);
    if (!cancellationReplayState(verificationSource, verificationLedger).noopReplay) {
      throw new CalendarSourceError("stale_calendar_source", "日历取消状态在确认期间发生变化，请刷新后重试。");
    }
    return { ...result, sourceId, committed: true, removedEventIds: [] };
  }
  const activeRefs = new Set(result.calendarOccurrences.map((occurrence) => occurrence.sourceOccurrenceRef));
  const cancelledRefs = new Set(result.cancelledOccurrenceRefs);
  const affectedSeriesRefs = new Set(recognition.affected_series_refs || []);
  const withdrawn = (baseline?.occurrences || []).filter((occurrence) => recognition.calendar_mode === "delta_cancel" || recognition.calendar_mode === "delta_upsert"
    ? cancelledRefs.has(occurrence.sourceOccurrenceRef)
      || affectedSeriesRefs.has(calendarOccurrenceSeriesRef(occurrence.sourceOccurrenceRef) || "")
        && (recognition.calendar_mode === "delta_cancel" || !activeRefs.has(occurrence.sourceOccurrenceRef))
    : !activeRefs.has(occurrence.sourceOccurrenceRef) || cancelledRefs.has(occurrence.sourceOccurrenceRef));
  if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const removedEventIds = withdrawn.map((item) => item.eventId);
  if (removedEventIds.length > 0) {
    const guardRead = await (dependencies.readSourcesAfter || dependencies.readSources || (() => readCoreCalendarSources(input.signal)))();
    const guardSource = guardRead.sources.find((source) => source.sourceId === sourceId) || null;
    if (!guardSource) throw new CalendarSourceError("stale_calendar_source", "日历来源在撤回前发生变化，请刷新后重试。");
    const interim = new Map((baseline?.occurrences || []).map((occurrence) => [occurrence.sourceOccurrenceRef, occurrence]));
    if (recognition.calendar_mode !== "delta_cancel") {
      for (const occurrence of expectedOccurrences) interim.set(occurrence.sourceOccurrenceRef, occurrence);
    }
    const expectedInterimFingerprint = calendarSourceFingerprintForOccurrences([...interim.values()]);
    if (guardSource.fingerprint !== expectedInterimFingerprint
      || expectedOccurrences.length > 0 && !includesImportedEvidence(guardSource, expectedOccurrences, materialEvidenceId)) {
      throw new CalendarSourceError("stale_calendar_source", "日历来源在撤回前发生变化，请刷新后重试。");
    }
    await (dependencies.deleteCalendarBatch || ((eventIds, guard) => deleteCalendarOccurrences(eventIds, input.signal, {
      expectedSnapshotId: String(guard.snapshot.payload.snapshot_id || ""),
      roots: guard.snapshot.roots,
      sourceId,
      expectedSourceFingerprint: guardSource.fingerprint,
      evidenceId: materialEvidenceId,
    })))(removedEventIds, guardRead);
  }
  return { ...result, sourceId, committed: true, removedEventIds };
}
