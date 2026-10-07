import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const configuredCore = process.env.EDUPI_FAMILY_CORE_TEST_ROOT || process.env.EDUPI_CORE_ROOT;
const available = configuredCore && fs.existsSync(path.join(configuredCore, "scripts/family_record_codec.mjs"));

test("source-paired family service uses real Core capture readback and exact source replacement without rewriting legacy records", { skip: !available, timeout: 30000 }, async () => {
  const coreRoot = fs.realpathSync(configuredCore);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-desktop-family-pair-")));
  const home = path.join(root, ".edupi"), memoryDir = path.join(home, "memory");
  for (const directory of [memoryDir, path.join(home, "output"), path.join(home, "locks")]) fs.mkdirSync(directory, { recursive: true });
  const environment = { ...process.env, EDUPI_PROJECT_ROOT: root, EDUPI_HOME: home, EDUPI_MEMORY_DIR: memoryDir,
    EDUPI_OUTPUT_DIR: path.join(home, "output"), EDUPI_LOCK_DIR: path.join(home, "locks") };
  fs.writeFileSync(path.join(memoryDir, "student_profiles.json"), JSON.stringify({ students: { A: { student_id: "paired-student-a", name: "同名合成学生", class_name: "703" }, B: { student_id: "paired-student-b", name: "同名合成学生", class_name: "704" } } }));
  const calls = [];
  async function runCoreProcess({ request }) {
    calls.push(request);
    const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(coreRoot, "scripts/desktop_bridge_port.mjs")], { cwd: coreRoot, env: environment, input: JSON.stringify(request), encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim());
  }
  const roots = { runtime: { root: coreRoot }, dataRoot: { root } };
  const compiled = ts.transpileModule(fs.readFileSync(new URL("./edupi-family-records.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exportedModule = { exports: {} };
  const scopedRequire = (name) => name === "./edupi-core-process-client" ? { runCoreProcess }
    : name === "./edupi-core-snapshot" ? { resolveEduPiBridgeRoots: () => roots }
      : name.startsWith("file:") ? require(fileURLToPath(name)) : require(name);
  new Function("require", "module", "exports", compiled)(scopedRequire, exportedModule, exportedModule.exports);
  const { captureFamilyRecord, readFamilyRecords } = exportedModule.exports;
  const source = { source_id: "paired-manual-source", source_revision: "1", raw_text: "教师明确记录配合，监护身份未核实", observed_at: "2026-10-08T01:00:00.000Z", actor_ref: "desktop-teacher" };
  const input = { studentId: "paired-student-a", parentEntityId: null, parent: { external_id: "family-paired-person-0001", label: "同名合成联系人" },
    record: { recorded_relationship: "母亲", teacher_explicit_quality: "supportive", observed_on: null, note: "第一次教师记录" }, source };
  const identity = { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "education-facts" };
  const { factMutationRequestId } = await jiti.import("./edupi-fact-lifecycle.ts");
  async function accept(row, conflict = null) {
    const body = { action: "review", expectedRevision: row.revision, decision: "accept", reviewer: source.actor_ref, note: null, supersedesFactId: conflict?.fact_id || null, supersedesFactRevision: conflict?.revision ?? null };
    return runCoreProcess({ request: { ...identity, request_id: factMutationRequestId(row.fact_id, body), action: "review", fact_id: row.fact_id, expected_revision: row.revision,
      decision: body.decision, reviewer: body.reviewer, note: null, supersedes_fact_id: body.supersedesFactId, supersedes_expected_revision: body.supersedesFactRevision } });
  }
  try {
    const first = await captureFamilyRecord(input);
    assert.equal(first.status, "pending_review");
    assert.equal(first.display_quality, "unknown");
    assert.equal(first.record.observed_on, null);
    assert.equal((await captureFamilyRecord(input)).fact_id, first.fact_id);
    assert.equal((await readFamilyRecords("paired-student-a", 0, 10)).total, 1);
    assert.equal((await readFamilyRecords("paired-student-b", 0, 10)).total, 0);
    assert.equal((await accept(first)).status, "accepted");
    const revised = await captureFamilyRecord({ ...input, parent: null, parentEntityId: first.parent_entity_id, source: { ...source, source_revision: "2", raw_text: "教师更正为沟通紧张，旧记录保留" }, record: { ...input.record, teacher_explicit_quality: "tense", note: "教师来源修订" } });
    assert.equal(revised.review_mode, "replace");
    assert.equal(revised.review_conflict_count, 1);
    assert.equal(revised.review_conflicts[0].fact_id, first.fact_id);
    assert.equal((await accept(revised, revised.review_conflicts[0])).status, "accepted");
    const page = await readFamilyRecords("paired-student-a", 0, 10);
    assert.equal(page.records.find(row => row.fact_id === first.fact_id).status, "superseded");
    assert.equal(page.records.find(row => row.fact_id === revised.fact_id).display_quality, "tense");
    assert.equal(page.records.every(row => row.record.guardian_verification === "unknown" && row.external_send === false), true);
    assert.equal(calls.every(call => ["capture_family_record", "list_family_records", "review"].includes(call.action)), true);
    const before = fs.readFileSync(path.join(memoryDir, "education_facts_v1.json"));
    await readFamilyRecords("paired-student-a", 0, 1);
    assert.deepEqual(fs.readFileSync(path.join(memoryDir, "education_facts_v1.json")), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
