import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { resolveScheduleSourceSelection } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./edupi-schedule-source-selection.ts");

const source = {
  sourceId: "document-source-00000000000000000000000000000001",
  sourceKind: "document",
  label: "教研会",
  eventCount: 1,
  fingerprint: `sha256:${"a".repeat(64)}`,
};

test("an empty selection remains an explicit new-source choice", () => {
  assert.deepEqual(resolveScheduleSourceSelection("", [source]), { state: "new", source: null });
});

test("one current source resolves with its fingerprint intact", () => {
  assert.deepEqual(resolveScheduleSourceSelection(source.sourceId, [source]), { state: "selected", source });
});

test("a removed or duplicated selected source fails closed instead of becoming a new source", () => {
  assert.deepEqual(resolveScheduleSourceSelection(source.sourceId, []), { state: "stale", source: null });
  assert.deepEqual(resolveScheduleSourceSelection(source.sourceId, [source, { ...source }]), { state: "stale", source: null });
});

test("a timetable option can share a logical source id with an event option", () => {
  const timetable = { ...source, sourceKind: "timetable", selectionKey: `timetable:${source.sourceId}` };
  assert.deepEqual(resolveScheduleSourceSelection(timetable.selectionKey, [source, timetable]),
    { state: "selected", source: timetable });
  assert.deepEqual(resolveScheduleSourceSelection(source.sourceId, [source, timetable]),
    { state: "selected", source });
});
