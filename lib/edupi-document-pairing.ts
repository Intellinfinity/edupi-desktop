import type { CoreCalendarOccurrence } from "./edupi-calendar-sources";
import type { DocumentPairingChoice } from "./edupi-document-pairing-contract";
import { MaterialRecognitionError, type MaterialRecognitionResult } from "./edupi-material-recognition";
import { stableDocumentOccurrenceRef, stableDocumentOccurrenceVariantRef, stableScheduleSourceHash } from "./edupi-schedule-upload";

type DocumentEvent = MaterialRecognitionResult["events"][number];

export type DocumentPairingGroup = {
  anchor: string;
  incoming: DocumentEvent[];
  current: CoreCalendarOccurrence[];
};

export function documentPairingFingerprint(events: readonly DocumentEvent[]): string {
  return stableScheduleSourceHash(events.map((event) => ({
    date: event.date, end_date: event.end_date, name: event.name, type: event.type,
    confidence: event.confidence, notes: event.notes, time_interval: event.time_interval ?? null,
    location: event.location ?? null,
  })));
}

export function pairDocumentEvents(
  events: readonly DocumentEvent[],
  occurrences: readonly CoreCalendarOccurrence[],
  choices?: readonly DocumentPairingChoice[],
): {
  assignments: Map<DocumentEvent, CoreCalendarOccurrence | null>;
  reviewGroups: DocumentPairingGroup[];
} {
  const assignments = new Map<DocumentEvent, CoreCalendarOccurrence | null>();
  const reviewGroups: DocumentPairingGroup[] = [];
  const anchors = new Set(events.map(stableDocumentOccurrenceRef));
  const incomingRefs = events.map(stableDocumentOccurrenceVariantRef);
  if (new Set(incomingRefs).size !== incomingRefs.length) {
    throw new MaterialRecognitionError("ambiguous_schedule", "同一材料包含无法区分的同名安排。");
  }
  for (const anchor of anchors) {
    const incoming = events.filter(event => stableDocumentOccurrenceRef(event) === anchor);
    const current = occurrences.filter(occurrence => stableDocumentOccurrenceRef(occurrence.content) === anchor);
    const usedCurrent = new Set<CoreCalendarOccurrence>();
    for (const event of incoming) {
      const variant = stableDocumentOccurrenceVariantRef(event);
      const matches = current.filter(occurrence => !usedCurrent.has(occurrence)
        && stableDocumentOccurrenceVariantRef(occurrence.content) === variant);
      if (matches.length > 1) throw new MaterialRecognitionError("ambiguous_schedule", "所选来源包含重复安排，无法安全更新。");
      if (matches.length === 1) {
        assignments.set(event, matches[0]);
        usedCurrent.add(matches[0]);
      }
    }
    const remainingIncoming = incoming.filter(event => !assignments.has(event));
    const remainingCurrent = current.filter(occurrence => !usedCurrent.has(occurrence));
    if (remainingIncoming.length > 0 && remainingCurrent.length > 0) {
      if (remainingIncoming.length === 1 && remainingCurrent.length === 1) {
        assignments.set(remainingIncoming[0], remainingCurrent[0]);
      } else reviewGroups.push({ anchor, incoming: remainingIncoming, current: remainingCurrent });
    } else for (const event of remainingIncoming) assignments.set(event, null);
  }

  if (choices === undefined) return { assignments, reviewGroups };
  if (!Array.isArray(choices) || choices.length > 200) {
    throw new MaterialRecognitionError("invalid_output", "逐项配对内容无效。");
  }
  const required = new Map(reviewGroups.flatMap(group => group.incoming.map(event =>
    [stableDocumentOccurrenceVariantRef(event), group] as const)));
  const selected = new Set<string>();
  const usedCurrentRefs = new Set<string>();
  for (const choice of choices) {
    if (!choice || typeof choice.incomingVariantRef !== "string"
      || (choice.currentSourceOccurrenceRef !== null && typeof choice.currentSourceOccurrenceRef !== "string")) {
      throw new MaterialRecognitionError("invalid_output", "逐项配对内容无效。");
    }
    const group = required.get(choice.incomingVariantRef);
    if (!group || selected.has(choice.incomingVariantRef)) {
      throw new MaterialRecognitionError("ambiguous_schedule", "存在多余或重复的逐项配对，请重新核对。");
    }
    selected.add(choice.incomingVariantRef);
    const event = group.incoming.find(item => stableDocumentOccurrenceVariantRef(item) === choice.incomingVariantRef)!;
    if (choice.currentSourceOccurrenceRef === null) {
      assignments.set(event, null);
      continue;
    }
    const occurrence = group.current.find(item => item.sourceOccurrenceRef === choice.currentSourceOccurrenceRef);
    if (!occurrence) throw new MaterialRecognitionError("ambiguous_schedule", "逐项配对指向了其他来源的事项。");
    if (usedCurrentRefs.has(occurrence.sourceOccurrenceRef)) {
      throw new MaterialRecognitionError("ambiguous_schedule", "同一旧事项不能重复配对。");
    }
    usedCurrentRefs.add(occurrence.sourceOccurrenceRef);
    assignments.set(event, occurrence);
  }
  if (selected.size !== required.size) {
    throw new MaterialRecognitionError("ambiguous_schedule", "请完成每一项的逐项配对后再更新。");
  }
  return { assignments, reviewGroups: [] };
}
