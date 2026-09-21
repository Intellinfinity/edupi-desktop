import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const { stableCalendarEventId, stableTimetableSlotId, stableScheduleSourceHash } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-schedule-upload.ts");

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
  ]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_envelope");
  }
});

test("derives stable semantic IDs for schedule uploads without caller IDs", () => {
  const calendar = { date: "日期待确认", endDate: null, name: " 秋季 运动会 ", type: "activity" };
  assert.equal(stableCalendarEventId(calendar), stableCalendarEventId({ ...calendar, name: "秋季  运动会" }));
  assert.notEqual(stableCalendarEventId(calendar), stableCalendarEventId({ ...calendar, type: "meeting" }));
  const slot = { dayOfWeek: 1, period: 2, subject: " 数学 ", className: "七年级二班", kind: "class" };
  assert.equal(stableTimetableSlotId(slot), stableTimetableSlotId({ ...slot, subject: "数学" }));
  assert.notEqual(stableTimetableSlotId(slot), stableTimetableSlotId({ ...slot, period: 3 }));
  const first = { eventId: "a", date: "2026-09-01", name: "开学", type: "teaching" };
  const second = { eventId: "b", date: "2026-09-02", name: "班会", type: "meeting" };
  assert.equal(stableScheduleSourceHash([first, second]), stableScheduleSourceHash([second, first]));
});
