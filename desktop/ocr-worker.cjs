"use strict";

// A short-lived, offline OCR process. The parent limits runtime and output;
// this process only sees one private image snapshot and bundled language data.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { copyFileSync } = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dirname, isAbsolute, join } = require("node:path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createWorker, OEM, PSM } = require("tesseract.js");

async function main(imagePath) {
  if (!imagePath || !isAbsolute(imagePath)) throw new Error("OCR image path is invalid");
  const languagePath = dirname(imagePath);
  for (const language of ["chi_sim", "eng"]) {
    const packageEntry = require.resolve(`@tesseract.js-data/${language}`);
    copyFileSync(
      join(dirname(packageEntry), "4.0.0", `${language}.traineddata.gz`),
      join(languagePath, `${language}.traineddata.gz`),
    );
  }
  const worker = await createWorker(["chi_sim", "eng"], OEM.LSTM_ONLY, {
    langPath: languagePath,
    cacheMethod: "none",
    gzip: true,
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    const { data } = await worker.recognize(imagePath, {}, { text: false, tsv: true });
    if (typeof data.tsv !== "string") throw new Error("OCR TSV is unavailable");
    // Tesseract.js emits the same rows as the CLI `tsv` renderer, but omits
    // its column header. Keep the shared strict parser's input contract.
    process.stdout.write("level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n");
    process.stdout.write(data.tsv);
  } finally {
    await worker.terminate();
  }
}

if (require.main === module) {
  main(process.argv[2]).catch(() => { process.exitCode = 1; });
}

module.exports = { main };
