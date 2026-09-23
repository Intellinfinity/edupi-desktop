#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const coreRoot = process.env.EDUPI_CORE_ROOT;
if (!coreRoot || !path.isAbsolute(coreRoot)) throw new Error("EDUPI_CORE_ROOT must be an absolute Core checkout");
const desktopRoot = path.resolve(new URL("..", import.meta.url).pathname);
const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts/edupi-core-compat.json"), "utf8"));
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-slot-alias-e2-")));
const dataRoot = path.join(temporaryRoot, "data");
const home = path.join(dataRoot, ".edupi");
const stateDir = path.join(temporaryRoot, "desktop-state");
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
  EDUPI_CORE_ROOT: fs.realpathSync(coreRoot),
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(fs.realpathSync(coreRoot)),
  EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: path.join(home, "memory"),
  EDUPI_OUTPUT_DIR: path.join(home, "output"),
  EDUPI_LOCK_DIR: path.join(home, "locks"),
  EDUPI_CORE_COMMIT: compat.core_runtime.core_commit,
  PI_DESKTOP_STATE_DIR: stateDir,
});

try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const { stageMaterialInputs } = await jiti.import("../lib/edupi-material-staging.ts");
  const { syncDocumentScheduleFile } = await jiti.import("../lib/edupi-document-schedule-sync.ts");
  const { intakeRecognizedMaterial } = await jiti.import("../lib/edupi-material-intake-flow.ts");
  const { readCoreCalendarSources } = await jiti.import("../lib/edupi-calendar-sources.ts");
  const { issueEntityDelete } = await jiti.import("../lib/edupi-entity-delete.ts");
  const { projectTimetableSourceOptions } = await jiti.import("../lib/edupi-timetable-source-alias.ts");

  const slot = { slot_id: "model-slot", day_of_week: 1, period: 2, subject: "数学",
    class_name: "七年级二班", kind: "class", notes: null };
  const recognized = { events: [], slots: [slot] };
  function stage(name, marker) {
    return stageMaterialInputs([{ name, mimeType: "application/pdf",
      bytes: new Uint8Array(Buffer.from(`%PDF-1.4\n${marker}\n%%EOF\n`, "utf8")) }])[0];
  }
  async function sync(descriptor, dependencies = {}) {
    return syncDocumentScheduleFile({ descriptor, title: descriptor.original_name, materialKind: "other",
      subject: "数学", classId: "七年级二班", requestedSourceId: null, expectedSourceFingerprint: null },
    { recognize: async () => recognized, ...dependencies });
  }

  const firstDescriptor = stage("旧版课表.pdf", "first version");
  const first = await sync(firstDescriptor);
  assert.equal(first.committed, true);
  assert.match(first.sourceId, /^document-source-[a-f0-9]{32}$/u);
  const firstEvidenceId = `schedule-evidence-${firstDescriptor.source_hash.slice(7, 39)}`;
  let read = await readCoreCalendarSources();
  let row = read.snapshot.payload.education_workspace.timetable.find((item) => item.subject === "数学");
  assert.deepEqual(row.source_ids, [first.sourceId]);
  assert.deepEqual(row.evidence_ids, [firstEvidenceId]);

  const secondDescriptor = stage("修订课表.pdf", "second version");
  const secondEvidenceId = `schedule-evidence-${secondDescriptor.source_hash.slice(7, 39)}`;
  const rebound = await intakeRecognizedMaterial({ descriptor: secondDescriptor, scheduleSourceId: first.sourceId,
    materialKind: "other", subject: "数学", classId: "七年级二班" }, { recognize: async () => recognized });
  assert.equal(rebound.scheduleNeedsReview, false);
  assert.equal(rebound.receipts.every((receipt) => receipt.status === "accepted"), true);
  read = await readCoreCalendarSources();
  row = read.snapshot.payload.education_workspace.timetable.find((item) => item.subject === "数学");
  assert.deepEqual(row.source_ids, [first.sourceId]);
  assert.equal(row.evidence_ids.includes(firstEvidenceId), true);
  assert.equal(row.evidence_ids.includes(secondEvidenceId), true);
  const replay = await sync(secondDescriptor);
  assert.equal(replay.sourceId, first.sourceId);
  assert.equal(replay.committed, true);

  const thirdDescriptor = stage("增量课表.pdf", "third version");
  const newSlot = { ...slot, slot_id: "new-model-slot", day_of_week: 3, period: 4, subject: "科学" };
  const expanded = { events: [], slots: [slot, newSlot] };
  const currentOption = projectTimetableSourceOptions(await readCoreCalendarSources())
    .find((option) => option.sourceId === first.sourceId);
  assert.ok(currentOption);
  const explicit = await syncDocumentScheduleFile({ descriptor: thirdDescriptor, title: thirdDescriptor.original_name,
    materialKind: "other", subject: "数学", classId: "七年级二班", requestedSourceId: first.sourceId,
    expectedSourceFingerprint: currentOption.fingerprint }, { recognize: async () => expanded });
  assert.equal(explicit.committed, true);
  assert.equal(explicit.sourceId, first.sourceId);
  const expandedReplay = await sync(thirdDescriptor, { recognize: async () => expanded });
  assert.equal(expandedReplay.committed, true);
  assert.equal(expandedReplay.sourceId, first.sourceId);
  assert.equal((await readCoreCalendarSources()).snapshot.payload.education_workspace.timetable.length, 2);

  const removed = await issueEntityDelete({ kind: "material", id: `material-${firstDescriptor.staging_id.slice(4)}`,
    note: "隔离验收：删除旧版材料" });
  assert.equal(removed.target.kind, "material");
  read = await readCoreCalendarSources();
  row = read.snapshot.payload.education_workspace.timetable.find((item) => item.subject === "数学");
  assert.ok(row, "the new material's identical evidence must keep the canonical slot visible");
  assert.equal(read.snapshot.payload.education_workspace.timetable.length, 2);
  assert.equal((await sync(secondDescriptor)).sourceId, first.sourceId);
  await assert.rejects(sync(firstDescriptor), (error) => error?.code === "calendar_source_selection_required");
  const reread = await readCoreCalendarSources();
  assert.equal(reread.snapshot.payload.education_workspace.timetable.length, 2);
  const staleRead = await readCoreCalendarSources();
  await assert.rejects(sync(secondDescriptor, { readSources: async () => {
    await issueEntityDelete({ kind: "timetable", id: row.slot_id, note: "隔离验收：制造快照竞争" });
    return staleRead;
  } }), (error) => error?.code === "stale_snapshot",
  "a deleted slot between alias proof and intake must reject the old Core snapshot before writing");
  assert.equal((await readCoreCalendarSources()).snapshot.payload.education_workspace.timetable
    .some((item) => item.slot_id === row.slot_id), false);
  console.log(JSON.stringify({ status: "passed", core_commit: compat.core_runtime.core_commit,
    logical_source: first.sourceId, canonical_slots: 2, incremental_selected_and_replayed: true, old_material_deleted: true,
    new_material_visible: true, stale_old_replay_rejected: true, concurrent_delete_rejected: true, external_send: false,
    artifacts: process.env.EDUPI_E2_KEEP === "1" ? temporaryRoot : null }));
} finally {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (process.env.EDUPI_E2_KEEP !== "1") fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
