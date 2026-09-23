import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import JSZip from "jszip";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const resources = resolve(process.env.EDUPI_STAGED_RESOURCES || join(root, "src-tauri", "resources"));
const server = join(resources, "server");
const worker = join(server, "docx-text-worker.cjs");
const node = process.platform === "darwin"
  ? join(resources, "Pi Agent Server.app", "Contents", "MacOS", "node")
  : join(resources, "node", process.platform === "win32" ? "node.exe" : "node");
const temporaryRoot = await mkdtemp(join(tmpdir(), "edupi-staged-docx-"));

try {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>2026年11月12日 同名配对会</w:t></w:r></w:p></w:body></w:document>`);
  const docxPath = join(temporaryRoot, "notice.docx");
  await writeFile(docxPath, await zip.generateAsync({ type: "nodebuffer" }), { mode: 0o600 });
  const { stdout } = await promisify(execFile)(node, [worker, docxPath], {
    cwd: server, env: { NODE_ENV: "production", LANG: "C.UTF-8", TMPDIR: temporaryRoot },
    encoding: "utf8", timeout: 20_000, maxBuffer: 128 * 1024, windowsHide: true,
  });
  assert.match(stdout, /2026年11月12日 同名配对会/u);
  console.log("Staged DOCX: bundled Node and Mammoth extracted a real document");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
