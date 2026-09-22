#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const coreRootValue = process.env.EDUPI_CORE_ROOT;
if (!coreRootValue || !path.isAbsolute(coreRootValue)) throw new Error("EDUPI_CORE_ROOT must be an absolute Core checkout");
const coreRoot = fs.realpathSync(coreRootValue);
const desktopRoot = path.resolve(new URL("..", import.meta.url).pathname);
const dataRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-schedule-review-e2-")));
const home = path.join(dataRoot, ".edupi");
const memoryDir = path.join(home, "memory");
const outputDir = path.join(home, "output");
const lockDir = path.join(home, "locks");
for (const directory of [memoryDir, outputDir, lockDir]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts/edupi-core-compat.json"), "utf8"));
const keys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_CORE_ALLOWED_ROOT", "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT", "EDUPI_AMBIENT_PLANNING", "PI_DESKTOP_API_TOKEN"];
const previous = new Map(keys.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: path.dirname(dataRoot),
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot), EDUPI_HOME: home, EDUPI_MEMORY_DIR: memoryDir,
  EDUPI_OUTPUT_DIR: outputDir, EDUPI_LOCK_DIR: lockDir, EDUPI_CORE_COMMIT: compat.core_runtime.core_commit,
  EDUPI_AMBIENT_PLANNING: "1", PI_DESKTOP_API_TOKEN: "schedule-review-test-token-012345678901234567890123456789",
});

let admission;
let runtimeSupervisor;
try {
  const rootModule = await import(path.join(coreRoot, "scripts/core_runtime_root.mjs"));
  const admissionModule = await import(path.join(coreRoot, "scripts/core_runtime_writer_admission.mjs"));
  const schedule = await import(path.join(coreRoot, "scripts/schedule_dedupe.mjs"));
  const intake = await import(path.join(coreRoot, "scripts/education_intake_store.mjs"));
  const root = rootModule.prepareCoreRuntimeRoot(dataRoot);
  admission = await admissionModule.acquireCoreRuntimeWriterAdmission({ root, kind: "legacy_desktop_schedule_review_e2" });
  const at = "2026-09-22T08:00:00.000Z";
  const original = { event_id: "校历-开放日-e2", date: "2026-10-12", end_date: null, raw_date: null,
    date_status: "explicit", name: "学校开放日", type: "activity", source: "teacher", confidence: "teacher_confirmed",
    notes: "原日期", preparation_status: "hold", state: "held", source_ids: ["旧通知"], evidence_ids: ["旧日期-证据"],
    external_send: false, created_at: at };
  original._dedupe_identity = schedule.calendarScheduleIdentity(original);
  original._content_hash = schedule.scheduleContentFingerprint(original, "calendar");
  original._source_event_ids = [original.event_id];
  original._revision = 1;
  const candidate = { date: "2026-10-13", end_date: null, raw_date: null, name: "学校开放日",
    type: "activity", confidence: "teacher_confirmed", notes: "更正日期" };
  original._conflicts = [{ source_item_id: "开放日-更正-e2", source_ids: ["新通知"],
    evidence_ids: ["新日期-证据"], content_hash: schedule.scheduleContentFingerprint(candidate, "calendar"),
    identity: schedule.calendarScheduleIdentity(candidate), reason: "same_identity_conflicting_content",
    received_at: at, candidate, external_send: false }];
  const state = intake.loadEducationIntakeState();
  state.calendar_events.push(original);
  intake.saveEducationIntakeState(state);
  await admission.release();
  admission = null;

  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const route = await jiti.import(path.join(desktopRoot, "app/api/edupi/schedule-conflicts/route.ts"));
  runtimeSupervisor = await jiti.import(path.join(desktopRoot, "lib/edupi-runtime-supervisor.ts"));
  const url = "http://localhost:30141/api/edupi/schedule-conflicts";
  const token = process.env.PI_DESKTOP_API_TOKEN;
  const headers = { host: "localhost:30141", origin: "http://localhost:30141", "x-pi-desktop-token": token };
  const get = async (authorized = true) => route.GET(new Request(`${url}?limit=50`, { headers: authorized ? headers : { host: headers.host, origin: headers.origin } }));
  const post = async (body) => route.POST(new Request(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) }));

  assert.equal((await get(false)).status, 403);
  assert.equal((await get()).status, 409);
  assert.equal((await post({ action: "bootstrap" })).status, 200);
  const listedResponse = await get();
  const listed = await listedResponse.json();
  assert.equal(listedResponse.status, 200, JSON.stringify(listed));
  assert.equal(listed.result.conflicts.length, 1);
  const conflict = listed.result.conflicts[0];
  assert.equal(conflict.candidate.date, "2026-10-13");
  assert.equal(conflict.external_send, false);
  const decision = { action: "resolve", commandId: "desktop-resolve-opening-day-e2", conflictId: conflict.conflict_id,
    kind: conflict.kind, canonicalId: conflict.canonical_id, expectedRevision: conflict.expected_revision,
    expectedContentHash: conflict.expected_content_hash, expectedConflictHash: conflict.expected_conflict_hash,
    decision: "replace_with_candidate" };
  const resolvedResponse = await post(decision);
  const resolved = await resolvedResponse.json();
  assert.equal(resolvedResponse.status, 200, JSON.stringify(resolved));
  assert.match(resolved.result.resolution_id, /^schedule_resolution_[a-f0-9]{32}$/);
  assert.equal(resolved.result.replayed, false);
  assert.equal((await (await get()).json()).result.conflicts.length, 0);
  const replay = await post(decision);
  assert.equal(replay.status, 200, JSON.stringify(await replay.clone().json()));
  assert.equal((await replay.json()).result.replayed, true);
  const changedDecision = await post({ ...decision, decision: "keep_existing" });
  assert.equal(changedDecision.status, 409);
  assert.equal((await changedDecision.json()).errorCode, "schedule_conflict_replay_mismatch");
  const staleDecision = await post({ ...decision, commandId: "desktop-stale-opening-day-e2" });
  assert.equal(staleDecision.status, 409);
  assert.equal((await staleDecision.json()).errorCode, "schedule_conflict_stale");
  await runtimeSupervisor.closeAllEduPiRuntimes();
  assert.equal((await (await get()).json()).result.conflicts.length, 0);
  const stored = intake.loadEducationIntakeState();
  assert.equal(stored.calendar_events[0].date, "2026-10-13");
  assert.equal(stored.schedule_resolutions.length, 1);
  console.log(JSON.stringify({ status: "passed", token_guard: true, owner_bootstrap: true, conflict_read: true,
    resolution: true, exact_replay: true, changed_decision_rejected: true, stale_revision_rejected: true,
    restart_readback: true, external_send: false }));
} finally {
  if (admission) await admission.release().catch(() => {});
  await runtimeSupervisor?.closeAllEduPiRuntimes();
  fs.rmSync(dataRoot, { recursive: true, force: true });
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
