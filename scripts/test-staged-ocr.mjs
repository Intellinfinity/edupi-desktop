import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { imageOnlyPdfFromJpeg } from "./image-pdf-fixture.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const resources = resolve(process.env.EDUPI_STAGED_RESOURCES || join(root, "src-tauri", "resources"));
const server = join(resources, "server");
const helper = join(server, "ocr-worker.cjs");
const pdfHelper = join(server, "pdf-page-extract.mjs");
const node = process.platform === "darwin"
  ? join(resources, "Pi Agent Server.app", "Contents", "MacOS", "node")
  : join(resources, "node", process.platform === "win32" ? "node.exe" : "node");
const temp = await mkdtemp(join(tmpdir(), "edupi-staged-ocr-"));

try {
  for (const relativePath of [
    "tesseract.js/src/worker-script/node/index.js",
    "tesseract.js-core/tesseract-core-simd-lstm.wasm",
    "@tesseract.js-data/chi_sim/4.0.0/chi_sim.traineddata.gz",
    "@tesseract.js-data/eng/4.0.0/eng.traineddata.gz",
    "pdfjs-dist/legacy/build/pdf.mjs",
  ]) {
    assert.ok((await readFile(join(server, "node_modules", relativePath))).byteLength > 0, relativePath);
  }
  const image = join(temp, "notice.png");
  const svg = `<svg width="1600" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="80" y="170" fill="black" font-family="Arial,sans-serif" font-size="84">MEETING ROOM 301</text></svg>`;
  await writeFile(image, await sharp(Buffer.from(svg)).png().toBuffer(), { mode: 0o600 });
  const { stdout } = await promisify(execFile)(node, [helper, image], {
    cwd: server,
    env: { NODE_ENV: "production", LANG: "C.UTF-8", TMPDIR: temp },
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.match(stdout, /\tMEETING(?:\r?\n|$)/u);
  const pdfPath = join(temp, "scan.pdf");
  await writeFile(pdfPath, imageOnlyPdfFromJpeg(await sharp(Buffer.from(svg)).jpeg().toBuffer(), 1600, 400), { mode: 0o600 });
  const { stdout: pdfOutput } = await promisify(execFile)(node, [pdfHelper, pdfPath, temp], {
    cwd: server,
    env: { NODE_ENV: "production", LANG: "C.UTF-8", TMPDIR: temp },
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 128 * 1024,
  });
  assert.deepEqual(JSON.parse(pdfOutput), { pageCount: 1, text: "", imageCount: 1 });
  const renderedPage = join(temp, "page-1.png");
  assert.ok((await readFile(renderedPage)).byteLength > 0);
  const { stdout: pageOcr } = await promisify(execFile)(node, [helper, renderedPage], {
    cwd: server,
    env: { NODE_ENV: "production", LANG: "C.UTF-8", TMPDIR: temp },
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.match(pageOcr, /\tMEETING(?:\r?\n|$)/u);
  console.log("Staged offline OCR: bundled Node, PDF rendering, WASM, language data and real image recognition passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
