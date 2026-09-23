#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createJiti } from "jiti";

const desktopRoot = path.resolve(new URL("..", import.meta.url).pathname);
const staged = process.env.EDUPI_UPLOADED_CALENDAR_E2_STAGED === "1";
const resources = path.resolve(process.env.EDUPI_STAGED_RESOURCES || path.join(desktopRoot, "src-tauri", "resources"));
const coreRootValue = staged ? path.join(resources, "edupi-core") : process.env.EDUPI_CORE_ROOT;
if (!coreRootValue || !path.isAbsolute(coreRootValue)) throw new Error("EDUPI_CORE_ROOT must be an absolute Core checkout");
const coreRoot = fs.realpathSync(coreRootValue);
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-uploaded-calendar-e2-")));
const dataRoot = path.join(temporaryRoot, "data");
const desktopStateDir = path.join(temporaryRoot, "desktop-state");
const home = path.join(dataRoot, ".edupi");
for (const directory of [dataRoot, desktopStateDir, path.join(home, "memory"), path.join(home, "output"), path.join(home, "locks")]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}
const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts", "edupi-core-compat.json"), "utf8"));
const token = "uploaded-calendar-test-token-012345678901234567890123456";
const keys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT", "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT", "EDUPI_AMBIENT_PLANNING", "PI_DESKTOP_STATE_DIR", "PI_DESKTOP_API_TOKEN"];
const previous = new Map(keys.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  EDUPI_PROJECT_ROOT: dataRoot,
  EDUPI_DATA_ROOT: dataRoot,
  EDUPI_DATA_ALLOWED_ROOT: temporaryRoot,
  EDUPI_CORE_ROOT: coreRoot,
  EDUPI_CORE_ALLOWED_ROOT: staged ? resources : path.dirname(coreRoot),
  EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: path.join(home, "memory"),
  EDUPI_OUTPUT_DIR: path.join(home, "output"),
  EDUPI_LOCK_DIR: path.join(home, "locks"),
  EDUPI_CORE_COMMIT: compat.core_runtime.core_commit,
  EDUPI_AMBIENT_PLANNING: "1",
  PI_DESKTOP_STATE_DIR: desktopStateDir,
  PI_DESKTOP_API_TOKEN: token,
});

let stagedServer;
let runtimeSupervisor;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => address && typeof address === "object" ? resolve(address.port) : reject(new Error("port unavailable")));
    });
  });
}

async function startStagedServer() {
  const serverDir = path.join(resources, "server");
  const worker = path.join(serverDir, "lib", "edupi-ics-worker.cjs");
  assert.equal(fs.statSync(worker).isFile(), true, "packaged ICS worker is missing");
  const packageRequire = (await import("node:module")).createRequire(path.join(serverDir, "package.json"));
  for (const name of ["node-ical", "temporal-polyfill"]) {
    const entry = fs.realpathSync(packageRequire.resolve(name));
    assert.equal(entry.startsWith(`${fs.realpathSync(serverDir)}${path.sep}`), true, `${name} escaped the packaged server`);
  }
  const nodeBinary = path.join(resources, "Pi Agent Server.app", "Contents", "MacOS", "node");
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(nodeBinary, [path.join(serverDir, "desktop-server.cjs")], {
    cwd: serverDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
      EDUPI_CORE_VALIDATION_MODE: "bundled", PI_DESKTOP_INSTANCE_ID: "staged-uploaded-calendar-e2", PI_WEB_PARENT_PID: String(process.pid), PI_OFFLINE: "1" },
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs = (logs + chunk.toString("utf8")).slice(-5000); });
  child.stderr.on("data", (chunk) => { logs = (logs + chunk.toString("utf8")).slice(-5000); });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    if (await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 3000))])) return;
    child.kill("SIGKILL");
    if (!await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 3000))])) throw new Error("staged server did not exit");
  };
  try {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`staged server exited: ${logs}`);
      try { if ((await fetch(`${url}/api/desktop/identity`, { signal: AbortSignal.timeout(2000) })).status === 204) return { url, stop }; }
      catch { /* cold start */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`staged server not ready: ${logs}`);
  } catch (error) { await stop(); throw error; }
}

function calendar(events, method = null) {
  return Buffer.from(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EduPi Uploaded Calendar E2//EN",
    ...(method ? [`METHOD:${method}`] : []), ...events.flat(), "END:VCALENDAR", ""].join("\r\n"));
}

function timed(uid, date, hour, title, location) {
  const end = String(Number(hour) + 1).padStart(2, "0");
  return ["BEGIN:VEVENT", `UID:${uid}`, "DTSTAMP:20260923T000000Z", `DTSTART;TZID=Asia/Shanghai:${date}T${hour}0000`,
    `DTEND;TZID=Asia/Shanghai:${date}T${end}0000`, `SUMMARY:${title}`, `LOCATION:${location}`, "STATUS:CONFIRMED", "END:VEVENT"];
}

const seriesFamily = (uid) => `ics-series:${crypto.createHash("sha256").update(uid, "utf8").digest("hex")}`;
const deletionNote = (sourceId, evidenceId) => `ICS-SYNC:${crypto.createHash("sha256").update(`${sourceId}\0${evidenceId}`, "utf8").digest("hex")}`;

try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const stagingRoute = staged ? null : await jiti.import(path.join(desktopRoot, "app/api/edupi/materials/staging/route.ts"));
  const intakeRoute = staged ? null : await jiti.import(path.join(desktopRoot, "app/api/edupi/intake/route.ts"));
  const educationRoute = staged ? null : await jiti.import(path.join(desktopRoot, "app/api/edupi/education/route.ts"));
  const sourceRoute = staged ? null : await jiti.import(path.join(desktopRoot, "app/api/edupi/calendar-sources/route.ts"));
  const snapshot = staged ? null : await jiti.import(path.join(desktopRoot, "lib/edupi-core-snapshot.ts"));
  runtimeSupervisor = staged ? null : await jiti.import(path.join(desktopRoot, "lib/edupi-runtime-supervisor.ts"));
  if (staged) stagedServer = await startStagedServer();
  const baseUrl = () => stagedServer?.url || "http://localhost:30141";
  const headers = () => ({ host: new URL(baseUrl()).host, origin: baseUrl(), "x-pi-desktop-token": token });

  const stage = async (bytes, name = "官方校历.ics") => {
    const form = new FormData();
    form.append("files", new File([bytes], name, { type: "text/calendar" }), name);
    const request = new Request(`${baseUrl()}/api/edupi/materials/staging`, { method: "POST", headers: headers(), body: form });
    const response = stagedServer ? await fetch(request, { signal: AbortSignal.timeout(15_000) }) : await stagingRoute.POST(request);
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body.staged.length, 1);
    assert.equal(body.staged[0].kind, "calendar");
    return body.staged[0];
  };
  const intake = async (stagingId, calendarSourceId = null, calendarSourceFingerprint = null) => {
    const request = new Request(`${baseUrl()}/api/edupi/intake`, { method: "POST", headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ kind: "material", stagingId, title: "官方校历", materialKind: "other", subject: null, classId: null,
        recognize: true, calendarSourceId, calendarSourceFingerprint }) });
    const response = stagedServer ? await fetch(request, { signal: AbortSignal.timeout(30_000) }) : await intakeRoute.POST(request);
    return { response, body: await response.json() };
  };
  const intakeManualOccurrence = async () => {
    const request = new Request(`${baseUrl()}/api/edupi/intake`, { method: "POST", headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ kind: "calendar", events: [{ eventId: null, date: "2026-10-09", endDate: null,
        name: "手工日程", type: "meeting", confidence: "teacher_confirmed", notes: null,
        sourceOccurrenceRef: "manual-ui-occurrence", timeInterval: { start: "2026-10-09T09:00+08:00",
          end: "2026-10-09T10:00+08:00", timeZone: "Asia/Shanghai" }, location: "手工地点" }] }) });
    const response = stagedServer ? await fetch(request, { signal: AbortSignal.timeout(30_000) }) : await intakeRoute.POST(request);
    return { response, body: await response.json() };
  };
  const education = async () => {
    const request = new Request(`${baseUrl()}/api/edupi/education`, { headers: headers() });
    const response = stagedServer ? await fetch(request, { signal: AbortSignal.timeout(15_000) }) : await educationRoute.GET();
    return { response, body: await response.json() };
  };
  const listSources = async () => {
    const request = new Request(`${baseUrl()}/api/edupi/calendar-sources`, { headers: headers() });
    const response = stagedServer ? await fetch(request, { signal: AbortSignal.timeout(15_000) }) : await sourceRoute.GET(request);
    return { response, body: await response.json() };
  };

  const manual = await intakeManualOccurrence();
  assert.equal(manual.response.status, 200, JSON.stringify(manual.body));
  let sourceList = await listSources();
  assert.equal(sourceList.response.status, 200, JSON.stringify(sourceList.body));
  assert.deepEqual(sourceList.body.sources, [], "manual occurrence issuers must not poison uploaded-calendar source discovery");

  const firstBytes = calendar([
    timed("upload-a", "20261001", "09", "教研会", "东楼 203"),
    timed("upload-b", "20261002", "14", "备课组会", "西楼 401"),
  ]);
  let stagedFile = await stage(firstBytes);
  const firstEvidenceId = `calendar-evidence-${stagedFile.source_hash.slice("sha256:".length, "sha256:".length + 32)}`;
  const first = await intake(stagedFile.staging_id);
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.calendarCommitted, true);
  assert.equal(first.body.recognition.eventCount, 2);
  assert.equal(first.body.staged.length, 0);
  assert.equal(first.body.receipt.external_send, false);
  const sourceId = first.body.calendarSourceId;
  let intakeState = JSON.parse(fs.readFileSync(path.join(home, "output", "education_intake_state.json"), "utf8"));
  const firstMaterial = intakeState.materials.find((item) => item.material_id === firstEvidenceId);
  assert.ok(firstMaterial, "Core must own the original ICS evidence artifact");
  assert.deepEqual(fs.readFileSync(path.join(dataRoot, firstMaterial.relative_path)), firstBytes);
  sourceList = await listSources();
  assert.equal(sourceList.response.status, 200, JSON.stringify(sourceList.body));
  let sourceFingerprint = sourceList.body.sources.find((source) => source.sourceId === sourceId)?.fingerprint;
  assert.match(sourceFingerprint, /^sha256:[a-f0-9]{64}$/u);

  let read = await education();
  assert.equal(read.response.status, 200, JSON.stringify(read.body));
  assert.equal(read.body.calendar.filter((item) => ["upload-a", "upload-b"].includes(item.occurrenceRef)).length, 2);
  assert.equal(read.body.calendar.find((item) => item.occurrenceRef === "upload-a").startsAt, "2026-10-01T09:00+08:00");

  stagedFile = await stage(firstBytes, "校历副本.ics");
  const replay = await intake(stagedFile.staging_id);
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.calendarSourceId, sourceId);
  assert.equal(replay.body.calendarCommitted, true);
  intakeState = JSON.parse(fs.readFileSync(path.join(home, "output", "education_intake_state.json"), "utf8"));
  assert.equal(intakeState.materials.filter((item) => item.material_id === firstEvidenceId).length, 1,
    "renaming an exact ICS replay must not duplicate the Core evidence artifact");
  read = await education();
  assert.equal(read.body.calendar.filter((item) => ["upload-a", "upload-b"].includes(item.occurrenceRef)).length, 2);

  const updateBytes = calendar([
    timed("upload-b", "20261002", "14", "备课组会", "西楼 401"),
    timed("upload-c", "20261003", "10", "家长开放日", "礼堂"),
  ]);
  stagedFile = await stage(updateBytes, "官方校历-修订.ics");
  const updateEvidenceId = `calendar-evidence-${stagedFile.source_hash.slice("sha256:".length, "sha256:".length + 32)}`;
  const updated = await intake(stagedFile.staging_id, sourceId, sourceFingerprint);
  assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.calendarCommitted, true);
  assert.equal(updated.body.removedEventCount, 1);
  read = await education();
  assert.equal(read.body.calendar.some((item) => item.occurrenceRef === "upload-a"), false);
  assert.equal(read.body.calendar.filter((item) => ["upload-b", "upload-c"].includes(item.occurrenceRef)).length, 2);

  sourceList = await listSources();
  assert.equal(sourceList.response.status, 200, JSON.stringify(sourceList.body));
  assert.equal(sourceList.body.sources.length, 1);
  assert.equal(sourceList.body.sources[0].sourceId, sourceId);
  assert.equal(sourceList.body.sources[0].eventCount, 2);
  assert.notEqual(sourceList.body.sources[0].fingerprint, sourceFingerprint);
  sourceFingerprint = sourceList.body.sources[0].fingerprint;
  assert.equal(JSON.stringify(sourceList.body).includes("source_occurrence_ref"), false);
  assert.equal(fs.existsSync(path.join(desktopStateDir, "calendar-sources.json")), false, "Core projection is the only source baseline");

  const secondUpdateBytes = calendar([
    timed("upload-c", "20261003", "10", "家长开放日", "礼堂"),
    timed("upload-d", "20261004", "15", "校务会议", "行政楼"),
  ]);
  stagedFile = await stage(secondUpdateBytes, "官方校历-再次修订.ics");
  const secondUpdateEvidenceId = `calendar-evidence-${stagedFile.source_hash.slice("sha256:".length, "sha256:".length + 32)}`;
  const secondUpdated = await intake(stagedFile.staging_id, sourceId, sourceFingerprint);
  assert.equal(secondUpdated.response.status, 200, JSON.stringify(secondUpdated.body));
  assert.equal(secondUpdated.body.calendarCommitted, true);
  assert.equal(secondUpdated.body.removedEventCount, 1);
  read = await education();
  assert.equal(read.body.calendar.some((item) => ["upload-a", "upload-b"].includes(item.occurrenceRef)), false);
  assert.equal(read.body.calendar.filter((item) => ["upload-c", "upload-d"].includes(item.occurrenceRef)).length, 2);

  const recurringEvent = (withExdate) => [
    "BEGIN:VEVENT", "UID:upload-recurring", "DTSTAMP:20260923T000000Z",
    "DTSTART;TZID=Asia/Shanghai:20261020T090000", "DTEND;TZID=Asia/Shanghai:20261020T100000",
    "RRULE:FREQ=WEEKLY;COUNT=3", ...(withExdate ? ["EXDATE;TZID=Asia/Shanghai:20261027T090000"] : []),
    "SUMMARY:循环教研会", "STATUS:CONFIRMED", "END:VEVENT",
  ];
  const recurringFamily = seriesFamily("upload-recurring");
  const recurringUnrelated = timed("upload-recurring-keep", "20261022", "12", "同来源保留事项", "教研室");
  stagedFile = await stage(calendar([recurringEvent(false), recurringUnrelated]), "循环教研日历.ics");
  const recurringInitial = await intake(stagedFile.staging_id);
  assert.equal(recurringInitial.response.status, 200, JSON.stringify(recurringInitial.body));
  assert.equal(recurringInitial.body.calendarCommitted, true);
  assert.equal(recurringInitial.body.recognition.eventCount, 4);
  const recurringSourceId = recurringInitial.body.calendarSourceId;
  sourceList = await listSources();
  const recurringSource = sourceList.body.sources.find((source) => source.sourceId === recurringSourceId);
  assert.equal(recurringSource.eventCount, 4);
  stagedFile = await stage(calendar([recurringEvent(true)], "REQUEST"), "循环教研日历-排除一次.ics");
  const recurringUpdated = await intake(stagedFile.staging_id, recurringSourceId, recurringSource.fingerprint);
  assert.equal(recurringUpdated.response.status, 200, JSON.stringify(recurringUpdated.body));
  assert.equal(recurringUpdated.body.calendarCommitted, true);
  assert.equal(recurringUpdated.body.removedEventCount, 1);
  read = await education();
  const recurringCurrent = read.body.calendar.filter((item) => item.occurrenceRef?.startsWith(`${recurringFamily}#`));
  assert.equal(recurringCurrent.length, 2);
  assert.equal(recurringCurrent.some((item) => item.occurrenceRef === `${recurringFamily}#2026-10-27T01:00:00.000Z`), false);

  sourceList = await listSources();
  const recurrenceAfterExdate = sourceList.body.sources.find((source) => source.sourceId === recurringSourceId);
  const singleCancellation = [
    "BEGIN:VEVENT", "UID:upload-recurring", "RECURRENCE-ID;TZID=Asia/Shanghai:20261103T090000",
    "DTSTAMP:20260923T000000Z", "STATUS:CANCELLED", "END:VEVENT",
  ];
  stagedFile = await stage(calendar([singleCancellation], "CANCEL"), "循环教研日历-取消一次.ics");
  const recurrenceCancelled = await intake(stagedFile.staging_id, recurringSourceId, recurrenceAfterExdate.fingerprint);
  assert.equal(recurrenceCancelled.response.status, 200, JSON.stringify(recurrenceCancelled.body));
  assert.equal(recurrenceCancelled.body.calendarCommitted, true);
  assert.equal(recurrenceCancelled.body.removedEventCount, 1);

  sourceList = await listSources();
  const recurrenceAfterCancel = sourceList.body.sources.find((source) => source.sourceId === recurringSourceId);
  const shiftedSeries = [
    "BEGIN:VEVENT", "UID:upload-recurring", "DTSTAMP:20260923T000000Z",
    "DTSTART;TZID=Asia/Shanghai:20261020T100000", "DTEND;TZID=Asia/Shanghai:20261020T110000",
    "RRULE:FREQ=WEEKLY;COUNT=3", "SUMMARY:循环教研会改时", "STATUS:CONFIRMED", "END:VEVENT",
  ];
  stagedFile = await stage(calendar([shiftedSeries], "REQUEST"), "循环教研日历-改时.ics");
  const implicitShift = await intake(stagedFile.staging_id);
  assert.equal(implicitShift.response.status, 409, JSON.stringify(implicitShift.body));
  assert.equal(implicitShift.body.code, "calendar_source_selection_required");
  const shifted = await intake(stagedFile.staging_id, recurringSourceId, recurrenceAfterCancel.fingerprint);
  assert.equal(shifted.response.status, 200, JSON.stringify(shifted.body));
  assert.equal(shifted.body.calendarCommitted, true);
  assert.equal(shifted.body.recognition.eventCount, 3);
  assert.equal(shifted.body.removedEventCount, 1);
  read = await education();
  const shiftedCurrent = read.body.calendar.filter((item) => item.occurrenceRef?.startsWith(`${recurringFamily}#`));
  assert.equal(shiftedCurrent.length, 3);
  assert.equal(shiftedCurrent.every((item) => item.startsAt?.includes("T10:00+08:00")), true);
  assert.equal(shiftedCurrent.some((item) => item.occurrenceRef === `${recurringFamily}#2026-10-20T01:00:00.000Z`), false);

  sourceList = await listSources();
  const recurrenceAfterShift = sourceList.body.sources.find((source) => source.sourceId === recurringSourceId);
  const seriesCancellation = [
    "BEGIN:VEVENT", "UID:upload-recurring", "DTSTAMP:20260923T000000Z",
    "STATUS:CANCELLED", "END:VEVENT",
  ];
  stagedFile = await stage(calendar([seriesCancellation], "CANCEL"), "循环教研日历-全部取消.ics");
  const seriesCancellationEvidenceId = `calendar-evidence-${stagedFile.source_hash.slice("sha256:".length, "sha256:".length + 32)}`;
  const seriesCancelled = await intake(stagedFile.staging_id, recurringSourceId, recurrenceAfterShift.fingerprint);
  assert.equal(seriesCancelled.response.status, 200, JSON.stringify(seriesCancelled.body));
  assert.equal(seriesCancelled.body.calendarCommitted, true);
  assert.equal(seriesCancelled.body.calendarSourceId, recurringSourceId);
  assert.equal(seriesCancelled.body.removedEventCount, 3);
  const afterSeriesCancellationState = JSON.parse(fs.readFileSync(path.join(home, "output", "entity_delete_state.json"), "utf8"));
  const seriesCancellationHistory = afterSeriesCancellationState.history.filter((item) => item.action === "delete"
    && item.note === deletionNote(recurringSourceId, seriesCancellationEvidenceId));
  assert.equal(seriesCancellationHistory.length, 3, JSON.stringify(afterSeriesCancellationState.history));
  assert.equal(seriesCancellationHistory.every((item) => /^calendar-batch-delete-[a-f0-9]{32}$/u.test(item.request_id)), true,
    JSON.stringify(seriesCancellationHistory));
  assert.equal(seriesCancellationHistory.every((item) => afterSeriesCancellationState.records.some((record) =>
    record.target_kind === "calendar" && record.target_id === item.target_id)), true);
  stagedFile = await stage(calendar([seriesCancellation], "CANCEL"), "循环教研日历-全部取消-重放.ics");
  const seriesCancelReplay = await intake(stagedFile.staging_id, recurringSourceId, recurrenceAfterShift.fingerprint);
  assert.equal(seriesCancelReplay.response.status, 200, JSON.stringify(seriesCancelReplay.body));
  assert.equal(seriesCancelReplay.body.calendarCommitted, true);
  assert.equal(seriesCancelReplay.body.calendarSourceId, recurringSourceId);
  assert.equal(seriesCancelReplay.body.removedEventCount, 0);

  const firstImportExdate = [
    "BEGIN:VEVENT", "UID:upload-first-exdate", "DTSTAMP:20260923T000000Z",
    "DTSTART;TZID=Asia/Shanghai:20261110T090000", "DTEND;TZID=Asia/Shanghai:20261110T100000",
    "RRULE:FREQ=WEEKLY;COUNT=3", "EXDATE;TZID=Asia/Shanghai:20261117T090000",
    "SUMMARY:首次导入即排除", "STATUS:CONFIRMED", "END:VEVENT",
  ];
  stagedFile = await stage(calendar([firstImportExdate], "PUBLISH"), "首次导入含排除日历.ics");
  const firstExdate = await intake(stagedFile.staging_id);
  assert.equal(firstExdate.response.status, 200, JSON.stringify(firstExdate.body));
  assert.equal(firstExdate.body.calendarCommitted, true);
  assert.equal(firstExdate.body.recognition.eventCount, 2);
  assert.equal(firstExdate.body.removedEventCount, 0);

  if (stagedServer) {
    await stagedServer.stop();
    stagedServer = await startStagedServer();
  } else {
    await runtimeSupervisor.closeAllEduPiRuntimes();
    await runtimeSupervisor.ensureEduPiRuntime(snapshot.resolveEduPiBridgeRoots());
  }
  read = await education();
  assert.equal(read.body.calendar.some((item) => ["upload-a", "upload-b"].includes(item.occurrenceRef)), false);
  assert.equal(read.body.calendar.filter((item) => ["upload-c", "upload-d"].includes(item.occurrenceRef)).length, 2);
  assert.equal(read.body.calendar.filter((item) => item.occurrenceRef?.startsWith(`${recurringFamily}#`)).length, 0);
  assert.equal(read.body.calendar.some((item) => item.occurrenceRef === "upload-recurring-keep"), true,
    "whole-series cancellation must preserve another UID from the same uploaded source");
  assert.equal(read.body.calendar.filter((item) => item.occurrenceRef?.startsWith(`${seriesFamily("upload-first-exdate")}#`)).length, 2);
  const deletionState = JSON.parse(fs.readFileSync(path.join(home, "output", "entity_delete_state.json"), "utf8"));
  assert.equal(deletionState.records.filter((item) => item.target_kind === "calendar").length, 8);
  assert.equal(deletionState.history.filter((item) => item.action === "delete"
    && item.note === deletionNote(recurringSourceId, seriesCancellationEvidenceId)).length, 3,
  "an exact series cancellation replay must not create new delete history");
  assert.equal(deletionState.history.some((item) => item.action === "delete" && item.note === deletionNote(sourceId, updateEvidenceId)), true,
    "the batch tombstone history must identify the ICS revision that caused the withdrawal");
  assert.equal(deletionState.history.some((item) => item.action === "delete" && item.note === deletionNote(sourceId, secondUpdateEvidenceId)), true,
    "a later revision must preserve its own withdrawal evidence after earlier tombstones");
  console.log(JSON.stringify({ status: "passed", staged_server: staged, deterministic_ics: true, exact_replay: true,
    explicit_update: true, consecutive_update: true, exdate_delta: true, exdate_first_import: true,
    recurrence_cancel: true, recurrence_series_replace: true, recurrence_series_cancel: true,
    recurrence_series_cancel_replay: true, implicit_series_update_held: true,
    manual_occurrence_coexistence: true, deletion_propagation: true, restart_readback: true,
    external_send: false }));
} finally {
  await stagedServer?.stop();
  await runtimeSupervisor?.closeAllEduPiRuntimes();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
