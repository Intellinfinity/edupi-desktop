import path from "node:path";
import {
  CalendarSourceError,
  calendarOccurrenceContentFingerprint,
  calendarSourceFingerprintForOccurrences,
  documentSourceEvidenceAliasCandidates,
  readCoreCalendarSources,
  type CoreCalendarSource,
  type CoreCalendarSourceRead,
} from "./edupi-calendar-sources";
import { issueEducationIntake, type EducationIntakeCommand, type MaterialIntake } from "./edupi-education-intake";
import { readEntityDeletionLedger, type EntityDeletionLedger } from "./edupi-entity-delete";
import { intakeRecognizedMaterial } from "./edupi-material-intake-flow";
import { MaterialRecognitionError, recognizeStagedMaterial, type MaterialRecognitionResult } from "./edupi-material-recognition";
import type { MaterialStagingDescriptor } from "./edupi-material-staging";
import { stableDocumentOccurrenceRef, stableDocumentOccurrenceVariantRef, stableDocumentScheduleSourceId, stableFileScheduleIssuer, stableOccurrenceCalendarEventId } from "./edupi-schedule-upload";

type IssueResult = { receipt: Record<string, unknown>; data: unknown };
const CONFIDENCE = { inferred: 1, teacher_confirmed: 2, confirmed: 3 } as const;

function confidenceRank(value: unknown): number {
  return typeof value === "string" && Object.hasOwn(CONFIDENCE, value)
    ? CONFIDENCE[value as keyof typeof CONFIDENCE]
    : 0;
}

type DocumentSyncDependencies = {
  recognize?: (descriptor: MaterialStagingDescriptor) => Promise<MaterialRecognitionResult>;
  issue?: (command: EducationIntakeCommand) => Promise<IssueResult>;
  readSources?: () => Promise<CoreCalendarSourceRead>;
  readDeletions?: (sourceRead: CoreCalendarSourceRead) => Promise<EntityDeletionLedger>;
};

function supportsDocumentScheduleSource(descriptor: MaterialStagingDescriptor): boolean {
  const extension = path.extname(descriptor.staging_path).toLowerCase();
  return descriptor.kind === "pdf" && extension === ".pdf" || descriptor.kind === "word" && extension === ".docx";
}

function hasCurrentMaterialEvidence(sourceRead: CoreCalendarSourceRead, sourceHash: string): boolean {
  const targets = sourceRead.snapshot.payload.review_targets;
  if (!Array.isArray(targets)) return false;
  return targets.some((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const target = value as Record<string, unknown>;
    const identity = target.target;
    return target.projection_kind === "material_intake"
      && target.source_hash === sourceHash
      && target.status === "accepted"
      && target.intake_state === "accepted"
      && Boolean(identity && typeof identity === "object" && !Array.isArray(identity)
        && (identity as Record<string, unknown>).target_kind === "material_intake"
        && typeof (identity as Record<string, unknown>).target_id === "string");
  });
}

function documentSourceCandidates(sources: CoreCalendarSource[], events: MaterialRecognitionResult["events"]): CoreCalendarSource[] {
  const anchors = new Set(events.map((event) => stableDocumentOccurrenceRef(event)));
  const content = new Set(events.map((event) => calendarOccurrenceContentFingerprint(event as unknown as Record<string, unknown>)));
  return sources.filter((source) => source.occurrences.some((occurrence) => (
    content.has(occurrence.contentFingerprint) || anchors.has(stableDocumentOccurrenceRef(occurrence.content))
  )));
}

type DocumentEvent = MaterialRecognitionResult["events"][number];
type DocumentOccurrence = CoreCalendarSource["occurrences"][number];

function uniqueDocumentEvents(events: MaterialRecognitionResult["events"]): MaterialRecognitionResult["events"] {
  if (events.some((event) => Object.hasOwn(event, "source_occurrence_ref"))) {
    throw new MaterialRecognitionError("invalid_output", "普通材料不能提供日程身份。");
  }
  const unique: MaterialRecognitionResult["events"] = [];
  const fingerprintsByVariant = new Map<string, string>();
  for (const event of events) {
    const variant = stableDocumentOccurrenceVariantRef(event);
    const fingerprint = calendarOccurrenceContentFingerprint(event as unknown as Record<string, unknown>);
    const previous = fingerprintsByVariant.get(variant);
    if (previous !== undefined && previous !== fingerprint) {
      throw new MaterialRecognitionError("ambiguous_schedule", "同一材料包含无法区分的安排，请核对后再导入。");
    }
    if (previous === undefined) {
      fingerprintsByVariant.set(variant, fingerprint);
      unique.push(event);
    }
  }
  return unique;
}

function pairDocumentEvents(
  events: MaterialRecognitionResult["events"],
  occurrences: DocumentOccurrence[],
): Map<DocumentEvent, DocumentOccurrence | null> {
  const assigned = new Map<DocumentEvent, DocumentOccurrence | null>();
  const anchors = new Set(events.map((event) => stableDocumentOccurrenceRef(event)));
  for (const anchor of anchors) {
    const incoming = events.filter((event) => stableDocumentOccurrenceRef(event) === anchor);
    const current = occurrences.filter((occurrence) => stableDocumentOccurrenceRef(occurrence.content) === anchor);
    const usedCurrent = new Set<DocumentOccurrence>();
    for (const event of incoming) {
      const variant = stableDocumentOccurrenceVariantRef(event);
      const matches = current.filter((occurrence) => !usedCurrent.has(occurrence)
        && stableDocumentOccurrenceVariantRef(occurrence.content) === variant);
      if (matches.length > 1) {
        throw new MaterialRecognitionError("ambiguous_schedule", "所选来源包含重复安排，无法安全更新。");
      }
      if (matches.length === 1) {
        assigned.set(event, matches[0]);
        usedCurrent.add(matches[0]);
      }
    }
    const remainingIncoming = incoming.filter((event) => !assigned.has(event));
    const remainingCurrent = current.filter((occurrence) => !usedCurrent.has(occurrence));
    if (remainingIncoming.length > 0 && remainingCurrent.length > 0) {
      if (remainingIncoming.length !== 1 || remainingCurrent.length !== 1) {
        throw new MaterialRecognitionError("ambiguous_schedule", "同名同类安排同时发生多项变化，请逐项核对后再更新。");
      }
      assigned.set(remainingIncoming[0], remainingCurrent[0]);
      remainingIncoming.shift();
    }
    for (const event of remainingIncoming) assigned.set(event, null);
  }
  return assigned;
}

function legacyDocumentEventBindings(
  rows: Record<string, unknown>[],
  descriptor: MaterialStagingDescriptor,
  events: MaterialRecognitionResult["events"],
  baseline: CoreCalendarSource | null,
): Map<string, { eventId: string; confidence: "confirmed" | "teacher_confirmed" | "inferred" }> {
  const legacySourceId = stableFileScheduleIssuer(descriptor.original_name, descriptor.source_hash);
  const expectedEvidenceId = `schedule-evidence-${descriptor.source_hash.slice("sha256:".length, "sha256:".length + 32)}`;
  const legacyRows = rows.flatMap((row) => {
    if (Object.hasOwn(row, "source_occurrence_ref") || !Array.isArray(row.source_ids)
      || typeof row.event_id !== "string" || !row.event_id || row.event_id.length > 160) return [];
    const legacySourceIds = row.source_ids.filter((source): source is string =>
      typeof source === "string" && /^desktop-file-schedule-[a-f0-9]{24}$/u.test(source));
    if (legacySourceIds.length === 0) return [];
    const evidenceIds = Array.isArray(row.evidence_ids)
      ? row.evidence_ids.filter((evidence): evidence is string => typeof evidence === "string")
      : [];
    try {
      return [{ row, anchor: stableDocumentOccurrenceRef(row),
        owned: legacySourceIds.includes(legacySourceId) || evidenceIds.includes(expectedEvidenceId), legacySourceIds }];
    } catch {
      return [];
    }
  });
  const owned = legacyRows.filter((item) => item.owned);
  const currentAssignments = pairDocumentEvents(events, baseline?.occurrences || []);
  const unresolvedEvents = events.filter((event) => currentAssignments.get(event) === null);
  const bindings = new Map<string, { eventId: string; confidence: "confirmed" | "teacher_confirmed" | "inferred" }>();
  if (owned.length > 0) {
    const legacyByOccurrence = new Map<DocumentOccurrence, typeof owned[number]>();
    const legacyOccurrences = owned.map((item) => {
      const occurrence: DocumentOccurrence = {
        sourceOccurrenceRef: `legacy:${item.row.event_id}`,
        eventId: item.row.event_id as string,
        contentFingerprint: calendarOccurrenceContentFingerprint(item.row),
        content: item.row,
        evidenceIds: [],
      };
      legacyByOccurrence.set(occurrence, item);
      return occurrence;
    });
    const legacyAssignments = pairDocumentEvents(unresolvedEvents, legacyOccurrences);
    const matchedLegacy = new Set<DocumentOccurrence>();
    for (const event of unresolvedEvents) {
      const occurrence = legacyAssignments.get(event);
      if (!occurrence) {
        throw new MaterialRecognitionError("ambiguous_schedule", "首次接管旧版材料时必须完整识别全部既有安排。");
      }
      matchedLegacy.add(occurrence);
      const match = legacyByOccurrence.get(occurrence);
      if (!match) throw new MaterialRecognitionError("ambiguous_schedule", "旧版材料来源无法验证。");
      if (match.legacySourceIds.length !== 1 || !Array.isArray(match.row.source_ids) || match.row.source_ids.length !== 1) {
        throw new MaterialRecognitionError("ambiguous_schedule", "旧版事项绑定了多个材料来源，无法自动接管。");
      }
      const currentConfidence = match.row.confidence;
      let confidence = event.confidence;
      if (confidenceRank(currentConfidence) > confidenceRank(confidence)) {
        if (!["confirmed", "teacher_confirmed", "inferred"].includes(String(currentConfidence))) {
          throw new MaterialRecognitionError("ambiguous_schedule", "旧版事项置信状态无效，无法自动接管。");
        }
        const trusted = { ...event, confidence: currentConfidence as "confirmed" | "teacher_confirmed" | "inferred" };
        if (calendarOccurrenceContentFingerprint(trusted as unknown as Record<string, unknown>)
          !== calendarOccurrenceContentFingerprint(match.row)) {
          throw new MaterialRecognitionError("ambiguous_schedule", "教师已确认的旧版事项与本次识别不一致，请先人工核对。");
        }
        confidence = trusted.confidence;
      }
      bindings.set(stableDocumentOccurrenceVariantRef(event), { eventId: match.row.event_id as string, confidence });
    }
    if (matchedLegacy.size !== owned.length) {
      throw new MaterialRecognitionError("ambiguous_schedule", "首次接管旧版材料时必须完整识别全部既有安排。");
    }
  } else {
    for (const event of unresolvedEvents) if (legacyRows.some((item) => item.anchor === stableDocumentOccurrenceRef(event))) {
      throw new CalendarSourceError("calendar_source_selection_required", "检测到其他旧版材料中的同名安排，请先核对旧日程。");
    }
  }
  return bindings;
}

function normalizedLabel(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase() : "";
}

function assertNotDeletedDocumentEvents(
  events: MaterialRecognitionResult["events"],
  ledger: EntityDeletionLedger,
  baseline: CoreCalendarSource | null,
): void {
  const deleted = ledger.deletions.filter((record) => record.kind === "calendar");
  const ids = new Set(deleted.map((record) => record.id));
  const labels = new Set(deleted.map((record) => normalizedLabel(record.label)).filter(Boolean));
  const hasUnlabelledLegacyDeletion = deleted.some((record) => !normalizedLabel(record.label));
  const currentEventIds = new Set((baseline?.occurrences || []).map((occurrence) => occurrence.eventId));
  const currentVariants = new Set((baseline?.occurrences || []).map((occurrence) => stableDocumentOccurrenceVariantRef(occurrence.content)));
  if (events.some((event) => ids.has(event.event_id)
    || !currentEventIds.has(event.event_id) && !currentVariants.has(stableDocumentOccurrenceVariantRef(event))
      && (hasUnlabelledLegacyDeletion || labels.has(normalizedLabel(event.name))))) {
    throw new MaterialRecognitionError("ambiguous_schedule", "该安排此前已删除，请先从删除记录明确恢复后再更新。");
  }
}

function bindDocumentOccurrences(
  events: MaterialRecognitionResult["events"],
  sourceId: string,
  baseline: CoreCalendarSource | null,
): MaterialRecognitionResult["events"] {
  const assigned = pairDocumentEvents(events, baseline?.occurrences || []);
  const bindings = events.map((event) => {
    const anchor = stableDocumentOccurrenceRef(event);
    const match = assigned.get(event) || null;
    const currentConfidence = match?.content.confidence;
    const protectsCurrentDecision = baseline?.sourceKind === "calendar"
      || confidenceRank(currentConfidence) > confidenceRank(event.confidence);
    if (protectsCurrentDecision) {
      const confidence = match?.content.confidence;
      if (!match || !["confirmed", "teacher_confirmed", "inferred"].includes(String(confidence))) {
        throw new MaterialRecognitionError("ambiguous_schedule", "材料事项无法与所选日历逐项对应。");
      }
      const trusted = { ...event, confidence: confidence as "confirmed" | "teacher_confirmed" | "inferred" };
      if (calendarOccurrenceContentFingerprint(trusted as unknown as Record<string, unknown>) !== match.contentFingerprint) {
        throw new MaterialRecognitionError("ambiguous_schedule", "材料内容与所选日历不一致，请通过日历更新或冲突审核处理。");
      }
      return { event: trusted, ref: match.sourceOccurrenceRef, eventId: match.eventId };
    }
    const sameAnchorCount = events.filter((candidate) => stableDocumentOccurrenceRef(candidate) === anchor).length;
    const ref = match?.sourceOccurrenceRef || (sameAnchorCount === 1 ? anchor : stableDocumentOccurrenceVariantRef(event));
    return { event, ref, eventId: match?.eventId || null };
  });
  const refs = bindings.map((binding) => binding.ref);
  if (new Set(refs).size !== refs.length) {
    throw new MaterialRecognitionError("ambiguous_schedule", "同一材料包含无法区分的同名同类安排，请核对后再导入。");
  }
  return bindings.map((binding) => ({
    ...binding.event,
    source_occurrence_ref: binding.ref,
    event_id: binding.eventId || stableOccurrenceCalendarEventId(sourceId, binding.ref),
  }));
}

export async function syncDocumentScheduleFile(input: {
  descriptor: MaterialStagingDescriptor;
  title: string;
  materialKind: MaterialIntake["kind"];
  subject: string | null;
  classId: string | null;
  requestedSourceId: string | null;
  expectedSourceFingerprint: string | null;
  signal?: AbortSignal;
}, dependencies: DocumentSyncDependencies = {}): Promise<{
  sourceId: string | null;
  committed: boolean;
  removedEventIds: string[];
  receipts: Record<string, unknown>[];
  data: unknown;
  recognition: { eventCount: number; slotCount: number };
  scheduleNeedsReview: boolean;
  calendarOccurrences: Array<{ sourceOccurrenceRef: string; eventId: string }>;
  cancelledOccurrenceRefs: string[];
}> {
  if (!supportsDocumentScheduleSource(input.descriptor)) {
    throw new MaterialRecognitionError("invalid_output", "只有 PDF 和 DOCX 可以绑定材料日程来源。");
  }
  const recognized = await (dependencies.recognize || recognizeStagedMaterial)(input.descriptor);
  if (recognized.cancelled_occurrence_refs !== undefined || recognized.affected_series_refs !== undefined
    || recognized.calendar_mode !== undefined) {
    throw new MaterialRecognitionError("invalid_output", "普通材料不能撤回既有日程。");
  }
  const recognition = { ...recognized, events: uniqueDocumentEvents(recognized.events) };
  if (recognition.events.length === 0) {
    if (input.requestedSourceId || input.expectedSourceFingerprint) {
      throw new MaterialRecognitionError("ambiguous_schedule", "材料没有可用于确认来源的日程事项。");
    }
    const result = await intakeRecognizedMaterial({
      descriptor: input.descriptor,
      title: input.title,
      materialKind: input.materialKind,
      subject: input.subject,
      classId: input.classId,
      recognize: true,
    }, { recognize: async () => recognition, issue: dependencies.issue });
    const expectedReceiptCount = 1 + (recognition.slots.length > 0 ? 1 : 0);
    return { ...result, sourceId: null, committed: result.receipts.length === expectedReceiptCount
      && result.receipts.every((receipt) => ["accepted", "modified"].includes(String(receipt.status)))
      && !result.scheduleNeedsReview, removedEventIds: [] };
  }

  const derivedSourceId = stableDocumentScheduleSourceId(input.descriptor.source_hash);
  const sourceRead = await (dependencies.readSources || (() => readCoreCalendarSources(input.signal)))();
  const requested = input.requestedSourceId
    ? sourceRead.sources.find((source) => source.sourceId === input.requestedSourceId) || null
    : null;
  if (input.requestedSourceId && !requested) {
    throw new CalendarSourceError("calendar_source_not_found", "所选材料日程来源已经不存在，请刷新后重试。");
  }
  const currentMaterialEvidence = hasCurrentMaterialEvidence(sourceRead, input.descriptor.source_hash);
  const directDerived = currentMaterialEvidence
    ? sourceRead.sources.find((source) => source.sourceId === derivedSourceId) || null : null;
  const evidenceAliases = currentMaterialEvidence
    ? documentSourceEvidenceAliasCandidates(sourceRead.sources, derivedSourceId) : [];
  if (!requested && (evidenceAliases.length > 1
    || directDerived && evidenceAliases.some((source) => source.sourceId !== directDerived.sourceId))) {
    throw new CalendarSourceError("calendar_source_selection_required", "这份材料曾绑定多个日程来源，请明确选择来源。");
  }
  const derived = directDerived || evidenceAliases[0] || null;
  const sourceId = requested?.sourceId || derived?.sourceId || derivedSourceId;
  const candidates = documentSourceCandidates(sourceRead.sources, recognition.events);
  const legacyBaseline = requested?.sourceKind === "document" ? requested : requested ? null : derived;
  const legacyBindings = !requested || requested.sourceKind === "document"
    ? legacyDocumentEventBindings(sourceRead.snapshot.occurrenceEvents || [], input.descriptor, recognition.events, legacyBaseline)
    : new Map<string, { eventId: string; confidence: "confirmed" | "teacher_confirmed" | "inferred" }>();
  const boundEvents = bindDocumentOccurrences(recognition.events, sourceId, requested || derived).map((event) => {
    const legacy = legacyBindings.get(stableDocumentOccurrenceVariantRef(event));
    return { ...event, event_id: legacy?.eventId || event.event_id, confidence: legacy?.confidence || event.confidence };
  });
  const deletionLedger = await (dependencies.readDeletions
    || ((current) => readEntityDeletionLedger({ signal: input.signal }, { roots: current.snapshot.roots })))(sourceRead);
  if (deletionLedger.snapshotId !== String(sourceRead.snapshot.payload.snapshot_id || "")) {
    throw new CalendarSourceError("stale_calendar_source", "日程删除状态已变化，请刷新后重试。");
  }
  assertNotDeletedDocumentEvents(boundEvents, deletionLedger, requested || derived);
  const expectedOccurrences = boundEvents.map((event) => ({
    sourceOccurrenceRef: event.source_occurrence_ref as string,
    eventId: event.event_id,
    contentFingerprint: calendarOccurrenceContentFingerprint(event as unknown as Record<string, unknown>),
    evidenceIds: [],
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
  const scheduleEvidenceId = `schedule-evidence-${input.descriptor.source_hash.slice("sha256:".length, "sha256:".length + 32)}`;
  const exactEvidenceReplay = Boolean(derived && expectedOccurrences.length > 0 && expectedOccurrences.every((incoming) =>
    derived.occurrences.some((current) => current.sourceOccurrenceRef === incoming.sourceOccurrenceRef
      && current.eventId === incoming.eventId
      && current.contentFingerprint === incoming.contentFingerprint
      && current.evidenceIds.includes(scheduleEvidenceId))));
  if (requested) {
    if (candidates.length !== 1 || candidates[0].sourceId !== requested.sourceId) {
      throw new CalendarSourceError("calendar_source_selection_required", "材料事项属于另一个来源或无法确认，请重新选择。");
    }
    if (!input.expectedSourceFingerprint || requested.fingerprint !== input.expectedSourceFingerprint) {
      throw new CalendarSourceError("stale_calendar_source", "材料日程来源已更新，请刷新后重试。");
    }
  } else {
    if (derived && recognition.slots.length > 0) {
      throw new CalendarSourceError("calendar_source_selection_required", "材料中的课表项没有来源别名证明，请明确选择来源。");
    }
    if (derived && derived.fingerprint !== incomingFingerprint && !exactEvidenceReplay) {
      throw new CalendarSourceError("calendar_source_selection_required", "这份材料与既有来源内容不一致，请明确选择要更新的来源。");
    }
    if (candidates.length > 0 && (!derived || candidates.length !== 1 || candidates[0].sourceId !== derived.sourceId)) {
      throw new CalendarSourceError("calendar_source_selection_required", "检测到与既有材料来源重复的安排，请明确选择来源。");
    }
  }

  let chainedSnapshot = sourceRead.snapshot;
  const issue = dependencies.issue || (async (command: EducationIntakeCommand) => {
    const response = await issueEducationIntake(command, { readSnapshot: async () => chainedSnapshot });
    if (response.data) chainedSnapshot = { ...chainedSnapshot, payload: response.data };
    return response;
  });
  const result = await intakeRecognizedMaterial({
    descriptor: input.descriptor,
    scheduleSourceId: sourceId,
    preserveOccurrenceEventIds: true,
    title: input.title,
    materialKind: input.materialKind,
    subject: input.subject,
    classId: input.classId,
    recognize: true,
  }, { recognize: async () => ({ ...recognition, events: boundEvents }), issue });
  const expectedReceiptCount = 2 + (recognition.slots.length > 0 ? 1 : 0);
  const committed = result.receipts.length === expectedReceiptCount
    && result.receipts.every((receipt) => ["accepted", "modified"].includes(String(receipt.status)))
    && !result.scheduleNeedsReview;
  return { ...result, sourceId, committed, removedEventIds: [] };
}
