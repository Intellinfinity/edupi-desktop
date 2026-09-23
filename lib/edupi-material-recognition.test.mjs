import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const recognition = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-material-recognition.ts");

const descriptor = {
  staging_id: "stg_00000000000000000000000000000001",
  staging_path: "/desktop-state/material-staging/stg_00000000000000000000000000000001/material.pdf",
  original_name: "第一学期校历.pdf",
  expected_size_bytes: 128,
  source_hash: `sha256:${"a".repeat(64)}`,
  kind: "pdf",
  source_scope: "desktop_staging",
};

test("keeps DOCX dependency resolution out of the webpack module-load path", () => {
  const source = fs.readFileSync(new URL("./edupi-material-recognition.ts", import.meta.url), "utf8");
  assert.match(source, /function resolveMammothEntry\(\)/);
  assert.match(source, /resolveMammothEntry\(\)/);
  assert.doesNotMatch(source, /const mammothEntry\s*=\s*createRequire\(path\.join\(process\.cwd\(\),\s*["']package\.json/);
});

function docxDirectory(uncompressedSize) {
  const central = Buffer.alloc(47);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(uncompressedSize, 24);
  central.writeUInt16LE(1, 28);
  central[46] = 0x61;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(0, 16);
  return Buffer.concat([central, end]);
}

test("parses only bounded calendar and timetable fields and keeps uncertain dates unguessed", () => {
  let nextId = 0;
  const result = recognition.parseRecognitionOutput(`\n\`\`\`json\n${JSON.stringify({
    events: [
      { date: "2026-09-01", end_date: null, name: "开学", type: "teaching", notes: "校历原文" },
      { date: "十月下旬（日期待确认）", end_date: null, name: "运动会", type: "activity", notes: null },
    ],
    slots: [
      { day_of_week: 1, period: 1, subject: "数学", class_name: "七年级二班", kind: "class", notes: null },
    ],
  })}\n\`\`\``, () => `recognized-${++nextId}`);
  assert.deepEqual(result.events, [
    { event_id: "recognized-1", date: "2026-09-01", end_date: null, name: "开学", type: "teaching", confidence: "inferred", notes: "校历原文" },
    { event_id: "recognized-2", date: "十月下旬（日期待确认）", end_date: null, name: "运动会", type: "activity", confidence: "inferred", notes: null },
  ]);
  assert.deepEqual(result.slots, [
    { slot_id: "recognized-3", day_of_week: 1, period: 1, subject: "数学", class_name: "七年级二班", kind: "class", notes: null },
  ]);
});

test("fills omitted optional recognition fields while still rejecting unknown fields", () => {
  const result = recognition.parseRecognitionOutput(JSON.stringify({
    events: [{ date: "2026-09-01", name: "开学", type: "teaching" }],
    slots: [{ day_of_week: 1, period: 1, subject: "数学", kind: "class" }],
  }), () => "optional-1");
  assert.equal(result.events[0].end_date, null);
  assert.equal(result.events[0].notes, null);
  assert.equal(result.slots[0].class_name, null);
  assert.equal(result.slots[0].notes, null);
  assert.throws(() => recognition.parseRecognitionOutput(JSON.stringify({ events: [{ date: "2026-09-01", name: "开学", type: "teaching", surprise: true }], slots: [] })), (error) => error?.code === "invalid_output");
});

test("rejects model-invented occurrence identity, time, and location", () => {
  for (const event of [
    { date: "2026-10-01", name: "时间来源不可证", type: "meeting", time_interval: { start: "2026-10-01T09:00+08:00", end: "2026-10-01T10:00+08:00", time_zone: "Asia/Shanghai" } },
    { date: "2026-10-01", name: "地点来源不可证", type: "meeting", location: "东楼 203" },
    { date: "2026-10-01", name: "来源错误", type: "meeting", source_occurrence_ref: "model-invented" },
  ]) {
    assert.throws(() => recognition.parseRecognitionOutput(JSON.stringify({ events: [event], slots: [] })),
      (error) => error?.code === "invalid_output");
  }
});

test("parses explicit ICS identities, timezones, all-day ranges, and finite recurrence", async () => {
  const source = Buffer.from([
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EduPi Test//EN",
    "BEGIN:VEVENT", "UID:timed-1", "DTSTAMP:20260901T000000Z", "DTSTART;TZID=Asia/Shanghai:20261001T090000",
    "DTEND;TZID=Asia/Shanghai:20261001T100000", "SUMMARY:教研会", "LOCATION:东楼 203", "DESCRIPTION:区级教研", "STATUS:CONFIRMED", "END:VEVENT",
    "BEGIN:VEVENT", "UID:all-day-1", "DTSTAMP:20260901T000000Z", "DTSTART;VALUE=DATE:20261001",
    "DTEND;VALUE=DATE:20261003", "SUMMARY:国庆安排", "END:VEVENT",
    "BEGIN:VEVENT", "UID:weekly-1", "DTSTAMP:20260901T000000Z", "DTSTART;TZID=Asia/Shanghai:20260901T140000",
    "DTEND;TZID=Asia/Shanghai:20260901T150000", "RRULE:FREQ=WEEKLY;COUNT=3", "EXDATE;TZID=Asia/Shanghai:20260908T140000",
    "SUMMARY:备课组会", "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n"));
  const first = await recognition.parseIcsCalendar(source);
  const second = await recognition.parseIcsCalendar(source);
  assert.equal(first.events.length, 4);
  assert.deepEqual(first, second, "the same ICS bytes must keep stable occurrence identities");
  const timed = first.events.find((event) => event.name === "教研会");
  assert.equal(timed.source_occurrence_ref, "timed-1");
  assert.deepEqual(timed.time_interval, { start: "2026-10-01T09:00+08:00", end: "2026-10-01T10:00+08:00", time_zone: "Asia/Shanghai" });
  assert.equal(timed.location, "东楼 203");
  assert.equal(timed.notes, "区级教研");
  const allDay = first.events.find((event) => event.name === "国庆安排");
  assert.equal(allDay.date, "2026-10-01");
  assert.equal(allDay.end_date, "2026-10-02", "date-only DTEND is exclusive in RFC 5545");
  assert.equal(Object.hasOwn(allDay, "time_interval"), false);
  const weekly = first.events.filter((event) => event.name === "备课组会");
  assert.deepEqual(weekly.map((event) => event.date), ["2026-09-01", "2026-09-15"]);
  assert.equal(new Set(weekly.map((event) => event.source_occurrence_ref)).size, 2);
  assert.deepEqual(first.cancelled_occurrence_refs, ["weekly-1#2026-09-08T06:00:00.000Z"],
    "EXDATE must name the same stable recurrence identity that a delta update withdraws");
});

test("rejects unbounded, floating, cross-day, oversized, and malformed ICS schedules", async () => {
  const calendar = (lines) => Buffer.from(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EduPi Test//EN", ...lines, "END:VCALENDAR", ""].join("\r\n"));
  const base = ["BEGIN:VEVENT", "UID:test", "DTSTAMP:20260901T000000Z", "SUMMARY:测试"];
  for (const bytes of [
    calendar([...base, "DTSTART;TZID=Asia/Shanghai:20260901T090000", "DTEND;TZID=Asia/Shanghai:20260901T100000", "RRULE:FREQ=DAILY", "END:VEVENT"]),
    calendar([...base, "DTSTART:20260901T090000", "DTEND:20260901T100000", "END:VEVENT"]),
    calendar([...base, "DTSTART;TZID=Asia/Shanghai:20260901T230000", "DTEND;TZID=Asia/Shanghai:20260902T010000", "END:VEVENT"]),
  ]) await assert.rejects(recognition.parseIcsCalendar(bytes), (error) => error?.code === "ambiguous_schedule");
  await assert.rejects(recognition.parseIcsCalendar(calendar([...base, "DTSTART;TZID=Asia/Shanghai:20260901T090000",
    "DTEND;TZID=Asia/Shanghai:20260901T100000", "RRULE:FREQ=DAILY;COUNT=201", "END:VEVENT"])),
  (error) => error?.code === "too_large");
  await assert.rejects(recognition.parseIcsCalendar(Buffer.from("not a calendar")), (error) => error?.code === "invalid_output");
});

test("rejects missing or duplicate UID, missing end, sub-minute time, unknown zones, and unsupported recurrence forms", async () => {
  const calendar = (events) => Buffer.from(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EduPi Test//EN", ...events.flat(), "END:VCALENDAR", ""].join("\r\n"));
  const event = (uid, lines = []) => ["BEGIN:VEVENT", ...(uid ? [`UID:${uid}`] : []), "DTSTAMP:20260901T000000Z", "SUMMARY:测试", ...lines, "END:VEVENT"];
  const timed = ["DTSTART;TZID=Asia/Shanghai:20260901T090000", "DTEND;TZID=Asia/Shanghai:20260901T100000"];
  for (const bytes of [
    calendar([event(null, timed)]),
    calendar([event("same", timed), event("same", timed)]),
    calendar([event("missing-end", ["DTSTART;TZID=Asia/Shanghai:20260901T090000"])]),
    calendar([event("seconds", ["DTSTART;TZID=Asia/Shanghai:20260901T090001", "DTEND;TZID=Asia/Shanghai:20260901T100000"])]),
    calendar([event("unknown-zone", ["DTSTART;TZID=School/Local:20260901T090000", "DTEND;TZID=School/Local:20260901T100000"])]),
    calendar([event("rdate", [...timed, "RDATE;TZID=Asia/Shanghai:20260902T090000"])]),
    calendar([event("high-frequency", [...timed, "RRULE:FREQ=HOURLY;COUNT=2"])]),
    calendar([event("all-day-recurrence", ["DTSTART;VALUE=DATE:20260901", "DTEND;VALUE=DATE:20260902", "RRULE:FREQ=DAILY;COUNT=2"])]),
  ]) await assert.rejects(recognition.parseIcsCalendar(bytes), (error) => ["invalid_output", "ambiguous_schedule"].includes(error?.code));
});

test("uses the original recurrence key for moved overrides and keeps cancellations out of active events", async () => {
  const bytes = Buffer.from([
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EduPi Test//EN",
    "BEGIN:VEVENT", "UID:series-1", "DTSTAMP:20260901T000000Z", "DTSTART;TZID=America/New_York:20261101T090000",
    "DTEND;TZID=America/New_York:20261101T100000", "RRULE:FREQ=WEEKLY;COUNT=3", "SUMMARY:原安排", "END:VEVENT",
    "BEGIN:VEVENT", "UID:series-1", "RECURRENCE-ID;TZID=America/New_York:20261108T090000", "DTSTAMP:20260901T000000Z",
    "DTSTART;TZID=America/New_York:20261108T110000", "DTEND;TZID=America/New_York:20261108T120000", "SUMMARY:改期安排", "END:VEVENT",
    "BEGIN:VEVENT", "UID:cancelled-1", "DTSTAMP:20260901T000000Z", "DTSTART;TZID=Asia/Shanghai:20261201T090000",
    "DTEND;TZID=Asia/Shanghai:20261201T100000", "SUMMARY:已取消", "STATUS:CANCELLED", "END:VEVENT",
    "END:VCALENDAR", "",
  ].join("\r\n"));
  const result = await recognition.parseIcsCalendar(bytes);
  assert.equal(result.events.length, 3);
  const moved = result.events.find((event) => event.name === "改期安排");
  assert.equal(moved.time_interval.start, "2026-11-08T11:00-05:00");
  assert.match(moved.source_occurrence_ref, /2026-11-08T14:00:00\.000Z$/u, "identity uses RECURRENCE-ID rather than moved DTSTART");
  assert.deepEqual(result.cancelled_occurrence_refs, ["cancelled-1"]);
  assert.equal(result.calendar_mode, "full_snapshot");
  assert.equal(result.events.some((event) => event.source_occurrence_ref === "cancelled-1"), false);
});

test("parses a standalone RECURRENCE-ID cancellation without requiring the master RRULE", async () => {
  const bytes = Buffer.from([
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EduPi Test//EN", "METHOD:CANCEL",
    "BEGIN:VEVENT", "UID:series-cancel", "RECURRENCE-ID;TZID=Asia/Shanghai:20261027T090000",
    "DTSTAMP:20260901T000000Z", "STATUS:CANCELLED", "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n"));
  const result = await recognition.parseIcsCalendar(bytes);
  assert.equal(result.calendar_mode, "delta_cancel");
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.cancelled_occurrence_refs, ["series-cancel#2026-10-27T01:00:00.000Z"]);
});

test("distinguishes full snapshots, delta upserts, and cancellation deltas", async () => {
  const source = (method, status = "CONFIRMED") => Buffer.from([
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EduPi Test//EN", ...(method ? [`METHOD:${method}`] : []),
    "BEGIN:VEVENT", `UID:${method || "snapshot"}`, "DTSTAMP:20260901T000000Z", "DTSTART;TZID=Asia/Shanghai:20261201T090000",
    "DTEND;TZID=Asia/Shanghai:20261201T100000", "SUMMARY:事项", `STATUS:${status}`, "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n"));
  assert.equal((await recognition.parseIcsCalendar(source(null))).calendar_mode, "full_snapshot");
  assert.equal((await recognition.parseIcsCalendar(source("REQUEST"))).calendar_mode, "delta_upsert");
  assert.equal((await recognition.parseIcsCalendar(source("PUBLISH"))).calendar_mode, "delta_upsert");
  const cancelled = await recognition.parseIcsCalendar(source("CANCEL", "CANCELLED"));
  assert.equal(cancelled.calendar_mode, "delta_cancel");
  assert.deepEqual(cancelled.events, []);
  assert.deepEqual(cancelled.cancelled_occurrence_refs, ["CANCEL"]);
});

test("normalizes folded timed text fields before Core content hashing", async () => {
  const bytes = Buffer.from([
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EduPi Test//EN", "BEGIN:VEVENT", "UID:normalized-text", "DTSTAMP:20260901T000000Z",
    "DTSTART;TZID=Asia/Shanghai:20261201T090000", "DTEND;TZID=Asia/Shanghai:20261201T100000", "SUMMARY:  教研   会  ",
    "LOCATION:  东楼   203  ", "DESCRIPTION:第一行  ", " 第二行", "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n"));
  const parsed = await recognition.parseIcsCalendar(bytes);
  assert.equal(parsed.events[0].name, "教研 会");
  assert.equal(parsed.events[0].location, "东楼 203");
  assert.equal(parsed.events[0].notes, "第一行 第二行");
});

test("accepts UTC and unambiguous DST offsets but rejects DST gaps and folds", async () => {
  const calendar = (uid, start, end, zone = null) => Buffer.from([
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EduPi Test//EN", "BEGIN:VEVENT", `UID:${uid}`, "DTSTAMP:20260901T000000Z",
    `DTSTART${zone ? `;TZID=${zone}` : ""}:${start}`, `DTEND${zone ? `;TZID=${zone}` : ""}:${end}`, "SUMMARY:时区测试", "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n"));
  const utc = await recognition.parseIcsCalendar(calendar("utc-1", "20261001T090000Z", "20261001T100000Z"));
  assert.deepEqual(utc.events[0].time_interval, { start: "2026-10-01T09:00+00:00", end: "2026-10-01T10:00+00:00", time_zone: "UTC" });
  const dst = await recognition.parseIcsCalendar(calendar("dst-ok", "20261101T003000", "20261101T023000", "America/New_York"));
  assert.equal(dst.events[0].time_interval.start, "2026-11-01T00:30-04:00");
  assert.equal(dst.events[0].time_interval.end, "2026-11-01T02:30-05:00");
  await assert.rejects(recognition.parseIcsCalendar(calendar("dst-gap", "20260308T023000", "20260308T033000", "America/New_York")), (error) => error?.code === "ambiguous_schedule");
  await assert.rejects(recognition.parseIcsCalendar(calendar("dst-fold", "20261101T013000", "20261101T023000", "America/New_York")), (error) => error?.code === "ambiguous_schedule");
});

test("enforces the aggregate occurrence cap before expansion and accepts a bounded UNTIL rule", async () => {
  const event = (uid, rule) => ["BEGIN:VEVENT", `UID:${uid}`, "DTSTAMP:20260901T000000Z", "DTSTART;TZID=Asia/Shanghai:20260901T090000",
    "DTEND;TZID=Asia/Shanghai:20260901T100000", rule, "SUMMARY:循环", "END:VEVENT"];
  const wrap = (events) => Buffer.from(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EduPi Test//EN", ...events.flat(), "END:VCALENDAR", ""].join("\r\n"));
  await assert.rejects(recognition.parseIcsCalendar(wrap([event("series-a", "RRULE:FREQ=DAILY;COUNT=101"), event("series-b", "RRULE:FREQ=DAILY;COUNT=100")])),
    (error) => error?.code === "too_large");
  const finite = await recognition.parseIcsCalendar(wrap([event("until-1", "RRULE:FREQ=DAILY;UNTIL=20260903T010000Z")]));
  assert.deepEqual(finite.events.map((item) => item.date), ["2026-09-01", "2026-09-02", "2026-09-03"]);
});

test("long UID values are bounded by a stable hash and all-day dates ignore the host timezone", async () => {
  const longUid = `school-${"x".repeat(220)}`;
  const bytes = Buffer.from([
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EduPi Test//EN", "BEGIN:VEVENT", `UID:${longUid}`, "DTSTAMP:20260901T000000Z",
    "DTSTART;VALUE=DATE:20261001", "DTEND;VALUE=DATE:20261003", "SUMMARY;LANGUAGE=zh-CN:国庆安排", "LOCATION;LANGUAGE=zh-CN:本地", "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n"));
  const previous = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const utc = await recognition.parseIcsCalendar(bytes);
    process.env.TZ = "America/Los_Angeles";
    const pacific = await recognition.parseIcsCalendar(bytes);
    assert.deepEqual(utc, pacific);
    assert.match(utc.events[0].source_occurrence_ref, /^ics:[a-f0-9]{64}$/u);
    assert.equal(utc.events[0].date, "2026-10-01");
    assert.equal(utc.events[0].end_date, "2026-10-02");
    assert.equal(utc.events[0].location, "本地");
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test("tentative ICS events remain inferred and cannot silently become confirmed facts", async () => {
  const bytes = Buffer.from([
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EduPi Test//EN", "BEGIN:VEVENT", "UID:tentative-1", "DTSTAMP:20260901T000000Z",
    "DTSTART;TZID=Asia/Shanghai:20261001T090000", "DTEND;TZID=Asia/Shanghai:20261001T100000", "SUMMARY:暂定会议", "STATUS:TENTATIVE", "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n"));
  assert.equal((await recognition.parseIcsCalendar(bytes)).events[0].confidence, "inferred");
});

test("rejects prose, unknown fields, invalid slot bounds, and oversized results", () => {
  for (const output of [
    "没有识别到日程",
    JSON.stringify({ events: [], slots: [], explanation: "extra" }),
    JSON.stringify({ events: [], slots: [{ day_of_week: 8, period: 1, subject: "数学", class_name: null, kind: "class", notes: null }] }),
    JSON.stringify({ events: Array.from({ length: 201 }, (_, index) => ({ date: "2026-09-01", end_date: null, name: `事件${index}`, type: "custom", notes: null })), slots: [] }),
  ]) assert.throws(() => recognition.parseRecognitionOutput(output), (error) => error?.code === "invalid_output");
});

test("normalizes common Chinese date, type, weekday, period, and slot-kind output", () => {
  let nextId = 0;
  const result = recognition.parseRecognitionOutput(JSON.stringify({
    events: [{ date: "2026年9月1日", end_date: "", name: "开学", type: "开学", notes: "" }],
    slots: [{ day_of_week: "周一", period: "第1节", subject: "数学", class_name: "七年级二班", kind: "课程", notes: "" }],
  }), () => `cn-${++nextId}`);
  assert.deepEqual(result.events[0], { event_id: "cn-1", date: "2026-09-01", end_date: null, name: "开学", type: "teaching", confidence: "inferred", notes: null });
  assert.deepEqual(result.slots[0], { slot_id: "cn-2", day_of_week: 1, period: 1, subject: "数学", class_name: "七年级二班", kind: "class", notes: null });
});

test("recognizes extracted source content without sending staging ids or hashes to the model", async () => {
  let modelInput;
  const result = await recognition.recognizeStagedMaterial(descriptor, {
    idFactory: (() => { let index = 0; return () => `item-${++index}`; })(),
    extract: async () => ({ text: "2026年9月1日开学", images: [] }),
    runModel: async (input) => {
      modelInput = input;
      return JSON.stringify({ events: [{ date: "2026-09-01", end_date: null, name: "开学", type: "teaching", notes: null }], slots: [] });
    },
  });
  assert.equal(modelInput.originalName, "第一学期校历.pdf");
  assert.equal(modelInput.text, "2026年9月1日开学");
  assert.equal(JSON.stringify(modelInput).includes("stg_"), false);
  assert.equal(JSON.stringify(modelInput).includes("sha256"), false);
  assert.equal(result.events[0].event_id, "item-1");
  assert.equal(result.events[0].confidence, "inferred");
});

test("returns an empty recognition result for a material with no schedule facts", async () => {
  const result = await recognition.recognizeStagedMaterial(descriptor, {
    extract: async () => ({ text: "普通课堂反思，没有日期或课表", images: [] }),
    runModel: async () => JSON.stringify({ events: [], slots: [] }),
  });
  assert.deepEqual(result, { events: [], slots: [] });
});

test("never sends a truncated 30,001-character source to the model", async () => {
  let modelCalls = 0;
  await assert.rejects(recognition.recognizeStagedMaterial(descriptor, {
    extract: async () => ({ text: "日".repeat(30_001), images: [] }),
    runModel: async () => { modelCalls += 1; return JSON.stringify({ events: [], slots: [] }); },
  }), (error) => error?.code === "ambiguous_schedule");
  assert.equal(modelCalls, 0);
});

test("rejects malformed and decompression-bomb DOCX archives before mammoth runs", () => {
  assert.doesNotThrow(() => recognition.validateDocxArchive(docxDirectory(1024)));
  assert.throws(() => recognition.validateDocxArchive(docxDirectory(80 * 1024 * 1024)), (error) => error?.code === "too_large");
  assert.throws(() => recognition.validateDocxArchive(Buffer.from("PK bad")), (error) => error?.code === "extract_unavailable");
});

test("runs DOCX expansion in a bounded child process instead of the server process", () => {
  const source = fs.readFileSync(new URL("./edupi-material-recognition.ts", import.meta.url), "utf8");
  assert.match(source, /`--max-old-space-size=\$\{DOCX_WORKER_HEAP_MB\}`/);
  assert.match(source, /timeout: DOCX_WORKER_TIMEOUT_MS/);
  assert.match(source, /withPrivateSnapshot\(bytes, extension, extractDocxText\)/);
  assert.doesNotMatch(source, /mammoth\.extractRawText\(\{ buffer: bytes \}\)/);
  assert.match(source, /pdfinfo/);
  assert.match(source, /pageCount > MAX_MODEL_IMAGES/);
  assert.ok(source.indexOf("pageCount > MAX_MODEL_IMAGES") < source.indexOf("pdftoppm"), "page count is gated before partial OCR");
});

test("pins recognition bytes to the private staging root and rejects swaps or symlinks", async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "edupi-recognition-boundary-"));
  const previous = process.env.PI_DESKTOP_STATE_DIR;
  const stagingId = "stg_30000000000000000000000000000001";
  const directory = path.join(root, "material-staging", stagingId);
  const file = path.join(directory, "material.png");
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(file, bytes);
  process.env.PI_DESKTOP_STATE_DIR = root;
  const boundaryDescriptor = { ...descriptor, staging_id: stagingId, staging_path: file, original_name: "校历.png", expected_size_bytes: bytes.length, source_hash: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`, kind: "image" };
  try {
    assert.deepEqual((await recognition.readVerifiedStagedMaterial(boundaryDescriptor)).bytes, bytes);
    const cachedResult = { events: [{ event_id: "cached-event", date: "2026-09-01", end_date: null, name: "开学", type: "teaching", confidence: "inferred", notes: null }], slots: [] };
    recognition.saveRecognitionCache(boundaryDescriptor, cachedResult);
    assert.deepEqual(recognition.loadRecognitionCache(boundaryDescriptor), cachedResult);
    const cacheFile = path.join(directory, "recognition-result.json");
    const legacyCache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    fs.writeFileSync(cacheFile, `${JSON.stringify({ version: 1, source_hash: legacyCache.source_hash, original_name: legacyCache.original_name, result: legacyCache.result })}\n`);
    assert.equal(recognition.loadRecognitionCache(boundaryDescriptor), null,
      "a v1 cache becomes a miss and cannot bypass the current parser and policy checks");
    fs.writeFileSync(file, Buffer.alloc(bytes.length, 0x61));
    await assert.rejects(recognition.readVerifiedStagedMaterial(boundaryDescriptor), (error) => error?.code === "extract_unavailable");
    await assert.rejects(recognition.recognizeStagedMaterial(boundaryDescriptor), (error) => error?.code === "extract_unavailable");
    fs.unlinkSync(file);
    const outside = path.join(root, "outside.png");
    fs.writeFileSync(outside, bytes);
    fs.symlinkSync(outside, file);
    await assert.rejects(recognition.readVerifiedStagedMaterial(boundaryDescriptor), (error) => error?.code === "extract_unavailable");
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_STATE_DIR; else process.env.PI_DESKTOP_STATE_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
