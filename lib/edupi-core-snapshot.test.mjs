import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { readFile } from "node:fs/promises";

const jiti = createJiti(import.meta.url);
const {
  isEduPiAbsolutePath,
  readEduPiEducationSnapshot,
  resolveEduPiBridgeRoots,
  validateScheduleOccurrenceV12Envelope,
  validateScheduleOccurrenceV12Projection,
} = await jiti.import("./edupi-core-snapshot.ts");
const { activeBridgeIdentity, scheduleOccurrenceIdentity } = await jiti.import("./edupi-bridge-manifest.ts");
const { resolveEduPiCoreRoot, resolveEduPiDataRoot } = await jiti.import("./edupi-core-root.ts");
const coreRoot = process.env.EDUPI_CORE_ROOT;
const dataRoot = process.env.EDUPI_DATA_ROOT;

test("recognizes POSIX and Windows absolute roots without accepting relative paths", () => {
  assert.equal(isEduPiAbsolutePath("/Users/teacher/edupi"), true);
  assert.equal(isEduPiAbsolutePath("C:\\Users\\teacher\\edupi"), true);
  assert.equal(isEduPiAbsolutePath("\\\\server\\share\\edupi"), true);
  assert.equal(isEduPiAbsolutePath("edupi"), false);
  assert.equal(isEduPiAbsolutePath("./edupi"), false);
});

test("keeps v1.1 active while validating the opt-in v1.2 occurrence projection", () => {
  const legacy = activeBridgeIdentity();
  const occurrence = scheduleOccurrenceIdentity();
  assert.equal(legacy.contract.contract_version, "1.1");
  assert.equal(occurrence.contract_version, "1.2");
  const projection = {
    contract_version: "1.2",
    schema_hash: occurrence.schema_hash,
    snapshot_id: "snapshot-occurrence-test",
    events: [],
    external_send: false,
  };
  assert.equal(validateScheduleOccurrenceV12Envelope(projection), true);
  assert.equal(validateScheduleOccurrenceV12Projection(projection, projection.snapshot_id), true);
  assert.equal(validateScheduleOccurrenceV12Projection({ ...projection, snapshot_id: "snapshot-other" }, projection.snapshot_id), false);
  assert.equal(validateScheduleOccurrenceV12Projection({ ...projection, schema_hash: `sha256:${"0".repeat(64)}` }, projection.snapshot_id), false);
  assert.equal(validateScheduleOccurrenceV12Projection({ ...projection, external_send: true }, projection.snapshot_id), false);
  assert.equal(validateScheduleOccurrenceV12Envelope({ ...projection, unexpected: true }), false);
  const source = { source_id: "desktop-calendar", source_kind: "teacher_message", source_hash: `sha256:${"a".repeat(64)}`, evidence_ids: ["manual-event"] };
  const command = {
    contract_version: "1.2",
    message_id: "occurrence-message",
    request_id: "occurrence-request",
    issued_at: "2026-09-23T08:00:00.000Z",
    producer: "edupi-desktop",
    schema_hash: occurrence.schema_hash,
    snapshot_id: projection.snapshot_id,
    idempotency_key: "occurrence-idempotency",
    provenance: [{ source_kind: source.source_kind, source_id: source.source_id, source_path: null, source_hash: source.source_hash,
      observed_at: "2026-09-23T08:00:00.000Z", actor: "teacher", evidence_ids: source.evidence_ids, parent_ids: [] }],
    teacher_review: { state: "pending_review", reviewer_id: null, reviewed_at: null, note: null, revision: 0 },
    external_send: false,
    command: { command_type: "import_calendar", source, events: [{ event_id: "meeting-42", date: "2026-10-01", end_date: null,
      name: "教研会", type: "meeting", confidence: "teacher_confirmed", notes: null, source_occurrence_ref: "meeting-42",
      time_interval: { start: "2026-10-01T09:00+08:00", end: "2026-10-01T10:00+08:00", time_zone: "Asia/Shanghai" }, location: "东楼 203" }] },
  };
  assert.equal(validateScheduleOccurrenceV12Envelope(command), true);
  assert.equal(validateScheduleOccurrenceV12Envelope({ ...command, command: { ...command.command,
    events: [{ ...command.command.events[0], time_interval: { ...command.command.events[0].time_interval, extra: true } }] } }), false);
});

test("consumes the pinned Core education_workspace snapshot from the separate data root", { skip: !coreRoot || !dataRoot }, async () => {
  const result = await readEduPiEducationSnapshot({ requestId: "snapshot-consumer-test" });
  assert.equal(result.runtime.root, coreRoot && await import("node:fs").then(({ realpathSync }) => realpathSync(coreRoot)));
  assert.equal(result.dataRoot.root, dataRoot && await import("node:fs").then(({ realpathSync }) => realpathSync(dataRoot)));
  assert.equal(result.workspace.projection_kind, "education_workspace");
  assert.equal(result.workspace.projection_version, "1.1");
  assert.ok(result.workspace.students.length > 0);
  assert.ok(result.workspace.calendar.length > 0);
  assert.ok(result.workspace.tasks.length > 0);
  assert.deepEqual(result.payload.capabilities.supported_commands, ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"]);
  assert.deepEqual(result.payload.capabilities.supported_projections, ["education_workspace"]);
  assert.equal(result.occurrenceProjection, null, "the default v1.1 snapshot remains frozen");
  const occurrence = await readEduPiEducationSnapshot({ requestId: "snapshot-occurrence-consumer-test", scheduleOccurrenceVersion: "1.2" });
  assert.equal(occurrence.envelope.contract_version, "1.1");
  assert.equal(occurrence.occurrenceProjection?.snapshot_id, occurrence.payload.snapshot_id);
  assert.equal(occurrence.occurrenceProjection?.schema_hash, scheduleOccurrenceIdentity().schema_hash);
  assert.equal(occurrence.occurrenceProjection?.external_send, false);
});

test("reads a real paired Core occurrence projection only when requested", { skip: !coreRoot }, async () => {
  const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-desktop-occurrence-snapshot-")));
  try {
    for (const directory of ["memory", "output", "locks"]) fs.mkdirSync(path.join(temporaryRoot, ".edupi", directory), { recursive: true });
    const identity = activeBridgeIdentity();
    const roots = {
      runtime: resolveEduPiCoreRoot({ configuredRoot: coreRoot, allowedRoot: path.dirname(coreRoot), runtimeIdentity: identity.runtime }),
      dataRoot: resolveEduPiDataRoot({ configuredRoot: temporaryRoot, allowedRoot: path.dirname(temporaryRoot) }),
    };
    const defaultRead = await readEduPiEducationSnapshot({ requestId: "snapshot-default-real", roots });
    assert.equal(defaultRead.envelope.contract_version, "1.1");
    assert.equal(defaultRead.occurrenceProjection, null);
    const occurrenceRead = await readEduPiEducationSnapshot({ requestId: "snapshot-occurrence-real", roots, scheduleOccurrenceVersion: "1.2" });
    assert.equal(occurrenceRead.envelope.contract_version, "1.1");
    assert.equal(occurrenceRead.occurrenceProjection.snapshot_id, occurrenceRead.payload.snapshot_id);
    assert.equal(occurrenceRead.occurrenceProjection.schema_hash, scheduleOccurrenceIdentity().schema_hash);
    assert.equal(occurrenceRead.occurrenceProjection.external_send, false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("requires both explicit roots", () => {
  const previousCore = process.env.EDUPI_CORE_ROOT;
  const previousData = process.env.EDUPI_DATA_ROOT;
  delete process.env.EDUPI_CORE_ROOT;
  delete process.env.EDUPI_DATA_ROOT;
  try {
    assert.throws(() => resolveEduPiBridgeRoots(), /EDUPI_CORE_ROOT|absolute/i);
  } finally {
    if (previousCore === undefined) delete process.env.EDUPI_CORE_ROOT;
    else process.env.EDUPI_CORE_ROOT = previousCore;
    if (previousData === undefined) delete process.env.EDUPI_DATA_ROOT;
    else process.env.EDUPI_DATA_ROOT = previousData;
  }
});

test("health requires every platform projection operation", async () => {
  const source = await readFile(new URL("./edupi-core-snapshot.ts", import.meta.url), "utf8");
  assert.match(source, /CORE_OPERATIONS = \["health", "snapshot", "workspace-resources", "generated-artifacts", "command", "students", "teaching-priorities", "material-metadata", "education-facts", "delete", "kernel", "memory-scopes", "teaching-skills", "connectors", "agent-computer", "platform", "connector-setup"\]/);
  assert.match(source, /sameCapabilityList\(health\.supported_operations, CORE_OPERATIONS\)/);
});
