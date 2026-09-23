import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const sources = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-calendar-sources.ts");
const seriesFamily = (uid) => `ics-series:${crypto.createHash("sha256").update(uid, "utf8").digest("hex")}`;

function event(sourceId, ref, name = "教研会", date = "2026-10-01") {
  return { event_id: `event-${ref}`, date, end_date: null, date_status: "explicit", name, type: "meeting", confidence: "teacher_confirmed",
    notes: null, state: "confirmed", preparation_status: "read_only", source_ids: [sourceId], evidence_ids: [], external_send: false,
    source_occurrence_ref: ref, time_interval: { start: `${date}T09:00+08:00`, end: `${date}T10:00+08:00`, time_zone: "Asia/Shanghai" }, location: "东楼" };
}

test("rebuilds calendar source identity, current occurrences, and CAS fingerprint only from Core", () => {
  const sourceId = "calendar-source-00000000000000000000000000000001";
  const projected = sources.projectCoreCalendarSources([event(sourceId, "uid-2", "备课会", "2026-10-02"), event(sourceId, "uid-1")]);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].sourceId, sourceId);
  assert.equal(projected[0].eventCount, 2);
  assert.match(projected[0].fingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(projected[0].occurrences.map((item) => item.sourceOccurrenceRef), ["uid-1", "uid-2"]);
  assert.equal(JSON.stringify(projected).includes("staging"), false);
});

test("ignores manual occurrence issuers outside the uploaded calendar-source namespace", () => {
  const sourceId = "calendar-source-00000000000000000000000000000001";
  const manual = event("desktop-calendar-manual-v1", "manual-occurrence", "手工日程", "2026-10-05");
  const projected = sources.projectCoreCalendarSources([manual, event(sourceId, "uploaded-occurrence")]);
  assert.deepEqual(projected.map((item) => item.sourceId), [sourceId]);
  assert.deepEqual(projected[0].occurrences.map((item) => item.sourceOccurrenceRef), ["uploaded-occurrence"]);
});

test("flags shared UID or identical facts for explicit source selection", () => {
  const first = "calendar-source-00000000000000000000000000000001";
  const second = "calendar-source-00000000000000000000000000000002";
  const projected = sources.projectCoreCalendarSources([event(first, "uid-1"), event(second, "uid-2", "家长会", "2026-10-03")]);
  assert.deepEqual(sources.calendarSourceSelectionCandidates(projected, [event("ignored", "uid-1")]).map((item) => item.sourceId), [first]);
  assert.deepEqual(sources.calendarSourceSelectionCandidates(projected, [{ ...event("ignored", "different-uid"), event_id: "different" }]).map((item) => item.sourceId), [first]);
  const family = `ics-series:${"a".repeat(64)}`;
  const recurring = sources.projectCoreCalendarSources([event(first, `${family}#2026-10-01T01:00:00.000Z`)]);
  assert.deepEqual(sources.calendarSourceSelectionCandidates(recurring,
    [event("ignored", `${family}#2026-10-01T02:00:00.000Z`)], [family]).map((item) => item.sourceId), [first]);
});

test("maps single, hashed, and recurring occurrence refs onto one collision-safe series family", () => {
  const uid = "single-to-series";
  const family = seriesFamily(uid);
  assert.equal(sources.calendarOccurrenceSeriesRef(uid), family);
  assert.equal(sources.calendarOccurrenceSeriesRef(`ics:${family.slice("ics-series:".length)}`), family);
  assert.equal(sources.calendarOccurrenceSeriesRef(`${family}#2026-10-20T02:00:00.000Z`), family);
  assert.notEqual(sources.calendarOccurrenceSeriesRef(`foo#2026-10-20T02:00:00.000Z`), seriesFamily("foo"));
});

test("fails closed on ambiguous source ownership or duplicate Core occurrences", () => {
  const first = "calendar-source-00000000000000000000000000000001";
  const second = "calendar-source-00000000000000000000000000000002";
  assert.throws(() => sources.projectCoreCalendarSources([{ ...event(first, "uid-1"), source_ids: [first, second] }]),
    (error) => error?.code === "invalid_calendar_source_projection");
  assert.throws(() => sources.projectCoreCalendarSources([{ ...event(first, "uid-bad"), source_ids: ["calendar-source-not-valid"] }]),
    (error) => error?.code === "invalid_calendar_source_projection");
  assert.throws(() => sources.projectCoreCalendarSources([event(first, "uid-1"), event(first, "uid-1")]),
    (error) => error?.code === "invalid_calendar_source_projection");
});

test("calendar source fingerprint matches the Core cross-repository golden fixture", () => {
  const sourceId = "calendar-source-00000000000000000000000000000001";
  const projected = sources.projectCoreCalendarSources([{
    event_id: "event-uid-1", date: "2026-10-01", end_date: null, name: "教研会", type: "meeting",
    confidence: "teacher_confirmed", notes: null, source_ids: [sourceId], evidence_ids: [], source_occurrence_ref: "uid-1",
    time_interval: null, location: null,
  }]);
  assert.equal(projected[0].fingerprint, "sha256:569c1f717906aa857a153ccccfb01aea6bb85bc8221128bb6b20426f7a2c8096");
});
