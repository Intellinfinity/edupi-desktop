import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createJiti } from "jiti";

const { extractTrustedOcrPage, parseTesseractTsv } = await createJiti(import.meta.url).import("./edupi-ocr-evidence.ts");

const header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
const page = "1\t1\t0\t0\t0\t0\t0\t0\t1200\t800\t-1\t";

test("high-confidence OCR words retain page coordinates and an image hash", () => {
  const tsv = [header, page,
    "5\t1\t1\t1\t1\t1\t20\t30\t180\t40\t96.5\t教研会议",
    "5\t1\t1\t1\t1\t2\t220\t30\t200\t40\t94.0\t2026年9月24日",
    "5\t1\t1\t1\t2\t1\t20\t90\t240\t40\t91.0\t09:00-10:00",
    "5\t1\t1\t1\t2\t2\t280\t90\t120\t40\t92.0\t会议室",
  ].join("\n");
  const result = parseTesseractTsv(tsv, {
    sourceHash: `sha256:${"a".repeat(64)}`, pageNumber: 1, imageBytes: Buffer.from("verified page image"),
  });
  assert.equal(result.text, "教研会议 2026年9月24日\n09:00-10:00 会议室");
  assert.equal(result.lines.length, 2);
  assert.deepEqual(result.lines[0].box, { left: 20, top: 30, width: 400, height: 40 });
  assert.equal(result.lines[0].minConfidence, 94);
  assert.match(result.imageHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.sourceHash, `sha256:${"a".repeat(64)}`);
});

test("a low-confidence token excludes its entire line from trusted OCR text", () => {
  const tsv = [header, page,
    "5\t1\t1\t1\t1\t1\t20\t30\t100\t40\t96\t会议",
    "5\t1\t1\t1\t1\t2\t130\t30\t100\t40\t45\t09:00",
    "5\t1\t1\t1\t2\t1\t20\t90\t100\t40\t90\t地点",
  ].join("\n");
  const result = parseTesseractTsv(tsv, {
    sourceHash: `sha256:${"b".repeat(64)}`, pageNumber: 1, imageBytes: Buffer.from("image"),
  });
  assert.equal(result.text, "地点");
  assert.equal(result.lines.length, 1);
});

test("malformed headers, impossible boxes, duplicate words and wrong page are rejected", () => {
  const input = { sourceHash: `sha256:${"c".repeat(64)}`, pageNumber: 1, imageBytes: Buffer.from("image") };
  assert.throws(() => parseTesseractTsv("bad header", input));
  assert.throws(() => parseTesseractTsv([header, page, "5\t1\t1\t1\t1\t1\t1190\t30\t30\t40\t96\t越界"].join("\n"), input));
  const word = "5\t1\t1\t1\t1\t1\t20\t30\t100\t40\t96\t会议";
  assert.throws(() => parseTesseractTsv([header, page, word, word].join("\n"), input));
  assert.throws(() => parseTesseractTsv([header, page, "5\t2\t1\t1\t1\t1\t20\t30\t100\t40\t96\t错页"].join("\n"), input));
});

test("a blank but well-formed page has no trusted OCR text", () => {
  const result = parseTesseractTsv([header, page, ""].join("\n"), {
    sourceHash: `sha256:${"d".repeat(64)}`, pageNumber: 1, imageBytes: Buffer.from("blank page"),
  });
  assert.equal(result.text, "");
  assert.deepEqual(result.lines, []);
});

test("OCR subprocess receives only a private verified image and a bounded, secret-free environment", async () => {
  const imageBytes = Buffer.from("synthetic page bytes");
  let snapshotPath = "";
  const evidence = await extractTrustedOcrPage({
    sourceHash: `sha256:${"e".repeat(64)}`, pageNumber: 1, imageBytes, mimeType: "image/png",
  }, {
    run: async (filePath, args, options) => {
      snapshotPath = filePath;
      assert.deepEqual(readFileSync(filePath), imageBytes);
      assert.equal(args[0], "--max-old-space-size=512");
      assert.match(args[1], /ocr-worker\.cjs$/);
      assert.equal(args[2], filePath);
      assert.equal(options.env.OPENAI_API_KEY, undefined);
      assert.equal(options.env.HOME, undefined);
      return [header, page, "5\t1\t1\t1\t1\t1\t20\t30\t100\t40\t96\t会议"].join("\n");
    },
  });
  assert.equal(evidence?.text, "会议");
  assert.equal(existsSync(snapshotPath), false);
});

test("failed offline OCR worker returns no trusted evidence without inventing text", async () => {
  const result = await extractTrustedOcrPage({
    sourceHash: `sha256:${"f".repeat(64)}`, pageNumber: 1, imageBytes: Buffer.from("image"), mimeType: "image/png",
  }, { run: async () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; } });
  assert.equal(result, null);
});

test("the bundled offline OCR worker reads a real synthetic printed page", async (t) => {
  const sharp = await import("sharp").catch(() => null);
  if (!sharp) return t.skip("Sharp image renderer is unavailable on this host");
  const svg = `<svg width="1600" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="80" y="170" fill="black" font-family="Arial" font-size="84">MEETING ROOM 301</text></svg>`;
  const imageBytes = await sharp.default(Buffer.from(svg)).png().toBuffer();
  const sourceHash = `sha256:${createHash("sha256").update(imageBytes).digest("hex")}`;
  const result = await extractTrustedOcrPage({ sourceHash, pageNumber: 1, imageBytes, mimeType: "image/png" });
  assert.ok(result, "verified OCR evidence should exist for a clear printed page");
  assert.match(result.text, /MEETING/);
  assert.equal(result.sourceHash, sourceHash);
});
