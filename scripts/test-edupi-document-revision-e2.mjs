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
  const materialFlow = await jiti.import("../lib/edupi-material-intake-flow.ts");
  const upload = await jiti.import("../lib/edupi-schedule-upload.ts");
  const entityDelete = await jiti.import("../lib/edupi-entity-delete.ts");
  const intakeRoute = await jiti.import("../app/api/edupi/intake/route.ts");

  async function stageAndRecognize(name, text, events, exactBytes = null, cache = false) {
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
    if (cache) recognition.saveRecognitionCache(descriptor, result, { modelOutput: output, sourceText: text });
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

  const legacyQuote = "通知：2026年10月18日 15:00-16:00（北京时间）在旧行政楼举行旧版升级会议。";
  const legacyDocument = await stageAndRecognize("旧版升级安排.docx", legacyQuote, [
    modelEvent({ date: "2026-10-18", name: "旧版升级会议", start: "15:00", end: "16:00", location: "旧行政楼", quote: legacyQuote, notes: null }),
  ]);
  const legacyResult = await materialFlow.intakeRecognizedMaterial({
    descriptor: legacyDocument.descriptor,
    materialKind: "other",
    subject: "行政",
    classId: "全校",
  }, { recognize: async () => legacyDocument.result });
  assert.equal(legacyResult.scheduleNeedsReview, false);
  let read = await sourceProjection.readCoreCalendarSources();
  const legacyBefore = read.snapshot.occurrenceEvents.filter((event) => event.name === "旧版升级会议");
  assert.equal(legacyBefore.length, 1);
  assert.equal(Object.hasOwn(legacyBefore[0], "source_occurrence_ref"), false);
  const legacyAdoption = await importDocument(legacyDocument.descriptor, legacyDocument.result);
  assert.equal(legacyAdoption.committed, false);
  assert.equal(legacyAdoption.scheduleNeedsReview, true);
  read = await sourceProjection.readCoreCalendarSources();
  const legacyAfter = read.snapshot.occurrenceEvents.filter((event) => event.name === "旧版升级会议");
  assert.equal(legacyAfter.length, 1, "pre-upgrade document replay must hold one adoption conflict instead of duplicating the row");
  assert.equal(legacyAfter[0].event_id, legacyBefore[0].event_id);
  assert.equal(legacyAfter[0].state, "held");

  const earlyQuote = "通知：2026年10月16日 08:00-09:00（北京时间）在旧教学楼举行早期公开版会议。";
  const earlyDocument = await stageAndRecognize("早期公开版安排.docx", earlyQuote, [
    modelEvent({ date: "2026-10-16", name: "早期公开版会议", start: "08:00", end: "09:00", location: "旧教学楼", quote: earlyQuote, notes: null }),
  ]);
  await materialFlow.intakeRecognizedMaterial({
    descriptor: earlyDocument.descriptor,
    scheduleSourceId: upload.stableFileScheduleIssuer(earlyDocument.descriptor.original_name),
    materialKind: "other",
    subject: "行政",
    classId: "全校",
  }, { recognize: async () => earlyDocument.result });
  const earlyRenamed = await stageAndRecognize("改名后的早期公开版安排.docx", earlyQuote,
    [modelEvent({ date: "2026-10-16", name: "早期公开版会议", start: "08:00", end: "09:00", location: "旧教学楼", quote: earlyQuote, notes: null })],
    earlyDocument.bytes);
  const earlyAdoption = await importDocument(earlyRenamed.descriptor, earlyRenamed.result);
  assert.equal(earlyAdoption.committed, false);
  assert.equal(earlyAdoption.scheduleNeedsReview, true);
  read = await sourceProjection.readCoreCalendarSources();
  assert.equal(read.snapshot.occurrenceEvents.filter((event) => event.name === "早期公开版会议").length, 1);

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
  read = await sourceProjection.readCoreCalendarSources();
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

  async function postDocument(descriptor, source = null) {
    const response = await intakeRoute.POST(new Request("http://localhost/api/edupi/intake", {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "material",
        stagingId: descriptor.staging_id,
        title: descriptor.original_name,
        materialKind: "other",
        subject: "行政",
        classId: "全校",
        recognize: true,
        calendarSourceId: null,
        calendarSourceFingerprint: null,
        documentSourceId: source?.sourceId ?? null,
        documentSourceFingerprint: source?.fingerprint ?? null,
      }),
    }));
    return { response, body: await response.json() };
  }

  const routeQuote = "通知：2026年10月28日 13:00-14:00（北京时间）在一号会议室举行路由合同会议。";
  const routeDocument = await stageAndRecognize("路由合同会议.docx", routeQuote, [
    modelEvent({ date: "2026-10-28", name: "路由合同会议", start: "13:00", end: "14:00", location: "一号会议室", quote: routeQuote, notes: null }),
  ], null, true);
  const routeFirst = await postDocument(routeDocument.descriptor);
  assert.equal(routeFirst.response.status, 200, JSON.stringify(routeFirst.body));
  assert.equal(routeFirst.body.documentCommitted, true);
  assert.match(routeFirst.body.documentSourceId, /^document-source-[a-f0-9]{32}$/u);
  assert.equal(routeFirst.body.staged.some((item) => item.staging_id === routeDocument.descriptor.staging_id), false);
  read = await sourceProjection.readCoreCalendarSources();
  const routeSource = read.sources.find((source) => source.sourceId === routeFirst.body.documentSourceId);
  const routeRevisionQuote = "通知：2026年10月28日 13:00-14:00（北京时间）在一号会议室举行路由合同会议，议程已确认。";
  const routeRevision = await stageAndRecognize("路由合同会议-修订.docx", routeRevisionQuote, [
    modelEvent({ date: "2026-10-28", name: "路由合同会议", start: "13:00", end: "14:00", location: "一号会议室", quote: routeRevisionQuote, notes: "议程已确认" }),
  ], null, true);
  const routeUpdated = await postDocument(routeRevision.descriptor, routeSource);
  assert.equal(routeUpdated.response.status, 200, JSON.stringify(routeUpdated.body));
  assert.equal(routeUpdated.body.documentCommitted, true);
  assert.equal(routeUpdated.body.documentSourceId, routeSource.sourceId);

  const deletionQuote = "通知：2026年10月30日 16:00-17:00（北京时间）在二号会议室举行删除传播会议。";
  const deletionKeepQuote = "通知：2026年10月31日 09:00-10:00（北京时间）在三号会议室举行保留会议。";
  const deletionText = `${deletionQuote}\n${deletionKeepQuote}`;
  const deletionEvents = [
    modelEvent({ date: "2026-10-30", name: "删除传播会议", start: "16:00", end: "17:00", location: "二号会议室", quote: deletionQuote, notes: null }),
    modelEvent({ date: "2026-10-31", name: "保留会议", start: "09:00", end: "10:00", location: "三号会议室", quote: deletionKeepQuote, notes: null }),
  ];
  const deletionDocument = await stageAndRecognize("删除传播会议.docx", deletionText, deletionEvents);
  const deletionImport = await importDocument(deletionDocument.descriptor, deletionDocument.result);
  assert.equal(deletionImport.committed, true);
  read = await sourceProjection.readCoreCalendarSources();
  const deletionSource = read.sources.find((source) => source.sourceId === deletionImport.sourceId);
  const deletionEventId = deletionSource.occurrences.find((occurrence) => occurrence.content.name === "删除传播会议").eventId;
  await entityDelete.issueEntityDelete({ kind: "calendar", id: deletionEventId, note: "教师删除测试" });
  read = await sourceProjection.readCoreCalendarSources();
  const deletionRemainingSource = read.sources.find((source) => source.sourceId === deletionImport.sourceId);
  assert.equal(deletionRemainingSource.eventCount, 1);
  const deletionRevisionText = `${deletionText}\n修订文件字节变化，但事项语义不变。`;
  const deletionRevision = await stageAndRecognize("删除传播会议-修订.docx", deletionRevisionText, deletionEvents);
  assert.notEqual(deletionRevision.descriptor.source_hash, deletionDocument.descriptor.source_hash);
  await assert.rejects(importDocument(deletionRevision.descriptor, deletionRevision.result, deletionRemainingSource),
    (error) => error?.code === "ambiguous_schedule");
  const deletionLedger = await entityDelete.readEntityDeletionLedger();
  const deletionRecord = deletionLedger.deletions.find((record) => record.kind === "calendar" && record.id === deletionEventId);
  assert.ok(deletionRecord);
  await entityDelete.issueEntityRestore({ kind: "calendar", id: deletionEventId, note: "教师明确恢复测试",
    restoreRequestId: entityDelete.entityRestoreRequestId(deletionRecord) });
  read = await sourceProjection.readCoreCalendarSources();
  const restoredSource = read.sources.find((source) => source.sourceId === deletionImport.sourceId);
  const afterRestore = await importDocument(deletionRevision.descriptor, deletionRevision.result, restoredSource);
  assert.equal(afterRestore.committed, true);
  read = await sourceProjection.readCoreCalendarSources();
  assert.equal(read.snapshot.occurrenceEvents.filter((event) => event.name === "删除传播会议").length, 1);
  assert.equal(read.snapshot.payload.education_workspace.calendar.every((event) => event.external_send === false), true);
  assert.equal(fs.existsSync(path.join(stateDir, "calendar-sources.json")), false);

  console.log(JSON.stringify({ status: "passed", source_id: first.sourceId, exact_replay: true, additive_omission: true,
    stale_cas_rejected: true, moved_candidate_held: true, cross_format_dedupe: true, legacy_adoption_held: true,
    filename_issuer_adoption: true,
    route_post: true, route_source_update: true,
    deletion_reupload_blocked: true, explicit_restore: true,
    current_occurrences: documentSource.eventCount, external_send: false }));
} finally {
  if (keepArtifacts) console.log(JSON.stringify({ status: "retained", temporary_root: temporaryRoot, data_root: dataRoot, state_dir: stateDir }));
  else fs.rmSync(temporaryRoot, { recursive: true, force: true });
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
