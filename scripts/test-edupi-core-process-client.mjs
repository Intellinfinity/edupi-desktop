#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createJiti } from "jiti";

const coreRoot = process.env.EDUPI_CORE_ROOT;
assert.ok(coreRoot, "EDUPI_CORE_ROOT is required for the paired Core smoke test");
const jiti = createJiti(import.meta.url);
const { resolveEduPiCoreRoot, resolveEduPiDataRoot } = await jiti.import("../lib/edupi-core-root.ts");
const { callEduPiCore } = await jiti.import("../lib/edupi-core-process-client.ts");
const realRoot = fs.realpathSync(coreRoot);
const manifest = JSON.parse(fs.readFileSync(path.join(realRoot, "contracts", "edupi-desktop-component-manifest.json"), "utf8"));
const runtime = resolveEduPiCoreRoot({ configuredRoot: realRoot, allowedRoot: path.dirname(realRoot), runtimeIdentity: { core_commit: execFileSync("git", ["-C", realRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), component_manifest_path: "contracts/edupi-desktop-component-manifest.json", component_manifest_hash: manifest.component_manifest_hash } });
const dataRoot = resolveEduPiDataRoot({ configuredRoot: process.env.EDUPI_DATA_ROOT, allowedRoot: process.env.EDUPI_DATA_ALLOWED_ROOT });
const health = await callEduPiCore({ operation: "health", requestId: "paired-health-smoke", runtime, dataRoot });
assert.equal(health.ok, true);
assert.deepEqual(health.supported_commands, ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"]);
console.log(JSON.stringify({ status: "passed", core_root: realRoot, schema_hash: health.schema_hash, component_manifest_hash: runtime.componentManifestHash }, null, 2));
