#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const coreRoot = process.env.EDUPI_CORE_ROOT;
assert.ok(typeof coreRoot === "string" && path.isAbsolute(coreRoot), "EDUPI_CORE_ROOT must name the pinned Core checkout");
const compat = JSON.parse(fs.readFileSync(new URL("../contracts/edupi-core-compat.json", import.meta.url), "utf8"));
const coreCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: coreRoot, encoding: "utf8" }).trim();
assert.equal(coreCommit, compat.core_runtime.core_commit);
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-calendar-tool-e2-")));
const dataRoot = path.join(temp, "synthetic-teacher-data");
const edupiHome = path.join(dataRoot, ".edupi");
for (const directory of [edupiHome, path.join(edupiHome, "memory"), path.join(edupiHome, "output"), path.join(edupiHome, "locks"), path.join(temp, "agent"), path.join(temp, "desktop-state")]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
Object.assign(process.env, {
  EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot), EDUPI_CORE_COMMIT: coreCommit,
  EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: temp, EDUPI_PROJECT_ROOT: dataRoot,
  EDUPI_HOME: edupiHome, EDUPI_MEMORY_DIR: path.join(edupiHome, "memory"), EDUPI_OUTPUT_DIR: path.join(edupiHome, "output"), EDUPI_LOCK_DIR: path.join(edupiHome, "locks"),
  PI_CODING_AGENT_DIR: path.join(temp, "agent"), PI_DESKTOP_STATE_DIR: path.join(temp, "desktop-state"),
});
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createEduPiCalendarTools } = await jiti.import("../lib/edupi-calendar-tool.ts");
const { issueEducationIntake } = await jiti.import("../lib/edupi-education-intake.ts");
const { readEduPiEducationSnapshot } = await jiti.import("../lib/edupi-core-snapshot.ts");
const { closeAllEduPiRuntimes, ensureEduPiRuntime } = await jiti.import("../lib/edupi-runtime-supervisor.ts");
const { prepareCoreRuntimeRoot } = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_root.mjs")).href);
const { acquireCoreRuntimeWriterAdmission } = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_writer_admission.mjs")).href);
const { GET } = await jiti.import("../app/api/edupi/education/route.ts");
const ctx = { cwd: dataRoot, sessionManager: { getSessionId: () => "synthetic-calendar-session", getBranch: () => [{ type: "message", id: "synthetic-teacher-message", message: { role: "user", content: "隔离日程验收" } }] } };
const [add, importCalendar] = createEduPiCalendarTools({ projectRoot: dataRoot, issue: issueEducationIntake });
const first = { date: "2026-10-10", name: "合成会议", type: "meeting" };
let writerAdmission;

try {
  const before = await readEduPiEducationSnapshot();
  assert.equal(before.payload.education_workspace.calendar.length, 0);
  const legacyTools = new Map();
  const legacy = await jiti.import(path.join(coreRoot, "extensions/calendar.ts"));
  legacy.default({ registerTool: tool => legacyTools.set(tool.name, tool), registerCommand() {}, on() {} });
  await assert.rejects(legacyTools.get("calendar_add").execute("legacy-call", first, undefined, undefined, ctx), error => error.code === "writer_admission_required");
  const savedIds = [];
  for (const [index, date] of ["2026-10-10", "2026-10-11", "2026-10-12"].entries()) {
    const result = await add.execute(`calendar-day-${index}`, { ...first, date }, undefined, undefined, ctx);
    assert.equal(result.details.verified, true);
    assert.equal(result.details.events[0].state, "confirmed");
    savedIds.push(result.details.events[0].id);
  }
  assert.equal(new Set(savedIds).size, 3, "the three days are separate calendar objects");
  const replay = await add.execute("calendar-repeat", first, undefined, undefined, ctx);
  assert.equal(replay.details.events[0].id, savedIds[0]);
  await assert.rejects(legacyTools.get("calendar_add").execute("legacy-after-intake", first, undefined, undefined, ctx), error => error.code === "canonical_schedule_required");
  const pending = await importCalendar.execute("calendar-import", { events: [
    { date: "2026-10-15", name: "合成通知", type: "activity" },
    { date: "日期待确认", name: "合成待定事项", type: "meeting" },
  ] }, undefined, undefined, ctx);
  assert.deepEqual(pending.details.events.map(event => event.state), ["pending_review", "held"]);
  assert.doesNotMatch(pending.content[0].text, /已保存|已安排/);
  const after = await readEduPiEducationSnapshot();
  assert.equal(after.payload.education_workspace.calendar.length, 5);
  const viaRoute = await (await GET()).json();
  assert.equal(viaRoute.calendar.length, 5);
  for (const id of savedIds) assert.ok(viaRoute.calendar.some(event => event.id === id), "the other workspace entry reads the same saved object");
  await closeAllEduPiRuntimes();
  await ensureEduPiRuntime({ runtime: before.runtime, dataRoot: before.dataRoot });
  const restarted = await readEduPiEducationSnapshot();
  assert.deepEqual(restarted.payload.education_workspace.calendar.map(event => event.event_id).sort(), after.payload.education_workspace.calendar.map(event => event.event_id).sort());
  await closeAllEduPiRuntimes();
  writerAdmission = await acquireCoreRuntimeWriterAdmission({ root: prepareCoreRuntimeRoot(dataRoot), kind: "legacy_calendar_tool_test", busyTimeoutMs: 250 });
  await assert.rejects(add.execute("calendar-runtime-unavailable", { ...first, date: "2026-10-20" }, undefined, undefined, ctx), error => {
    assert.match(error.message, /写入未确认/);
    assert.match(error.message, /writer_admission_unavailable/);
    return true;
  });
  await writerAdmission.release();
  writerAdmission = undefined;
  const afterFailure = await readEduPiEducationSnapshot();
  assert.equal(afterFailure.payload.education_workspace.calendar.length, 5, "the unavailable write did not become a hidden scheduled retry");
  console.log(JSON.stringify({ status: "passed", coreCommit, isolated: true, legacyWriterAdmissionDenial: true, legacyCanonicalDenial: true, confirmedDays: 3, afterReplay: 3, pendingReview: 1, held: 1, crossEntryReadback: true, restartReadback: true, unavailableWrite: "not_confirmed", automaticRetry: false, realModelCalls: 0 }));
} finally {
  await writerAdmission?.release();
  await closeAllEduPiRuntimes();
  fs.rmSync(temp, { recursive: true, force: true });
}
