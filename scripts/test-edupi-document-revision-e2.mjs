#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
if (typeof configuredCoreRoot !== "string" || !path.isAbsolute(configuredCoreRoot)) {
  throw new Error("EDUPI_CORE_ROOT must be an absolute Core checkout");
}
const coreRoot = fs.realpathSync(configuredCoreRoot);
const keepArtifacts = process.env.EDUPI_E2_KEEP === "1";
const desktopRoot = path.resolve(new URL("..", import.meta.url).pathname);
const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts", "edupi-core-compat.json"), "utf8"));
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-document-revision-e2-")));
const dataRoot = path.join(temporaryRoot, "data");
const stateDir = path.join(temporaryRoot, "desktop-state");
const home = path.join(dataRoot, ".edupi");
for (const directory of [stateDir, path.join(home, "memory"), path.join(home, "output"), path.join(home, "locks")]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

const keys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT",
  "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT", "PI_DESKTOP_STATE_DIR"];
const previous = new Map(keys.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  EDUPI_PROJECT_ROOT: dataRoot,
  EDUPI_DATA_ROOT: dataRoot,
  EDUPI_DATA_ALLOWED_ROOT: temporaryRoot,
  EDUPI_CORE_ROOT: coreRoot,
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: path.join(home, "memory"),
  EDUPI_OUTPUT_DIR: path.join(home, "output"),
  EDUPI_LOCK_DIR: path.join(home, "locks"),
  EDUPI_CORE_COMMIT: compat.core_runtime.core_commit,
  PI_DESKTOP_STATE_DIR: stateDir,
});

function xml(value) {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

async function docx(text) {
  const zip = new JSZip();
  const options = { date: new Date("2026-01-01T00:00:00.000Z") };
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`, options);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`, options);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text.split("\n").map((line) => `<w:p><w:r><w:t>${xml(line)}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`, options);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function modelEvent({ date, name, start, end, location, quote, notes }) {
  return {
    date,
    name,
    type: "meeting",
    notes,
    evidence_quote: quote,
    time_interval: { start: `${date}T${start}+08:00`, end: `${date}T${end}+08:00`, time_zone: "Asia/Shanghai" },
    location,
  };
}

try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const staging = await jiti.import("../lib/edupi-material-staging.ts");
  const recognition = await jiti.import("../lib/edupi-material-recognition.ts");
  const sync = await jiti.import("../lib/edupi-document-schedule-sync.ts");
  const sourceProjection = await jiti.import("../lib/edupi-calendar-sources.ts");
  const intake = await jiti.import("../lib/edupi-education-intake.ts");
  const upload = await jiti.import("../lib/edupi-schedule-upload.ts");

  async function stageAndRecognize(name, text, events, exactBytes = null) {
    const bytes = exactBytes || await docx(text);
    const descriptor = staging.stageMaterialInputs([{
      name,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: new Uint8Array(bytes),
    }])[0];
    const output = JSON.stringify({ events, slots: [] });
    const result = await recognition.recognizeStagedMaterial(descriptor, {
      runModel: async (input) => {
        assert.equal(input.text.includes(text.split("\n")[0]), true);
        return output;
      },
      idFactory: () => `model-${descriptor.staging_id}`,
    });
    return { descriptor, result, bytes };
  }

  async function importDocument(descriptor, result, source = null) {
    return sync.syncDocumentScheduleFile({
      descriptor,
      title: descriptor.original_name,
      materialKind: "other",
      subject: "行政",
      classId: "全校",
      requestedSourceId: source?.sourceId ?? null,
      expectedSourceFingerprint: source?.fingerprint ?? null,
    }, { recognize: async () => result });
  }

  const meetingQuote = "通知：2026年10月20日 09:00-10:00（北京时间）在东楼 203 举行教研会。";
  const parentQuote = "通知：2026年10月22日 18:00-19:00（北京时间）在报告厅举行家长会。";
  const initialText = `${meetingQuote}\n${parentQuote}`;
  const initialEvents = [
    modelEvent({ date: "2026-10-20", name: "教研会", start: "09:00", end: "10:00", location: "东楼 203", quote: meetingQuote, notes: null }),
    modelEvent({ date: "2026-10-22", name: "家长会", start: "18:00", end: "19:00", location: "报告厅", quote: parentQuote, notes: null }),
  ];
  const initial = await stageAndRecognize("校内安排.docx", initialText, initialEvents);
  const first = await importDocument(initial.descriptor, initial.result);
  assert.equal(first.committed, true);
  assert.equal(first.removedEventIds.length, 0);
  let read = await sourceProjection.readCoreCalendarSources();
  let documentSource = read.sources.find((source) => source.sourceId === first.sourceId);
  assert.equal(documentSource.sourceKind, "document");
  assert.equal(documentSource.eventCount, 2);
  const originalIds = documentSource.occurrences.map((item) => item.eventId).sort();

  const renamed = await stageAndRecognize("重命名后的校内安排.docx", initialText, initialEvents, initial.bytes);
  assert.equal(renamed.descriptor.source_hash, initial.descriptor.source_hash);
  const replay = await importDocument(renamed.descriptor, renamed.result);
  assert.equal(replay.sourceId, first.sourceId);
  assert.equal(replay.committed, true);
  read = await sourceProjection.readCoreCalendarSources();
  documentSource = read.sources.find((source) => source.sourceId === first.sourceId);
  assert.deepEqual(documentSource.occurrences.map((item) => item.eventId).sort(), originalIds);
  assert.equal(documentSource.eventCount, 2);

  const revisedQuote = "通知：2026年10月20日 09:00-10:00（北京时间）在东楼 203 举行教研会，地点已确认。";
  const revision = await stageAndRecognize("校内安排-修订.docx", revisedQuote, [
    modelEvent({ date: "2026-10-20", name: "教研会", start: "09:00", end: "10:00", location: "东楼 203", quote: revisedQuote, notes: "地点已确认" }),
  ]);
  const beforeRevision = documentSource;
  const revised = await importDocument(revision.descriptor, revision.result, beforeRevision);
  assert.equal(revised.committed, true);
  assert.equal(revised.removedEventIds.length, 0);
  read = await sourceProjection.readCoreCalendarSources();
  documentSource = read.sources.find((source) => source.sourceId === first.sourceId);
  assert.equal(documentSource.eventCount, 2, "an omitted document row must not withdraw an existing occurrence");
  assert.equal(documentSource.occurrences.find((item) => item.content.name === "家长会") !== undefined, true);
  assert.equal(documentSource.occurrences.find((item) => item.content.name === "教研会").content.notes, "地点已确认");

  await assert.rejects(importDocument(revision.descriptor, revision.result, beforeRevision),
    (error) => error?.code === "stale_calendar_source");

  const movedQuote = "通知：2026年10月21日 14:00-15:00（北京时间）在西楼 101 举行教研会。";
  const moved = await stageAndRecognize("校内安排-再次修订.docx", movedQuote, [
    modelEvent({ date: "2026-10-21", name: "教研会", start: "14:00", end: "15:00", location: "西楼 101", quote: movedQuote, notes: null }),
  ]);
  const held = await importDocument(moved.descriptor, moved.result, documentSource);
  assert.equal(held.committed, false);
  assert.equal(held.scheduleNeedsReview, true);
  read = await sourceProjection.readCoreCalendarSources();
  documentSource = read.sources.find((source) => source.sourceId === first.sourceId);
  assert.equal(documentSource.eventCount, 2, "a moved candidate is held instead of duplicated");
  assert.deepEqual(documentSource.occurrences.map((item) => item.eventId).sort(), originalIds);

  const crossSourceId = `calendar-source-${"9".repeat(32)}`;
  const crossRef = "ics-cross-format-school-meeting";
  const crossQuote = "通知：2026年10月25日 10:00-11:00（北京时间）在行政楼 301 举行跨格式校务会。";
  const crossEvent = {
    event_id: upload.stableOccurrenceCalendarEventId(crossSourceId, crossRef),
    date: "2026-10-25",
    end_date: null,
    name: "跨格式校务会",
    type: "meeting",
    confidence: "teacher_confirmed",
    notes: null,
    source_occurrence_ref: crossRef,
    time_interval: { start: "2026-10-25T10:00+08:00", end: "2026-10-25T11:00+08:00", time_zone: "Asia/Shanghai" },
    location: "行政楼 301",
  };
  await intake.issueEducationIntake({ command_type: "import_calendar", source: {
    source_id: crossSourceId,
    source_kind: "teacher_file",
    source_hash: `sha256:${"9".repeat(64)}`,
    evidence_ids: ["calendar-evidence-cross-format"],
  }, events: [crossEvent] });
  read = await sourceProjection.readCoreCalendarSources();
  const crossSource = read.sources.find((source) => source.sourceId === crossSourceId);
  const crossDocument = await stageAndRecognize("跨格式校务会.docx", crossQuote, [
    modelEvent({ date: "2026-10-25", name: "跨格式校务会", start: "10:00", end: "11:00", location: "行政楼 301", quote: crossQuote, notes: null }),
  ]);
  await assert.rejects(importDocument(crossDocument.descriptor, crossDocument.result),
    (error) => error?.code === "calendar_source_selection_required");
  const crossDedupe = await importDocument(crossDocument.descriptor, crossDocument.result, crossSource);
  assert.equal(crossDedupe.committed, true);
  read = await sourceProjection.readCoreCalendarSources();
  const crossAfter = read.sources.find((source) => source.sourceId === crossSourceId);
  assert.equal(crossAfter.eventCount, 1);
  assert.equal(crossAfter.occurrences[0].eventId, crossEvent.event_id);
  assert.equal(crossAfter.occurrences[0].content.confidence, "teacher_confirmed");
  assert.equal(read.snapshot.payload.education_workspace.calendar.every((event) => event.external_send === false), true);
  assert.equal(fs.existsSync(path.join(stateDir, "calendar-sources.json")), false);

  console.log(JSON.stringify({ status: "passed", source_id: first.sourceId, exact_replay: true, additive_omission: true,
    stale_cas_rejected: true, moved_candidate_held: true, cross_format_dedupe: true,
    current_occurrences: documentSource.eventCount, external_send: false }));
} finally {
  if (keepArtifacts) console.log(JSON.stringify({ status: "retained", temporary_root: temporaryRoot, data_root: dataRoot, state_dir: stateDir }));
  else fs.rmSync(temporaryRoot, { recursive: true, force: true });
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
