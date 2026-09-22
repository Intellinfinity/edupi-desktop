import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildEducationContractFromWorkspace } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./edupi-education-contract.ts");

test("preserves typed occurrence details without changing legacy calendar defaults", () => {
  const workspace = { tasks: [], timetable: [], students: [], source_summaries: [], continuity: {}, calendar: [
    { event_id: "typed-event", date: "2026-10-01", end_date: null, date_status: "explicit", name: "教研会", type: "meeting",
      source: "teacher", confidence: "teacher_confirmed", notes: null, preparation_status: "read_only", state: "confirmed",
      source_occurrence_ref: "manual-42", time_interval: { start: "2026-10-01T09:00+08:00", end: "2026-10-01T10:00+08:00", time_zone: "Asia/Shanghai" }, location: "东楼" },
    { event_id: "legacy-event", date: "2026-10-02", end_date: null, date_status: "explicit", name: "班会", type: "meeting",
      source: "teacher", confidence: "teacher_confirmed", notes: null, preparation_status: "read_only", state: "confirmed" },
  ] };
  const data = buildEducationContractFromWorkspace(workspace, { workspacePath: "/tmp/edupi", supportedCommands: [] });
  assert.deepEqual(data.calendar[0], {
    id: "typed-event", date: "2026-10-01", endDate: null, dateStatus: "explicit", name: "教研会", type: "meeting",
    source: "teacher", confidence: "teacher_confirmed", notes: null, preparationStatus: "read_only",
    occurrenceRef: "manual-42", startsAt: "2026-10-01T09:00+08:00", endsAt: "2026-10-01T10:00+08:00",
    timeZone: "Asia/Shanghai", location: "东楼",
  });
  assert.equal(data.calendar[1].occurrenceRef, null);
  assert.equal(data.calendar[1].startsAt, null);
  assert.equal(data.calendar[1].location, null);
});
