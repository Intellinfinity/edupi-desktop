import assert from "node:assert/strict";
import test from "node:test";
import {
  ENTITY_DELETE_KINDS,
  EntityDeleteError,
  buildEntityDeleteRequest,
  buildEntityDeletionListRequest,
  buildEntityRestoreRequest,
  issueEntityDelete,
  issueEntityRestore,
  parseEntityDeletionSummary,
  readEntityDeletionLedger,
} from "./edupi-entity-delete.ts";

const workspace = {
  calendar: [{ event_id: "calendar-1", name: "开学" }],
  timetable: [{ slot_id: "slot-1", subject: "数学" }],
  students: [{ name: "李四" }],
  continuity: { memories: [{ memory_id: "memory-1", content: "偏好" }] },
  tasks: [{ task_id: "task-1", title: "准备第一课" }],
};

test("student deletion checks the exact ID when another namesake remains", async () => {
  const namesakes={...workspace,students:[{student_id:"a",name:"张三"},{student_id:"b",name:"张三"}]};
  const dependencies={readSnapshot:async()=>({envelope:{snapshot_id:"snapshot-1"},payload:{education_workspace:namesakes}}),callCore:async request=>({ok:true,operation:"delete",request_id:request.request_id,target:{kind:"student",id:"b"},external_send:false,snapshot:{education_workspace:{...namesakes,students:[namesakes.students[0]]}}})};
  assert.equal((await issueEntityDelete({kind:"student",id:"b",note:null},dependencies)).data.education_workspace.students.length,1);
  await assert.rejects(()=>issueEntityDelete({kind:"student",id:"b",note:null},{...dependencies,callCore:async request=>({...await dependencies.callCore(request),snapshot:{education_workspace:namesakes}})}),error=>error.code==="invalid_response");
});

test("entity deletion request is bounded to the six Core-owned target kinds", () => {
  assert.deepEqual(ENTITY_DELETE_KINDS, ["calendar", "timetable", "memory", "student", "task", "material"]);
  assert.deepEqual(buildEntityDeleteRequest({ kind: "calendar", id: "calendar-1", snapshotId: "snapshot-1", note: null }, "request-1"), {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation: "delete",
    request_id: "request-1",
    action: "delete",
    target_kind: "calendar",
    target_id: "calendar-1",
    snapshot_id: "snapshot-1",
    reviewer: "teacher",
    note: null,
  });
  assert.throws(() => buildEntityDeleteRequest({ kind: "unknown", id: "x", snapshotId: "snapshot-1", note: null }, "request-1"), EntityDeleteError);
});

test("entity deletion accepts only a Core response whose refreshed snapshot no longer contains the target", async () => {
  const result = await issueEntityDelete({ kind: "student", id: "李四", note: null }, {
    readSnapshot: async () => ({ envelope: { snapshot_id: "snapshot-1" }, payload: { education_workspace: workspace }, roots: { runtime: {}, dataRoot: {} } }),
    callCore: async (request) => ({
      ok: true,
      operation: "delete",
      request_id: request.request_id,
      target: { kind: "student", id: "李四" },
      external_send: false,
      snapshot: { education_workspace: { ...workspace, students: [] } },
    }),
  });
  assert.equal(result.target.kind, "student");
  assert.equal(result.data.education_workspace.students.length, 0);

  await assert.rejects(() => issueEntityDelete({ kind: "calendar", id: "calendar-1", note: null }, {
    readSnapshot: async () => ({ envelope: { snapshot_id: "snapshot-1" }, payload: { education_workspace: workspace }, roots: { runtime: {}, dataRoot: {} } }),
    callCore: async (request) => ({ ok: true, operation: "delete", request_id: request.request_id, target: { kind: "calendar", id: "calendar-1" }, external_send: false, snapshot: { education_workspace: workspace } }),
  }), (error) => error instanceof EntityDeleteError && error.code === "invalid_response");
});

test("entity deletion maps stale Core snapshots to a retryable conflict", async () => {
  await assert.rejects(() => issueEntityDelete({ kind: "task", id: "task-1", note: null }, {
    readSnapshot: async () => ({ envelope: { snapshot_id: "snapshot-1" }, payload: { education_workspace: workspace }, roots: { runtime: {}, dataRoot: {} } }),
    callCore: async () => ({ ok: false, operation: "delete", request_id: "request", code: "stale_snapshot" }),
  }), (error) => error instanceof EntityDeleteError && error.code === "stale_snapshot");
});

test("entity deletion lets Core reconcile a retry whose target is already absent", async () => {
  const withoutTask = { ...workspace, tasks: [] };
  const result = await issueEntityDelete({ kind: "task", id: "task-1", note: null }, {
    readSnapshot: async () => ({ envelope: { snapshot_id: "snapshot-after-delete" }, payload: { education_workspace: withoutTask }, roots: { runtime: {}, dataRoot: {} } }),
    callCore: async (request) => ({ ok: true, operation: "delete", request_id: request.request_id, target: { kind: "task", id: "task-1" }, external_send: false, replayed: true, snapshot: { education_workspace: withoutTask } }),
  });
  assert.equal(result.target.id, "task-1");
});

const deletionRecord = {
  kind: "student",
  id: "student-1",
  label: "李四",
  studentId: "student-1",
  reviewTargetId: null,
  targetFingerprint: `sha256:${"a".repeat(64)}`,
  tombstoneRevision: 2,
  deletedAt: "2026-09-14T01:00:00.000Z",
  reviewer: "teacher",
  note: null,
};

test("deletion ledger accepts only bounded Core-owned tombstones and history", async () => {
  assert.deepEqual(parseEntityDeletionSummary({ entityDeletionSummary: { active_count: 2, history_count: 4 } }), { activeCount: 2, historyCount: 4 });
  assert.throws(() => parseEntityDeletionSummary({ entityDeletionSummary: { active_count: 501, history_count: 4 } }), EntityDeleteError);
  const roots = { runtime: {}, dataRoot: {} };
  const ledger = await readEntityDeletionLedger({}, {
    roots,
    callCore: async (request) => ({
      ok: true,
      operation: "delete",
      action: "list",
      request_id: request.request_id,
      snapshot_id: "snapshot-deleted",
      external_send: false,
      deletions: [{ target: { kind: "student", id: "student-1" }, label: "李四", student_id: "student-1", target_fingerprint: deletionRecord.targetFingerprint, tombstone_revision: 2, deleted_at: deletionRecord.deletedAt, reviewer: "teacher", note: null }],
      history: [{ mutation_id: "history-1", request_id: "delete-1", action: "delete", target_kind: "student", target_id: "student-1", target_label: "李四", target_fingerprint: deletionRecord.targetFingerprint, tombstone_revision: 2, before_snapshot_id: "snapshot-before", after_snapshot_id: "snapshot-deleted", before_state_hash: `sha256:${"b".repeat(64)}`, after_state_hash: `sha256:${"c".repeat(64)}`, occurred_at: deletionRecord.deletedAt, reviewer: "teacher", note: null, evidence_quality: "bound", external_send: false }],
    }),
  });
  assert.deepEqual(ledger.deletions, [deletionRecord]);
  assert.equal(ledger.history[0].targetLabel, "李四");
  await assert.rejects(() => readEntityDeletionLedger({}, { roots, callCore: async (request) => ({ ok: true, operation: "delete", action: "list", request_id: request.request_id, snapshot_id: "snapshot-deleted", external_send: false, deletions: [{ target: { kind: "unknown", id: "x" } }], history: [] }) }), (error) => error.code === "invalid_response");
});

test("restore request is built only from a Core tombstone", () => {
  assert.deepEqual(buildEntityDeletionListRequest("list-1"), { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "delete", request_id: "list-1", action: "list" });
  assert.deepEqual(buildEntityRestoreRequest({ record: deletionRecord, snapshotId: "snapshot-deleted", note: null }, "restore-1"), {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation: "delete",
    request_id: "restore-1",
    action: "restore",
    target_kind: "student",
    target_id: "student-1",
    snapshot_id: "snapshot-deleted",
    expected_tombstone_revision: 2,
    expected_target_fingerprint: deletionRecord.targetFingerprint,
    reviewer: "teacher",
    note: null,
  });
});

test("entity restore re-reads the Core ledger and requires the object in the refreshed projection", async () => {
  const roots = { runtime: {}, dataRoot: {} };
  const restoredWorkspace = { ...workspace, students: [{ student_id: "student-1", name: "李四" }] };
  const result = await issueEntityRestore({ kind: "student", id: "student-1", note: null }, {
    roots,
    readLedger: async () => ({ snapshotId: "snapshot-deleted", deletions: [deletionRecord], history: [] }),
    callCore: async (request) => ({ ok: true, operation: "delete", action: "restore", request_id: request.request_id, target: { kind: "student", id: "student-1" }, tombstone_revision: 2, target_fingerprint: deletionRecord.targetFingerprint, restored_at: "2026-09-14T02:00:00.000Z", external_send: false, snapshot: { education_workspace: restoredWorkspace } }),
  });
  assert.equal(result.target.id, "student-1");
  assert.equal(result.restoredAt, "2026-09-14T02:00:00.000Z");
  await assert.rejects(() => issueEntityRestore({ kind: "student", id: "student-1", note: null }, {
    roots,
    readLedger: async () => ({ snapshotId: "snapshot-deleted", deletions: [deletionRecord], history: [] }),
    callCore: async (request) => ({ ok: true, operation: "delete", action: "restore", request_id: request.request_id, target: { kind: "student", id: "student-1" }, tombstone_revision: 2, target_fingerprint: deletionRecord.targetFingerprint, external_send: false, snapshot: { education_workspace: { ...workspace, students: [] } } }),
  }), (error) => error.code === "invalid_response");
});
