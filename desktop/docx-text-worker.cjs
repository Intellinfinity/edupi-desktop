"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mammoth = require("mammoth");

const filePath = process.argv[2];
if (!filePath) process.exitCode = 2;
else mammoth.extractRawText({ path: filePath }).then(
  result => process.stdout.write(String(result.value || "").slice(0, 30_001)),
  () => { process.exitCode = 2; },
);
