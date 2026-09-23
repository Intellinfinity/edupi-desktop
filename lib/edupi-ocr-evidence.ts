import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OcrBox = { left: number; top: number; width: number; height: number };
export type OcrLine = { text: string; box: OcrBox; minConfidence: number };
export type OcrPageEvidence = {
  sourceHash: string;
  imageHash: string;
  pageNumber: number;
  width: number;
  height: number;
  text: string;
  lines: OcrLine[];
};

const HEADER = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
const MIN_WORD_CONFIDENCE = 85;
const MAX_OCR_ROWS = 10_000;
const MAX_OCR_TEXT_CHARS = 30_000;

function integer(value: string, minimum: number, maximum: number): number {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw new Error("OCR coordinate is invalid");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error("OCR coordinate is invalid");
  return parsed;
}

/** Tesseract 5 TSV level 5 rows carry word text, bounding box and confidence.
 * Source: https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html#tsv-output */
export function parseTesseractTsv(
  tsv: string,
  input: { sourceHash: string; pageNumber: number; imageBytes: Uint8Array },
): OcrPageEvidence {
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.sourceHash) || !Number.isInteger(input.pageNumber)
    || input.pageNumber < 1 || input.pageNumber > 3 || input.imageBytes.byteLength < 1
    || input.imageBytes.byteLength > 10 * 1024 * 1024) throw new Error("OCR source is invalid");
  const rows = tsv.replace(/\r\n/gu, "\n").replace(/\n+$/u, "").split("\n");
  if (rows[0] !== HEADER || rows.length < 2 || rows.length > MAX_OCR_ROWS) throw new Error("OCR TSV header is invalid");
  const page = rows[1].split("\t");
  if (page.length !== 12 || page[0] !== "1" || page[1] !== "1"
    || page[6] !== "0" || page[7] !== "0") throw new Error("OCR page row is invalid");
  const width = integer(page[8], 1, 20_000);
  const height = integer(page[9], 1, 20_000);
  const lines = new Map<string, Array<{ text: string; confidence: number; box: OcrBox }>>();
  const words = new Set<string>();
  for (const row of rows.slice(2)) {
    const columns = row.split("\t");
    if (columns.length !== 12) throw new Error("OCR TSV row is invalid");
    if (columns[0] !== "5") continue;
    if (columns[1] !== "1") throw new Error("OCR word page is invalid");
    const block = integer(columns[2], 1, 10_000);
    const paragraph = integer(columns[3], 1, 10_000);
    const line = integer(columns[4], 1, 10_000);
    const word = integer(columns[5], 1, 10_000);
    const left = integer(columns[6], 0, width - 1);
    const top = integer(columns[7], 0, height - 1);
    const boxWidth = integer(columns[8], 1, width);
    const boxHeight = integer(columns[9], 1, height);
    if (left + boxWidth > width || top + boxHeight > height) throw new Error("OCR word box is outside the image");
    const confidence = Number(columns[10]);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) throw new Error("OCR confidence is invalid");
    const content = columns[11].normalize("NFKC").trim();
    if (!content || /[\u0000-\u001f\u007f]/u.test(content) || content.length > 300) throw new Error("OCR word text is invalid");
    const lineKey = `${block}:${paragraph}:${line}`;
    const wordKey = `${lineKey}:${word}`;
    if (words.has(wordKey)) throw new Error("OCR word is duplicated");
    words.add(wordKey);
    const group = lines.get(lineKey) ?? [];
    group.push({ text: content, confidence, box: { left, top, width: boxWidth, height: boxHeight } });
    lines.set(lineKey, group);
  }
  const trusted: OcrLine[] = [];
  for (const group of lines.values()) {
    if (group.some(item => item.confidence < MIN_WORD_CONFIDENCE)) continue;
    const left = Math.min(...group.map(item => item.box.left));
    const top = Math.min(...group.map(item => item.box.top));
    const right = Math.max(...group.map(item => item.box.left + item.box.width));
    const bottom = Math.max(...group.map(item => item.box.top + item.box.height));
    trusted.push({
      text: group.map(item => item.text).join(" "),
      box: { left, top, width: right - left, height: bottom - top },
      minConfidence: Math.min(...group.map(item => item.confidence)),
    });
  }
  const text = trusted.map(line => line.text).join("\n");
  if (text.length > MAX_OCR_TEXT_CHARS) throw new Error("OCR text is too long");
  return {
    sourceHash: input.sourceHash,
    imageHash: `sha256:${createHash("sha256").update(input.imageBytes).digest("hex")}`,
    pageNumber: input.pageNumber,
    width,
    height,
    text,
    lines: trusted,
  };
}

export type OcrRunOptions = { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number };
export type OcrRunner = (filePath: string, args: string[], options: OcrRunOptions) => Promise<string>;

/** Run local Tesseract without model credentials; unavailable OCR never becomes trusted text.
 * Source: https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html#tsv-output */
export async function extractTrustedOcrPage(
  input: { sourceHash: string; pageNumber: number; imageBytes: Uint8Array; mimeType: string },
  dependencies: { run?: OcrRunner } = {},
): Promise<OcrPageEvidence | null> {
  const extension = ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" } as Record<string, string>)[input.mimeType];
  if (!extension || !/^sha256:[a-f0-9]{64}$/u.test(input.sourceHash)
    || !Number.isInteger(input.pageNumber) || input.pageNumber < 1 || input.pageNumber > 3
    || input.imageBytes.byteLength < 1 || input.imageBytes.byteLength > 10 * 1024 * 1024) return null;
  const directory = await mkdtemp(join(realpathSync(tmpdir()), "edupi-ocr-page-"));
  const filePath = join(directory, `page${extension}`);
  try {
    await writeFile(filePath, input.imageBytes, { flag: "wx", mode: 0o600 });
    const workerPath = [join(process.cwd(), "ocr-worker.cjs"), join(process.cwd(), "desktop", "ocr-worker.cjs")]
      .find(candidate => existsSync(candidate));
    if (!workerPath) return null;
    const args = ["--max-old-space-size=512", workerPath, filePath];
    const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "production", LANG: "C.UTF-8", TMPDIR: directory };
    const options: OcrRunOptions = { env, timeout: 45_000, maxBuffer: 2 * 1024 * 1024 };
    const output = dependencies.run
      ? await dependencies.run(filePath, args, options)
      : (await execFileAsync(process.execPath, args, { ...options, encoding: "utf8", windowsHide: true })).stdout;
    // Re-read the private snapshot after OCR so a subprocess cannot change the
    // bytes whose hash is recorded as evidence.
    const verifiedBytes = await readFile(filePath);
    if (!verifiedBytes.equals(Buffer.from(input.imageBytes))) return null;
    return parseTesseractTsv(output, { sourceHash: input.sourceHash, pageNumber: input.pageNumber, imageBytes: verifiedBytes });
  } catch {
    return null;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
