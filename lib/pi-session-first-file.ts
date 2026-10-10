import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

type FirstSessionManager = {
  getSessionFile(): string | undefined;
  getHeader(): unknown;
  getEntries(): unknown[];
};

function exactExisting(file: string, expected: Buffer): boolean {
  let descriptor: number | undefined;
  try {
    const before = fs.lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size !== expected.length) return false;
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW);
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) return false;
    const bytes = fs.readFileSync(descriptor);
    return bytes.equals(expected);
  } catch { return false; }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

/** Atomic no-clobber first flush; a partial final file must never authorize Core capture. */
export function persistInitialPiSessionFile(manager: FirstSessionManager, expectedSessionId: string): string {
  const file = manager.getSessionFile();
  const header = manager.getHeader() as { id?: unknown } | null;
  if (!file || !path.isAbsolute(file) || !header || header.id !== expectedSessionId) throw new Error("session_persist_unavailable");
  const bytes = Buffer.from([header, ...manager.getEntries()].map(item => JSON.stringify(item)).join("\n") + "\n", "utf8");
  if (fs.existsSync(file)) {
    if (!exactExisting(file, bytes)) throw new Error("session_persist_conflict");
    return file;
  }
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    fs.linkSync(temporary, file); // link is an atomic create-if-absent on the same filesystem
    if (process.platform !== "win32") {
      const directoryDescriptor = fs.openSync(directory, fs.constants.O_RDONLY | NOFOLLOW);
      try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !exactExisting(file, bytes)) throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch { /* only this random temporary */ }
  }
  if (!exactExisting(file, bytes)) throw new Error("session_persist_conflict");
  return file;
}
