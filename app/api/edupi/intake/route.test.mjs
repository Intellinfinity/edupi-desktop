import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { POST, calendarCommand } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const { MANUAL_CALENDAR_ISSUER, stableCalendarEventId, stableOccurrenceCalendarEventId, stableRecognizedCalendarEventId, stableTimetableSlotId, stableScheduleSourceHash } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-schedule-upload.ts");

function request(body, headers = {}) {
  return new Request("http://localhost/api/edupi/intake", {
    method: "POST",
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("rejects cross-site and non-JSON education intake requests", async () => {
  const crossSite = await POST(request({ kind: "calendar", events: [] }, { origin: "https://attacker.example", "sec-fetch-site": "cross-site" }));
  assert.equal(crossSite.status, 403);
  const wrongType = await POST(request({ kind: "calendar", events: [] }, { "content-type": "text/plain" }));
  assert.equal(wrongType.status, 415);
});

test("rejects unknown and unbounded intake shapes before Core dispatch", async () => {
  for (const body of [
    { kind: "calendar", events: [], secret: "no" },
    { kind: "calendar", events: [] },
    { kind: "timetable", slots: [] },
    { kind: "material", stagingId: "bad", unknown: true },
    { kind: "unknown" },
    { kind: "calendar", events: [{ date: "2026-10-01", name: "教研", type: "meeting", sourceOccurrenceRef: "ref-1", timeInterval: { start: "2026-10-01T09:00", end: "2026-10-01T10:00+08:00", timeZone: "Asia/Shanghai" } }] },
    { kind: "calendar", events: [{ date: "2026-10-01", name: "教研", type: "meeting", location: "东楼" }] },
    { kind: "calendar", events: [{ date: "2026-10-01", name: "教研", type: "meeting", sourceOccurrenceRef: "ref-1", timeInterval: { start: "2026-10-01T09:00+08:00", timeZone: "Asia/Shanghai" } }] },
    { kind: "calendar", events: [{ date: "2026-10-01", name: "教研", type: "meeting", sourceOccurrenceRef: "ref-1", location: "x".repeat(241) }] },
  ]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_envelope");
  }
});

test("keeps a manual occurrence issuer and event identity stable across a move", () => {
  const base = { kind: "calendar", events: [{ eventId: null, date: "2026-10-01", endDate: null, name: "教研会", type: "meeting",
    confidence: "teacher_confirmed", notes: null, sourceOccurrenceRef: "manual-ref-42", location: "东楼 203",
    timeInterval: { start: "2026-10-01T09:00+08:00", end: "2026-10-01T10:00+08:00", timeZone: "Asia/Shanghai" } }] };
  const moved = structuredClone(base);
  moved.events[0].date = "2026-10-02";
  moved.events[0].timeInterval = { start: "2026-10-02T11:00+08:00", end: "2026-10-02T12:00+08:00", timeZone: "Asia/Shanghai" };
  const first = calendarCommand(base);
  const second = calendarCommand(moved);
  assert.equal(first.source.source_id, MANUAL_CALENDAR_ISSUER);
  assert.equal(second.source.source_id, MANUAL_CALENDAR_ISSUER);
  assert.equal(first.events[0].event_id, stableOccurrenceCalendarEventId(MANUAL_CALENDAR_ISSUER, "manual-ref-42"));
  assert.equal(second.events[0].event_id, first.events[0].event_id);
  assert.notEqual(second.source.source_hash, first.source.source_hash);
  assert.deepEqual(first.events[0].time_interval, { start: "2026-10-01T09:00+08:00", end: "2026-10-01T10:00+08:00", time_zone: "Asia/Shanghai" });
  assert.equal(first.events[0].location, "东楼 203");
});

test("derives stable semantic IDs for schedule uploads without caller IDs", () => {
  const calendar = { date: "日期待确认", endDate: null, name: " 秋季 运动会 ", type: "activity" };
  assert.equal(stableCalendarEventId(calendar), stableCalendarEventId({ ...calendar, name: "秋季  运动会" }));
  assert.notEqual(stableCalendarEventId(calendar), stableCalendarEventId({ ...calendar, type: "meeting" }));
  assert.equal(stableRecognizedCalendarEventId({ ...calendar, notes: " 09:00 教学楼 " }), stableRecognizedCalendarEventId({ ...calendar, notes: "09:00  教学楼" }));
  assert.notEqual(stableRecognizedCalendarEventId({ ...calendar, notes: "09:00 教学楼" }), stableRecognizedCalendarEventId({ ...calendar, notes: "14:00 教学楼" }));
  const slot = { dayOfWeek: 1, period: 2, subject: " 数学 ", className: "七年级二班", kind: "class" };
  assert.equal(stableTimetableSlotId(slot), stableTimetableSlotId({ ...slot, subject: "数学" }));
  assert.notEqual(stableTimetableSlotId(slot), stableTimetableSlotId({ ...slot, period: 3 }));
  const first = { eventId: "a", date: "2026-09-01", name: "开学", type: "teaching" };
  const second = { eventId: "b", date: "2026-09-02", name: "班会", type: "meeting" };
  assert.equal(stableScheduleSourceHash([first, second]), stableScheduleSourceHash([second, first]));
});
