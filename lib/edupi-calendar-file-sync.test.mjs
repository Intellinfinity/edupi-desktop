import assert from "node:assert/strict";
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

function sourceRead(sources) {
  return { sources, snapshot: { payload: { snapshot_id: "snapshot-1", education_workspace: {} }, roots: { runtime: {}, dataRoot: {} } } };
}

function ledger(deletions = []) {
  return { snapshotId: "snapshot-1", deletions, history: [] };
}

function acceptedIssue(commands) {
  return async (command) => { commands.push(structuredClone(command)); return { receipt: { status: "accepted" }, data: {} }; };
}

const evidenceId = `calendar-evidence-${"a".repeat(32)}`;

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
  assert.match(request.note, new RegExp(evidenceId));
  assert.equal(ledgerReads, 0, "no read may invalidate the guarded composite snapshot before the batch mutation");
  let calls = 0;
  await assert.rejects(sync.deleteCalendarOccurrences(ids, undefined, {
    roots: { runtime: {}, dataRoot: {} }, expectedSnapshotId: "snapshot-1", sourceId, expectedSourceFingerprint: fingerprint, evidenceId,
    callCore: async () => { calls += 1; return { ok: false, code: "stale_snapshot" }; },
  }), (error) => error?.code === "stale_calendar_source");
  assert.equal(calls, 1);
});
