import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isEduPiManagedPath } from "./edupi-managed-path";

export const MATERIAL_STAGING_MAX_FILES = 10;
export const MATERIAL_STAGING_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MATERIAL_STAGING_MAX_CALENDAR_BYTES = 1024 * 1024;
export const MATERIAL_STAGING_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const MATERIAL_STAGING_MAX_REQUEST_BYTES = MATERIAL_STAGING_MAX_TOTAL_BYTES + 1024 * 1024;

export type MaterialStagingKind = "image" | "pdf" | "word" | "calendar";
export type MaterialStagingErrorCode =
  | "configuration"
  | "forbidden_root"
  | "forbidden_source"
  | "invalid_count"
  | "invalid_name"
  | "invalid_path"
  | "symlink"
  | "too_large"
  | "unsupported_type"
  | "unavailable";

export class MaterialStagingError extends Error {
  constructor(
    public readonly code: MaterialStagingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MaterialStagingError";
  }
}

export type MaterialStagingInput = {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type MaterialStagingDescriptor = {
  staging_id: string;
  staging_path: string;
  original_name: string;
  expected_size_bytes: number;
  source_hash: string;
  kind: MaterialStagingKind;
  source_scope: "desktop_staging";
};

export type MaterialStagingOptions = {
  stateDir?: string;
  dataRoot?: string;
  coreRoot?: string;
  idFactory?: () => string;
};

type ValidatedInput = {
  extension: string;
  kind: MaterialStagingKind;
  originalName: string;
  bytes: Buffer;
};

const STAGING_ID_PATTERN = /^stg_[a-f0-9]{32}$/;
const PENDING_NAME_PATTERN = /^\.pending-stg_[a-f0-9]{32}$/;

function configuredPath(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized.includes("\0") || !path.isAbsolute(normalized)) {
    throw new MaterialStagingError("configuration", `${field} must be an absolute path`);
  }
  return path.resolve(normalized);
}

function canonicalIfPresent(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || normalized.includes("\0") || !path.isAbsolute(normalized)) return null;
  const resolved = path.resolve(normalized);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function prospectivePhysicalPath(target: string): string {
  let existing = target;
  const missingParts: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new MaterialStagingError("configuration", "Desktop state parent is unavailable");
    missingParts.unshift(path.basename(existing));
    existing = parent;
  }
  const existingStat = fs.lstatSync(existing);
  if (!existingStat.isDirectory() && !existingStat.isSymbolicLink()) {
    throw new MaterialStagingError("configuration", "Desktop state parent must be a directory");
  }
  return path.join(fs.realpathSync(existing), ...missingParts);
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function ensurePrivateDirectory(directory: string): string {
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink()) throw new MaterialStagingError("symlink", "Staging directories cannot be symbolic links");
    if (!stat.isDirectory()) throw new MaterialStagingError("configuration", "Staging root must be a directory");
  } else {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
  return fs.realpathSync(directory);
}

function cleanupIncompleteTransactions(stagingRoot: string): void {
  for (const name of fs.readdirSync(stagingRoot)) {
    if (!PENDING_NAME_PATTERN.test(name)) continue;
    const target = path.join(stagingRoot, name);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) fs.unlinkSync(target);
    else if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
    else fs.unlinkSync(target);
  }
}

export function prepareMaterialStagingRoot(options: MaterialStagingOptions = {}): string {
  const stateDir = configuredPath(options.stateDir ?? process.env.PI_DESKTOP_STATE_DIR, "PI_DESKTOP_STATE_DIR");
  if (fs.existsSync(stateDir) && fs.lstatSync(stateDir).isSymbolicLink()) {
    throw new MaterialStagingError("symlink", "Desktop state root cannot be a symbolic link");
  }
  const managedRoots = [
    canonicalIfPresent(options.dataRoot ?? process.env.EDUPI_DATA_ROOT),
    canonicalIfPresent(options.coreRoot ?? process.env.EDUPI_CORE_ROOT),
  ];
  const prospectiveStateRoot = prospectivePhysicalPath(stateDir);
  for (const managed of managedRoots) {
    if (managed && isWithin(managed, prospectiveStateRoot)) {
      throw new MaterialStagingError("forbidden_root", "Desktop staging must be outside EduPi data and Core roots");
    }
  }
  const stateRoot = ensurePrivateDirectory(stateDir);
  for (const managed of managedRoots) {
    if (managed && isWithin(managed, stateRoot)) {
      throw new MaterialStagingError("forbidden_root", "Desktop staging must be outside EduPi data and Core roots");
    }
  }
  const stagingPath = path.join(stateRoot, "material-staging");
  if (fs.existsSync(stagingPath) && fs.lstatSync(stagingPath).isSymbolicLink()) {
    throw new MaterialStagingError("symlink", "Material staging root cannot be a symbolic link");
  }
  const stagingRoot = ensurePrivateDirectory(stagingPath);
  if (!isWithin(stateRoot, stagingRoot)) throw new MaterialStagingError("forbidden_root", "Material staging escaped the desktop state root");
  cleanupIncompleteTransactions(stagingRoot);
  return stagingRoot;
}

function validateName(value: unknown): string {
  if (typeof value !== "string" || !value || value !== value.trim() || value === "." || value === ".."
    || value.includes("\0") || value.includes("/") || value.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(value) || Buffer.byteLength(value, "utf8") > 240
    || path.basename(value) !== value) {
    throw new MaterialStagingError("invalid_name", "Material filename is invalid");
  }
  return value;
}

function hasPrefix(bytes: Buffer, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function hasWebpSignature(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function validateMime(actual: string, allowed: readonly string[]): boolean {
  const normalized = actual.trim().toLowerCase();
  return !normalized || normalized === "application/octet-stream" || allowed.includes(normalized);
}

function hasCalendarSignature(bytes: Buffer): boolean {
  if (bytes.length === 0 || bytes.length > MATERIAL_STAGING_MAX_CALENDAR_BYTES || bytes.includes(0)) return false;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/u, "");
    const normalized = decoded.replace(/\r\n/gu, "\n");
    if (normalized.includes("\r")) return false;
    const lines = normalized.split("\n");
    while (lines[0] === "") lines.shift();
    while (lines.at(-1) === "") lines.pop();
    return lines[0] === "BEGIN:VCALENDAR" && lines.at(-1) === "END:VCALENDAR";
  } catch {
    return false;
  }
}

function classifyInput(name: string, mimeType: string, bytes: Buffer): { extension: string; kind: MaterialStagingKind } {
  const extension = path.extname(name).toLowerCase();
  if (extension === ".png" && validateMime(mimeType, ["image/png"]) && hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { extension, kind: "image" };
  }
  if ((extension === ".jpg" || extension === ".jpeg") && validateMime(mimeType, ["image/jpeg"]) && hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return { extension, kind: "image" };
  }
  if (extension === ".webp" && validateMime(mimeType, ["image/webp"]) && hasWebpSignature(bytes)) {
    return { extension, kind: "image" };
  }
  if (extension === ".pdf" && validateMime(mimeType, ["application/pdf"]) && bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { extension, kind: "pdf" };
  }
  if (extension === ".doc" && validateMime(mimeType, ["application/msword", "application/x-ole-storage"])
    && hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return { extension, kind: "word" };
  }
  if (extension === ".docx" && validateMime(mimeType, ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"])
    && hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return { extension, kind: "word" };
  }
  if (extension === ".ics" && validateMime(mimeType, ["text/calendar", "application/ics"])
    && hasCalendarSignature(bytes)) {
    return { extension, kind: "calendar" };
  }
  throw new MaterialStagingError("unsupported_type", "Material type or file signature is unsupported");
}

function validateInputs(inputs: MaterialStagingInput[]): ValidatedInput[] {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MATERIAL_STAGING_MAX_FILES) {
    throw new MaterialStagingError("invalid_count", `Select between 1 and ${MATERIAL_STAGING_MAX_FILES} files`);
  }
  let totalBytes = 0;
  return inputs.map((input) => {
    const name = validateName(input?.name);
    if (!(input?.bytes instanceof Uint8Array)) throw new MaterialStagingError("unsupported_type", "Material bytes are invalid");
    const bytes = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
    if (bytes.length > MATERIAL_STAGING_MAX_FILE_BYTES) {
      throw new MaterialStagingError("too_large", "Each material must be 25MB or smaller");
    }
    if (path.extname(name).toLowerCase() === ".ics" && bytes.length > MATERIAL_STAGING_MAX_CALENDAR_BYTES) {
      throw new MaterialStagingError("too_large", "ICS calendars must be 1MB or smaller");
    }
    totalBytes += bytes.length;
    if (totalBytes > MATERIAL_STAGING_MAX_TOTAL_BYTES) {
      throw new MaterialStagingError("too_large", "Staged materials must total 100MB or less");
    }
    const classification = classifyInput(name, typeof input.mimeType === "string" ? input.mimeType : "", bytes);
    return { ...classification, originalName: name, bytes };
  });
}

function nextStagingId(stagingRoot: string, idFactory: (() => string) | undefined): string {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const id = idFactory ? idFactory() : `stg_${crypto.randomBytes(16).toString("hex")}`;
    if (!STAGING_ID_PATTERN.test(id)) throw new MaterialStagingError("unavailable", "Generated staging identity is invalid");
    if (!fs.existsSync(path.join(stagingRoot, id)) && !fs.existsSync(path.join(stagingRoot, `.pending-${id}`))) return id;
  }
  throw new MaterialStagingError("unavailable", "Could not allocate a staging identity");
}

export function stageMaterialInputs(inputs: MaterialStagingInput[], options: MaterialStagingOptions = {}): MaterialStagingDescriptor[] {
  const validated = validateInputs(inputs);
  const stagingRoot = prepareMaterialStagingRoot(options);
  const created: string[] = [];
  try {
    return validated.map((input) => {
      const stagingId = nextStagingId(stagingRoot, options.idFactory);
      const pendingDir = path.join(stagingRoot, `.pending-${stagingId}`);
      const finalDir = path.join(stagingRoot, stagingId);
      fs.mkdirSync(pendingDir, { mode: 0o700 });
      created.push(pendingDir);
      const pendingPath = path.join(pendingDir, `material${input.extension}`);
      fs.writeFileSync(pendingPath, input.bytes, { flag: "wx", mode: 0o600 });
      const stagingPath = path.join(finalDir, `material${input.extension}`);
      const descriptor: MaterialStagingDescriptor = {
        staging_id: stagingId,
        staging_path: stagingPath,
        original_name: input.originalName,
        expected_size_bytes: input.bytes.length,
        source_hash: `sha256:${crypto.createHash("sha256").update(input.bytes).digest("hex")}`,
        kind: input.kind,
        source_scope: "desktop_staging",
      };
      const descriptorPath = path.join(pendingDir, "descriptor.json");
      fs.writeFileSync(descriptorPath, `${JSON.stringify(descriptor)}\n`, { flag: "wx", mode: 0o600 });
      if (process.platform !== "win32") {
        fs.chmodSync(pendingDir, 0o700);
        fs.chmodSync(pendingPath, 0o600);
        fs.chmodSync(descriptorPath, 0o600);
      }
      fs.renameSync(pendingDir, finalDir);
      created[created.length - 1] = finalDir;
      const stat = fs.lstatSync(stagingPath);
      if (!stat.isFile() || stat.isSymbolicLink() || !isWithin(stagingRoot, fs.realpathSync(stagingPath))) {
        throw new MaterialStagingError("unavailable", "Staged material verification failed");
      }
      return descriptor;
    });
  } catch (error) {
    for (const target of created.reverse()) fs.rmSync(target, { recursive: true, force: true });
    if (error instanceof MaterialStagingError) throw error;
    throw new MaterialStagingError("unavailable", "Material staging failed");
  }
}

function parseStoredDescriptor(value: unknown, stagingId: string, stagingDir: string): MaterialStagingDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MaterialStagingError("unavailable", "Staged material descriptor is invalid");
  }
  const descriptor = value as Record<string, unknown>;
  const expectedKeys = ["staging_id", "staging_path", "original_name", "expected_size_bytes", "source_hash", "kind", "source_scope"];
  const legacyKeys = expectedKeys.filter((key) => key !== "original_name");
  const keys = Object.keys(descriptor);
  if (!((keys.length === expectedKeys.length && keys.every((key) => expectedKeys.includes(key)))
      || (keys.length === legacyKeys.length && keys.every((key) => legacyKeys.includes(key))))
    || descriptor.staging_id !== stagingId
    || typeof descriptor.staging_path !== "string"
    || !Number.isInteger(descriptor.expected_size_bytes)
    || Number(descriptor.expected_size_bytes) <= 0
    || Number(descriptor.expected_size_bytes) > MATERIAL_STAGING_MAX_FILE_BYTES
    || typeof descriptor.source_hash !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(descriptor.source_hash)
    || (descriptor.kind !== "image" && descriptor.kind !== "pdf" && descriptor.kind !== "word" && descriptor.kind !== "calendar")
    || descriptor.source_scope !== "desktop_staging") {
    throw new MaterialStagingError("unavailable", "Staged material descriptor is invalid");
  }
  const stagingPath = path.resolve(descriptor.staging_path);
  if (!isWithin(stagingDir, stagingPath) || path.dirname(stagingPath) !== stagingDir || !path.basename(stagingPath).startsWith("material.")) {
    throw new MaterialStagingError("unavailable", "Staged material descriptor path is invalid");
  }
  const originalName = descriptor.original_name ?? `material${path.extname(stagingPath).toLowerCase()}`;
  let validatedName: string;
  try {
    validatedName = validateName(originalName);
  } catch {
    throw new MaterialStagingError("unavailable", "Staged material original filename is invalid");
  }
  if (path.extname(validatedName).toLowerCase() !== path.extname(stagingPath).toLowerCase()) {
    throw new MaterialStagingError("unavailable", "Staged material original filename does not match its type");
  }
  return { ...(descriptor as unknown as MaterialStagingDescriptor), original_name: validatedName };
}

export function listStagedMaterials(options: MaterialStagingOptions = {}): MaterialStagingDescriptor[] {
  const stagingRoot = prepareMaterialStagingRoot(options);
  const descriptors: MaterialStagingDescriptor[] = [];
  let totalBytes = 0;
  for (const stagingId of fs.readdirSync(stagingRoot).sort()) {
    if (!STAGING_ID_PATTERN.test(stagingId)) throw new MaterialStagingError("unavailable", "Material staging contains an invalid entry");
    const stagingDir = path.join(stagingRoot, stagingId);
    const directoryStat = fs.lstatSync(stagingDir);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || !isWithin(stagingRoot, fs.realpathSync(stagingDir))) {
      throw new MaterialStagingError("symlink", "Staged material directory is invalid");
    }
    const descriptorPath = path.join(stagingDir, "descriptor.json");
    if (!fs.existsSync(descriptorPath)) throw new MaterialStagingError("unavailable", "Staged material descriptor is missing");
    const descriptorStat = fs.lstatSync(descriptorPath);
    if (!descriptorStat.isFile() || descriptorStat.isSymbolicLink()) throw new MaterialStagingError("symlink", "Staged material descriptor is invalid");
    let stored: unknown;
    try {
      stored = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
    } catch {
      throw new MaterialStagingError("unavailable", "Staged material descriptor is invalid");
    }
    const descriptor = parseStoredDescriptor(stored, stagingId, stagingDir);
    if (!fs.existsSync(descriptor.staging_path)) throw new MaterialStagingError("unavailable", "Staged material file is missing");
    const fileStat = fs.lstatSync(descriptor.staging_path);
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size !== descriptor.expected_size_bytes
      || !isWithin(stagingDir, fs.realpathSync(descriptor.staging_path))) {
      throw new MaterialStagingError("unavailable", "Staged material file does not match its descriptor");
    }
    totalBytes += fileStat.size;
    if (totalBytes > MATERIAL_STAGING_MAX_TOTAL_BYTES) {
      throw new MaterialStagingError("unavailable", "Material staging exceeds its total size limit");
    }
    const bytes = fs.readFileSync(descriptor.staging_path);
    const classification = classifyInput(path.basename(descriptor.staging_path), "", bytes);
    const hash = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
    if (classification.kind !== descriptor.kind || hash !== descriptor.source_hash) {
      throw new MaterialStagingError("unavailable", "Staged material integrity check failed");
    }
    descriptors.push(descriptor);
  }
  return descriptors;
}

function readNativeSource(sourcePath: unknown, options: MaterialStagingOptions, remainingBytes: number): MaterialStagingInput {
  if (typeof sourcePath !== "string" || !sourcePath.trim() || sourcePath.includes("\0") || !path.isAbsolute(sourcePath)) {
    throw new MaterialStagingError("invalid_path", "Native material path is invalid");
  }
  const resolved = path.resolve(sourcePath);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new MaterialStagingError("invalid_path", "Native material file was not found");
  }
  if (stat.isSymbolicLink()) throw new MaterialStagingError("symlink", "Native material cannot be a symbolic link");
  if (!stat.isFile()) throw new MaterialStagingError("invalid_path", "Native material must be a regular file");
  if (stat.size > MATERIAL_STAGING_MAX_FILE_BYTES) throw new MaterialStagingError("too_large", "Each material must be 25MB or smaller");
  if (stat.size > remainingBytes) throw new MaterialStagingError("too_large", "Staged materials must total 100MB or less");
  const physical = fs.realpathSync(resolved);
  const coreRoot = canonicalIfPresent(options.coreRoot ?? process.env.EDUPI_CORE_ROOT);
  if ((coreRoot && isWithin(coreRoot, physical))
    || isEduPiManagedPath(resolved, options.dataRoot ?? process.env.EDUPI_DATA_ROOT, physical)) {
    throw new MaterialStagingError("forbidden_source", "Core and managed EduPi files cannot be restaged");
  }
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(physical, flags);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.size !== stat.size) throw new MaterialStagingError("invalid_path", "Native material changed during staging");
    return { name: path.basename(resolved), mimeType: "", bytes: new Uint8Array(fs.readFileSync(descriptor)) };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function stageMaterialPaths(sourcePaths: unknown[], options: MaterialStagingOptions = {}): MaterialStagingDescriptor[] {
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0 || sourcePaths.length > MATERIAL_STAGING_MAX_FILES) {
    throw new MaterialStagingError("invalid_count", `Select between 1 and ${MATERIAL_STAGING_MAX_FILES} files`);
  }
  let totalBytes = 0;
  const inputs = sourcePaths.map((sourcePath) => {
    const input = readNativeSource(sourcePath, options, MATERIAL_STAGING_MAX_TOTAL_BYTES - totalBytes);
    totalBytes += input.bytes.byteLength;
    return input;
  });
  return stageMaterialInputs(inputs, options);
}

export function settleStagedMaterial(
  stagingId: string,
  outcome: "accepted_receipt" | "failed" | "teacher_cleanup",
  options: MaterialStagingOptions = {},
): { removed: boolean; retained: boolean } {
  if (!STAGING_ID_PATTERN.test(stagingId)) throw new MaterialStagingError("invalid_path", "Staging identity is invalid");
  const stagingRoot = prepareMaterialStagingRoot(options);
  const target = path.join(stagingRoot, stagingId);
  if (outcome === "failed") return { removed: false, retained: fs.existsSync(target) };
  if (outcome !== "accepted_receipt" && outcome !== "teacher_cleanup") {
    throw new MaterialStagingError("invalid_path", "Staging settlement is invalid");
  }
  if (!fs.existsSync(target)) return { removed: false, retained: false };
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !isWithin(stagingRoot, fs.realpathSync(target))) {
    throw new MaterialStagingError("symlink", "Staging settlement target is invalid");
  }
  fs.rmSync(target, { recursive: true, force: true });
  return { removed: true, retained: false };
}
