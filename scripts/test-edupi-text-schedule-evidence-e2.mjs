#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
if (typeof configuredCoreRoot !== "string" || !path.isAbsolute(configuredCoreRoot)) {
  throw new Error("EDUPI_CORE_ROOT must be an absolute Core checkout");
}
const coreRoot = fs.realpathSync(configuredCoreRoot);
const desktopRoot = path.resolve(new URL("..", import.meta.url).pathname);
const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts", "edupi-core-compat.json"), "utf8"));
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-text-schedule-evidence-e2-")));
const dataRoot = path.join(temporaryRoot, "data");
const stateDir = path.join(temporaryRoot, "desktop-state");
const home = path.join(dataRoot, ".edupi");
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
  EDUPI_CORE_ROOT: coreRoot,
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: path.join(home, "memory"),
  EDUPI_OUTPUT_DIR: path.join(home, "output"),
  EDUPI_LOCK_DIR: path.join(home, "locks"),
  EDUPI_CORE_COMMIT: compat.core_runtime.core_commit,
  PI_DESKTOP_STATE_DIR: stateDir,
});

function xml(value) {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

async function docx(text) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  const paragraphs = text.split("\n").map((line) => `<w:p><w:r><w:t>${xml(line)}</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const staging = await jiti.import("../lib/edupi-material-staging.ts");
  const recognition = await jiti.import("../lib/edupi-material-recognition.ts");
  const intake = await jiti.import("../lib/edupi-material-intake-flow.ts");
  const snapshot = await jiti.import("../lib/edupi-core-snapshot.ts");
  const shanghaiEvidence = "通知：2026年10月20日 09:00-10:00（北京时间）在东楼 203 举行教研会。";
  const dstEvidence = "通知：2026年11月1日 00:30-02:30 America/New_York 在西楼举行值班会议。";
  const sourceText = `${shanghaiEvidence}\n${dstEvidence}`;
  const bytes = await docx(sourceText);
  const descriptors = ["教研安排.docx", "改名后的安排.docx"].map((name) => staging.stageMaterialInputs([{
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: new Uint8Array(bytes),
  }])[0]);
  assert.equal(descriptors[0].source_hash, descriptors[1].source_hash);
  const eventIds = [];
  let modelCalls = 0;
  let cacheReplays = 0;
  for (const descriptor of descriptors) {
    const modelOutput = JSON.stringify({ events: [{
      date: "2026-10-20", name: "教研会", type: "meeting", evidence_quote: shanghaiEvidence,
      time_interval: { start: "2026-10-20T09:00+08:00", end: "2026-10-20T10:00+08:00", time_zone: "Asia/Shanghai" },
      location: "东楼 203",
    }, {
      date: "2026-11-01", name: "值班会议", type: "meeting", evidence_quote: dstEvidence,
      time_interval: { start: "2026-11-01T00:30-04:00", end: "2026-11-01T02:30-05:00", time_zone: "America/New_York" },
      location: "西楼",
    }], slots: [] });
    const recognized = await recognition.recognizeStagedMaterial(descriptor, {
      runModel: async (input) => {
        modelCalls += 1;
        assert.equal(input.text.includes(shanghaiEvidence), true);
        assert.equal(input.text.includes(dstEvidence), true);
        return modelOutput;
      },
      idFactory: () => `model-event-${modelCalls}`,
    });
    recognition.saveRecognitionCache(descriptor, recognized, { modelOutput, sourceText });
    assert.deepEqual(await recognition.recognizeStagedMaterial(descriptor), recognized,
      "production cache replay must re-extract the DOCX and re-validate the saved model JSON without model configuration");
    cacheReplays += 1;
    const result = await intake.intakeRecognizedMaterial({ descriptor, materialKind: "other", subject: null, classId: null }, {
      recognize: async () => recognized,
    });
    assert.equal(result.scheduleNeedsReview, false);
    const read = await snapshot.readEduPiEducationSnapshot({ requestId: `text-evidence-${modelCalls}`, scheduleOccurrenceVersion: "1.2" });
    const matching = read.occurrenceProjection.events.filter((event) => ["教研会", "值班会议"].includes(event.name));
    assert.equal(matching.length, 2);
    const meeting = matching.find((event) => event.name === "教研会");
    const dstMeeting = matching.find((event) => event.name === "值班会议");
    assert.deepEqual(meeting.time_interval,
      { start: "2026-10-20T09:00+08:00", end: "2026-10-20T10:00+08:00", time_zone: "Asia/Shanghai" });
    assert.equal(meeting.location, "东楼 203");
    assert.deepEqual(dstMeeting.time_interval,
      { start: "2026-11-01T00:30-04:00", end: "2026-11-01T02:30-05:00", time_zone: "America/New_York" });
    for (const event of matching) {
      assert.equal(event.confidence, "inferred");
      assert.equal(event.preparation_status, "hold");
      assert.equal(event.external_send, false);
    }
    eventIds.push(matching.map((event) => event.event_id).sort().join("|"));
  }
  assert.equal(modelCalls, 2, "typed text evidence is revalidated instead of loaded from an evidence-free cache");
  assert.equal(cacheReplays, 2);
  assert.equal(eventIds[0], eventIds[1], "renamed identical DOCX bytes must keep one Core schedule identity");
  const changedBytes = Buffer.alloc(descriptors[1].expected_size_bytes, 0x61);
  fs.writeFileSync(descriptors[1].staging_path, changedBytes);
  await assert.rejects(recognition.recognizeStagedMaterial(descriptors[1]), (error) => error?.code === "extract_unavailable");
  console.log(JSON.stringify({ status: "passed", typed_text_evidence: true, renamed_exact_dedupe: true,
    model_revalidation: true, cache_replay: true, changed_source_rejected: true,
    dst_transition: true, projected_events: 2, external_send: false }));
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
