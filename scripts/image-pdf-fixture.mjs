/** One-page PDF fixture with exact byte offsets; no PDF toolchain required. */
function pdfFromJpeg(jpeg, width, height, embeddedText, positionedText = []) {
  if (!Buffer.isBuffer(jpeg) || !jpeg.length || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width > 10_000 || height > 10_000) throw new Error("Invalid PDF fixture image");
  if (typeof embeddedText !== "string" || /[^\x20-\x7e]/u.test(embeddedText)) throw new Error("Invalid PDF fixture text");
  if (!Array.isArray(positionedText) || positionedText.some(item => !item || !Number.isFinite(item.x)
    || !Number.isFinite(item.y) || typeof item.text !== "string" || /[^\x20-\x7e]/u.test(item.text))) {
    throw new Error("Invalid positioned PDF fixture text");
  }
  const hasText = Boolean(embeddedText || positionedText.length);
  const parts = [];
  const offsets = [0];
  let length = 0;
  function append(value) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "latin1");
    parts.push(bytes);
    length += bytes.length;
  }
  function object(number, body) {
    offsets[number] = length;
    append(`${number} 0 obj\n`);
    append(body);
    append("\nendobj\n");
  }
  append("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> ${hasText ? "/Font << /F1 6 0 R >>" : ""} >> /Contents 5 0 R >>`);
  offsets[4] = length;
  append(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  append(jpeg);
  append("\nendstream\nendobj\n");
  const textCommands = embeddedText.match(/.{1,20}/gu)?.map(chunk =>
    `BT /F1 12 Tf 20 20 Td (${chunk.replace(/[()\\]/gu, "\\$&")}) Tj ET\n`).join("") ?? "";
  const positionedCommands = positionedText.map(item =>
    `BT /F1 12 Tf ${item.x} ${item.y} Td (${item.text.replace(/[()\\]/gu, "\\$&")}) Tj ET\n`).join("");
  const commands = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\n${textCommands}${positionedCommands}`;
  offsets[5] = length;
  append(`5 0 obj\n<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}endstream\nendobj\n`);
  if (hasText) object(6, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const xref = length;
  const objectCount = hasText ? 6 : 5;
  append(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let number = 1; number <= objectCount; number++) append(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
  append(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

export const imageOnlyPdfFromJpeg = (jpeg, width, height) => pdfFromJpeg(jpeg, width, height, "");
export const pdfWithEmbeddedTextFromJpeg = (jpeg, width, height, text) => pdfFromJpeg(jpeg, width, height, text);
export const pdfWithPositionedTextFromJpeg = (jpeg, width, height, items) => pdfFromJpeg(jpeg, width, height, "", items);
