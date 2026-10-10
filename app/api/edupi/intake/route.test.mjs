import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createRequire } from "node:module";
import ts from "typescript";

const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const { parseTimetableIntakeCommand } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-timetable-intake.ts");
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
    { kind: "timetable", slots: [{ dayOfWeek: 2, period: 2, subject: "数学", className: "七一班", classId: "七一班" }] },
    { kind: "timetable", slots: [{ dayOfWeek: 2, period: 2, subject: "数学", classId: "class-7-1", startTime: "25:00", timeZone: "Asia/Shanghai" }] },
    { kind: "timetable", slots: [{ dayOfWeek: 2, period: 2, subject: "数学", classId: "class-7-1", startTime: "09:00" }] },
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

test("teacher-confirmed timetable class ID reaches the Core envelope unchanged", async () => {
  const { buildEducationIntakeCommandEnvelope } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-education-intake.ts");
  const { buildEducationContract } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-education-contract.ts");
  const command = parseTimetableIntakeCommand({ kind: "timetable", slots: [{ slotId: "slot-7-1", dayOfWeek: 2,
    period: 2, subject: "数学", className: "七一班", classId: "class-7-1", startTime: "09:00", timeZone: "Asia/Shanghai", kind: "class" }] });
  assert.equal(command.slots[0].class_id, "class-7-1");
  assert.equal(command.slots[0].class_name, "七一班");
  assert.equal(command.slots[0].start_time, "09:00");
  assert.equal(command.slots[0].time_zone, "Asia/Shanghai");
  const envelope = buildEducationIntakeCommandEnvelope({ snapshotId: "snapshot-before", command });
  assert.equal(envelope.command.slots[0].class_id, "class-7-1");
  assert.equal(buildEducationContract({ timetable: command.slots }).timetable[0].class_id, "class-7-1");
  assert.equal(buildEducationContract({ timetable: command.slots }).timetable[0].start_time, "09:00");
  assert.equal(parseTimetableIntakeCommand({ kind: "timetable", slots: [{ slotId: "slot-7-1", dayOfWeek: 2,
    period: 2, subject: "数学", className: "七一班", classId: "class-7-2", kind: "class" }] }).source.source_hash === command.source.source_hash, false);
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
  assert.notEqual(stableTimetableSlotId({ ...slot, classId: "class-7-1" }),
    stableTimetableSlotId({ ...slot, classId: "class-7-2" }),
    "same-label classes must never share a new timetable slot ID");
  assert.equal(stableTimetableSlotId({ ...slot, classId: "class-7-1", startTime: "09:00" }),
    stableTimetableSlotId({ ...slot, classId: "class-7-1", startTime: "09:30" }),
    "time edits revise one class slot rather than inventing another class identity");
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
  assert.match(source, /\(\?:document\|calendar\)-source-\[a-f0-9\]\{32\}/);
  assert.match(source, /desktop-file-schedule-\[a-f0-9\]\{24\}/);
  assert.doesNotMatch(source, /deleteDocument|removedDocumentEvent/);
});

async function materialRouteFixture(kind, proposal, oldSource = false, lessonProposal = undefined) {
  const require = createRequire(import.meta.url);
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const filename = kind === "calendar" ? "schedule.ics" : kind === "pdf" ? "schedule.pdf" : "schedule.docx";
  const descriptor = { staging_id: `stg_${"1".repeat(32)}`, original_name: filename,
    staging_path: `/synthetic/${filename}`, kind,
    source_hash: `sha256:${"a".repeat(64)}`, expected_size_bytes: 128, source_scope: "desktop_staging" };
  const receipt = { command_type: "intake_material", status: "accepted", applied_ids: [proposal.material_id] };
  const calls = [];
  class EducationIntakeError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const dependencies = {
    "@/lib/edupi-education-intake": { EducationIntakeError, issueEducationIntake: async () => { throw new Error("unexpected direct dispatch"); } },
    "@/lib/edupi-material-staging": { listStagedMaterials: () => [descriptor], settleStagedMaterial: (...args) => calls.push(["settle", ...args]) },
    "@/lib/edupi-material-intake-flow": { intakeRecognizedMaterial: async input => {
      calls.push(["intake", input]); assert.equal(input.recognize, false);
      return { receipts: [receipt], data: {}, materialScheduleProposal: proposal,
        ...(lessonProposal ? { materialLessonProposal: lessonProposal } : {}), recognition: { eventCount: 0, slotCount: 0 }, scheduleNeedsReview: false };
    } },
    "@/lib/edupi-material-recognition": { MaterialRecognitionError: class extends Error {},
      recognizeStagedMaterial: async () => { throw new Error("unexpected recognition"); } },
    "@/lib/edupi-material-recognition-lock": { MaterialRecognitionAdmissionError: class extends Error {}, withMaterialRecognitionLock: async (_id, work) => work() },
    "@/lib/request-security": await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/request-security.ts"),
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/bounded-form-data": await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/bounded-form-data.ts"),
    "@/lib/edupi-timetable-intake": { parseTimetableIntakeCommand },
    "@/lib/edupi-calendar-intake-request": { parseCalendarIntakeCommand },
    "@/lib/edupi-calendar-sources": { CalendarSourceError: class extends Error {} },
    "@/lib/edupi-calendar-file-sync": { calendarRecognitionFingerprint: () => { throw new Error("unexpected fingerprint"); }, syncCalendarFile: async () => {
      assert.equal(oldSource, true, "new intake must not call the old automatic calendar import");
      calls.push(["explicit-calendar-update"]); return { receipts: [receipt], committed: true, recognition: { eventCount: 1, slotCount: 0 }, scheduleNeedsReview: false, sourceId: "old-calendar", removedEventIds: [] };
    } },
    "@/lib/edupi-document-schedule-sync": { syncDocumentScheduleFile: async () => {
      assert.equal(oldSource, true, "new intake must not call the old automatic document import");
      calls.push(["explicit-document-update"]); return { receipts: [receipt], committed: true, recognition: { eventCount: 1, slotCount: 0 }, scheduleNeedsReview: false, sourceId: "old-document" };
    } },
  };
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => dependencies[name] || require(name), routeModule, routeModule.exports);
  return { post: routeModule.exports.POST, descriptor, receipt, calls };
}

test("initial ICS, DOCX and PDF intake retain the file receipt and separate proposal without automatic import", async () => {
  for (const kind of ["calendar", "word", "pdf"]) for (const status of ["proposed", "held", "unavailable"]) {
    const proposal = { status, material_id: "synthetic-material", read_result: status === "unavailable" ? null : { status: status === "proposed" ? "ready" : "unresolved" },
      reason_code: status === "proposed" ? null : "material_schedule_unresolved", read_only: true, automatic_import: false, external_send: false };
    const { post, descriptor, receipt, calls } = await materialRouteFixture(kind, proposal);
    const response = await post(request({ kind: "material", stagingId: descriptor.staging_id, materialKind: "other", recognize: true }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.receipt, receipt);
    assert.deepEqual(result.materialScheduleProposal, proposal);
    assert.equal(result.materialReceivedOnly, true);
    assert.deepEqual(calls.map(item => item[0]), ["intake", "settle"]);
    assert.deepEqual(result.recognition, { eventCount: 0, slotCount: 0 });
  }
});

test("initial DOCX intake exposes a separate pending lesson suggestion without adopting it", async () => {
  const schedule = { status: "unavailable", material_id: "synthetic-material", read_result: null,
    reason_code: "material_schedule_unavailable", read_only: true, automatic_import: false, external_send: false };
  const lesson = { status: "proposed", material_id: "synthetic-material", source_hash: `sha256:${"a".repeat(64)}`,
    metadata_revision: 0, lesson_date: "2026-10-12", lesson_date_path: "word/document.xml/w:p[0]",
    lesson: { slot_id: "synthetic-slot", task_id: "synthetic-task", source_event_date: "2026-10-12",
      starts_at: "2026-10-12T01:00:00.000Z", time_zone: "Asia/Shanghai" },
    basis_hash: `sha256:${"b".repeat(64)}`, reason_code: null,
    read_only: true, automatic_prepare: false, external_send: false };
  const { post, descriptor, calls } = await materialRouteFixture("word", schedule, false, lesson);
  const response = await post(request({ kind: "material", stagingId: descriptor.staging_id, materialKind: "lesson_note", recognize: true }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.materialLessonProposal, lesson);
  assert.deepEqual(result.materialScheduleProposal, schedule);
  assert.equal(result.materialReceivedOnly, true);
  assert.deepEqual(calls.map(item => item[0]), ["intake", "settle"]);
});

test("explicit old calendar and document source updates retain the original sync path", async () => {
  for (const kind of ["calendar", "word"]) {
    const { post, descriptor, calls } = await materialRouteFixture(kind, { material_id: "synthetic-material" }, true);
    const fields = kind === "calendar" ? { calendarSourceId: `calendar-source-${"2".repeat(32)}`, calendarSourceFingerprint: `sha256:${"3".repeat(64)}` }
      : { documentSourceId: `document-source-${"2".repeat(32)}`, documentSourceFingerprint: `sha256:${"3".repeat(64)}` };
    const response = await post(request({ kind: "material", stagingId: descriptor.staging_id, materialKind: "other", recognize: true, ...fields }));
    assert.equal(response.status, 200);
    assert.equal(calls[0][0], kind === "calendar" ? "explicit-calendar-update" : "explicit-document-update");
    assert.equal((await response.json()).materialReceivedOnly, undefined);
  }
});
