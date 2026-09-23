import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const sync = await jiti.import("./edupi-calendar-file-sync.ts");
const sourceProjection = await jiti.import("./edupi-calendar-sources.ts");
const upload = await jiti.import("./edupi-schedule-upload.ts");

const descriptor = {
  staging_id: "stg_00000000000000000000000000000001",
  staging_path: "/desktop-state/material-staging/stg_00000000000000000000000000000001/material.ics",
  original_name: "官方校历.ics",
  expected_size_bytes: 128,
  source_hash: `sha256:${"a".repeat(64)}`,
  kind: "calendar",
  source_scope: "desktop_staging",
};

function event(ref, date, name = ref) {
  return { event_id: `parsed-${ref}`, date, end_date: null, name, type: "meeting", confidence: "teacher_confirmed", notes: null, source_occurrence_ref: ref };
}

function sourceEvent(sourceId, value, evidenceIds = []) {
  return { ...value, event_id: upload.stableOccurrenceCalendarEventId(sourceId, value.source_occurrence_ref), date_status: "explicit",
    state: "confirmed", preparation_status: "read_only", source_ids: [sourceId], evidence_ids: evidenceIds, external_send: false };
}

function coreSources(sourceId, events, evidenceIds = []) {
  return sourceProjection.projectCoreCalendarSources(events.map((value) => sourceEvent(sourceId, value, evidenceIds)));
}

function sourceRead(sources, snapshotId = "snapshot-1") {
  return { sources, snapshot: { payload: { snapshot_id: snapshotId, education_workspace: {} }, roots: { runtime: {}, dataRoot: {} } } };
}

function ledger(deletions = []) {
  return { snapshotId: "snapshot-1", deletions, history: [], historyTruncated: false };
}

function acceptedIssue(commands) {
  return async (command) => { commands.push(structuredClone(command)); return { receipt: { status: "accepted" }, data: {} }; };
}

const evidenceId = `calendar-evidence-${"a".repeat(32)}`;
const seriesFamily = (uid) => `ics-series:${crypto.createHash("sha256").update(uid, "utf8").digest("hex")}`;
const deletionNote = (sourceId) => `ICS-SYNC:${crypto.createHash("sha256").update(`${sourceId}\0${evidenceId}`, "utf8").digest("hex")}`;
const batchRequestId = `calendar-batch-delete-${"b".repeat(32)}`;

test("an explicit Core-bound calendar update imports first, deletes withdrawn occurrences, and keeps no Desktop baseline", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000011";
  const beforeEvents = [event("uid-1", "2026-10-01"), event("uid-2", "2026-10-02")];
  const sources = coreSources(sourceId, beforeEvents);
  const afterImport = coreSources(sourceId, [...beforeEvents, event("uid-3", "2026-10-03")], [evidenceId]);
  const deleted = [];
  const commands = [];
  const result = await sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: sources[0].fingerprint }, {
    recognize: async () => ({ events: [event("uid-2", "2026-10-02"), event("uid-3", "2026-10-03")], slots: [], calendar_mode: "full_snapshot" }),
    readSources: async () => sourceRead(sources),
    readSourcesAfter: async () => sourceRead(afterImport),
    readDeletions: async () => ledger(),
    issue: acceptedIssue(commands),
    deleteCalendarBatch: async (eventIds) => { deleted.push(...eventIds); },
  });
  assert.equal(result.committed, true);
  assert.deepEqual(deleted, [upload.stableOccurrenceCalendarEventId(sourceId, "uid-1")]);
  assert.equal(commands.at(-1).source.source_id, sourceId);
  assert.equal(JSON.stringify(result).includes("calendar-sources.json"), false);
});

test("a cancellation delta deletes only named refs and preserves unrelated source occurrences", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000012";
  const sources = coreSources(sourceId, [event("uid-a", "2026-10-01"), event("uid-b", "2026-10-02")]);
  const deleted = [];
  const result = await sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: sources[0].fingerprint }, {
    recognize: async () => ({ events: [], slots: [], calendar_mode: "delta_cancel", cancelled_occurrence_refs: ["uid-a"] }),
    readSources: async () => sourceRead(sources),
    readSourcesAfter: async () => sourceRead(sources),
    readDeletions: async () => ledger(),
    issue: acceptedIssue([]),
    deleteCalendarBatch: async (eventIds) => { deleted.push(...eventIds); },
  });
  assert.equal(result.committed, true);
  assert.deepEqual(deleted, [upload.stableOccurrenceCalendarEventId(sourceId, "uid-a")]);
});

test("unknown, mixed, or wrong-source cancellation refs fail before any Core mutation", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000018";
  const sources = coreSources(sourceId, [event("uid-a", "2026-10-01"), event("uid-b", "2026-10-02")]);
  for (const cancelled of [["unknown"], ["uid-a", "unknown"]]) {
    let issues = 0;
    let deletes = 0;
    await assert.rejects(sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: sources[0].fingerprint }, {
      recognize: async () => ({ events: [], slots: [], calendar_mode: "delta_cancel", cancelled_occurrence_refs: cancelled }),
      readSources: async () => sourceRead(sources), readDeletions: async () => ledger(),
      issue: async () => { issues += 1; return { receipt: { status: "accepted" }, data: {} }; },
      deleteCalendarBatch: async () => { deletes += 1; },
    }), (error) => error?.code === "ambiguous_schedule");
    assert.equal(issues, 0);
    assert.equal(deletes, 0);
  }
});

test("REQUEST/PUBLISH delta upserts never delete omitted source occurrences", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000019";
  const sources = coreSources(sourceId, [event("uid-a", "2026-10-01"), event("uid-b", "2026-10-02")]);
  let deletes = 0;
  const result = await sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: sources[0].fingerprint }, {
    recognize: async () => ({ events: [event("uid-a", "2026-10-01")], slots: [], calendar_mode: "delta_upsert" }),
    readSources: async () => sourceRead(sources), readDeletions: async () => ledger(), issue: acceptedIssue([]),
    deleteCalendarBatch: async () => { deletes += 1; },
  });
  assert.equal(result.committed, true);
  assert.equal(deletes, 0);
  assert.deepEqual(result.removedEventIds, []);
});

test("REQUEST/PUBLISH delta upserts withdraw only explicit EXDATE occurrence refs", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000020";
  const before = [event("series#week-1", "2026-10-20"), event("series#week-2", "2026-10-27"), event("series#week-3", "2026-11-03")];
  const sources = coreSources(sourceId, before);
  const deleted = [];
  const result = await sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: sources[0].fingerprint }, {
    recognize: async () => ({ events: [before[0], before[2]], slots: [], calendar_mode: "delta_upsert",
      cancelled_occurrence_refs: ["series#week-2"] }),
    readSources: async () => sourceRead(sources),
    readSourcesAfter: async () => sourceRead(coreSources(sourceId, before, [evidenceId])),
    readDeletions: async () => ledger(), issue: acceptedIssue([]),
    deleteCalendarBatch: async (eventIds) => { deleted.push(...eventIds); },
  });
  assert.equal(result.committed, true);
  assert.deepEqual(deleted, [upload.stableOccurrenceCalendarEventId(sourceId, "series#week-2")]);
  assert.deepEqual(result.removedEventIds, deleted);
});

test("a new REQUEST/PUBLISH source accepts EXDATE without requiring a prior occurrence", async () => {
  let deletes = 0;
  const commands = [];
  const result = await sync.syncCalendarFile({ descriptor, requestedSourceId: null, expectedSourceFingerprint: null }, {
    recognize: async () => ({ events: [event("series#week-1", "2026-10-20"), event("series#week-3", "2026-11-03")],
      slots: [], calendar_mode: "delta_upsert", cancelled_occurrence_refs: ["series#week-2"] }),
    readSources: async () => sourceRead([]), readDeletions: async () => ledger(), issue: acceptedIssue(commands),
    deleteCalendarBatch: async () => { deletes += 1; },
  });
  assert.equal(result.committed, true);
  assert.equal(result.recognition.eventCount, 2);
  assert.equal(deletes, 0);
  assert.deepEqual(result.removedEventIds, []);
  assert.equal(commands.length, 2);
});

test("a recurring master delta replaces only the matching UID series", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000021";
  const series = `ics-series:${"a".repeat(64)}`;
  const other = `ics-series:${"b".repeat(64)}`;
  const before = [event(`${series}#2026-10-20T01:00:00.000Z`, "2026-10-20"),
    event(`${series}#2026-10-27T01:00:00.000Z`, "2026-10-27"), event(`${other}#2026-10-21T01:00:00.000Z`, "2026-10-21")];
  const incoming = [event(`${series}#2026-10-20T02:00:00.000Z`, "2026-10-20"),
    event(`${series}#2026-10-27T02:00:00.000Z`, "2026-10-27")];
  const sources = coreSources(sourceId, before);
  const deleted = [];
  const result = await sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: sources[0].fingerprint }, {
    recognize: async () => ({ events: incoming, slots: [], calendar_mode: "delta_upsert", affected_series_refs: [series] }),
    readSources: async () => sourceRead(sources),
    readSourcesAfter: async () => sourceRead(coreSources(sourceId, [...before, ...incoming], [evidenceId])),
    readDeletions: async () => ledger(), issue: acceptedIssue([]),
    deleteCalendarBatch: async (eventIds) => { deleted.push(...eventIds); },
  });
  assert.equal(result.committed, true);
  assert.deepEqual(deleted, before.slice(0, 2).map((item) => upload.stableOccurrenceCalendarEventId(sourceId, item.source_occurrence_ref)));
  assert.equal(deleted.includes(upload.stableOccurrenceCalendarEventId(sourceId, before[2].source_occurrence_ref)), false,
    "an unrelated UID series must remain current");
});

test("a REQUEST recurring-to-single change withdraws the old series family", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000022";
  const series = seriesFamily("series-to-single");
  const before = [event(`${series}#2026-10-20T01:00:00.000Z`, "2026-10-20"),
    event(`${series}#2026-10-27T01:00:00.000Z`, "2026-10-27")];
  const incoming = [event("series-to-single", "2026-10-20")];
  const sources = coreSources(sourceId, before);
  const deleted = [];
  const result = await sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: sources[0].fingerprint }, {
    recognize: async () => ({ events: incoming, slots: [], calendar_mode: "delta_upsert", affected_series_refs: [series] }),
    readSources: async () => sourceRead(sources),
    readSourcesAfter: async () => sourceRead(coreSources(sourceId, [...before, ...incoming], [evidenceId])),
    readDeletions: async () => ledger(), issue: acceptedIssue([]),
    deleteCalendarBatch: async (eventIds) => { deleted.push(...eventIds); },
  });
  assert.equal(result.committed, true);
  assert.deepEqual(deleted, before.map((item) => upload.stableOccurrenceCalendarEventId(sourceId, item.source_occurrence_ref)));
});

test("a REQUEST single-to-recurring change withdraws the old single occurrence", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000023";
  const uid = "single-to-series";
  const series = seriesFamily(uid);
  const before = [event(uid, "2026-10-20")];
  const incoming = [event(`${series}#2026-10-20T02:00:00.000Z`, "2026-10-20"),
    event(`${series}#2026-10-27T02:00:00.000Z`, "2026-10-27")];
  const sources = coreSources(sourceId, before);
  const deleted = [];
  const result = await sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: sources[0].fingerprint }, {
    recognize: async () => ({ events: incoming, slots: [], calendar_mode: "delta_upsert", affected_series_refs: [series] }),
    readSources: async () => sourceRead(sources),
    readSourcesAfter: async () => sourceRead(coreSources(sourceId, [...before, ...incoming], [evidenceId])),
    readDeletions: async () => ledger(), issue: acceptedIssue([]),
    deleteCalendarBatch: async (eventIds) => { deleted.push(...eventIds); },
  });
  assert.equal(result.committed, true);
  assert.deepEqual(deleted, [upload.stableOccurrenceCalendarEventId(sourceId, uid)]);
});

test("a whole-series CANCEL withdraws every matching UID occurrence and no other series", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000026";
  const series = seriesFamily("series-cancel-all");
  const other = seriesFamily("series-keep");
  const before = [event(`${series}#2026-10-20T01:00:00.000Z`, "2026-10-20"),
    event(`${series}#2026-10-27T01:00:00.000Z`, "2026-10-27"),
    event(`${other}#2026-10-21T01:00:00.000Z`, "2026-10-21")];
  const sources = coreSources(sourceId, before);
  const deleted = [];
  const result = await sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: sources[0].fingerprint }, {
    recognize: async () => ({ events: [], slots: [], calendar_mode: "delta_cancel", affected_series_refs: [series] }),
    readSources: async () => sourceRead(sources),
    readSourcesAfter: async () => sourceRead(sources),
    readDeletions: async () => ledger(), issue: acceptedIssue([]),
    deleteCalendarBatch: async (eventIds) => { deleted.push(...eventIds); },
  });
  assert.equal(result.committed, true);
  assert.deepEqual(deleted, before.slice(0, 2).map((item) => upload.stableOccurrenceCalendarEventId(sourceId, item.source_occurrence_ref)));
  assert.equal(deleted.includes(upload.stableOccurrenceCalendarEventId(sourceId, before[2].source_occurrence_ref)), false);
});

test("an exact whole-series cancellation replay remains a committed no-op after its source disappears", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000027";
  const occurrenceRef = `${seriesFamily("series-cancel-all")}#2026-10-20T01:00:00.000Z`;
  const targetId = upload.stableOccurrenceCalendarEventId(sourceId, occurrenceRef);
  const result = await sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: `sha256:${"c".repeat(64)}` }, {
    recognize: async () => ({ events: [], slots: [], calendar_mode: "delta_cancel",
      affected_series_refs: [seriesFamily("series-cancel-all")] }),
    readSources: async () => sourceRead([]),
    readDeletions: async () => ({ snapshotId: "snapshot-1", historyTruncated: false, deletions: [{ kind: "calendar", id: targetId }], history: [{
      action: "delete", kind: "calendar", targetId, requestId: batchRequestId, note: deletionNote(sourceId),
    }] }),
    issue: acceptedIssue([]),
    deleteCalendarBatch: async () => { throw new Error("an exact replay must not delete again"); },
  });
  assert.equal(result.committed, true);
  assert.equal(result.sourceId, sourceId);
  assert.deepEqual(result.removedEventIds, []);
});

test("an exact whole-series cancellation replay is a no-op while unrelated UID series keep the source alive", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000029";
  const cancelled = event(`${seriesFamily("series-cancel-all")}#2026-10-20T01:00:00.000Z`, "2026-10-20");
  const unrelated = event(`${seriesFamily("series-keep")}#2026-10-21T01:00:00.000Z`, "2026-10-21");
  const before = coreSources(sourceId, [cancelled, unrelated]);
  const sources = coreSources(sourceId, [unrelated]);
  const targetId = upload.stableOccurrenceCalendarEventId(sourceId, cancelled.source_occurrence_ref);
  let deletes = 0;
  const result = await sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: before[0].fingerprint }, {
    recognize: async () => ({ events: [], slots: [], calendar_mode: "delta_cancel",
      affected_series_refs: [seriesFamily("series-cancel-all")] }),
    readSources: async () => sourceRead(sources),
    readDeletions: async () => ({ snapshotId: "snapshot-1", historyTruncated: false, deletions: [{ kind: "calendar", id: targetId }], history: [{
      action: "delete", kind: "calendar", targetId, requestId: batchRequestId, note: deletionNote(sourceId),
    }] }),
    issue: acceptedIssue([]),
    deleteCalendarBatch: async () => { deletes += 1; },
  });
  assert.equal(result.committed, true);
  assert.equal(result.sourceId, sourceId);
  assert.deepEqual(result.removedEventIds, []);
  assert.equal(deletes, 0);
});

test("an exact single cancellation replay accepts its pre-delete fingerprint while unrelated occurrences remain", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000030";
  const occurrenceRef = `${seriesFamily("single-replay-live")}#2026-10-27T01:00:00.000Z`;
  const cancelled = event(occurrenceRef, "2026-10-27");
  const unrelated = event("unrelated-single", "2026-10-28");
  const before = coreSources(sourceId, [cancelled, unrelated]);
  const current = coreSources(sourceId, [unrelated]);
  const eventId = upload.stableOccurrenceCalendarEventId(sourceId, occurrenceRef);
  let deletes = 0;
  const result = await sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: before[0].fingerprint }, {
    recognize: async () => ({ events: [], slots: [], calendar_mode: "delta_cancel",
      cancelled_occurrence_refs: [occurrenceRef] }),
    readSources: async () => sourceRead(current),
    readDeletions: async () => ({ snapshotId: "snapshot-1", historyTruncated: false, deletions: [{ kind: "calendar", id: eventId }], history: [] }),
    issue: acceptedIssue([]),
    deleteCalendarBatch: async () => { deletes += 1; },
  });
  assert.equal(result.committed, true);
  assert.equal(result.sourceId, sourceId);
  assert.deepEqual(result.removedEventIds, []);
  assert.equal(deletes, 0);
});

test("unrelated global snapshot drift does not reject a still-valid cancellation no-op replay", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000033";
  const occurrenceRef = `${seriesFamily("single-ambient-drift")}#2026-10-27T01:00:00.000Z`;
  const cancelled = event(occurrenceRef, "2026-10-27");
  const unrelated = event("unrelated-ambient-drift", "2026-10-28");
  const before = coreSources(sourceId, [cancelled, unrelated]);
  const current = coreSources(sourceId, [unrelated]);
  const eventId = upload.stableOccurrenceCalendarEventId(sourceId, occurrenceRef);
  const result = await sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: before[0].fingerprint }, {
    recognize: async () => ({ events: [], slots: [], calendar_mode: "delta_cancel", cancelled_occurrence_refs: [occurrenceRef] }),
    readSources: async () => sourceRead(current, "snapshot-before-ambient-drift"),
    readSourcesAfter: async () => sourceRead(current, "snapshot-after-ambient-drift"),
    readDeletions: async () => ({ snapshotId: "snapshot-independent-ledger-read", historyTruncated: false,
      deletions: [{ kind: "calendar", id: eventId }], history: [] }),
    issue: acceptedIssue([]),
  });
  assert.equal(result.committed, true);
  assert.equal(result.sourceId, sourceId);
  assert.deepEqual(result.removedEventIds, []);
});

test("a concurrent restore invalidates a single cancellation no-op replay before success", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000031";
  const occurrenceRef = `${seriesFamily("single-race")}#2026-10-27T01:00:00.000Z`;
  const cancelled = event(occurrenceRef, "2026-10-27");
  const unrelated = event("unrelated-race", "2026-10-28");
  const before = coreSources(sourceId, [cancelled, unrelated]);
  const current = coreSources(sourceId, [unrelated]);
  const restored = coreSources(sourceId, [cancelled, unrelated]);
  const eventId = upload.stableOccurrenceCalendarEventId(sourceId, occurrenceRef);
  await assert.rejects(sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: before[0].fingerprint }, {
    recognize: async () => ({ events: [], slots: [], calendar_mode: "delta_cancel", cancelled_occurrence_refs: [occurrenceRef] }),
    readSources: async () => sourceRead(current, "snapshot-before-restore"),
    readSourcesAfter: async () => sourceRead(restored, "snapshot-after-restore"),
    readDeletions: async (read) => read.snapshot.payload.snapshot_id === "snapshot-before-restore"
      ? { snapshotId: "snapshot-before-restore", historyTruncated: false, deletions: [{ kind: "calendar", id: eventId }], history: [] }
      : { snapshotId: "snapshot-after-restore", historyTruncated: false, deletions: [], history: [] },
    issue: acceptedIssue([]),
  }), (error) => error?.code === "stale_calendar_source");
});

test("a concurrent restore invalidates a whole-series cancellation no-op replay before success", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000032";
  const cancelled = event(`${seriesFamily("series-race")}#2026-10-20T01:00:00.000Z`, "2026-10-20");
  const unrelated = event("unrelated-series-race", "2026-10-21");
  const before = coreSources(sourceId, [cancelled, unrelated]);
  const current = coreSources(sourceId, [unrelated]);
  const restored = coreSources(sourceId, [cancelled, unrelated]);
  const targetId = upload.stableOccurrenceCalendarEventId(sourceId, cancelled.source_occurrence_ref);
  const history = [{ action: "delete", kind: "calendar", targetId, requestId: batchRequestId, note: deletionNote(sourceId) }];
  await assert.rejects(sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: before[0].fingerprint }, {
    recognize: async () => ({ events: [], slots: [], calendar_mode: "delta_cancel",
      affected_series_refs: [seriesFamily("series-race")] }),
    readSources: async () => sourceRead(current, "snapshot-before-series-restore"),
    readSourcesAfter: async () => sourceRead(restored, "snapshot-after-series-restore"),
    readDeletions: async (read) => ({ snapshotId: read.snapshot.payload.snapshot_id, historyTruncated: false,
      deletions: [{ kind: "calendar", id: targetId }], history }),
    issue: acceptedIssue([]),
  }), (error) => error?.code === "stale_calendar_source");
});

test("restored series tombstones invalidate replay even while another visibility filter keeps the family absent", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000034";
  const cancelled = event(`${seriesFamily("series-hidden-restore")}#2026-10-20T01:00:00.000Z`, "2026-10-20");
  const unrelated = event("unrelated-hidden-restore", "2026-10-21");
  const before = coreSources(sourceId, [cancelled, unrelated]);
  const current = coreSources(sourceId, [unrelated]);
  const targetId = upload.stableOccurrenceCalendarEventId(sourceId, cancelled.source_occurrence_ref);
  const history = [{ action: "delete", kind: "calendar", targetId, requestId: batchRequestId, note: deletionNote(sourceId) }];
  let ledgerReads = 0;
  await assert.rejects(sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: before[0].fingerprint }, {
    recognize: async () => ({ events: [], slots: [], calendar_mode: "delta_cancel",
      affected_series_refs: [seriesFamily("series-hidden-restore")] }),
    readSources: async () => sourceRead(current, "snapshot-before-hidden-restore"),
    readSourcesAfter: async () => sourceRead(current, "snapshot-after-hidden-restore"),
    readDeletions: async () => {
      ledgerReads += 1;
      return { snapshotId: `snapshot-hidden-ledger-${ledgerReads}`, historyTruncated: false,
        deletions: ledgerReads === 1 ? [{ kind: "calendar", id: targetId }] : [], history };
    },
    issue: acceptedIssue([]),
  }), (error) => error?.code === "stale_calendar_source");
  assert.equal(ledgerReads, 2);
});

test("unbound delete history from another source cannot authorize a series cancellation replay", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000035";
  const otherSourceId = "calendar-source-00000000000000000000000000000036";
  const cancelled = event(`${seriesFamily("series-cross-source")}#2026-10-20T01:00:00.000Z`, "2026-10-20");
  const unrelated = event("unrelated-cross-source", "2026-10-21");
  const before = coreSources(sourceId, [cancelled, unrelated]);
  const current = coreSources(sourceId, [unrelated]);
  const otherTargetId = upload.stableOccurrenceCalendarEventId(otherSourceId, cancelled.source_occurrence_ref);
  await assert.rejects(sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: before[0].fingerprint }, {
    recognize: async () => ({ events: [], slots: [], calendar_mode: "delta_cancel",
      affected_series_refs: [seriesFamily("series-cross-source")] }),
    readSources: async () => sourceRead(current),
    readDeletions: async () => ({ snapshotId: "snapshot-cross-source", historyTruncated: false,
      deletions: [{ kind: "calendar", id: otherTargetId }], history: [{
      action: "delete", kind: "calendar", targetId: otherTargetId, note: `ICS 日历来源更新 ${evidenceId}`,
    }] }),
    issue: acceptedIssue([]),
  }), (error) => ["stale_calendar_source", "ambiguous_schedule"].includes(error?.code));
});

test("a saturated deletion history cannot prove a complete series cancellation batch", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000037";
  const cancelled = event(`${seriesFamily("series-truncated-history")}#2026-10-20T01:00:00.000Z`, "2026-10-20");
  const unrelated = event("unrelated-truncated-history", "2026-10-21");
  const before = coreSources(sourceId, [cancelled, unrelated]);
  const current = coreSources(sourceId, [unrelated]);
  const targetId = upload.stableOccurrenceCalendarEventId(sourceId, cancelled.source_occurrence_ref);
  const history = Array.from({ length: 49 }, (_, index) => ({ action: "delete", kind: "calendar",
    targetId: `other-history-target-${index}`, note: null }));
  history.push({ action: "delete", kind: "calendar", targetId, requestId: batchRequestId, note: deletionNote(sourceId) });
  await assert.rejects(sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: before[0].fingerprint }, {
    recognize: async () => ({ events: [], slots: [], calendar_mode: "delta_cancel",
      affected_series_refs: [seriesFamily("series-truncated-history")] }),
    readSources: async () => sourceRead(current),
    readDeletions: async () => ({ snapshotId: "snapshot-truncated-history", historyTruncated: true,
      deletions: [{ kind: "calendar", id: targetId }], history }),
    issue: acceptedIssue([]),
  }), (error) => ["stale_calendar_source", "ambiguous_schedule"].includes(error?.code));
});

test("an exact single-occurrence cancellation replay keeps the original missing source identity", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000028";
  const occurrenceRef = `${seriesFamily("single-replay")}#2026-10-27T01:00:00.000Z`;
  const eventId = upload.stableOccurrenceCalendarEventId(sourceId, occurrenceRef);
  const result = await sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: `sha256:${"d".repeat(64)}` }, {
    recognize: async () => ({ events: [], slots: [], calendar_mode: "delta_cancel",
      cancelled_occurrence_refs: [occurrenceRef] }),
    readSources: async () => sourceRead([]),
    readDeletions: async () => ({ snapshotId: "snapshot-1", historyTruncated: false,
      deletions: [{ kind: "calendar", id: eventId }], history: [] }),
    issue: acceptedIssue([]),
    deleteCalendarBatch: async () => { throw new Error("an exact replay must not delete again"); },
  });
  assert.equal(result.committed, true);
  assert.equal(result.sourceId, sourceId);
  assert.deepEqual(result.removedEventIds, []);
});

test("held imports and failed deletion never claim a committed source update", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000013";
  const sources = coreSources(sourceId, [event("uid-1", "2026-10-01"), event("uid-2", "2026-10-02")]);
  const held = await sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: sources[0].fingerprint }, {
    recognize: async () => ({ events: [event("uid-1", "2026-10-03")], slots: [], calendar_mode: "full_snapshot" }),
    readSources: async () => sourceRead(sources), readDeletions: async () => ledger(),
    issue: async () => ({ receipt: { status: "held" }, data: {} }),
    deleteCalendar: async () => { throw new Error("must not delete on held import"); },
  });
  assert.equal(held.committed, false);

  await assert.rejects(sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: sources[0].fingerprint }, {
    recognize: async () => ({ events: [event("uid-2", "2026-10-02")], slots: [], calendar_mode: "full_snapshot" }),
    readSources: async () => sourceRead(sources), readSourcesAfter: async () => sourceRead(coreSources(sourceId,
      [event("uid-1", "2026-10-01"), event("uid-2", "2026-10-02")], [evidenceId])),
    readDeletions: async () => ledger(), issue: acceptedIssue([]),
    deleteCalendarBatch: async () => { throw new Error("delete unavailable"); },
  }), /delete unavailable/);
});

test("a concurrent source change after import stops the batch delete", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000020";
  const before = [event("uid-a", "2026-10-01"), event("uid-b", "2026-10-02")];
  const sources = coreSources(sourceId, before);
  let deletes = 0;
  await assert.rejects(sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: sources[0].fingerprint }, {
    recognize: async () => ({ events: [event("uid-b", "2026-10-02")], slots: [], calendar_mode: "full_snapshot" }),
    readSources: async () => sourceRead(sources),
    readSourcesAfter: async () => sourceRead(coreSources(sourceId, [event("uid-a", "2026-10-04", "并发改期"), event("uid-b", "2026-10-02")], [evidenceId])),
    readDeletions: async () => ledger(), issue: acceptedIssue([]),
    deleteCalendarBatch: async () => { deletes += 1; },
  }), (error) => error?.code === "stale_calendar_source");
  assert.equal(deletes, 0);
});

test("source selection is CAS-bound and old revisions cannot silently roll back the current Core source", async () => {
  const original = [event("uid-a", "2026-10-01")];
  const semantic = upload.stableScheduleSourceHash([{ calendar_mode: "full_snapshot" }, ...original]);
  const sourceId = `calendar-source-${semantic.slice("sha256:".length, "sha256:".length + 32)}`;
  const current = coreSources(sourceId, [event("uid-b", "2026-10-02")]);
  await assert.rejects(sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: `sha256:${"f".repeat(64)}` }, {
    recognize: async () => ({ events: original, slots: [], calendar_mode: "full_snapshot" }),
    readSources: async () => sourceRead(current), readDeletions: async () => ledger(), issue: acceptedIssue([]),
  }), (error) => error?.code === "stale_calendar_source");
  await assert.rejects(sync.syncCalendarFile({ descriptor, requestedSourceId: null, expectedSourceFingerprint: null }, {
    recognize: async () => ({ events: original, slots: [], calendar_mode: "full_snapshot" }),
    readSources: async () => sourceRead(current), readDeletions: async () => ledger(), issue: acceptedIssue([]),
  }), (error) => error?.code === "calendar_source_selection_required");
});

test("a subset, superset, shared UID, or identical fact requires explicit existing-source selection", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000014";
  const sources = coreSources(sourceId, [event("uid-a", "2026-10-01", "教研会"), event("uid-b", "2026-10-02", "备课会")]);
  for (const incoming of [
    [event("uid-a", "2026-10-01", "教研会")],
    [event("uid-a", "2026-10-01", "教研会"), event("uid-c", "2026-10-03", "活动")],
    [event("different-uid", "2026-10-01", "教研会")],
  ]) await assert.rejects(sync.syncCalendarFile({ descriptor, requestedSourceId: null, expectedSourceFingerprint: null }, {
    recognize: async () => ({ events: incoming, slots: [], calendar_mode: "full_snapshot" }),
    readSources: async () => sourceRead(sources), readDeletions: async () => ledger(), issue: acceptedIssue([]),
  }), (error) => error?.code === "calendar_source_selection_required");
});

test("an explicit source selection rejects facts owned by another or multiple existing sources", async () => {
  const firstId = "calendar-source-00000000000000000000000000000024";
  const secondId = "calendar-source-00000000000000000000000000000025";
  const firstEvent = event("uid-first", "2026-10-01");
  const secondEvent = event("uid-second", "2026-10-02");
  const projected = [...coreSources(firstId, [firstEvent]), ...coreSources(secondId, [secondEvent])];
  const first = projected.find((source) => source.sourceId === firstId);
  const second = projected.find((source) => source.sourceId === secondId);
  for (const [requested, events] of [[second, [firstEvent]], [first, [firstEvent, secondEvent]]]) {
    let issues = 0;
    await assert.rejects(sync.syncCalendarFile({ descriptor, requestedSourceId: requested.sourceId,
      expectedSourceFingerprint: requested.fingerprint }, {
      recognize: async () => ({ events, slots: [], calendar_mode: "full_snapshot" }),
      readSources: async () => sourceRead(projected), readDeletions: async () => ledger(),
      issue: async () => { issues += 1; return { receipt: { status: "accepted" }, data: {} }; },
    }), (error) => error?.code === "calendar_source_selection_required");
    assert.equal(issues, 0);
  }
});

test("Core tombstones block revival until restore removes the tombstone", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000015";
  const active = [event("uid-b", "2026-10-02")];
  const sources = coreSources(sourceId, active);
  const revived = event("uid-a", "2026-10-01");
  const revivedId = upload.stableOccurrenceCalendarEventId(sourceId, "uid-a");
  const tombstone = { kind: "calendar", id: revivedId, label: "uid-a", studentId: null, reviewTargetId: null,
    targetFingerprint: `sha256:${"a".repeat(64)}`, tombstoneRevision: 1, deletedAt: "2026-09-23T00:00:00.000Z", reviewer: "teacher", note: null };
  const input = { descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: sources[0].fingerprint };
  await assert.rejects(sync.syncCalendarFile(input, {
    recognize: async () => ({ events: [revived, ...active], slots: [], calendar_mode: "full_snapshot" }),
    readSources: async () => sourceRead(sources), readDeletions: async () => ledger([tombstone]), issue: acceptedIssue([]),
  }), (error) => error?.code === "ambiguous_schedule");
  const commands = [];
  const restored = await sync.syncCalendarFile(input, {
    recognize: async () => ({ events: [revived, ...active], slots: [], calendar_mode: "full_snapshot" }),
    readSources: async () => sourceRead(sources), readDeletions: async () => ledger(), issue: acceptedIssue(commands),
  });
  assert.equal(restored.committed, true);
  assert.equal(commands.length, 2);
});

test("a 200-item source revision uses one bounded Core batch instead of sequential deletes", async () => {
  const sourceId = "calendar-source-00000000000000000000000000000016";
  const before = Array.from({ length: 200 }, (_, index) => event(`uid-${String(index).padStart(3, "0")}`, `2026-10-${String(index % 28 + 1).padStart(2, "0")}`));
  const incoming = [before.at(-1)];
  const sources = coreSources(sourceId, before);
  let batchCalls = 0;
  let batchSize = 0;
  const result = await sync.syncCalendarFile({ descriptor, requestedSourceId: sourceId, expectedSourceFingerprint: sources[0].fingerprint }, {
    recognize: async () => ({ events: incoming, slots: [], calendar_mode: "full_snapshot" }),
    readSources: async () => sourceRead(sources),
    readSourcesAfter: async () => sourceRead(coreSources(sourceId, before, [evidenceId])),
    readDeletions: async () => ledger(), issue: acceptedIssue([]),
    deleteCalendarBatch: async (eventIds) => { batchCalls += 1; batchSize = eventIds.length; },
  });
  assert.equal(result.committed, true);
  assert.equal(batchCalls, 1);
  assert.equal(batchSize, 199);
});

test("calendar batch delete uses the guarded snapshot without an intervening ledger read and never retries stale CAS", async () => {
  const ids = ["calendar-1", "calendar-2"];
  const sourceId = "calendar-source-00000000000000000000000000000017";
  const fingerprint = `sha256:${"b".repeat(64)}`;
  let request;
  let ledgerReads = 0;
  await sync.deleteCalendarOccurrences(ids, undefined, {
    roots: { runtime: {}, dataRoot: {} }, expectedSnapshotId: "snapshot-1", sourceId, expectedSourceFingerprint: fingerprint, evidenceId,
    readLedger: async () => { ledgerReads += 1; return ledger(); },
    callCore: async (value) => {
      request = value;
      return { ok: true, operation: "delete", action: "delete_batch", request_id: value.request_id, source_id: sourceId,
        source_fingerprint: fingerprint, target_ids: ids, tombstone_revisions: ids.map((target_id, index) => ({ target_id, tombstone_revision: index + 1 })),
        external_send: false, snapshot: { education_workspace: { calendar: [] } } };
    },
  });
  assert.deepEqual(request.target_ids, ids);
  assert.equal(request.snapshot_id, "snapshot-1");
  assert.equal(request.source_id, sourceId);
  assert.equal(request.note, deletionNote(sourceId));
  assert.equal(ledgerReads, 0, "no read may invalidate the guarded composite snapshot before the batch mutation");
  let calls = 0;
  await assert.rejects(sync.deleteCalendarOccurrences(ids, undefined, {
    roots: { runtime: {}, dataRoot: {} }, expectedSnapshotId: "snapshot-1", sourceId, expectedSourceFingerprint: fingerprint, evidenceId,
    callCore: async () => { calls += 1; return { ok: false, code: "stale_snapshot" }; },
  }), (error) => error?.code === "stale_calendar_source");
  assert.equal(calls, 1);
});
