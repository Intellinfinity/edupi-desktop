export type ScheduleSourceOption = {
  sourceId: string;
  sourceKind: "calendar" | "document" | "timetable";
  selectionKey?: string;
  label: string;
  eventCount: number;
  fingerprint: string;
};

export function resolveScheduleSourceSelection(
  requestedSourceId: string,
  sources: ScheduleSourceOption[],
): { state: "new" | "selected" | "stale"; source: ScheduleSourceOption | null } {
  if (!requestedSourceId) return { state: "new", source: null };
  const matches = sources.filter((source) => (source.selectionKey || source.sourceId) === requestedSourceId);
  return matches.length === 1
    ? { state: "selected", source: matches[0] }
    : { state: "stale", source: null };
}
