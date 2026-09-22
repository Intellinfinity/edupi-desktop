import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { inspectEduPiRuntimeRecovery, repairEduPiRuntimeState } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-runtime-recovery.ts");

const runtimeSchema = `
CREATE TABLE runtime_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE authority (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1), schema_version INTEGER NOT NULL,
  root_fingerprint TEXT NOT NULL, fencing_generation INTEGER NOT NULL CHECK (fencing_generation >= 1),
  owner_pid INTEGER NOT NULL CHECK (owner_pid >= 1), process_start_evidence TEXT NOT NULL,
  instance_nonce TEXT NOT NULL, supervisor_session_id TEXT NOT NULL,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('starting','ready','degraded','draining','failed','stopped')),
  acquired_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE events (
  event_id TEXT PRIMARY KEY NOT NULL, event_version INTEGER NOT NULL CHECK (event_version = 1),
  event_type TEXT NOT NULL CHECK (event_type IN ('teacher_event','timer_event')), occurrence_time TEXT NOT NULL,
  source_ref TEXT NOT NULL, actor_ref TEXT NOT NULL, scope_ref TEXT NOT NULL, revision_ref TEXT NOT NULL,
  payload_json TEXT NOT NULL, canonical_json TEXT NOT NULL, canonical_hash TEXT NOT NULL,
  external_send INTEGER NOT NULL CHECK (external_send = 0),
  state TEXT NOT NULL CHECK (state IN ('queued','claimed','completed','failed','cancelled')),
  attempts INTEGER NOT NULL CHECK (attempts >= 0 AND attempts <= 3),
  fencing_generation INTEGER NOT NULL CHECK (fencing_generation >= 1), claim_token_hash TEXT, claimed_at TEXT,
  claim_deadline TEXT, deferred INTEGER NOT NULL DEFAULT 0 CHECK (deferred IN (0,1)), deferred_reason TEXT,
  result_code TEXT, settlement_kind TEXT, settlement_code TEXT, settlement_generation INTEGER,
  settlement_token_hash TEXT, settlement_deadline TEXT,
  settlement_retryable INTEGER NOT NULL DEFAULT 0 CHECK (settlement_retryable IN (0,1)),
  receipt_promotion_ack INTEGER NOT NULL DEFAULT 1 CHECK (receipt_promotion_ack IN (0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (state <> 'queued' OR attempts < 3), CHECK (state <> 'claimed' OR attempts >= 1),
  CHECK ((deferred = 0 AND deferred_reason IS NULL) OR (deferred = 1 AND state = 'claimed' AND deferred_reason = 'invalidation_pending'))
) STRICT;
CREATE INDEX events_available_idx ON events(state, occurrence_time, created_at, event_id);
CREATE INDEX events_terminal_idx ON events(state, updated_at, event_id);
PRAGMA user_version = 1;
`;

const admissionSchema = `
CREATE TABLE admission_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE admission_lease (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  admission_version INTEGER NOT NULL CHECK (admission_version = 1), root_fingerprint TEXT NOT NULL,
  lease_kind TEXT NOT NULL, owner_pid INTEGER NOT NULL CHECK (owner_pid >= 1),
  process_start_evidence TEXT NOT NULL, lease_id TEXT NOT NULL, acquired_at TEXT NOT NULL
) STRICT;
PRAGMA user_version = 1;
`;

function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "edupi-runtime-recovery-"));
  const runtime = path.join(root, ".edupi", "runtime");
  mkdirSync(runtime, { recursive: true });
  const dataRoot = { root, memoryDir: path.join(root, ".edupi", "memory"), outputDir: path.join(root, ".edupi", "output"), lockDir: path.join(root, ".edupi", "locks") };
  for (const dir of [dataRoot.memoryDir, dataRoot.outputDir, dataRoot.lockDir]) mkdirSync(dir, { recursive: true });
  const runtimeDb = new DatabaseSync(path.join(runtime, "core-runtime-v1.sqlite"));
  runtimeDb.exec(runtimeSchema);
  runtimeDb.prepare("INSERT INTO runtime_meta VALUES ('schema_version', '1'), ('root_fingerprint', ?)").run("sha256:" + "1".repeat(64));
  runtimeDb.prepare("INSERT INTO authority VALUES (1, 1, ?, 1, 999999, 'p-test', 'nonce-test', 'session-test', 'stopped', '2026-09-21T00:00:00.000Z', '2026-09-21T00:00:00.000Z')").run("sha256:" + "1".repeat(64));
  runtimeDb.close();
  const admissionDb = new DatabaseSync(path.join(runtime, "core-runtime-writer-admission-v1.sqlite"));
  admissionDb.exec(admissionSchema);
  admissionDb.prepare("INSERT INTO admission_meta VALUES ('admission_version', '1'), ('root_fingerprint', ?)").run("sha256:" + "1".repeat(64));
  admissionDb.close();
  return dataRoot;
}

const current = "sha256:" + "2".repeat(64);

test("classifies an idle stale runtime as repairable", () => {
  const dataRoot = makeRoot();
  const result = inspectEduPiRuntimeRecovery(dataRoot, current);
  assert.equal(result.status, "stale");
  assert.equal(result.reason, null);
});

test("fails closed when either pinned runtime database is missing", async () => {
  const emptyRoot = makeRoot();
  const emptyRuntime = path.join(emptyRoot.root, ".edupi", "runtime");
  unlinkSync(path.join(emptyRuntime, "core-runtime-v1.sqlite"));
  unlinkSync(path.join(emptyRuntime, "core-runtime-writer-admission-v1.sqlite"));
  const emptyInspection = inspectEduPiRuntimeRecovery(emptyRoot, current);
  assert.equal(emptyInspection.status, "unavailable");
  assert.match(emptyInspection.reason, /incomplete/i);
  await assert.rejects(() => repairEduPiRuntimeState(emptyRoot, current), /incomplete/i);

  const partialRoot = makeRoot();
  unlinkSync(path.join(partialRoot.root, ".edupi", "runtime", "core-runtime-writer-admission-v1.sqlite"));
  const partialInspection = inspectEduPiRuntimeRecovery(partialRoot, current);
  assert.equal(partialInspection.status, "unavailable");
  assert.match(partialInspection.reason, /incomplete/i);
  await assert.rejects(() => repairEduPiRuntimeState(partialRoot, current), /incomplete/i);
});

test("repairs only runtime metadata and leaves teacher directories untouched", async () => {
  const dataRoot = makeRoot();
  const result = await repairEduPiRuntimeState(dataRoot, current);
  assert.equal(result.repaired, true);
  assert.equal(result.status, "clean");
  assert.equal(result.backups.length, 2);
  assert.equal(existsSync(path.join(dataRoot.root, ".edupi", "memory")), true);
});

test("refuses repair while a live admission lease is present", async () => {
  const dataRoot = makeRoot();
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-writer-admission-v1.sqlite");
  const db = new DatabaseSync(file);
  db.prepare("INSERT INTO admission_lease VALUES (1, 1, ?, 'daemon', ?, 'p-test', 'lease-test', '2026-09-21T00:00:00.000Z')").run("sha256:" + "1".repeat(64), process.pid);
  db.close();
  const result = inspectEduPiRuntimeRecovery(dataRoot, current);
  assert.equal(result.status, "blocked");
  await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /writer admission|active/i);
});

test("removes a valid admission lease left by a dead owner", async () => {
  const dataRoot = makeRoot();
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-writer-admission-v1.sqlite");
  const db = new DatabaseSync(file);
  db.prepare("INSERT INTO admission_lease VALUES (1, 1, ?, 'daemon', 999999, 'p-test', 'lease-test', '2026-09-21T00:00:00.000Z')").run("sha256:" + "1".repeat(64));
  db.close();

  assert.equal(inspectEduPiRuntimeRecovery(dataRoot, current).status, "stale");
  const repaired = await repairEduPiRuntimeState(dataRoot, current);
  assert.equal(repaired.status, "clean");
  const recovered = new DatabaseSync(file, { readOnly: true });
  assert.equal(recovered.prepare("SELECT COUNT(*) AS count FROM admission_lease").get().count, 0);
  recovered.close();
});

test("cleans a dead admission lease even when both fingerprints are current", async () => {
  const dataRoot = makeRoot();
  await repairEduPiRuntimeState(dataRoot, current);
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-writer-admission-v1.sqlite");
  const db = new DatabaseSync(file);
  db.prepare("INSERT INTO admission_lease VALUES (1, 1, ?, 'daemon', 999999, 'p-test', 'lease-current', '2026-09-21T00:00:00.000Z')").run(current);
  db.close();

  const inspection = inspectEduPiRuntimeRecovery(dataRoot, current);
  assert.equal(inspection.status, "stale");
  const repaired = await repairEduPiRuntimeState(dataRoot, current);
  assert.equal(repaired.status, "clean");
  assert.equal(repaired.repaired, true);
  const recovered = new DatabaseSync(file, { readOnly: true });
  assert.equal(recovered.prepare("SELECT COUNT(*) AS count FROM admission_lease").get().count, 0);
  recovered.close();
});

test("refuses repair while the runtime owner is active", async () => {
  const dataRoot = makeRoot();
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-v1.sqlite");
  const db = new DatabaseSync(file);
  db.prepare("UPDATE authority SET lifecycle = 'ready', owner_pid = ? WHERE singleton = 1").run(process.pid);
  db.close();
  const result = inspectEduPiRuntimeRecovery(dataRoot, current);
  assert.equal(result.status, "blocked");
  await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /owner|active/i);
});

test("treats an already-current active runtime as a clean no-op", async () => {
  const dataRoot = makeRoot();
  await repairEduPiRuntimeState(dataRoot, current);
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-v1.sqlite");
  const db = new DatabaseSync(file);
  db.prepare("UPDATE authority SET lifecycle = 'ready', owner_pid = ? WHERE singleton = 1").run(process.pid);
  db.close();
  const result = await repairEduPiRuntimeState(dataRoot, current);
  assert.equal(result.status, "clean");
  assert.equal(result.repaired, false);
});

test("repairs a stale runtime left ready by a dead owner", async () => {
  const dataRoot = makeRoot();
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-v1.sqlite");
  const db = new DatabaseSync(file);
  db.prepare("UPDATE authority SET lifecycle = 'ready', owner_pid = 999999 WHERE singleton = 1").run();
  db.close();
  const result = await repairEduPiRuntimeState(dataRoot, current);
  assert.equal(result.status, "clean");
  assert.equal(result.repaired, true);
});

test("creates a consistent SQLite backup that includes committed WAL pages", async () => {
  const dataRoot = makeRoot();
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-v1.sqlite");
  const writer = new DatabaseSync(file);
  writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; UPDATE authority SET updated_at = '2026-09-21T00:00:01.000Z';");
  try {
    const result = await repairEduPiRuntimeState(dataRoot, current);
    const runtimeBackup = result.backups.find((backup) => backup.includes("core-runtime-v1.sqlite.before-root-repair"));
    assert.ok(runtimeBackup);
    const backupDb = new DatabaseSync(runtimeBackup, { readOnly: true });
    try {
      assert.equal(backupDb.prepare("SELECT updated_at FROM authority WHERE singleton = 1").get().updated_at, "2026-09-21T00:00:01.000Z");
    } finally {
      backupDb.close();
    }
  } finally {
    writer.close();
  }
});

test("cannot race an admission owner that starts after inspection", async () => {
  const dataRoot = makeRoot();
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-writer-admission-v1.sqlite");
  const owner = new DatabaseSync(file);
  owner.exec("BEGIN IMMEDIATE");
  try {
    await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /locked|busy/i);
    assert.equal(inspectEduPiRuntimeRecovery(dataRoot, current).status, "stale");
  } finally {
    owner.exec("ROLLBACK");
    owner.close();
  }
});

test("rejects unsupported schema versions before changing a fingerprint", async () => {
  const dataRoot = makeRoot();
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-v1.sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA user_version = 2");
  db.close();
  assert.equal(inspectEduPiRuntimeRecovery(dataRoot, current).status, "unavailable");
  await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /schema/i);
  const unchanged = new DatabaseSync(file, { readOnly: true });
  assert.equal(unchanged.prepare("SELECT value FROM runtime_meta WHERE key = 'root_fingerprint'").get().value, "sha256:" + "1".repeat(64));
  unchanged.close();
});

test("rejects an extra trigger before changing admission metadata", async () => {
  const dataRoot = makeRoot();
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-writer-admission-v1.sqlite");
  const db = new DatabaseSync(file);
  db.exec("CREATE TRIGGER unexpected_trigger AFTER UPDATE ON admission_meta BEGIN SELECT 1; END;");
  db.close();
  assert.equal(inspectEduPiRuntimeRecovery(dataRoot, current).status, "unavailable");
  await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /schema/i);
});

test("rejects unexpected metadata rows and versions before changing a fingerprint", async () => {
  const dataRoot = makeRoot();
  const admissionFile = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-writer-admission-v1.sqlite");
  const admission = new DatabaseSync(admissionFile);
  admission.prepare("INSERT INTO admission_meta VALUES ('unexpected', 'value')").run();
  admission.close();
  assert.equal(inspectEduPiRuntimeRecovery(dataRoot, current).status, "unavailable");
  await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /metadata/i);

  const second = makeRoot();
  const runtimeFile = path.join(second.root, ".edupi", "runtime", "core-runtime-v1.sqlite");
  const runtime = new DatabaseSync(runtimeFile);
  runtime.prepare("UPDATE authority SET schema_version = 2 WHERE singleton = 1").run();
  runtime.close();
  assert.equal(inspectEduPiRuntimeRecovery(second, current).status, "unavailable");
  await assert.rejects(() => repairEduPiRuntimeState(second, current), /authority/i);
});

test("rejects a missing runtime authority row", async () => {
  const dataRoot = makeRoot();
  const runtimeFile = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-v1.sqlite");
  const runtime = new DatabaseSync(runtimeFile);
  runtime.prepare("DELETE FROM authority WHERE singleton = 1").run();
  runtime.close();
  assert.equal(inspectEduPiRuntimeRecovery(dataRoot, current).status, "unavailable");
  await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /authority/i);
});

test("resumes a repair interrupted after the runtime commit", async () => {
  const dataRoot = makeRoot();
  await assert.rejects(
    () => repairEduPiRuntimeState(dataRoot, current, { afterRuntimeCommit() { throw new Error("simulated interruption"); } }),
    /simulated interruption/,
  );
  const intent = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-root-repair-v1.json");
  assert.equal(existsSync(intent), true);
  const firstIntent = JSON.parse(await (await import("node:fs/promises")).readFile(intent, "utf8"));
  assert.equal(inspectEduPiRuntimeRecovery(dataRoot, current).status, "stale");
  const recovered = await repairEduPiRuntimeState(dataRoot, current);
  assert.equal(recovered.status, "clean");
  assert.deepEqual(recovered.backups.map((file) => path.basename(file)), [firstIntent.runtimeBackup, firstIntent.admissionBackup]);
  assert.equal(existsSync(intent), false);
});
