#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const coreRoot = process.env.EDUPI_CORE_ROOT;
if (typeof coreRoot !== "string" || !path.isAbsolute(coreRoot)) throw new Error("EDUPI_CORE_ROOT must be an absolute Core checkout");
const dataRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-calendar-dedupe-e2-")));
const home = path.join(dataRoot, ".edupi");
const memoryDir = path.join(home, "memory");
const outputDir = path.join(home, "output");
const lockDir = path.join(home, "locks");
for (const directory of [memoryDir, outputDir, lockDir]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const previous = new Map(["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT", "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT"].map(key => [key, process.env[key]]));
Object.assign(process.env, {
  EDUPI_PROJECT_ROOT: dataRoot,
  EDUPI_DATA_ROOT: dataRoot,
  EDUPI_DATA_ALLOWED_ROOT: path.dirname(dataRoot),
  EDUPI_CORE_ROOT: path.resolve(coreRoot),
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(path.resolve(coreRoot)),
  EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: memoryDir,
  EDUPI_OUTPUT_DIR: outputDir,
  EDUPI_LOCK_DIR: lockDir,
  EDUPI_CORE_COMMIT: "368bcd8b6fbe04d78860c96c37f27bec312c8e4c",
});

try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const snapshot = await jiti.import("../lib/edupi-core-snapshot.ts");
  const intake = await jiti.import("../lib/edupi-education-intake.ts");
  const route = await jiti.import("../app/api/edupi/intake/route.ts");
  const events = [
    { event_id: route.stableCalendarEventId({ date: "2026-10-01", endDate: null, name: " 秋季运动会 ", type: "activity" }), date: "2026-10-01", end_date: null, name: "秋季 运动会", type: "activity", confidence: "teacher_confirmed", notes: null },
    { event_id: route.stableCalendarEventId({ date: "日期待确认", endDate: null, name: "家长会", type: "meeting" }), date: "日期待确认", end_date: null, name: "家长会", type: "meeting", confidence: "inferred", notes: "原通知日期未确认" },
  ];
  const source = { source_id: "desktop-calendar-upload-dedupe", source_kind: "teacher_file", source_hash: route.stableScheduleSourceHash("calendar", events), evidence_ids: ["calendar-upload-dedupe-evidence"] };
  const first = await snapshot.readEduPiEducationSnapshot({ requestId: "calendar-dedupe-before" });
  const firstResult = await intake.issueEducationIntake({ command_type: "import_calendar", source, events });
  assert.ok(["accepted", "modified", "held"].includes(firstResult.receipt.status));
  const afterFirst = await snapshot.readEduPiEducationSnapshot({ requestId: "calendar-dedupe-after-first" });
  const secondSource = { ...source, source_id: "desktop-calendar-upload-dedupe-retry" };
  const secondResult = await intake.issueEducationIntake({ command_type: "import_calendar", source: secondSource, events: [...events].reverse() });
  const afterSecond = await snapshot.readEduPiEducationSnapshot({ requestId: "calendar-dedupe-after-second" });
  assert.equal(first.payload.education_workspace.calendar.length, 0);
  assert.equal(afterFirst.payload.education_workspace.calendar.length, 2);
  assert.equal(afterSecond.payload.education_workspace.calendar.length, 2);
  assert.equal(afterSecond.payload.education_workspace.calendar.filter(item => item.date_status === "invalid").length, 1);
  assert.ok(["accepted", "modified", "held"].includes(secondResult.receipt.status));
  assert.equal(afterSecond.payload.education_workspace.calendar.map(item => item.event_id).sort().join("|"), events.map(item => item.event_id).sort().join("|"));
  console.log(JSON.stringify({ status: "passed", initial_count: 0, after_first_count: 2, after_replay_count: 2, stable_event_ids: true, unresolved_date_held: true, external_send: false }, null, 2));
} finally {
  fs.rmSync(dataRoot, { recursive: true, force: true });
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
