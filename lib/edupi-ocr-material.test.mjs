import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { imageOnlyPdfFromJpeg, pdfWithEmbeddedTextFromJpeg, pdfWithPositionedTextFromJpeg } from "../scripts/image-pdf-fixture.mjs";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { parseTesseractTsv } = await jiti.import("./edupi-ocr-evidence.ts");
const { recognizeStagedMaterial } = await jiti.import("./edupi-material-recognition.ts");
const { extractStagedMaterial } = await jiti.import("./edupi-material-recognition.ts");
const { stageMaterialInputs } = await jiti.import("./edupi-material-staging.ts");
const { materialRecognitionSummary } = await jiti.import("./edupi-material-recognition-status.ts");
const { intakeRecognizedMaterial } = await jiti.import("./edupi-material-intake-flow.ts");

const imageBytes = Buffer.from("synthetic scanned image");
const sourceHash = `sha256:${createHash("sha256").update(imageBytes).digest("hex")}`;
const descriptor = {
  staging_id: `stg_${"a".repeat(32)}`,
  staging_path: "/private/tmp/teacher-scan.png",
  original_name: "教师日程照片.png",
  expected_size_bytes: imageBytes.length,
  source_hash: sourceHash,
  kind: "image",
  source_scope: "desktop_staging",
};
const ocr = parseTesseractTsv([
  "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
  "1\t1\t0\t0\t0\t0\t0\t0\t1200\t800\t-1\t",
  "5\t1\t1\t1\t1\t1\t20\t30\t100\t40\t95\t会议",
  "5\t1\t1\t1\t1\t2\t150\t30\t300\t40\t94\t2026年9月24日",
].join("\n"), { sourceHash, pageNumber: 1, imageBytes });

test("an OCR-backed image yields only a quote-proven untyped calendar candidate", async () => {
  let modelInput;
  const result = await recognizeStagedMaterial(descriptor, {
    extract: async () => ({ text: ocr.text, images: [{ data: imageBytes.toString("base64"), mimeType: "image/png" }], ocrEvidence: [ocr] }),
    runModel: async input => {
      modelInput = input;
      return JSON.stringify({ events: [{ date: "2026-09-24", name: "会议", type: "meeting", evidence_quote: "会议 2026年9月24日", notes: "模型凭空注释" }], slots: [] });
    },
  });
  assert.equal(modelInput.text, "会议 2026年9月24日");
  assert.equal(modelInput.images.length, 0, "private scanned bytes should not be sent to the model after local OCR");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].confidence, "inferred");
  assert.equal(result.events[0].time_interval, undefined);
  assert.match(result.events[0].notes, /OCR 摘录：会议 2026年9月24日/);
  assert.match(result.events[0].notes, /第 1 页/);
  assert.match(result.events[0].notes, /来源哈希 sha256:[a-f0-9]{64}/);
  assert.doesNotMatch(result.events[0].notes, /模型凭空注释/);
});

test("OCR-derived events without a source quote cannot enter the calendar", async () => {
  await assert.rejects(() => recognizeStagedMaterial(descriptor, {
    extract: async () => ({ text: ocr.text, images: [{ data: imageBytes.toString("base64"), mimeType: "image/png" }], ocrEvidence: [ocr] }),
    runModel: async () => JSON.stringify({ events: [{ date: "2026-09-24", name: "会议", type: "meeting" }], slots: [] }),
  }), /证据|摘录/u);
});

test("the bounded OCR citation travels with an inferred Core calendar command", async () => {
  const recognized = await recognizeStagedMaterial(descriptor, {
    extract: async () => ({ text: ocr.text, images: [{ data: imageBytes.toString("base64"), mimeType: "image/png" }], ocrEvidence: [ocr] }),
    runModel: async () => JSON.stringify({ events: [{ date: "2026-09-24", name: "会议", type: "meeting", evidence_quote: "会议 2026年9月24日" }], slots: [] }),
  });
  const commands = [];
  await intakeRecognizedMaterial({ descriptor, materialKind: "other", subject: null, classId: null }, {
    recognize: async () => recognized,
    issue: async command => { commands.push(command); return { receipt: { status: "accepted" }, data: {} }; },
  });
  assert.equal(commands.length, 2);
  assert.equal(commands[1].source.source_hash, sourceHash);
  assert.equal(commands[1].events[0].confidence, "inferred");
  assert.match(commands[1].events[0].notes, /OCR 摘录：会议 2026年9月24日/);
  assert.match(commands[1].events[0].notes, /来源哈希 sha256:[a-f0-9]{64}/);
});

test("the same scanned source keeps one calendar identity when page raster bytes vary", async () => {
  const ids = [];
  const notes = [];
  for (const [index, renderedBytes] of [imageBytes, Buffer.from("different rasterization of the same PDF")].entries()) {
    const renderedEvidence = parseTesseractTsv([
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
      "1\t1\t0\t0\t0\t0\t0\t0\t1200\t800\t-1\t",
      `5\t1\t1\t1\t1\t1\t${20 + index}\t30\t100\t40\t${95 - index}\t会议`,
      `5\t1\t1\t1\t1\t2\t150\t30\t300\t40\t${94 - index}\t2026年9月24日`,
    ].join("\n"), { sourceHash, pageNumber: 1, imageBytes: renderedBytes });
    const recognized = await recognizeStagedMaterial({ ...descriptor, kind: "pdf", original_name: "同一来源.pdf", staging_path: "/private/tmp/same-source.pdf" }, {
      extract: async () => ({ text: renderedEvidence.text,
        images: [{ data: renderedBytes.toString("base64"), mimeType: "image/png" }], ocrEvidence: [renderedEvidence] }),
      runModel: async () => JSON.stringify({ events: [{ date: "2026-09-24", name: "会议", type: "meeting", evidence_quote: renderedEvidence.text }], slots: [] }),
    });
    await intakeRecognizedMaterial({ descriptor, materialKind: "other", subject: null, classId: null }, {
      recognize: async () => recognized,
      issue: async command => {
        if (command.command_type === "import_calendar") {
          ids.push(command.events[0].event_id);
          notes.push(command.events[0].notes);
        }
        return { receipt: { status: "accepted" }, data: {} };
      },
    });
  }
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.equal(notes[0], notes[1], "renderer-specific boxes, confidence and page bytes must not change Core content");
});

test("OCR quote cannot stitch an event name and date from separate lines", async () => {
  const split = parseTesseractTsv([
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "1\t1\t0\t0\t0\t0\t0\t0\t1200\t800\t-1\t",
    "5\t1\t1\t1\t1\t1\t20\t30\t100\t40\t95\t会议",
    "5\t1\t1\t1\t2\t1\t20\t100\t300\t40\t94\t2026年9月24日",
  ].join("\n"), { sourceHash, pageNumber: 1, imageBytes });
  await assert.rejects(() => recognizeStagedMaterial(descriptor, {
    extract: async () => ({ text: split.text, images: [{ data: imageBytes.toString("base64"), mimeType: "image/png" }], ocrEvidence: [split] }),
    runModel: async () => JSON.stringify({ events: [{ date: "2026-09-24", name: "会议", type: "meeting", evidence_quote: "会议 2026年9月24日" }], slots: [] }),
  }), /OCR|证据|摘录/u);
});

test("OCR quote must prove the candidate date rather than a different day", async () => {
  await assert.rejects(() => recognizeStagedMaterial(descriptor, {
    extract: async () => ({ text: ocr.text, images: [{ data: imageBytes.toString("base64"), mimeType: "image/png" }], ocrEvidence: [ocr] }),
    runModel: async () => JSON.stringify({ events: [{ date: "2026-09-25", name: "会议", type: "meeting", evidence_quote: "会议 2026年9月24日" }], slots: [] }),
  }), /OCR|日期|证据/u);
});

test("OCR dates cannot be a valid prefix of a longer numeric token or an invalid calendar date", async () => {
  for (const rawDate of ["2026-09-240", "2026-02-30"]) {
    const badDate = parseTesseractTsv([
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
      "1\t1\t0\t0\t0\t0\t0\t0\t1200\t800\t-1\t",
      "5\t1\t1\t1\t1\t1\t20\t30\t100\t40\t95\t会议",
      `5\t1\t1\t1\t1\t2\t150\t30\t300\t40\t94\t${rawDate}`,
    ].join("\n"), { sourceHash, pageNumber: 1, imageBytes });
    await assert.rejects(() => recognizeStagedMaterial(descriptor, {
      extract: async () => ({ text: badDate.text, images: [{ data: imageBytes.toString("base64"), mimeType: "image/png" }], ocrEvidence: [badDate] }),
      runModel: async () => JSON.stringify({ events: [{ date: rawDate === "2026-02-30" ? rawDate : "2026-09-24", name: "会议", type: "meeting", evidence_quote: badDate.text }], slots: [] }),
    }), /日期|摘录|OCR/u);
  }
});

test("OCR quote must also prove an end date instead of extending a one-day event", async () => {
  await assert.rejects(() => recognizeStagedMaterial(descriptor, {
    extract: async () => ({ text: ocr.text, images: [{ data: imageBytes.toString("base64"), mimeType: "image/png" }], ocrEvidence: [ocr] }),
    runModel: async () => JSON.stringify({ events: [{ date: "2026-09-24", end_date: "2026-12-31", name: "会议", type: "meeting", evidence_quote: "会议 2026年9月24日" }], slots: [] }),
  }), /OCR|日期|证据/u);
});

test("an OCR line with two different dates cannot pair one event name to the other date", async () => {
  const ambiguous = parseTesseractTsv([
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "1\t1\t0\t0\t0\t0\t0\t0\t1200\t800\t-1\t",
    "5\t1\t1\t1\t1\t1\t20\t30\t100\t40\t95\t会议",
    "5\t1\t1\t1\t1\t2\t130\t30\t260\t40\t94\t2026年9月24日",
    "5\t1\t1\t1\t1\t3\t410\t30\t100\t40\t96\t考试",
    "5\t1\t1\t1\t1\t4\t530\t30\t260\t40\t93\t2026年9月25日",
  ].join("\n"), { sourceHash, pageNumber: 1, imageBytes });
  await assert.rejects(() => recognizeStagedMaterial(descriptor, {
    extract: async () => ({ text: ambiguous.text, images: [{ data: imageBytes.toString("base64"), mimeType: "image/png" }], ocrEvidence: [ambiguous] }),
    runModel: async () => JSON.stringify({ events: [{ date: "2026-09-25", name: "会议", type: "meeting", evidence_quote: ambiguous.text }], slots: [] }),
  }), /OCR|日期|证据/u);
});

test("a month-day-only OCR notice gives a clear hold instead of inventing a year", async () => {
  const shortDate = parseTesseractTsv([
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "1\t1\t0\t0\t0\t0\t0\t0\t1200\t800\t-1\t",
    "5\t1\t1\t1\t1\t1\t20\t30\t100\t40\t95\t会议",
    "5\t1\t1\t1\t1\t2\t130\t30\t260\t40\t94\t9月24日",
  ].join("\n"), { sourceHash, pageNumber: 1, imageBytes });
  await assert.rejects(() => recognizeStagedMaterial(descriptor, {
    extract: async () => ({ text: shortDate.text, images: [{ data: imageBytes.toString("base64"), mimeType: "image/png" }], ocrEvidence: [shortDate] }),
    runModel: async () => JSON.stringify({ events: [{ date: "2026-09-24", name: "会议", type: "meeting", evidence_quote: shortDate.text }], slots: [] }),
  }), (error) => error?.code === "ambiguous_schedule" && /缺少年份/u.test(error.message));
});

test("OCR page hashes must match both the staged source and the supplied model image", async () => {
  await assert.rejects(() => recognizeStagedMaterial(descriptor, {
    extract: async () => ({ text: ocr.text, images: [{ data: Buffer.from("different image").toString("base64"), mimeType: "image/png" }], ocrEvidence: [ocr] }),
    runModel: async () => { throw new Error("model must not run"); },
  }), /OCR|证据|来源/u);
  await assert.rejects(() => recognizeStagedMaterial({ ...descriptor, source_hash: `sha256:${"b".repeat(64)}` }, {
    extract: async () => ({ text: ocr.text, images: [{ data: imageBytes.toString("base64"), mimeType: "image/png" }], ocrEvidence: [ocr] }),
    runModel: async () => { throw new Error("model must not run"); },
  }), /OCR|证据|来源/u);
});

test("OCR text cannot authorize typed time and location before the Core evidence contract exists", async () => {
  await assert.rejects(() => recognizeStagedMaterial(descriptor, {
    extract: async () => ({ text: ocr.text, images: [{ data: imageBytes.toString("base64"), mimeType: "image/png" }], ocrEvidence: [ocr] }),
    runModel: async () => JSON.stringify({ events: [{ date: "2026-09-24", name: "会议", type: "meeting", evidence_quote: "会议 2026年9月24日",
      time_interval: { start: "2026-09-24T09:00+08:00", end: "2026-09-24T10:00+08:00", time_zone: "Asia/Shanghai" }, location: "会议室" }], slots: [] }),
  }), /时间|地点|OCR/u);
});

test("images without local trusted OCR cannot ask the model to invent a schedule", async () => {
  const result = await recognizeStagedMaterial(descriptor, {
    extract: async () => ({ text: "", images: [{ data: imageBytes.toString("base64"), mimeType: "image/png" }] }),
    runModel: async () => { throw new Error("model must not run"); },
  });
  assert.deepEqual(result, { events: [], slots: [], ocrStatus: "unavailable" });
  assert.match(materialRecognitionSummary({ eventCount: 0, slotCount: 0, ocrStatus: result.ocrStatus }), /文字识别未完成/);
  assert.doesNotMatch(materialRecognitionSummary({ eventCount: 0, slotCount: 0, ocrStatus: result.ocrStatus }), /未发现日程/);
});

test("real staged image bytes produce replayable local OCR page evidence", async (t) => {
  const sharp = await import("sharp").catch(() => null);
  if (!sharp) return t.skip("Sharp image renderer is unavailable on this host");
  const root = mkdtempSync(join(realpathSync(tmpdir()), "edupi-ocr-staged-"));
  const originalEnv = Object.fromEntries(["PI_DESKTOP_STATE_DIR", "EDUPI_DATA_ROOT", "EDUPI_CORE_ROOT"].map(key => [key, process.env[key]]));
  try {
    const stateDir = join(root, "state");
    const dataRoot = join(root, "data");
    const coreRoot = join(root, "core");
    mkdirSync(join(dataRoot, ".edupi", "memory"), { recursive: true });
    mkdirSync(coreRoot);
    process.env.PI_DESKTOP_STATE_DIR = stateDir;
    process.env.EDUPI_DATA_ROOT = dataRoot;
    process.env.EDUPI_CORE_ROOT = coreRoot;
    const svg = `<svg width="1600" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="80" y="170" fill="black" font-family="Arial" font-size="84">MEETING ROOM 301</text></svg>`;
    const bytes = await sharp.default(Buffer.from(svg)).png().toBuffer();
    const [staged] = stageMaterialInputs([{ name: "notice.png", mimeType: "image/png", bytes }], { stateDir, dataRoot, coreRoot, idFactory: () => `stg_${"1".repeat(32)}` });
    const extracted = await extractStagedMaterial(staged);
    assert.match(extracted.text, /MEETING/);
    assert.equal(extracted.ocrEvidence?.[0]?.sourceHash, staged.source_hash);
    assert.equal(extracted.images.length, 1);
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("an image-only PDF uses rendered page OCR rather than pretending to have embedded text", async (t) => {
  const sharp = await import("sharp").catch(() => null);
  if (!sharp) return t.skip("Sharp image renderer is unavailable on this host");
  const root = mkdtempSync(join(realpathSync(tmpdir()), "edupi-ocr-pdf-"));
  const originalEnv = Object.fromEntries(["PI_DESKTOP_STATE_DIR", "EDUPI_DATA_ROOT", "EDUPI_CORE_ROOT"].map(key => [key, process.env[key]]));
  try {
    const stateDir = join(root, "state");
    const dataRoot = join(root, "data");
    const coreRoot = join(root, "core");
    mkdirSync(join(dataRoot, ".edupi", "memory"), { recursive: true });
    mkdirSync(coreRoot);
    process.env.PI_DESKTOP_STATE_DIR = stateDir;
    process.env.EDUPI_DATA_ROOT = dataRoot;
    process.env.EDUPI_CORE_ROOT = coreRoot;
    const svg = `<svg width="800" height="1200" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="60" y="230" fill="black" font-family="Arial" font-size="62">MEETING ROOM</text></svg>`;
    const jpeg = await sharp.default(Buffer.from(svg)).jpeg().toBuffer();
    const pdf = imageOnlyPdfFromJpeg(jpeg, 800, 1200);
    const [staged] = stageMaterialInputs([{ name: "scan.pdf", mimeType: "application/pdf", bytes: pdf }],
      { stateDir, dataRoot, coreRoot, idFactory: () => `stg_${"2".repeat(32)}` });
    const extracted = await extractStagedMaterial(staged);
    assert.match(extracted.text, /MEETING/);
    assert.equal(extracted.ocrEvidence?.[0]?.sourceHash, staged.source_hash);
    assert.equal(extracted.images.length, 1);
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("a text PDF over the complete-recognition limit never imports its truncated first page", async (t) => {
  const sharp = await import("sharp").catch(() => null);
  if (!sharp) return t.skip("Sharp image renderer is unavailable on this host");
  const jpeg = await sharp.default({ create: { width: 200, height: 200, channels: 3, background: "white" } }).jpeg().toBuffer();
  const bytes = pdfWithEmbeddedTextFromJpeg(jpeg, 200, 200, "A".repeat(30_001));
  const previousPath = process.env.PATH;
  try {
    process.env.PATH = "";
    await assert.rejects(() => extractStagedMaterial({
      ...descriptor, kind: "pdf", original_name: "too-long.pdf", staging_path: "/private/tmp/too-long.pdf",
      expected_size_bytes: bytes.length,
      source_hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    }, { bytes, extension: ".pdf" }), (error) => error?.code === "ambiguous_schedule");
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
});

test("bundled PDF text extraction follows visual rows and rejects cross-column evidence", async (t) => {
  const sharp = await import("sharp").catch(() => null);
  if (!sharp) return t.skip("Sharp image renderer is unavailable on this host");
  const jpeg = await sharp.default({ create: { width: 360, height: 240, channels: 3, background: "white" } }).jpeg().toBuffer();
  const bytes = pdfWithPositionedTextFromJpeg(jpeg, 360, 240, [
    { text: "2026-09-25", x: 20, y: 180 },
    { text: "EXAM", x: 160, y: 50 },
    { text: "MEETING", x: 160, y: 180 },
    { text: "2026-09-24", x: 20, y: 50 },
  ]);
  const previousPath = process.env.PATH;
  let extracted;
  try {
    process.env.PATH = "";
    extracted = await extractStagedMaterial({ ...descriptor, kind: "pdf", staging_path: "/private/tmp/two-column.pdf",
      source_hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}` }, { bytes, extension: ".pdf" });
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
  assert.equal(extracted.textLayout, "coordinate_rows");
  assert.match(extracted.text, /^2026-09-25 \| MEETING\n2026-09-24 \| EXAM$/u);
  await assert.rejects(() => recognizeStagedMaterial(descriptor, {
    extract: async () => extracted,
    runModel: async () => JSON.stringify({ events: [{ date: "2026-09-25", name: "EXAM", type: "exam",
      evidence_quote: "2026-09-25 | MEETING 2026-09-24 | EXAM" }], slots: [] }),
  }), /同一行|跨栏/u);
});
