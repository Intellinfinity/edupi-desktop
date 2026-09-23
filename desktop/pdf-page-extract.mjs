import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_TEXT_CHARS = 30_000;
const MAX_TEXT_PAGES = 100;
const MAX_SCAN_PAGES = 3;

function positionedTextRows(items, pageWidth) {
  const words = items.filter(item => "str" in item && item.str.trim()).map(item => {
    const x = item.transform?.[4];
    const y = item.transform?.[5];
    if (![x, y, item.width, item.height].every(Number.isFinite)) throw new Error("PDF text position is invalid");
    return { text: item.str.trim(), x, y, right: x + item.width, height: item.height };
  });
  words.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const word of words) {
    const previous = rows.at(-1);
    if (previous && Math.abs(previous.y - word.y) <= Math.max(2, Math.min(previous.height, word.height) * 0.4)) {
      previous.words.push(word);
    } else rows.push({ y: word.y, height: word.height, words: [word] });
  }
  return rows.map(row => {
    row.words.sort((a, b) => a.x - b.x);
    let line = "";
    let previous = null;
    for (const word of row.words) {
      if (previous) line += word.x - previous.right > Math.max(24, pageWidth * 0.1) ? " | " : " ";
      line += word.text;
      previous = word;
    }
    return line;
  }).join("\n");
}

async function main(pdfPath, outputDirectory) {
  if (!pdfPath || !outputDirectory || !isAbsolute(pdfPath) || !isAbsolute(outputDirectory)) {
    throw new Error("PDF paths are invalid");
  }
  const task = getDocument({
    data: new Uint8Array(await readFile(pdfPath)),
    useSystemFonts: true,
    disableAutoFetch: true,
    disableStream: true,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages < 1 || pdf.numPages > MAX_TEXT_PAGES) throw new Error("PDF page count is unsupported");
    let text = "";
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = positionedTextRows(content.items, page.getViewport({ scale: 1 }).width);
      text += `${pageText}\n`;
      page.cleanup();
      if (text.length > MAX_TEXT_CHARS) {
        process.stdout.write(JSON.stringify({ pageCount: pdf.numPages, text: "", imageCount: 0, tooLong: true }));
        return;
      }
    }
    if (text.trim().length >= 20) {
      process.stdout.write(JSON.stringify({ pageCount: pdf.numPages, text, imageCount: 0 }));
      return;
    }
    if (pdf.numPages > MAX_SCAN_PAGES) {
      process.stdout.write(JSON.stringify({ pageCount: pdf.numPages, text: "", imageCount: 0 }));
      return;
    }
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = 1600 / Math.max(baseViewport.width, baseViewport.height);
      const viewport = page.getViewport({ scale });
      const { canvas, context } = pdf.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: context, viewport }).promise;
      await writeFile(join(outputDirectory, `page-${pageNumber}.png`), canvas.toBuffer("image/png"), { flag: "wx", mode: 0o600 });
      page.cleanup();
    }
    process.stdout.write(JSON.stringify({ pageCount: pdf.numPages, text: "", imageCount: pdf.numPages }));
  } finally {
    await task.destroy();
  }
}

main(process.argv[2], process.argv[3]).catch(() => { process.exitCode = 1; });
