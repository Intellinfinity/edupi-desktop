import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const syncModule = await jiti.import("./edupi-document-schedule-sync.ts");
const sources = await jiti.import("./edupi-calendar-sources.ts");
const upload = await jiti.import("./edupi-schedule-upload.ts");

const sync = {
  ...syncModule,
  syncDocumentScheduleFile(input, dependencies = {}) {
    return syncModule.syncDocumentScheduleFile(input, {
      readDeletions: async (source) => ({ snapshotId: String(source.snapshot.payload.snapshot_id), deletions: [], history: [], historyTruncated: false }),
      ...dependencies,
    });
  },
};

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
    evidence_ids: event.evidence_ids || ["schedule-evidence-old"],
    external_send: false,
  })))[0];
}

function sourceRead(projected = [], occurrenceEvents = [], activeSourceHashes = []) {
  return {
    sources: projected,
    snapshot: {
      payload: { snapshot_id: "snapshot-1", education_workspace: {}, review_targets: activeSourceHashes.map((sourceHash, index) => ({
        projection_kind: "material_intake", source_hash: sourceHash, status: "accepted", intake_state: "accepted",
        target: { target_kind: "material_intake", target_id: `material-target-${index}` },
      })) },
      roots: { runtime: {}, dataRoot: {} },
      occurrenceEvents,
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
    readSources: async () => sourceRead([exact], [], [descriptor.source_hash]),
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

test("replays an explicitly rebound byte revision from Core evidence without asking for the source again", async () => {
  const event = recognizedEvent("已绑定修订", "2026-10-23", "13:00", "14:00", "东楼 205");
  const omitted = recognizedEvent("来源内其他事项", "2026-10-24", "15:00", "16:00", "西楼 206");
  const sourceId = "document-source-00000000000000000000000000000010";
  const reboundDescriptor = { ...descriptor, original_name: "H2-改名.docx", source_hash: `sha256:${"b".repeat(64)}` };
  const evidenceId = `schedule-evidence-${"b".repeat(32)}`;
  const current = coreSource(sourceId, [
    { ...event, source_occurrence_ref: upload.stableDocumentOccurrenceRef(event), evidence_ids: [evidenceId] },
    { ...omitted, source_occurrence_ref: upload.stableDocumentOccurrenceRef(omitted), evidence_ids: ["schedule-evidence-old"] },
  ]);
  const commands = [];
  const replay = await sync.syncDocumentScheduleFile({
    descriptor: reboundDescriptor,
    title: "H2 exact replay",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: null,
    expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead([current], [], [reboundDescriptor.source_hash]),
    issue: acceptedIssue(commands),
  });
  assert.equal(replay.committed, true);
  assert.equal(replay.sourceId, sourceId);
  const imported = commands.find((command) => command.command_type === "import_calendar");
  assert.equal(imported.source.source_id, sourceId);
  assert.equal(imported.events[0].event_id, current.occurrences.find((occurrence) => occurrence.content.name === event.name).eventId);

  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor: reboundDescriptor,
    title: "H2 event with unproved slot",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: null,
    expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [event], slots: [{ slot_id: "model-slot", day_of_week: 1, period: 1,
      subject: "数学", class_name: "七年级一班", kind: "class", notes: null }] }),
    readSources: async () => sourceRead([current], [], [reboundDescriptor.source_hash]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "calendar_source_selection_required");

  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor: reboundDescriptor,
    title: "H2 drifted replay",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: null,
    expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [{ ...event, notes: "模型漂移" }], slots: [] }),
    readSources: async () => sourceRead([current], [], [reboundDescriptor.source_hash]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "calendar_source_selection_required");

  const secondSourceId = "calendar-source-00000000000000000000000000000011";
  const second = coreSource(secondSourceId, [{ ...event, source_occurrence_ref: "ics-alias-collision", evidence_ids: [evidenceId] }]);
  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor: reboundDescriptor,
    title: "H2 ambiguous alias",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: null,
    expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead([current, second], [], [reboundDescriptor.source_hash]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "calendar_source_selection_required");

  const confirmedCalendar = coreSource(secondSourceId, [{ ...event, confidence: "teacher_confirmed",
    source_occurrence_ref: "ics-alias-confirmed", evidence_ids: [evidenceId] }]);
  const calendarCommands = [];
  const calendarReplay = await sync.syncDocumentScheduleFile({
    descriptor: reboundDescriptor,
    title: "H2 explicit calendar replay",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: null,
    expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead([confirmedCalendar], [], [reboundDescriptor.source_hash]),
    issue: acceptedIssue(calendarCommands),
  });
  assert.equal(calendarReplay.sourceId, secondSourceId);
  assert.equal(calendarReplay.committed, true);
  assert.equal(calendarCommands.find((command) => command.command_type === "import_calendar").events[0].confidence,
    "teacher_confirmed");

  const directId = upload.stableDocumentScheduleSourceId(reboundDescriptor.source_hash);
  const direct = coreSource(directId, [{ ...event, source_occurrence_ref: upload.stableDocumentOccurrenceRef(event),
    evidence_ids: ["schedule-evidence-newer"] }]);
  const foreignAlias = coreSource("document-source-00000000000000000000000000000012", [{ ...omitted,
    source_occurrence_ref: upload.stableDocumentOccurrenceRef(omitted), evidence_ids: [evidenceId] }]);
  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor: reboundDescriptor,
    title: "H2 direct and alias disagree",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: null,
    expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead([direct, foreignAlias], [], [reboundDescriptor.source_hash]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "calendar_source_selection_required");

  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor: reboundDescriptor,
    title: "H2 deleted material evidence",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: null,
    expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead([current]),
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

test("adopts an exact pre-upgrade document row through one held Core conflict without creating a second event id", async () => {
  const event = recognizedEvent();
  const legacyIssuer = upload.stableFileScheduleIssuer(descriptor.original_name, descriptor.source_hash);
  const legacyId = upload.stableRecognizedCalendarEventId({
    date: event.date,
    endDate: event.end_date,
    name: event.name,
    type: event.type,
    notes: event.notes,
    timeInterval: event.time_interval,
    location: event.location,
  });
  const legacy = {
    ...event,
    confidence: "teacher_confirmed",
    event_id: legacyId,
    source_ids: [legacyIssuer],
    evidence_ids: ["schedule-evidence-legacy"],
    state: "pending_review",
    preparation_status: "hold",
    external_send: false,
  };
  const commands = [];
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
    readSources: async () => sourceRead([], [legacy]),
    issue: acceptedIssue(commands, "held"),
  });
  const imported = commands.find((command) => command.command_type === "import_calendar");
  assert.equal(result.committed, false);
  assert.equal(result.scheduleNeedsReview, true);
  assert.equal(imported.events[0].event_id, legacyId);
  assert.equal(imported.events[0].source_occurrence_ref, upload.stableDocumentOccurrenceRef(event));
  assert.equal(imported.events[0].confidence, "teacher_confirmed");

  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor, title: "教师已确认事项的差异重跑", materialKind: "other", subject: "行政", classId: "全校",
    requestedSourceId: null, expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [{ ...event, notes: "模型改写" }], slots: [] }),
    readSources: async () => sourceRead([], [legacy]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "ambiguous_schedule");

  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor, title: "多旧来源事项", materialKind: "other", subject: "行政", classId: "全校",
    requestedSourceId: null, expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead([], [{ ...legacy, source_ids: [legacyIssuer,
      upload.stableFileScheduleIssuer("另一份旧材料.docx", `sha256:${"7".repeat(64)}`)] }]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "ambiguous_schedule");

  const omittedLegacyEvent = recognizedEvent("旧版遗漏事项", "2026-10-19", "10:00", "11:00", "旧行政楼 2");
  const omittedLegacy = {
    ...omittedLegacyEvent,
    event_id: upload.stableRecognizedCalendarEventId({ date: omittedLegacyEvent.date, endDate: omittedLegacyEvent.end_date,
      name: omittedLegacyEvent.name, type: omittedLegacyEvent.type, notes: omittedLegacyEvent.notes,
      timeInterval: omittedLegacyEvent.time_interval, location: omittedLegacyEvent.location }),
    source_ids: [legacyIssuer], evidence_ids: ["schedule-evidence-legacy"], state: "pending_review",
    preparation_status: "hold", external_send: false,
  };
  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor, title: "首次接管漏项", materialKind: "other", subject: "行政", classId: "全校",
    requestedSourceId: null, expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead([], [legacy, omittedLegacy]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "ambiguous_schedule");

  const foreignLegacy = { ...legacy, source_ids: [upload.stableFileScheduleIssuer("旧安排.docx", `sha256:${"8".repeat(64)}`)] };
  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor: { ...descriptor, source_hash: `sha256:${"9".repeat(64)}` },
    title: "无法证明关联的修订",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: null,
    expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead([], [foreignLegacy]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "calendar_source_selection_required");

  const typedUpgrade = recognizedEvent("旧版未结构化会议", "2026-10-18", "09:00", "10:00", "东楼 203");
  const untypedShape = { ...typedUpgrade };
  delete untypedShape.time_interval;
  delete untypedShape.location;
  const untypedLegacy = {
    ...untypedShape,
    event_id: "legacy-untyped-event",
    confidence: "inferred",
    notes: "2026年10月18日 09:00-10:00 北京时间在东楼 203 举行旧版未结构化会议",
    source_ids: [legacyIssuer],
    evidence_ids: [`schedule-evidence-${descriptor.source_hash.slice("sha256:".length, "sha256:".length + 32)}`],
    state: "pending_review",
    preparation_status: "hold",
    external_send: false,
  };
  const typedUpgradeCommands = [];
  const typedUpgradeResult = await sync.syncDocumentScheduleFile({
    descriptor, title: "旧版 typed 升级", materialKind: "other", subject: "行政", classId: "全校",
    requestedSourceId: null, expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [typedUpgrade], slots: [] }),
    readSources: async () => sourceRead([], [untypedLegacy]),
    issue: acceptedIssue(typedUpgradeCommands, "held"),
  });
  assert.equal(typedUpgradeResult.committed, false);
  assert.equal(typedUpgradeResult.scheduleNeedsReview, true);
  assert.equal(typedUpgradeCommands.find((command) => command.command_type === "import_calendar").events[0].event_id,
    untypedLegacy.event_id, "same-byte typed upgrade must retain the inferred legacy canonical event id");
});

test("a modern requested or derived source takes precedence over unrelated legacy rows", async () => {
  const event = recognizedEvent();
  const ref = upload.stableDocumentOccurrenceRef(event);
  const foreignLegacy = {
    ...event,
    event_id: upload.stableRecognizedCalendarEventId({ date: event.date, endDate: event.end_date, name: event.name, type: event.type,
      notes: event.notes, timeInterval: event.time_interval, location: event.location }),
    source_ids: [upload.stableFileScheduleIssuer("别的旧材料.docx", `sha256:${"8".repeat(64)}`)],
    evidence_ids: ["schedule-evidence-foreign"],
    state: "pending_review",
    preparation_status: "hold",
    external_send: false,
  };
  const requestedId = "document-source-00000000000000000000000000000008";
  const requested = coreSource(requestedId, [{ ...event, source_occurrence_ref: ref }]);
  const requestedCommands = [];
  const requestedResult = await sync.syncDocumentScheduleFile({
    descriptor: { ...descriptor, source_hash: `sha256:${"1".repeat(64)}` }, title: "现代来源", materialKind: "other",
    subject: "行政", classId: "全校", requestedSourceId: requestedId, expectedSourceFingerprint: requested.fingerprint,
  }, {
    recognize: async () => ({ events: [event], slots: [] }), readSources: async () => sourceRead([requested], [foreignLegacy]),
    issue: acceptedIssue(requestedCommands),
  });
  assert.equal(requestedResult.committed, true);
  assert.equal(requestedCommands.find((command) => command.command_type === "import_calendar").events[0].event_id,
    requested.occurrences[0].eventId);

  const derivedId = upload.stableDocumentScheduleSourceId(descriptor.source_hash);
  const derived = coreSource(derivedId, [{ ...event, source_occurrence_ref: ref }]);
  const derivedCommands = [];
  const derivedResult = await sync.syncDocumentScheduleFile({
    descriptor, title: "现代来源重放", materialKind: "other", subject: "行政", classId: "全校",
    requestedSourceId: null, expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [event], slots: [] }), readSources: async () => sourceRead([derived], [foreignLegacy], [descriptor.source_hash]),
    issue: acceptedIssue(derivedCommands),
  });
  assert.equal(derivedResult.committed, true);
  assert.equal(derivedCommands.find((command) => command.command_type === "import_calendar").events[0].event_id,
    derived.occurrences[0].eventId);
});

test("adopts pre-content-hash filename issuers only when Core evidence proves the same bytes", async () => {
  const event = recognizedEvent("早期旧版事项", "2026-10-17", "08:00", "09:00", "旧教学楼");
  const originalName = "早期安排.docx";
  const exactDescriptor = { ...descriptor, original_name: originalName };
  const filenameIssuer = upload.stableFileScheduleIssuer(originalName);
  const evidenceId = `schedule-evidence-${exactDescriptor.source_hash.slice("sha256:".length, "sha256:".length + 32)}`;
  const legacyId = upload.stableRecognizedCalendarEventId({ date: event.date, endDate: event.end_date, name: event.name,
    type: event.type, notes: event.notes, timeInterval: event.time_interval, location: event.location });
  const legacy = { ...event, event_id: legacyId, source_ids: [filenameIssuer], evidence_ids: [evidenceId],
    state: "pending_review", preparation_status: "hold", external_send: false };

  for (const nextDescriptor of [exactDescriptor, { ...exactDescriptor, original_name: "改名后的早期安排.docx" }]) {
    const commands = [];
    const result = await sync.syncDocumentScheduleFile({
      descriptor: nextDescriptor, title: nextDescriptor.original_name, materialKind: "other", subject: "行政", classId: "全校",
      requestedSourceId: null, expectedSourceFingerprint: null,
    }, {
      recognize: async () => ({ events: [event], slots: [] }), readSources: async () => sourceRead([], [legacy]),
      issue: acceptedIssue(commands, "held"),
    });
    assert.equal(result.committed, false);
    assert.equal(commands.find((command) => command.command_type === "import_calendar").events[0].event_id, legacyId);
  }

  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor: { ...exactDescriptor, source_hash: `sha256:${"b".repeat(64)}` }, title: originalName,
    materialKind: "other", subject: "行政", classId: "全校", requestedSourceId: null, expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [event], slots: [] }), readSources: async () => sourceRead([], [legacy]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "calendar_source_selection_required");
  const foreignMoved = recognizedEvent(event.name, "2026-10-19", "11:00", "12:00", "新行政楼");
  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor: { ...descriptor, source_hash: `sha256:${"9".repeat(64)}` },
    title: "其他旧来源同名改期",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: null,
    expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [foreignMoved], slots: [] }),
    readSources: async () => sourceRead([], [legacy]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "calendar_source_selection_required",
  "a foreign legacy row with the same anchor must block a moved variant from becoming a duplicate source");
});

test("a partially adopted derived source keeps unresolved legacy canonical ids", async () => {
  const adopted = recognizedEvent("已接管事项", "2026-10-20", "09:00", "10:00", "东楼 203");
  const unresolved = recognizedEvent("待接管事项", "2026-10-21", "10:00", "11:00", "东楼 204");
  const sourceId = upload.stableDocumentScheduleSourceId(descriptor.source_hash);
  const derived = coreSource(sourceId, [{ ...adopted, source_occurrence_ref: upload.stableDocumentOccurrenceRef(adopted) }]);
  const legacyIssuer = upload.stableFileScheduleIssuer(descriptor.original_name, descriptor.source_hash);
  const legacyId = upload.stableRecognizedCalendarEventId({ date: unresolved.date, endDate: unresolved.end_date,
    name: unresolved.name, type: unresolved.type, notes: unresolved.notes,
    timeInterval: unresolved.time_interval, location: unresolved.location });
  const legacy = { ...unresolved, event_id: legacyId, source_ids: [legacyIssuer], evidence_ids: ["schedule-evidence-legacy"],
    state: "held", preparation_status: "hold", external_send: false };
  const commands = [];
  const result = await sync.syncDocumentScheduleFile({
    descriptor, title: "部分接管重放", materialKind: "other", subject: "行政", classId: "全校",
    requestedSourceId: sourceId, expectedSourceFingerprint: derived.fingerprint,
  }, {
    recognize: async () => ({ events: [adopted, unresolved], slots: [] }),
    readSources: async () => sourceRead([derived], [legacy]),
    issue: acceptedIssue(commands, "held"),
  });
  assert.equal(result.committed, false);
  const imported = commands.find((command) => command.command_type === "import_calendar");
  assert.equal(imported.events.find((event) => event.name === adopted.name).event_id, derived.occurrences[0].eventId);
  assert.equal(imported.events.find((event) => event.name === unresolved.name).event_id, legacyId);

  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor, title: "部分接管再次漏项", materialKind: "other", subject: "行政", classId: "全校",
    requestedSourceId: sourceId, expectedSourceFingerprint: derived.fingerprint,
  }, {
    recognize: async () => ({ events: [adopted], slots: [] }),
    readSources: async () => sourceRead([derived], [legacy]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "ambiguous_schedule");

  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor: { ...descriptor, source_hash: `sha256:${"2".repeat(64)}` }, title: "跨字节部分接管",
    materialKind: "other", subject: "行政", classId: "全校",
    requestedSourceId: sourceId, expectedSourceFingerprint: derived.fingerprint,
  }, {
    recognize: async () => ({ events: [adopted, unresolved], slots: [] }),
    readSources: async () => sourceRead([derived], [legacy]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "calendar_source_selection_required");
});

test("an active calendar tombstone blocks a byte-different document reupload until restore", async () => {
  const event = recognizedEvent();
  const ref = upload.stableDocumentOccurrenceRef(event);
  const deletedSourceId = "document-source-00000000000000000000000000000009";
  const deletedEventId = upload.stableOccurrenceCalendarEventId(deletedSourceId, ref);
  const changedDescriptor = { ...descriptor, source_hash: `sha256:${"9".repeat(64)}` };
  const input = {
    descriptor: changedDescriptor, title: "删除后的字节修订", materialKind: "other", subject: "行政", classId: "全校",
    requestedSourceId: null, expectedSourceFingerprint: null,
  };
  await assert.rejects(sync.syncDocumentScheduleFile(input, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead(),
    readDeletions: async () => ({ snapshotId: "snapshot-1", historyTruncated: false, history: [], deletions: [{
      kind: "calendar", id: deletedEventId, label: event.name, targetFingerprint: `sha256:${"d".repeat(64)}`,
      tombstoneRevision: 1, deletedAt: "2026-09-23T10:00:00.000Z", reviewer: "teacher", note: null,
      studentId: null, reviewTargetId: null,
    }] }),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "ambiguous_schedule");

  await assert.rejects(sync.syncDocumentScheduleFile(input, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead(),
    readDeletions: async () => ({ snapshotId: "snapshot-1", historyTruncated: false, history: [], deletions: [{
      kind: "calendar", id: "legacy-unlabelled-tombstone", label: null, targetFingerprint: `sha256:${"f".repeat(64)}`,
      tombstoneRevision: 3, deletedAt: "2026-09-23T12:00:00.000Z", reviewer: "teacher", note: null,
      studentId: null, reviewTargetId: null,
    }] }),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "ambiguous_schedule");

  const commands = [];
  const restored = await sync.syncDocumentScheduleFile(input, {
    recognize: async () => ({ events: [event], slots: [] }),
    readSources: async () => sourceRead(),
    readDeletions: async () => ({ snapshotId: "snapshot-1", historyTruncated: false, history: [], deletions: [] }),
    issue: acceptedIssue(commands),
  });
  assert.equal(restored.committed, true);
  assert.equal(commands.some((command) => command.command_type === "import_calendar"), true);

  const remaining = recognizedEvent("仍保留的会议", "2026-10-21", "11:00", "12:00", "东楼 204");
  const visibleSourceId = upload.stableDocumentScheduleSourceId(changedDescriptor.source_hash);
  const visibleSource = coreSource(visibleSourceId, [{ ...remaining, source_occurrence_ref: upload.stableDocumentOccurrenceRef(remaining) }]);
  await assert.rejects(sync.syncDocumentScheduleFile(input, {
    recognize: async () => ({ events: [event, remaining], slots: [] }),
    readSources: async () => sourceRead([visibleSource], [], [changedDescriptor.source_hash]),
    readDeletions: async () => ({ snapshotId: "snapshot-1", historyTruncated: false, history: [], deletions: [{
      kind: "calendar", id: "legacy-canonical-deleted-id", label: event.name, targetFingerprint: `sha256:${"e".repeat(64)}`,
      tombstoneRevision: 2, deletedAt: "2026-09-23T11:00:00.000Z", reviewer: "teacher", note: null,
      studentId: null, reviewTargetId: null,
    }] }),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "ambiguous_schedule");

  const repeatedNameRemaining = recognizedEvent("同名安全会", "2026-10-25", "09:00", "10:00", "东楼 205");
  const repeatedNameDeleted = recognizedEvent("同名安全会", "2026-10-26", "14:00", "15:00", "西楼 105");
  const repeatedNameSourceId = "document-source-00000000000000000000000000000014";
  const repeatedNameSource = coreSource(repeatedNameSourceId, [{ ...repeatedNameRemaining,
    source_occurrence_ref: upload.stableDocumentOccurrenceVariantRef(repeatedNameRemaining) }]);
  const movedSurvivor = recognizedEvent("同名安全会", "2026-10-27", "10:00", "11:00", "东楼 206");
  const movedSurvivorCommands = [];
  const movedSurvivorResult = await sync.syncDocumentScheduleFile({
    descriptor: changedDescriptor, title: "同名保留事项改期", materialKind: "other", subject: "行政", classId: "全校",
    requestedSourceId: repeatedNameSourceId, expectedSourceFingerprint: repeatedNameSource.fingerprint,
  }, {
    recognize: async () => ({ events: [movedSurvivor], slots: [] }),
    readSources: async () => sourceRead([repeatedNameSource]),
    readDeletions: async () => ({ snapshotId: "snapshot-1", historyTruncated: false, history: [], deletions: [{
      kind: "calendar", id: "deleted-same-name-occurrence", label: repeatedNameDeleted.name,
      targetFingerprint: `sha256:${"a".repeat(64)}`, tombstoneRevision: 4,
      deletedAt: "2026-09-23T13:00:00.000Z", reviewer: "teacher", note: null, studentId: null, reviewTargetId: null,
    }] }),
    issue: acceptedIssue(movedSurvivorCommands, "held"),
  });
  assert.equal(movedSurvivorResult.committed, false);
  const movedSurvivorImport = movedSurvivorCommands.find((command) => command.command_type === "import_calendar");
  assert.equal(movedSurvivorImport.events[0].event_id, repeatedNameSource.occurrences[0].eventId);
  assert.equal(movedSurvivorImport.events[0].source_occurrence_ref, repeatedNameSource.occurrences[0].sourceOccurrenceRef,
    "a tombstoned same-name sibling must not block the active occurrence from entering Core review");
  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor: changedDescriptor, title: "同名删除事项重传", materialKind: "other", subject: "行政", classId: "全校",
    requestedSourceId: repeatedNameSourceId, expectedSourceFingerprint: repeatedNameSource.fingerprint,
  }, {
    recognize: async () => ({ events: [repeatedNameRemaining, repeatedNameDeleted], slots: [] }),
    readSources: async () => sourceRead([repeatedNameSource]),
    readDeletions: async () => ({ snapshotId: "snapshot-1", historyTruncated: false, history: [], deletions: [{
      kind: "calendar", id: "deleted-same-name-occurrence", label: repeatedNameDeleted.name,
      targetFingerprint: `sha256:${"a".repeat(64)}`, tombstoneRevision: 4,
      deletedAt: "2026-09-23T13:00:00.000Z", reviewer: "teacher", note: null, studentId: null, reviewTargetId: null,
    }] }),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "ambiguous_schedule",
  "a surviving same-name occurrence must not let a deleted sibling be recreated");
});

test("imports distinguishable same-name occurrences with stable per-occurrence identities and collapses exact duplicates", async () => {
  const first = recognizedEvent("教研会", "2026-10-20");
  const second = recognizedEvent("教研会", "2026-10-21", "14:00", "15:00");
  const commands = [];
  const result = await sync.syncDocumentScheduleFile({
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
    issue: acceptedIssue(commands),
  });
  assert.equal(result.committed, true);
  const imported = commands.find((command) => command.command_type === "import_calendar");
  assert.equal(imported.events.length, 2);
  assert.equal(new Set(imported.events.map((event) => event.source_occurrence_ref)).size, 2);
  assert.deepEqual(imported.events.map((event) => event.source_occurrence_ref),
    [upload.stableDocumentOccurrenceVariantRef(first), upload.stableDocumentOccurrenceVariantRef(second)]);
  assert.equal(new Set(imported.events.map((event) => event.event_id)).size, 2);

  const duplicateCommands = [];
  const duplicate = await sync.syncDocumentScheduleFile({
    descriptor: { ...descriptor, source_hash: `sha256:${"3".repeat(64)}` },
    title: "重复事项材料",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: null,
    expectedSourceFingerprint: null,
  }, {
    recognize: async () => ({ events: [first, structuredClone(first)], slots: [] }),
    readSources: async () => sourceRead(),
    issue: acceptedIssue(duplicateCommands),
  });
  assert.equal(duplicate.committed, true);
  assert.equal(duplicateCommands.find((command) => command.command_type === "import_calendar").events.length, 1,
    "an exact duplicate fact inside one document must not become a second occurrence");
});

test("pairs one changed member of a same-name group and refuses an ambiguous multi-change", async () => {
  const sourceId = "document-source-00000000000000000000000000000013";
  const first = recognizedEvent("教研会", "2026-10-20", "09:00", "10:00", "东楼 203");
  const second = recognizedEvent("教研会", "2026-10-21", "14:00", "15:00", "西楼 101");
  const current = coreSource(sourceId, [first, second].map((event) => ({
    ...event,
    source_occurrence_ref: upload.stableDocumentOccurrenceVariantRef(event),
  })));
  const movedSecond = recognizedEvent("教研会", "2026-10-22", "15:00", "16:00", "西楼 102");
  const commands = [];
  const result = await sync.syncDocumentScheduleFile({
    descriptor: { ...descriptor, source_hash: `sha256:${"4".repeat(64)}` },
    title: "同名事项修订",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: sourceId,
    expectedSourceFingerprint: current.fingerprint,
  }, {
    recognize: async () => ({ events: [first, movedSecond], slots: [] }),
    readSources: async () => sourceRead([current]),
    issue: acceptedIssue(commands),
  });
  assert.equal(result.committed, true);
  const imported = commands.find((command) => command.command_type === "import_calendar");
  assert.equal(imported.events[0].source_occurrence_ref, current.occurrences[0].sourceOccurrenceRef);
  assert.equal(imported.events[1].source_occurrence_ref, current.occurrences[1].sourceOccurrenceRef);
  assert.equal(imported.events[1].event_id, current.occurrences[1].eventId);

  const movedFirst = recognizedEvent("教研会", "2026-10-23", "10:00", "11:00", "东楼 204");
  await assert.rejects(sync.syncDocumentScheduleFile({
    descriptor: { ...descriptor, source_hash: `sha256:${"5".repeat(64)}` },
    title: "同名事项多项修订",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: sourceId,
    expectedSourceFingerprint: current.fingerprint,
  }, {
    recognize: async () => ({ events: [movedFirst, movedSecond], slots: [] }),
    readSources: async () => sourceRead([current]),
    issue: async () => { throw new Error("must not write"); },
  }), (error) => error?.code === "ambiguous_schedule");
});

test("teacher preview maps two changed same-name items to distinct Core occurrences with stale rejection", async () => {
  const sourceId = "document-source-00000000000000000000000000000031";
  const oldA = recognizedEvent("教研会", "2026-10-20", "09:00", "10:00", "东楼 203");
  const oldB = recognizedEvent("教研会", "2026-10-21", "14:00", "15:00", "西楼 101");
  const current = coreSource(sourceId, [oldA, oldB].map(event => ({ ...event,
    source_occurrence_ref: upload.stableDocumentOccurrenceVariantRef(event) })));
  const newA = recognizedEvent("教研会", "2026-10-23", "10:00", "11:00", "东楼 204");
  const newB = recognizedEvent("教研会", "2026-10-24", "15:00", "16:00", "西楼 102");
  const changedDescriptor = { ...descriptor, source_hash: `sha256:${"9".repeat(64)}` };
  const preview = await sync.previewDocumentSchedulePairings({ descriptor: changedDescriptor,
    requestedSourceId: sourceId, expectedSourceFingerprint: current.fingerprint }, {
    recognize: async () => ({ events: [newA, newB], slots: [] }),
    readSources: async () => sourceRead([current]),
  });
  assert.equal(preview.groups.length, 1);
  assert.equal(preview.groups[0].incoming.length, 2);
  assert.equal(preview.groups[0].current.length, 2);
  const pairings = [
    { incomingVariantRef: preview.groups[0].incoming[0].variantRef, currentSourceOccurrenceRef: current.occurrences[1].sourceOccurrenceRef },
    { incomingVariantRef: preview.groups[0].incoming[1].variantRef, currentSourceOccurrenceRef: current.occurrences[0].sourceOccurrenceRef },
  ];
  const commands = [];
  const input = { descriptor: changedDescriptor, title: "教研会修订", materialKind: "other", subject: "行政", classId: "全校",
    requestedSourceId: sourceId, expectedSourceFingerprint: current.fingerprint,
    pairingFingerprint: preview.recognitionFingerprint, pairings };
  const result = await sync.syncDocumentScheduleFile(input, {
    recognize: async () => ({ events: [newA, newB], slots: [] }),
    readSources: async () => sourceRead([current]),
    issue: acceptedIssue(commands),
  });
  assert.equal(result.committed, true);
  const imported = commands.find(command => command.command_type === "import_calendar");
  assert.deepEqual(imported.events.map(event => event.source_occurrence_ref),
    [current.occurrences[1].sourceOccurrenceRef, current.occurrences[0].sourceOccurrenceRef]);
  assert.deepEqual(imported.events.map(event => event.event_id),
    [current.occurrences[1].eventId, current.occurrences[0].eventId]);
  await assert.rejects(sync.syncDocumentScheduleFile(input, {
    recognize: async () => ({ events: [{ ...newA, date: "2026-10-25" }, newB], slots: [] }),
    readSources: async () => sourceRead([current]),
    issue: async () => { throw new Error("stale candidate must not write"); },
  }), (error) => error?.code === "stale_calendar_source");
  let staleRecognitionCalls = 0;
  await assert.rejects(sync.previewDocumentSchedulePairings({ descriptor: changedDescriptor,
    requestedSourceId: sourceId, expectedSourceFingerprint: `sha256:${"f".repeat(64)}` }, {
    recognize: async () => { staleRecognitionCalls += 1; return { events: [newA, newB], slots: [] }; },
    readSources: async () => sourceRead([current]),
  }), (error) => error?.code === "stale_calendar_source");
  assert.equal(staleRecognitionCalls, 0, "stale source checks precede any model request");
  const other = coreSource("document-source-00000000000000000000000000000032", [oldA].map(event => ({ ...event,
    source_occurrence_ref: upload.stableDocumentOccurrenceVariantRef(event) })));
  await assert.rejects(sync.previewDocumentSchedulePairings({ descriptor: changedDescriptor,
    requestedSourceId: sourceId, expectedSourceFingerprint: current.fingerprint }, {
    recognize: async () => ({ events: [newA, newB], slots: [] }),
    readSources: async () => sourceRead([current, other]),
  }), (error) => error?.code === "calendar_source_selection_required");
});

test("pairing preview exposes notes and end dates that distinguish otherwise identical labels", async () => {
  const sourceId = "document-source-00000000000000000000000000000033";
  const base = { event_id: "model", date: "2026-10-20", end_date: null, name: "教研会", type: "meeting",
    confidence: "inferred", notes: null };
  const oldA = { ...base, event_id: "old-a", end_date: "2026-10-21", notes: "一年级" };
  const oldB = { ...base, event_id: "old-b", end_date: "2026-10-22", notes: "二年级" };
  const source = coreSource(sourceId, [oldA, oldB].map(event => ({ ...event,
    source_occurrence_ref: upload.stableDocumentOccurrenceVariantRef(event) })));
  const newA = { ...oldA, event_id: "new-a", notes: "一年级修订" };
  const newB = { ...oldB, event_id: "new-b", notes: "二年级修订" };
  const preview = await sync.previewDocumentSchedulePairings({ descriptor,
    requestedSourceId: sourceId, expectedSourceFingerprint: source.fingerprint }, {
    recognize: async () => ({ events: [newA, newB], slots: [] }),
    readSources: async () => sourceRead([source]),
  });
  assert.deepEqual(preview.groups[0].incoming.map(item => [item.endDate, item.notes]),
    [["2026-10-21", "一年级修订"], ["2026-10-22", "二年级修订"]]);
  assert.deepEqual(preview.groups[0].current.map(item => [item.endDate, item.notes]),
    [["2026-10-21", "一年级"], ["2026-10-22", "二年级"]]);
});

test("pairing preview distinguishes equal wall-clock times in different time zones", async () => {
  const sourceId = "document-source-00000000000000000000000000000034";
  const shanghai = recognizedEvent("教研会", "2026-10-20", "09:00", "10:00", "会议室");
  const tokyo = { ...shanghai, event_id: "tokyo", time_interval: {
    start: "2026-10-20T09:00+09:00", end: "2026-10-20T10:00+09:00", time_zone: "Asia/Tokyo",
  } };
  const source = coreSource(sourceId, [shanghai, tokyo].map(event => ({ ...event,
    source_occurrence_ref: upload.stableDocumentOccurrenceVariantRef(event) })));
  const newShanghai = { ...shanghai, date: "2026-10-21", time_interval: {
    start: "2026-10-21T09:00+08:00", end: "2026-10-21T10:00+08:00", time_zone: "Asia/Shanghai",
  } };
  const newTokyo = { ...tokyo, date: "2026-10-21", time_interval: {
    start: "2026-10-21T09:00+09:00", end: "2026-10-21T10:00+09:00", time_zone: "Asia/Tokyo",
  } };
  const preview = await sync.previewDocumentSchedulePairings({ descriptor,
    requestedSourceId: sourceId, expectedSourceFingerprint: source.fingerprint }, {
    recognize: async () => ({ events: [newShanghai, newTokyo], slots: [] }),
    readSources: async () => sourceRead([source]),
  });
  const times = preview.groups[0].current.map(item => item.time);
  assert.equal(times.length, 2);
  assert.notEqual(times[0], times[1]);
  assert.match(times[0], /Asia\/Shanghai.*UTC\+08:00/u);
  assert.match(times[1], /Asia\/Tokyo.*UTC\+09:00/u);
});

test("expands a legacy singleton into a same-name group without changing its existing identity", async () => {
  const sourceId = "document-source-00000000000000000000000000000015";
  const first = recognizedEvent("教研会", "2026-10-20", "09:00", "10:00", "东楼 203");
  const second = recognizedEvent("教研会", "2026-10-21", "14:00", "15:00", "西楼 101");
  const legacyRef = upload.stableDocumentOccurrenceRef(first);
  const current = coreSource(sourceId, [{ ...first, source_occurrence_ref: legacyRef }]);
  const commands = [];
  const result = await sync.syncDocumentScheduleFile({
    descriptor: { ...descriptor, source_hash: `sha256:${"6".repeat(64)}` },
    title: "单项来源新增同名事项",
    materialKind: "other",
    subject: "行政",
    classId: "全校",
    requestedSourceId: sourceId,
    expectedSourceFingerprint: current.fingerprint,
  }, {
    recognize: async () => ({ events: [first, second], slots: [] }),
    readSources: async () => sourceRead([current]),
    issue: acceptedIssue(commands),
  });
  assert.equal(result.committed, true);
  const imported = commands.find((command) => command.command_type === "import_calendar");
  assert.equal(imported.events[0].source_occurrence_ref, legacyRef);
  assert.equal(imported.events[0].event_id, current.occurrences[0].eventId);
  assert.equal(imported.events[1].source_occurrence_ref, upload.stableDocumentOccurrenceVariantRef(second));
  assert.notEqual(imported.events[1].event_id, imported.events[0].event_id);
});
