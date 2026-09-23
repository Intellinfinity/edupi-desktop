import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const { parseCalendarIntakeCommand } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-calendar-intake-request.ts");
const { MANUAL_CALENDAR_ISSUER, stableCalendarEventId, stableDocumentOccurrenceRef, stableDocumentOccurrenceVariantRef, stableDocumentScheduleSourceId, stableFileScheduleIssuer, stableOccurrenceCalendarEventId, stableRecognizedCalendarEventId, stableTimetableSlotId, stableScheduleSourceHash } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-schedule-upload.ts");
const { stageMaterialInputs } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-material-staging.ts");

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

test("document pairing fields cannot be smuggled into another material kind", async () => {
  const root = mkdtempSync(join(tmpdir(), "edupi-pairing-envelope-"));
  const stateDir = join(root, "state");
  const dataRoot = join(root, "data");
  const coreRoot = join(root, "core");
  mkdirSync(dataRoot); mkdirSync(coreRoot);
  const previous = Object.fromEntries(["PI_DESKTOP_STATE_DIR", "EDUPI_DATA_ROOT", "EDUPI_CORE_ROOT"]
    .map(key => [key, process.env[key]]));
  try {
    process.env.PI_DESKTOP_STATE_DIR = stateDir;
    process.env.EDUPI_DATA_ROOT = dataRoot;
    process.env.EDUPI_CORE_ROOT = coreRoot;
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlYdxsAAAAASUVORK5CYII=", "base64");
    const [staged] = stageMaterialInputs([{ name: "blank.png", mimeType: "image/png", bytes }],
      { stateDir, dataRoot, coreRoot, idFactory: () => `stg_${"1".repeat(32)}` });
    const base = { kind: "material", stagingId: staged.staging_id, title: "blank.png", materialKind: "other",
      subject: "测试", classId: "测试班", recognize: true,
      documentSourceId: `document-source-${"2".repeat(32)}`,
      documentSourceFingerprint: `sha256:${"3".repeat(64)}`,
      documentPairingFingerprint: `sha256:${"4".repeat(64)}` };
    for (const pairings of [[], [{ incomingVariantRef: "bad", currentSourceOccurrenceRef: null }],
      [{ incomingVariantRef: `document-occurrence-${"5".repeat(32)}-${"6".repeat(32)}`, currentSourceOccurrenceRef: "other\nsource" }]]) {
      const response = await POST(request({ ...base, documentPairings: pairings }));
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "invalid_envelope");
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps a manual occurrence issuer and event identity stable across a move", () => {
  const base = { kind: "calendar", events: [{ eventId: null, date: "2026-10-01", endDate: null, name: "教研会", type: "meeting",
    confidence: "teacher_confirmed", notes: null, sourceOccurrenceRef: "manual-ref-42", location: "东楼 203",
    timeInterval: { start: "2026-10-01T09:00+08:00", end: "2026-10-01T10:00+08:00", timeZone: "Asia/Shanghai" } }] };
  const moved = structuredClone(base);
  moved.events[0].date = "2026-10-02";
  moved.events[0].timeInterval = { start: "2026-10-02T11:00+08:00", end: "2026-10-02T12:00+08:00", timeZone: "Asia/Shanghai" };
  const first = parseCalendarIntakeCommand(base);
  const second = parseCalendarIntakeCommand(moved);
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
  const morning = { start: "2026-10-01T09:00+08:00", end: "2026-10-01T10:00+08:00", time_zone: "Asia/Shanghai" };
  const afternoon = { start: "2026-10-01T14:00+08:00", end: "2026-10-01T15:00+08:00", time_zone: "Asia/Shanghai" };
  assert.notEqual(stableRecognizedCalendarEventId({ ...calendar, notes: null, timeInterval: morning, location: "东楼" }),
    stableRecognizedCalendarEventId({ ...calendar, notes: null, timeInterval: afternoon, location: "东楼" }));
  assert.equal(stableRecognizedCalendarEventId({ ...calendar, notes: null, timeInterval: morning, location: " 东楼 " }),
    stableRecognizedCalendarEventId({ ...calendar, notes: null, timeInterval: { ...morning }, location: "东楼" }));
  const slot = { dayOfWeek: 1, period: 2, subject: " 数学 ", className: "七年级二班", kind: "class" };
  assert.equal(stableTimetableSlotId(slot), stableTimetableSlotId({ ...slot, subject: "数学" }));
  assert.notEqual(stableTimetableSlotId(slot), stableTimetableSlotId({ ...slot, period: 3 }));
  const first = { eventId: "a", date: "2026-09-01", name: "开学", type: "teaching" };
  const second = { eventId: "b", date: "2026-09-02", name: "班会", type: "meeting" };
  assert.equal(stableScheduleSourceHash([first, second]), stableScheduleSourceHash([second, first]));
  assert.equal(stableFileScheduleIssuer("校历和课表.pdf"), "desktop-file-schedule-aac4e224bafe9fe3e1aceb9c");
  const firstHash = `sha256:${"a".repeat(64)}`;
  const secondHash = `sha256:${"b".repeat(64)}`;
  assert.equal(stableFileScheduleIssuer("校历和课表.pdf", firstHash), stableFileScheduleIssuer("重命名后的行程.pdf", firstHash),
    "the same bytes must retain one schedule issuer after a rename");
  assert.notEqual(stableFileScheduleIssuer("校历和课表.pdf", firstHash), stableFileScheduleIssuer("校历和课表.pdf", secondHash),
    "different bytes with the same filename must not share schedule provenance");
  assert.notEqual(stableFileScheduleIssuer("校历和课表.pdf", firstHash), stableFileScheduleIssuer("校历和课表.pdf"));
  assert.equal(stableDocumentScheduleSourceId(firstHash), `document-source-${"a".repeat(32)}`);
  assert.equal(stableDocumentOccurrenceRef({ name: " 教研  会 ", type: "MEETING" }),
    stableDocumentOccurrenceRef({ name: "教研 会", type: "meeting" }));
  assert.notEqual(stableDocumentOccurrenceRef({ name: "教研会", type: "meeting" }),
    stableDocumentOccurrenceRef({ name: "教研会", type: "activity" }));
  assert.notEqual(stableDocumentOccurrenceVariantRef({ date: "2026-10-20", name: "教研会", type: "meeting" }),
    stableDocumentOccurrenceVariantRef({ date: "2026-10-21", name: "教研会", type: "meeting" }));
  assert.equal(stableDocumentOccurrenceVariantRef({ date: "2026-10-20", name: " 教研 会 ", type: "MEETING", notes: null }),
    stableDocumentOccurrenceVariantRef({ date: "2026-10-20", name: "教研 会", type: "meeting", notes: null }));
});

test("routes PDF and DOCX schedule revisions through a distinct bounded source contract", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /syncDocumentScheduleFile/);
  assert.match(source, /documentSourceId/);
  assert.match(source, /documentSourceFingerprint/);
  assert.match(source, /\^\(\?:document\|calendar\)-source-\[a-f0-9\]\{32\}\$/);
  assert.doesNotMatch(source, /deleteDocument|removedDocumentEvent/);
});
