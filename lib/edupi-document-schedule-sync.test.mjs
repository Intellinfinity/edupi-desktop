import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const sync = await jiti.import("./edupi-document-schedule-sync.ts");
const sources = await jiti.import("./edupi-calendar-sources.ts");
const upload = await jiti.import("./edupi-schedule-upload.ts");

const descriptor = {
  staging_id: "stg_11111111111111111111111111111111",
  staging_path: "/tmp/material-staging/stg_11111111111111111111111111111111/material.pdf",
  original_name: "校内安排.pdf",
  expected_size_bytes: 1024,
  source_hash: `sha256:${"a".repeat(64)}`,
  kind: "pdf",
  source_scope: "desktop_staging",
};

function recognizedEvent(name = "教研会", date = "2026-10-20", start = "09:00", end = "10:00", location = "东楼 203") {
  return {
    event_id: `model-${date}-${start}`,
    date,
    end_date: null,
    name,
    type: "meeting",
    confidence: "inferred",
    notes: null,
    time_interval: { start: `${date}T${start}+08:00`, end: `${date}T${end}+08:00`, time_zone: "Asia/Shanghai" },
    location,
  };
}

function coreSource(sourceId, events) {
  return sources.projectCoreCalendarSources(events.map((event) => ({
    ...event,
    event_id: upload.stableOccurrenceCalendarEventId(sourceId, event.source_occurrence_ref),
    date_status: "explicit",
    state: "pending_review",
    preparation_status: "hold",
    source_ids: [sourceId],
    evidence_ids: ["schedule-evidence-old"],
    external_send: false,
  })))[0];
}

function sourceRead(projected = []) {
  return {
    sources: projected,
    snapshot: {
      payload: { snapshot_id: "snapshot-1", education_workspace: {} },
      roots: { runtime: {}, dataRoot: {} },
    },
  };
}

function acceptedIssue(commands, calendarStatus = "accepted") {
  return async (command) => {
    commands.push(command);
    return { receipt: { status: command.command_type === "import_calendar" ? calendarStatus : "accepted", rejected_ids: [] }, data: null };
  };
}

test("binds a new PDF schedule to deterministic document source and occurrence identities", async () => {
  const commands = [];
  const event = recognizedEvent();
  const result = await sync.syncDocumentScheduleFile({
    descriptor,
    title: "校内安排",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: null,
    expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead(),
    issue: acceptedIssue(commands),
  });
  const sourceId = upload.stableDocumentScheduleSourceId(descriptor.source_hash);
  const occurrenceRef = upload.stableDocumentOccurrenceRef(event);
  const imported = commands.find((command) => command.command_type === "import_calendar");
  assert.equal(result.sourceId, sourceId);
  assert.equal(result.committed, true);
  assert.equal(imported.source.source_id, sourceId);
  assert.equal(imported.events[0].source_occurrence_ref, occurrenceRef);
  assert.equal(imported.events[0].event_id, upload.stableOccurrenceCalendarEventId(sourceId, occurrenceRef));
  assert.equal(imported.events[0].confidence, "inferred");
});

test("keeps a selected document occurrence identity stable while Core holds a moved candidate", async () => {
  const sourceId = "document-source-00000000000000000000000000000001";
  const original = recognizedEvent();
  const occurrenceRef = upload.stableDocumentOccurrenceRef(original);
  const current = coreSource(sourceId, [{ ...original, source_occurrence_ref: occurrenceRef }]);
  const commands = [];
  const moved = recognizedEvent("教研会", "2026-10-21", "14:00", "15:00", "西楼 101");
  const result = await sync.syncDocumentScheduleFile({
    descriptor: { ...descriptor, source_hash: `sha256:${"b".repeat(64)}` },
    title: "校内安排修订",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: sourceId,
    expectedSourceFingerprint: current.fingerprint,
  }, {
    recognize: async () => ({ events: [moved], slots: [] }),
    readSources: async () => sourceRead([current]),
    issue: acceptedIssue(commands, "held"),
  });
  const imported = commands.find((command) => command.command_type === "import_calendar");
  assert.equal(result.committed, false);
  assert.equal(result.scheduleNeedsReview, true);
  assert.equal(imported.events[0].source_occurrence_ref, occurrenceRef);
  assert.equal(imported.events[0].event_id, upload.stableOccurrenceCalendarEventId(sourceId, occurrenceRef));
});

test("document revisions are additive and never withdraw omitted Core occurrences", async () => {
  const sourceId = "document-source-00000000000000000000000000000002";
  const kept = recognizedEvent("教研会", "2026-10-20");
  const omitted = recognizedEvent("家长会", "2026-10-22", "18:00", "19:00", "报告厅");
  const current = coreSource(sourceId, [kept, omitted].map((event) => ({
    ...event,
    source_occurrence_ref: upload.stableDocumentOccurrenceRef(event),
  })));
  const commands = [];
  const result = await sync.syncDocumentScheduleFile({
    descriptor: { ...descriptor, source_hash: `sha256:${"c".repeat(64)}` },
    title: "校内安排修订",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: sourceId,
    expectedSourceFingerprint: current.fingerprint,
  }, {
    recognize: async () => ({ events: [kept], slots: [] }),
    readSources: async () => sourceRead([current]),
    issue: acceptedIssue(commands),
  });
  const imported = commands.find((command) => command.command_type === "import_calendar");
  assert.equal(result.committed, true);
  assert.equal(imported.events.length, 1);
  assert.equal(result.removedEventIds.length, 0);
  assert.equal(current.occurrences.length, 2, "the source baseline is not rewritten on Desktop");
});

test("rejects a stale or wrong document source selection before Core writes", async () => {
  const firstId = "document-source-00000000000000000000000000000003";
  const secondId = "document-source-00000000000000000000000000000004";
  const event = recognizedEvent();
  const ref = upload.stableDocumentOccurrenceRef(event);
  const first = coreSource(firstId, [{ ...recognizedEvent("另一事项"), source_occurrence_ref: upload.stableDocumentOccurrenceRef(recognizedEvent("另一事项")) }]);
  const second = coreSource(secondId, [{ ...event, source_occurrence_ref: ref }]);
  const input = {
    descriptor: { ...descriptor, source_hash: `sha256:${"d".repeat(64)}` },
    title: "校内安排修订",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: firstId,
    expectedSourceFingerprint: first.fingerprint,
  };
  await assert.rejects(sync.syncDocumentScheduleFile(input, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead([first, second]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "calendar_source_selection_required");
  await assert.rejects(sync.syncDocumentScheduleFile({ ...input, requestedSourceId: secondId, expectedSourceFingerprint: first.fingerprint }, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead([first, second]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "stale_calendar_source");
});

test("requires explicit source selection for a changed revision and accepts an exact replay", async () => {
  const exactSourceId = upload.stableDocumentScheduleSourceId(descriptor.source_hash);
  const event = recognizedEvent();
  const ref = upload.stableDocumentOccurrenceRef(event);
  const exact = coreSource(exactSourceId, [{ ...event, source_occurrence_ref: ref }]);
  const exactCommands = [];
  const replay = await sync.syncDocumentScheduleFile({
    descriptor,
    title: "校内安排",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: null,
    expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead([exact]),
    issue: acceptedIssue(exactCommands),
  });
  assert.equal(replay.sourceId, exactSourceId);
  assert.equal(replay.committed, true);

  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor: { ...descriptor, source_hash: `sha256:${"e".repeat(64)}` },
    title: "校内安排修订",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: null,
    expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead([exact]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "calendar_source_selection_required");
});

test("deduplicates a PDF event against an explicitly selected ICS occurrence", async () => {
  const calendarSourceId = "calendar-source-00000000000000000000000000000005";
  const event = recognizedEvent();
  const calendar = coreSource(calendarSourceId, [{ ...event, confidence: "teacher_confirmed", source_occurrence_ref: "ics-uid-teacher-meeting" }]);
  const input = {
    descriptor: { ...descriptor, source_hash: `sha256:${"f".repeat(64)}` },
    title: "校内安排 PDF",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: null,
    expectedSourceFingerprint: null,
  };
  await assert.rejects(sync.syncDocumentScheduleFile(input, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead([calendar]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "calendar_source_selection_required");

  const commands = [];
  const result = await sync.syncDocumentScheduleFile({
    ...input,
    requestedSourceId: calendarSourceId,
    expectedSourceFingerprint: calendar.fingerprint,
  }, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead([calendar]),
    issue: acceptedIssue(commands),
  });
  const imported = commands.find((command) => command.command_type === "import_calendar");
  assert.equal(result.committed, true);
  assert.equal(imported.source.source_id, calendarSourceId);
  assert.equal(imported.events[0].source_occurrence_ref, "ics-uid-teacher-meeting");
  assert.equal(imported.events[0].confidence, "teacher_confirmed", "document evidence must not downgrade an ICS fact");
  assert.equal(imported.events[0].event_id,
    upload.stableOccurrenceCalendarEventId(calendarSourceId, "ics-uid-teacher-meeting"));

  const changed = recognizedEvent("教研会", "2026-10-20", "09:00", "10:00", "西楼 101");
  await assert.rejects(sync.syncDocumentScheduleFile({
    ...input,
    requestedSourceId: calendarSourceId,
    expectedSourceFingerprint: calendar.fingerprint,
  }, {
    recognize: async () => ({ events: [changed], slots: [] }),
    readSources: async () => sourceRead([calendar]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "ambiguous_schedule");
});

test("an accepted document occurrence cannot be downgraded by a later inferred model run", async () => {
  const sourceId = "document-source-00000000000000000000000000000006";
  const event = recognizedEvent();
  const ref = upload.stableDocumentOccurrenceRef(event);
  const accepted = coreSource(sourceId, [{ ...event, confidence: "teacher_confirmed", source_occurrence_ref: ref }]);
  const commands = [];
  const result = await sync.syncDocumentScheduleFile({
    descriptor: { ...descriptor, source_hash: `sha256:${"6".repeat(64)}` },
    title: "已确认安排的副本",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: sourceId,
    expectedSourceFingerprint: accepted.fingerprint,
  }, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead([accepted]),
    issue: acceptedIssue(commands),
  });
  assert.equal(result.committed, true);
  assert.equal(commands.find((command) => command.command_type === "import_calendar").events[0].confidence, "teacher_confirmed");

  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor: { ...descriptor, source_hash: `sha256:${"7".repeat(64)}` },
    title: "有差异的安排",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: sourceId,
    expectedSourceFingerprint: accepted.fingerprint,
  }, {
    recognize: async () => ({ events: [{ ...event, notes: "模型新增说明" }], slots: [] }),
    readSources: async () => sourceRead([accepted]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "ambiguous_schedule");
});

test("fails closed when one document contains ambiguous same-name same-type occurrences", async () => {
  const first = recognizedEvent("教研会", "2026-10-20");
  const second = recognizedEvent("教研会", "2026-10-21", "14:00", "15:00");
  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor,
    title: "校内安排",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: null,
    expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [first, second], slots: [] }),
    readSources: async () => sourceRead(),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "ambiguous_schedule");
});
