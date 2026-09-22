import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PRIVATE_DIRECTORY = "edupi-owner-control";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

function unavailable(): Error {
  return Object.assign(new Error("Owner control credential unavailable."), { code: "owner_control_credential_unavailable" });
}

function privateDirectory(stateDir: string): string {
  if (!path.isAbsolute(stateDir)) throw unavailable();
  if (fs.lstatSync(stateDir).isSymbolicLink()) throw unavailable();
  const root = fs.realpathSync(stateDir);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || process.platform !== "win32" && ((rootStat.mode & 0o022) !== 0
    || typeof process.getuid === "function" && rootStat.uid !== process.getuid())) throw unavailable();
  const directory = path.join(root, PRIVATE_DIRECTORY);
  try { fs.mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw unavailable(); }
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || process.platform !== "win32" && (stat.mode & 0o077) !== 0
    || process.platform !== "win32" && typeof process.getuid === "function" && stat.uid !== process.getuid()) throw unavailable();
  return directory;
}

function readToken(file: string): string {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink()) throw unavailable();
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== 43
      || process.platform !== "win32" && (stat.mode & 0o077) !== 0
      || process.platform !== "win32" && typeof process.getuid === "function" && stat.uid !== process.getuid()) throw unavailable();
    if (stat.nlink === 2) {
      const name = path.basename(file);
      const temporary = fs.readdirSync(path.dirname(file)).filter((entry) => entry.startsWith(`${name.slice(0, -4)}.`) && /^[a-f0-9]{32}\.[a-f0-9-]{36}\.tmp$/.test(entry))
        .map((entry) => path.join(path.dirname(file), entry))
        .filter((entry) => {
          const candidate = fs.lstatSync(entry);
          return candidate.isFile() && !candidate.isSymbolicLink() && candidate.dev === stat.dev && candidate.ino === stat.ino
            && candidate.nlink === 2 && candidate.size === stat.size
            && (process.platform === "win32" || (candidate.mode & 0o077) === 0 && (typeof process.getuid !== "function" || candidate.uid === process.getuid()));
        });
      if (temporary.length !== 1) throw unavailable();
      fs.unlinkSync(temporary[0]);
    }
    if (fs.fstatSync(descriptor).nlink !== 1) throw unavailable();
    const value = fs.readFileSync(descriptor, "ascii");
    if (!TOKEN.test(value) || Buffer.from(value, "base64url").length !== 32
      || Buffer.from(value, "base64url").toString("base64url") !== value) throw unavailable();
    return value;
  } finally { fs.closeSync(descriptor); }
}

export function loadOwnerControlToken(stateDir: string | undefined, dataRoot: string): string {
  if (!stateDir || !path.isAbsolute(dataRoot)) throw unavailable();
  try {
    const directory = privateDirectory(stateDir);
    const canonicalDataRoot = fs.realpathSync(dataRoot);
    const relative = path.relative(canonicalDataRoot, directory);
    if (relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw unavailable();
    const name = crypto.createHash("sha256").update(canonicalDataRoot).digest("hex").slice(0, 32);
    const file = path.join(directory, `${name}.key`);
    try { return readToken(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw unavailable(); }

    const output = path.join(canonicalDataRoot, ".edupi", "output");
    const ownerStateExists = (fileName: string) => {
      try { fs.lstatSync(path.join(output, fileName)); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
    };
    if (["ambient-authorization-v1.json", "ambient-conversation-v1.json"].some(ownerStateExists)) throw unavailable();

    const token = crypto.randomBytes(32).toString("base64url");
    const temporary = path.join(directory, `${name}.${crypto.randomUUID()}.tmp`);
    try {
      const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
      try {
        if (fs.writeSync(descriptor, token) !== token.length) throw unavailable();
        fs.fsyncSync(descriptor);
      } finally { fs.closeSync(descriptor); }
      try { fs.linkSync(temporary, file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    } finally { try { fs.unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw unavailable(); } }
    return readToken(file);
  } catch { throw unavailable(); }
}
