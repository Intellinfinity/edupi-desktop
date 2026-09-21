import { createHash } from "node:crypto";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writePrivateFileAtomicSync } from "./atomic-file";
import type { ResolvedEduPiCore, ResolvedEduPiDataRoot } from "./edupi-core-root";

const RUNTIME_DB = "core-runtime-v1.sqlite";
const ADMISSION_DB = "core-runtime-writer-admission-v1.sqlite";
const FINGERPRINT_RE = /^sha256:[a-f0-9]{64}$/u;
const OPAQUE_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]*$/u;
const LEASE_KIND_RE = /^(?:daemon|legacy_[a-z0-9][a-z0-9_]{0,47})$/u;
const RECOVERY_BUSY_TIMEOUT_MS = 1_000;
const RUNTIME_SCHEMA_HASH = "sha256:9c8102dbe07242944b86693bc125d068ab90af632f84a7d0739d32c7e698c048";
const ADMISSION_SCHEMA_HASH = "sha256:67793e028ea8bee40542f071ae4f91194b83ba070c0dfabb2ab853b4695dc3f5";
const REPAIR_INTENT = "core-runtime-root-repair-v1.json";

export type RuntimeRecoveryStatus = "clean" | "stale" | "blocked" | "unavailable";

export type RuntimeRecoveryInspection = {
  status: RuntimeRecoveryStatus;
  runtimeFingerprint: string | null;
  admissionFingerprint: string | null;
  currentFingerprint: string;
  reason: string | null;
  files: string[];
};

export type RuntimeRecoveryResult = RuntimeRecoveryInspection & {
  repaired: boolean;
  backups: string[];
};

type CoreRuntimeRootModule = {
  prepareCoreRuntimeRoot?: (configuredRoot: string) => { ok: boolean; dataRootFingerprint?: string };
};

type RepairIntent = {
  version: 1;
  state: "prepared" | "runtime_committed";
  targetFingerprint: string;
  sourceFingerprint: string;
  runtimeBackup: string;
  admissionBackup: string;
};

type RecoveryHooks = { afterRuntimeCommit?: () => void };

function runtimeDirectory(dataRoot: ResolvedEduPiDataRoot): string {
  return path.join(dataRoot.root, ".edupi", "runtime");
}

function runtimePath(dataRoot: ResolvedEduPiDataRoot, name: string): string {
  const root = runtimeDirectory(dataRoot);
  const candidate = path.join(root, name);
  if (path.dirname(candidate) !== root) throw new Error("Runtime path escaped data root");
  return candidate;
}

function intentPath(dataRoot: ResolvedEduPiDataRoot): string {
  return runtimePath(dataRoot, REPAIR_INTENT);
}

function normalizeSchemaSql(sql: unknown): string {
  if (typeof sql !== "string" || !sql.trim()) throw new Error("Core Runtime schema is invalid");
  let normalized = "";
  let quote: string | null = null;
  let pendingSpace = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      normalized += character;
      if (character === quote) {
        if (sql[index + 1] === quote) {
          index += 1;
          normalized += sql[index];
        }
        else quote = null;
      }
    } else if (character === "'" || character === '"') {
      if (pendingSpace && normalized) normalized += " ";
      pendingSpace = false;
      quote = character;
      normalized += character;
    } else if (/\s/u.test(character)) pendingSpace = true;
    else {
      if (pendingSpace && normalized) normalized += " ";
      pendingSpace = false;
      normalized += character;
    }
  }
  if (quote) throw new Error("Core Runtime schema is invalid");
  normalized = normalized.trim();
  return normalized.endsWith(";") ? normalized.slice(0, -1).trimEnd() : normalized;
}

function schemaHash(db: DatabaseSync): string {
  const inventory = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name, tbl_name").all()
    .map((row) => ({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: normalizeSchemaSql(row.sql) }));
  return `sha256:${createHash("sha256").update(JSON.stringify(inventory), "utf8").digest("hex")}`;
}

function validatePinnedSchema(db: DatabaseSync, kind: "runtime" | "admission"): void {
  const version = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? -1);
  const expected = kind === "runtime" ? RUNTIME_SCHEMA_HASH : ADMISSION_SCHEMA_HASH;
  if (version !== 1 || schemaHash(db) !== expected) throw new Error("Core Runtime schema is incompatible");
}

function readRepairIntent(dataRoot: ResolvedEduPiDataRoot): RepairIntent | null {
  const file = intentPath(dataRoot);
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 8 * 1024) throw new Error("Core Runtime repair state is invalid");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Core Runtime repair state is invalid");
  const value = parsed as Partial<RepairIntent>;
  const expectedKeys = ["version", "state", "targetFingerprint", "sourceFingerprint", "runtimeBackup", "admissionBackup"].sort();
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])
    || value.version !== 1 || !["prepared", "runtime_committed"].includes(String(value.state))
    || typeof value.targetFingerprint !== "string" || !FINGERPRINT_RE.test(value.targetFingerprint)
    || typeof value.sourceFingerprint !== "string" || !FINGERPRINT_RE.test(value.sourceFingerprint)
    || typeof value.runtimeBackup !== "string" || !/^core-runtime-v1\.sqlite\.before-root-repair-\d+-\d+$/u.test(value.runtimeBackup)
    || typeof value.admissionBackup !== "string" || !/^core-runtime-writer-admission-v1\.sqlite\.before-root-repair-\d+-\d+$/u.test(value.admissionBackup)) {
    throw new Error("Core Runtime repair state is invalid");
  }
  return value as RepairIntent;
}

function validateIntentBackups(dataRoot: ResolvedEduPiDataRoot, intent: RepairIntent): string[] {
  const pairs = [
    [runtimePath(dataRoot, intent.runtimeBackup), "runtime"],
    [runtimePath(dataRoot, intent.admissionBackup), "admission"],
  ] as const;
  for (const [file, kind] of pairs) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Core Runtime repair backup is invalid");
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      validatePinnedSchema(db, kind);
      const fingerprint = kind === "runtime" ? runtimeMetadata(db).fingerprint : admissionMetadata(db).fingerprint;
      if (fingerprint !== intent.sourceFingerprint) throw new Error("Core Runtime repair backup is invalid");
    } finally {
      db.close();
    }
  }
  return pairs.map(([file]) => file);
}

function writeRepairIntent(dataRoot: ResolvedEduPiDataRoot, value: RepairIntent): void {
  writePrivateFileAtomicSync(intentPath(dataRoot), `${JSON.stringify(value)}\n`);
}

function clearRepairIntent(dataRoot: ResolvedEduPiDataRoot): void {
  try { fs.unlinkSync(intentPath(dataRoot)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

function isLive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function exactMetadata(db: DatabaseSync, table: "runtime_meta" | "admission_meta", versionKey: "schema_version" | "admission_version"): Record<string, string> {
  const rows = db.prepare(`SELECT key, value FROM ${table} ORDER BY key`).all() as Array<{ key?: unknown; value?: unknown }>;
  const expectedKeys = [versionKey, "root_fingerprint"].sort();
  if (rows.length !== 2 || rows.some((row, index) => row.key !== expectedKeys[index] || typeof row.value !== "string")) {
    throw new Error("Core Runtime metadata is incompatible");
  }
  const metadata = Object.fromEntries(rows.map((row) => [row.key as string, row.value as string]));
  if (metadata[versionKey] !== "1" || !FINGERPRINT_RE.test(metadata.root_fingerprint)) {
    throw new Error("Core Runtime metadata is incompatible");
  }
  return metadata;
}

function canonicalIso(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { return new Date(value).toISOString() === value; }
  catch { return false; }
}

function validOpaque(value: unknown): boolean {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= 512 && OPAQUE_RE.test(value);
}

function runtimeMetadata(db: DatabaseSync) {
  const metadata = exactMetadata(db, "runtime_meta", "schema_version");
  const rows = db.prepare("SELECT * FROM authority").all() as Array<Record<string, unknown>>;
  const authority = rows[0];
  if (rows.length !== 1 || Number(authority?.singleton) !== 1 || Number(authority?.schema_version) !== 1
    || authority.root_fingerprint !== metadata.root_fingerprint
    || !Number.isSafeInteger(Number(authority.fencing_generation)) || Number(authority.fencing_generation) < 1
    || !Number.isSafeInteger(Number(authority.owner_pid)) || Number(authority.owner_pid) < 1
    || !validOpaque(authority.process_start_evidence) || !validOpaque(authority.instance_nonce) || !validOpaque(authority.supervisor_session_id)
    || !["starting", "ready", "degraded", "draining", "failed", "stopped"].includes(String(authority.lifecycle))
    || !canonicalIso(authority.acquired_at) || !canonicalIso(authority.updated_at)) {
    throw new Error("Core Runtime authority is incompatible");
  }
  return { fingerprint: metadata.root_fingerprint, authority };
}

function admissionMetadata(db: DatabaseSync) {
  const metadata = exactMetadata(db, "admission_meta", "admission_version");
  const rows = db.prepare("SELECT * FROM admission_lease ORDER BY singleton").all() as Array<Record<string, unknown>>;
  const lease = rows[0] ?? null;
  if (rows.length > 1 || lease && (
    Number(lease.singleton) !== 1
    || Number(lease.admission_version) !== 1
    || lease.root_fingerprint !== metadata.root_fingerprint
    || !LEASE_KIND_RE.test(String(lease.lease_kind))
    || !Number.isSafeInteger(Number(lease.owner_pid))
    || Number(lease.owner_pid) < 1
    || !validOpaque(lease.process_start_evidence)
    || !validOpaque(lease.lease_id)
    || !canonicalIso(lease.acquired_at)
  )) {
    throw new Error("Core writer admission lease is incompatible");
  }
  return { fingerprint: metadata.root_fingerprint, lease };
}

function inspectDatabase(file: string, kind: "runtime" | "admission"): { fingerprint: string | null; blocked: boolean; needsRepair: boolean; reason: string | null } {
  if (!fs.existsSync(file)) return { fingerprint: null, blocked: false, needsRepair: false, reason: null };
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) return { fingerprint: null, blocked: true, needsRepair: false, reason: "运行状态文件不是普通文件" };
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    validatePinnedSchema(db, kind);
    if (kind === "admission") {
      const state = admissionMetadata(db);
      const fingerprint = state.fingerprint;
      if (state.lease && isLive(Number(state.lease.owner_pid))) {
        return { fingerprint, blocked: true, needsRepair: true, reason: "Core 正在持有 writer admission" };
      }
      return { fingerprint, blocked: false, needsRepair: Boolean(state.lease), reason: null };
    } else {
      const state = runtimeMetadata(db);
      if (isLive(Number(state.authority.owner_pid))) {
        return { fingerprint: state.fingerprint, blocked: true, needsRepair: false, reason: "Core Runtime owner 进程仍存在" };
      }
      return { fingerprint: state.fingerprint, blocked: false, needsRepair: false, reason: null };
    }
  } finally {
    db.close();
  }
}

export function inspectEduPiRuntimeRecovery(
  dataRoot: ResolvedEduPiDataRoot,
  currentFingerprint: string,
): RuntimeRecoveryInspection {
  if (!FINGERPRINT_RE.test(currentFingerprint)) throw new Error("Invalid Core Runtime root fingerprint");
  const files = [RUNTIME_DB, ADMISSION_DB].filter((name) => fs.existsSync(runtimePath(dataRoot, name)));
  if (files.length !== 2) {
    return {
      status: "unavailable",
      runtimeFingerprint: null,
      admissionFingerprint: null,
      currentFingerprint,
      reason: "Core Runtime state is incomplete",
      files,
    };
  }
  try {
    const runtime = inspectDatabase(runtimePath(dataRoot, RUNTIME_DB), "runtime");
    const admission = inspectDatabase(runtimePath(dataRoot, ADMISSION_DB), "admission");
    const fingerprints = [runtime.fingerprint, admission.fingerprint].filter((value): value is string => Boolean(value));
    const stale = runtime.needsRepair || admission.needsRepair || fingerprints.some((value) => value !== currentFingerprint);
    const blocked = stale && (runtime.blocked || admission.blocked);
    return {
      status: !stale ? "clean" : blocked ? "blocked" : "stale",
      runtimeFingerprint: runtime.fingerprint,
      admissionFingerprint: admission.fingerprint,
      currentFingerprint,
      reason: stale ? runtime.reason || admission.reason || null : null,
      files,
    };
  } catch (error) {
    return {
      status: "unavailable",
      runtimeFingerprint: null,
      admissionFingerprint: null,
      currentFingerprint,
      reason: error instanceof Error ? error.message : String(error),
      files,
    };
  }
}

async function backupDatabase(file: string, stamp: string): Promise<string> {
  const backupPath = `${file}.before-root-repair-${stamp}`;
  if (fs.existsSync(backupPath)) throw new Error("Core Runtime backup already exists");
  const source = new DatabaseSync(file, { readOnly: true });
  try {
    await sqliteBackup(source, backupPath);
    fs.chmodSync(backupPath, 0o600);
    return backupPath;
  } finally {
    source.close();
  }
}

function changedRows(result: { changes?: number | bigint }): number {
  return typeof result.changes === "bigint" ? Number(result.changes) : Number(result.changes ?? 0);
}

export async function repairEduPiRuntimeState(
  dataRoot: ResolvedEduPiDataRoot,
  currentFingerprint: string,
  hooks: RecoveryHooks = {},
): Promise<RuntimeRecoveryResult> {
  const priorIntent = readRepairIntent(dataRoot);
  if (priorIntent && priorIntent.targetFingerprint !== currentFingerprint) throw new Error("Core Runtime repair target changed");
  const priorBackups = priorIntent ? validateIntentBackups(dataRoot, priorIntent) : null;
  const inspection = inspectEduPiRuntimeRecovery(dataRoot, currentFingerprint);
  if (inspection.status === "clean") {
    if (priorIntent) clearRepairIntent(dataRoot);
    return { ...inspection, repaired: Boolean(priorIntent), backups: priorBackups ?? [] };
  }
  if (inspection.status !== "stale") throw new Error(inspection.reason || "Core Runtime cannot be repaired while active");
  if (!inspection.runtimeFingerprint || !inspection.admissionFingerprint) throw new Error("Core Runtime state is incomplete");
  if (!priorIntent && inspection.runtimeFingerprint !== inspection.admissionFingerprint) throw new Error("Core Runtime repair state is inconsistent");
  if (priorIntent) {
    const runtimeExpected = inspection.runtimeFingerprint === priorIntent.sourceFingerprint || inspection.runtimeFingerprint === currentFingerprint;
    const admissionExpected = inspection.admissionFingerprint === priorIntent.sourceFingerprint;
    if (!runtimeExpected || !admissionExpected || priorIntent.state === "runtime_committed" && inspection.runtimeFingerprint !== currentFingerprint) {
      throw new Error("Core Runtime repair state is inconsistent");
    }
  }

  const stamp = `${Date.now()}-${process.pid}`;
  const backups: string[] = priorBackups ? [...priorBackups] : [];
  const runtimeFile = runtimePath(dataRoot, RUNTIME_DB);
  const admissionFile = runtimePath(dataRoot, ADMISSION_DB);
  if (!fs.existsSync(runtimeFile) || !fs.existsSync(admissionFile)) throw new Error("Core Runtime state is incomplete");

  let admissionDb: DatabaseSync | null = null;
  let runtimeDb: DatabaseSync | null = null;
  let admissionTransaction = false;
  let runtimeTransaction = false;
  try {
    admissionDb = new DatabaseSync(admissionFile);
    admissionDb.exec(`PRAGMA busy_timeout = ${RECOVERY_BUSY_TIMEOUT_MS}; BEGIN IMMEDIATE`);
    admissionTransaction = true;
    validatePinnedSchema(admissionDb, "admission");

    runtimeDb = new DatabaseSync(runtimeFile);
    runtimeDb.exec(`PRAGMA busy_timeout = ${RECOVERY_BUSY_TIMEOUT_MS}; BEGIN IMMEDIATE`);
    runtimeTransaction = true;
    validatePinnedSchema(runtimeDb, "runtime");
    const runtimeState = runtimeMetadata(runtimeDb);
    const admissionState = admissionMetadata(admissionDb);
    if (isLive(Number(runtimeState.authority.owner_pid))) throw new Error("Core Runtime owner is active");
    if (admissionState.lease && isLive(Number(admissionState.lease.owner_pid))) throw new Error("Core writer admission is active");

    const runtimeFingerprint = runtimeState.fingerprint;
    const admissionFingerprint = admissionState.fingerprint;
    if (runtimeFingerprint === currentFingerprint && admissionFingerprint === currentFingerprint && !admissionState.lease) {
      runtimeDb.exec("ROLLBACK");
      runtimeTransaction = false;
      admissionDb.exec("ROLLBACK");
      admissionTransaction = false;
      if (priorIntent) clearRepairIntent(dataRoot);
      return { ...inspection, status: "clean", reason: null, runtimeFingerprint, admissionFingerprint, repaired: Boolean(priorIntent), backups };
    }

    let intent = priorIntent;
    if (!intent) {
      if (runtimeFingerprint !== admissionFingerprint) throw new Error("Core Runtime repair state is inconsistent");
      backups.push(await backupDatabase(runtimeFile, stamp));
      backups.push(await backupDatabase(admissionFile, stamp));
      intent = {
        version: 1,
        state: "prepared",
        targetFingerprint: currentFingerprint,
        sourceFingerprint: runtimeFingerprint,
        runtimeBackup: path.basename(backups[0]),
        admissionBackup: path.basename(backups[1]),
      };
      writeRepairIntent(dataRoot, intent);
    }

    if (admissionState.lease) {
      const removed = admissionDb.prepare("DELETE FROM admission_lease WHERE singleton = 1 AND lease_id = ? AND owner_pid = ?").run(
        String(admissionState.lease.lease_id),
        Number(admissionState.lease.owner_pid),
      );
      if (changedRows(removed) !== 1) throw new Error("Core writer admission lease is invalid");
    }

    if (changedRows(runtimeDb.prepare("UPDATE runtime_meta SET value = ? WHERE key = 'root_fingerprint'").run(currentFingerprint)) !== 1) {
      throw new Error("Core Runtime metadata is invalid");
    }
    const authorityRow = runtimeDb.prepare("SELECT singleton FROM authority WHERE singleton = 1 LIMIT 1").get();
    if (authorityRow && changedRows(runtimeDb.prepare("UPDATE authority SET root_fingerprint = ? WHERE singleton = 1").run(currentFingerprint)) !== 1) {
      throw new Error("Core Runtime authority is invalid");
    }
    if (changedRows(admissionDb.prepare("UPDATE admission_meta SET value = ? WHERE key = 'root_fingerprint'").run(currentFingerprint)) !== 1) {
      throw new Error("Core writer admission metadata is invalid");
    }

    runtimeDb.exec("COMMIT");
    runtimeTransaction = false;
    writeRepairIntent(dataRoot, { ...intent, state: "runtime_committed" });
    hooks.afterRuntimeCommit?.();
    admissionDb.exec("COMMIT");
    admissionTransaction = false;
    clearRepairIntent(dataRoot);
  } catch (error) {
    if (runtimeTransaction) try { runtimeDb?.exec("ROLLBACK"); } catch { /* preserve first error */ }
    if (admissionTransaction) try { admissionDb?.exec("ROLLBACK"); } catch { /* preserve first error */ }
    throw error;
  } finally {
    runtimeDb?.close();
    admissionDb?.close();
  }
  return {
    ...inspectEduPiRuntimeRecovery(dataRoot, currentFingerprint),
    repaired: true,
    backups,
  };
}

export async function coreRuntimeFingerprint(runtime: ResolvedEduPiCore, dataRoot: ResolvedEduPiDataRoot): Promise<string> {
  const moduleUrl = pathToFileURL(path.join(runtime.root, "scripts", "core_runtime_root.mjs")).href;
  const rootModule = await import(/* webpackIgnore: true */ moduleUrl) as CoreRuntimeRootModule;
  const prepared = rootModule.prepareCoreRuntimeRoot?.(dataRoot.root);
  if (!prepared?.ok || typeof prepared.dataRootFingerprint !== "string") throw new Error("Core Runtime root could not be verified");
  return prepared.dataRootFingerprint;
}
