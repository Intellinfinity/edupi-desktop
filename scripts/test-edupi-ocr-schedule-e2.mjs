#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createJiti } from "jiti";
import { imageOnlyPdfFromJpeg } from "./image-pdf-fixture.mjs";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
if (!configuredCoreRoot || !path.isAbsolute(configuredCoreRoot)) throw new Error("EDUPI_CORE_ROOT must be an absolute Core checkout");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const compat = JSON.parse(fs.readFileSync(path.join(root, "contracts", "edupi-core-compat.json"), "utf8"));
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-ocr-schedule-e2-")));
const dataRoot = path.join(temporaryRoot, "data");
const stateDir = path.join(temporaryRoot, "desktop-state");
const home = path.join(dataRoot, ".edupi");
for (const directory of [stateDir, path.join(home, "memory"), path.join(home, "output"), path.join(home, "locks")]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

const keys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT",
  "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT", "PI_DESKTOP_STATE_DIR"];
const previous = new Map(keys.map(key => [key, process.env[key]]));
Object.assign(process.env, {
  EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: temporaryRoot,
  EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_HOME: home, EDUPI_MEMORY_DIR: path.join(home, "memory"), EDUPI_OUTPUT_DIR: path.join(home, "output"),
  EDUPI_LOCK_DIR: path.join(home, "locks"), EDUPI_CORE_COMMIT: compat.core_runtime.core_commit,
  PI_DESKTOP_STATE_DIR: stateDir,
});

function printedNotice(name, date, width, height) {
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="60" y="210" fill="black" font-family="Arial,sans-serif" font-size="70">${name} ${date}</text></svg>`;
}

try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const staging = await jiti.import("../lib/edupi-material-staging.ts");
  const recognition = await jiti.import("../lib/edupi-material-recognition.ts");
  const intake = await jiti.import("../lib/edupi-material-intake-flow.ts");
  const snapshot = await jiti.import("../lib/edupi-core-snapshot.ts");
  const png = await sharp(Buffer.from(printedNotice("MEETING", "2026-09-24", 1600, 400))).png().toBuffer();
  const jpeg = await sharp(Buffer.from(printedNotice("EXAM", "2026-09-25", 800, 1200))).jpeg().toBuffer();
  const pdf = imageOnlyPdfFromJpeg(jpeg, 800, 1200);
  const descriptors = staging.stageMaterialInputs([
    { name: "meeting.png", mimeType: "image/png", bytes: png },
    { name: "exam.pdf", mimeType: "application/pdf", bytes: pdf },
  ]);
  assert.equal(descriptors.length, 2);
  for (const [index, descriptor] of descriptors.entries()) {
    const name = index === 0 ? "MEETING" : "EXAM";
    const date = index === 0 ? "2026-09-24" : "2026-09-25";
    const recognized = await recognition.recognizeStagedMaterial(descriptor, {
      runModel: async input => {
        assert.equal(input.images.length, 0, "OCR-proven text must not resend the image to the model");
        const quote = input.text.split("\n").find(line => line.includes(name) && line.includes(date));
        assert.ok(quote, `local OCR must read the complete ${name} notice`);
        return JSON.stringify({ events: [{ date, name, type: index === 0 ? "meeting" : "exam", evidence_quote: quote }], slots: [] });
      },
      idFactory: () => `ocr-${index}`,
    });
    assert.equal(recognized.ocrStatus, "trusted");
    assert.match(recognized.events[0].notes, /OCR 摘录/u);
    assert.match(recognized.events[0].notes, /来源哈希 sha256:[a-f0-9]{64}/u);
    const result = await intake.intakeRecognizedMaterial({ descriptor, materialKind: "other", subject: null, classId: null }, {
      recognize: async () => recognized,
    });
    assert.equal(result.scheduleNeedsReview, false);
    assert.equal(result.recognition.eventCount, 1);
    assert.equal(result.recognition.ocrStatus, "trusted");
    assert.equal(descriptor.source_hash, `sha256:${createHash("sha256").update(index === 0 ? png : pdf).digest("hex")}`);
  }
  const read = await snapshot.readEduPiEducationSnapshot({ requestId: "ocr-schedule-e2", scheduleOccurrenceVersion: "1.2" });
  const events = read.occurrenceProjection.events.filter(event => ["MEETING", "EXAM"].includes(event.name));
  assert.equal(events.length, 2);
  for (const event of events) {
    assert.equal(event.confidence, "inferred");
    assert.equal(event.preparation_status, "hold");
    assert.equal(event.external_send, false);
    assert.match(event.notes, /OCR 摘录/u);
  }
  console.log(JSON.stringify({ status: "passed", core_commit: compat.core_runtime.core_commit,
    scanned_image: true, scanned_pdf: true, imported_events: events.length, external_send: false }));
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
