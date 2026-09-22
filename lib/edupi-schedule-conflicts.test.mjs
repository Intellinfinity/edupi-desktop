import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const conflicts = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-schedule-conflicts.ts");
const conflict = {
  conflict_id: `schedule_conflict_${"a".repeat(32)}`,
  kind: "calendar",
  canonical_id: "school-open-day",
  expected_revision: 2,
  expected_content_hash: `sha256:${"b".repeat(64)}`,
  expected_conflict_hash: `sha256:${"c".repeat(64)}`,
  canonical: { event_id: "school-open-day", date: "2026-10-12", end_date: null, name: "学校开放日", type: "activity", confidence: "confirmed", notes: "旧日期", source_ids: ["notice-v1"], evidence_ids: ["evidence-v1"] },
  candidate: { source_item_id: "school-open-day-v2", date: "2026-10-13", end_date: null, name: "学校开放日", type: "activity", confidence: "teacher_confirmed", notes: "修订日期", source_ids: ["notice-v2"], evidence_ids: ["evidence-v2"] },
  external_send: false,
};
const headers = async () => new Headers({ "x-pi-desktop-token": "test-desktop-token" });

test("reads only complete owner-bound current conflicts without bootstrapping silently", async () => {
  const requests = [];
  const result = await conflicts.readScheduleConflicts(async (_url, init) => {
    requests.push(init);
    return new Response(JSON.stringify({ ok: true, result: { conflicts: [conflict], next_cursor: null, external_send: false } }));
  }, headers);
  assert.equal(result.conflicts[0].conflictId, conflict.conflict_id);
  assert.equal(result.conflicts[0].candidate.notes, "修订日期");
  assert.deepEqual(requests.map((item) => item.method), ["GET"]);
  assert.equal(new Headers(requests[0].headers).get("x-pi-desktop-token"), "test-desktop-token");
  await assert.rejects(() => conflicts.readScheduleConflicts(async () => new Response(JSON.stringify({ ok: false, errorCode: "owner_uninitialized" }), { status: 409 }), headers), (error) => error?.code === "owner_uninitialized");
  await assert.rejects(() => conflicts.readScheduleConflicts(async () => new Response(JSON.stringify({ ok: true, result: { conflicts: [{ ...conflict, expected_content_hash: "wrong" }], next_cursor: null, external_send: false } })), headers), (error) => error?.code === "invalid_conflict_response");
  const unicode = { ...conflict, canonical_id: "校历-开放日", canonical: { ...conflict.canonical, event_id: "校历-开放日", source_ids: ["学校通知-一"] },
    candidate: { ...conflict.candidate, source_item_id: "校历-更正", evidence_ids: ["新日期-通知"] } };
  assert.equal(conflicts.normalizeScheduleConflict(unicode).canonicalId, "校历-开放日");
});

test("a conflict decision retains exact command bytes across response loss", async () => {
  const captured = conflicts.captureScheduleDecision(conflicts.normalizeScheduleConflict(conflict), "replace_with_candidate", "desktop-conflict-command-1");
  const bodies = [];
  const fetcher = async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)));
    return bodies.length === 1
      ? new Response(JSON.stringify({ ok: false, errorCode: "schedule_conflict_unavailable" }), { status: 503 })
      : new Response(JSON.stringify({ ok: true, result: { resolution_id: `schedule_resolution_${"d".repeat(32)}`, command_id: captured.commandId, conflict_id: captured.conflictId, kind: captured.kind, canonical_id: captured.canonicalId, owner_id: "owner-test", decision: captured.decision, before_revision: 2, after_revision: 3, before_content_hash: captured.expectedContentHash, after_content_hash: `sha256:${"e".repeat(64)}`, resolved_at: "2026-09-22T08:00:00.000Z", external_send: false, replayed: true } }));
  };
  await assert.rejects(() => conflicts.resolveScheduleConflict(captured, fetcher, headers));
  assert.equal((await conflicts.resolveScheduleConflict(captured, fetcher, headers)).replayed, true);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(Object.keys(bodies[0]).sort(), ["action", "canonicalId", "commandId", "conflictId", "decision", "expectedConflictHash", "expectedContentHash", "expectedRevision", "kind"].sort());
});

test("refuses stale and unrelated Core receipts", async () => {
  const captured = conflicts.captureScheduleDecision(conflicts.normalizeScheduleConflict(conflict), "keep_existing", "desktop-conflict-command-2");
  await assert.rejects(() => conflicts.resolveScheduleConflict(captured, async () => new Response(JSON.stringify({ ok: false, errorCode: "schedule_conflict_stale" }), { status: 409 }), headers), (error) => error?.code === "schedule_conflict_stale");
  await assert.rejects(() => conflicts.resolveScheduleConflict(captured,
    async () => new Response(JSON.stringify({ ok: true, result: { command_id: "another-command", replayed: false, external_send: false } })), headers),
  (error) => error?.code === "invalid_conflict_response");
  await assert.rejects(() => conflicts.resolveScheduleConflict(captured,
    async () => new Response(JSON.stringify({ ok: true, result: { resolution_id: `sha256:${"d".repeat(64)}`, command_id: captured.commandId, conflict_id: captured.conflictId, kind: captured.kind, canonical_id: captured.canonicalId, decision: captured.decision, before_revision: 2, after_revision: 3, before_content_hash: captured.expectedContentHash, after_content_hash: `sha256:${"e".repeat(64)}`, replayed: false, external_send: false } })), headers),
  (error) => error?.code === "invalid_conflict_response");
});
