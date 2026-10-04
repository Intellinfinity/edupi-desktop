import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const contract = await jiti.import("./edupi-bridge-contract.ts");
const { activeBridgeIdentity, loadEduPiCompatManifest, scheduleOccurrenceIdentity } = await jiti.import("./edupi-bridge-manifest.ts");
const { consumeCoreEnvelope } = await jiti.import("./edupi-bridge-consumer.ts");
const coreRoot = process.env.EDUPI_CORE_ROOT;

test("mirrors the current Core schema and fixture identity exactly", { skip: !coreRoot }, () => {
  const schema = JSON.parse(fs.readFileSync(path.join(coreRoot, "contracts/edupi-bridge-v1.1.schema.json"), "utf8"));
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL("../contracts/edupi-bridge-v1.1.schema.json", import.meta.url), "utf8")), schema);
  const hash = JSON.parse(fs.readFileSync(path.join(coreRoot, "contracts/edupi-bridge-v1.1-hash.json"), "utf8"));
  const fixtures = JSON.parse(fs.readFileSync(path.join(coreRoot, "fixtures/bridge/v1.1/fixture-manifest.json"), "utf8"));
  const identity = loadEduPiCompatManifest().contract_identities[0];
  assert.equal(identity.schema_hash, hash.schema_hash);
  assert.equal(identity.fixture_manifest_hash, fixtures.fixture_manifest_hash);
  const occurrenceSchema = JSON.parse(fs.readFileSync(path.join(coreRoot, "contracts/edupi-schedule-occurrence-v1.2.schema.json"), "utf8"));
  const occurrenceHash = JSON.parse(fs.readFileSync(path.join(coreRoot, "contracts/edupi-schedule-occurrence-v1.2-hash.json"), "utf8"));
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL("../contracts/edupi-schedule-occurrence-v1.2.schema.json", import.meta.url), "utf8")), occurrenceSchema);
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL("../contracts/edupi-schedule-occurrence-v1.2-hash.json", import.meta.url), "utf8")), occurrenceHash);
  assert.equal(scheduleOccurrenceIdentity().schema_hash, occurrenceHash.schema_hash);
  const runtimeIdentity = loadEduPiCompatManifest().core_runtime;
  const desktopManifest = JSON.parse(fs.readFileSync(path.join(coreRoot, "contracts/edupi-desktop-component-manifest.json"), "utf8"));
  const runtimeManifest = JSON.parse(fs.readFileSync(path.join(coreRoot, "contracts/edupi-core-runtime-component-manifest.json"), "utf8"));
  const runtimeSchema = JSON.parse(fs.readFileSync(path.join(coreRoot, "contracts/edupi-core-runtime-v1-hash.json"), "utf8"));
  assert.equal(runtimeIdentity.component_manifest_hash, desktopManifest.component_manifest_hash);
  assert.equal(runtimeIdentity.runtime_component_manifest_hash, runtimeManifest.component_manifest_hash);
  assert.equal(runtimeIdentity.runtime_schema_hash, runtimeSchema.schema_hash);
});

test("validates the real Core fact projection and rejects unknown or malformed fact fields", { skip: !coreRoot }, async () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-fact-contract-")));
  const previousRoot = process.env.EDUPI_PROJECT_ROOT;
  process.env.EDUPI_PROJECT_ROOT = temp;
  const memoryDir = path.join(temp, ".edupi/memory");
  fs.mkdirSync(memoryDir, { recursive: true });
  try {
    const { loadEducationFactState } = await jiti.import(path.join(coreRoot, "scripts/education_fact_store.mjs"));
    const { buildEducationFactProjection } = await jiti.import(path.join(coreRoot, "scripts/education_fact_projection.mjs"));
    const snapshot = JSON.parse(fs.readFileSync(path.join(coreRoot, "fixtures/bridge/v1.1/snapshot-education-workspace.json"), "utf8"));
    snapshot.payload.education_workspace.fact_spine = buildEducationFactProjection({ state: loadEducationFactState({ memoryDir }) });
    assert.equal(contract.validateCoreEnvelopeSchema(snapshot), true);
    const unknown = structuredClone(snapshot);
    unknown.payload.education_workspace.fact_spine.extra = true;
    assert.equal(contract.validateCoreEnvelopeSchema(unknown), false);
    assert.equal(contract.validateCoreEnvelopeSchemaWithFactIsolation(unknown), true);
    const external = structuredClone(snapshot);
    external.payload.education_workspace.fact_spine.external_send = true;
    assert.equal(contract.validateCoreEnvelopeSchema(external), false);
    assert.equal(contract.validateCoreEnvelopeSchemaWithFactIsolation(external), true);
    const malformed = structuredClone(snapshot);
    malformed.payload.education_workspace.fact_spine.fact_candidates = [{}];
    assert.equal(contract.validateCoreEnvelopeSchema(malformed), false);
    assert.equal(contract.validateCoreEnvelopeSchemaWithFactIsolation(malformed), true);
    malformed.payload.education_workspace.tasks = [{}];
    assert.equal(contract.validateCoreEnvelopeSchemaWithFactIsolation(malformed), false, "fact isolation cannot hide a malformed base workspace");
    const coreSnapshot = await jiti.import(path.join(coreRoot, "scripts/edupi_bridge_snapshot.mjs"));
    assert.deepEqual(contract.computeSnapshotIdentity(snapshot.payload), coreSnapshot.computeSnapshotIdentity(snapshot.payload));
    assert.match(contract.computeSnapshotIdentity(snapshot.payload).snapshot_id, /^snapshot_[a-f0-9]{64}$/);
  } finally { if (previousRoot === undefined) delete process.env.EDUPI_PROJECT_ROOT; else process.env.EDUPI_PROJECT_ROOT = previousRoot; fs.rmSync(temp, { recursive: true, force: true }); }
});

test("mirrors Core C1 identity ordering without mutating the visible snapshot", () => {
  const snapshot = {
    snapshot_id: "snapshot-source",
    state_hash: "sha256:source",
    observations: [{ observation_id: "observation-b" }, { observation_id: "observation-a" }],
    memory_candidates: [{ candidate_id: "candidate-b" }, { candidate_id: "candidate-a" }],
    memories: [{ memory_id: "memory-b" }, { memory_id: "memory-a" }],
    receipts: [
      { receipt_id: "receipt-b", after_snapshot_id: "after-b", after_state_hash: "sha256:after-b" },
      { receipt_id: "receipt-a", after_snapshot_id: "after-a", after_state_hash: "sha256:after-a" },
    ],
    review_history: [
      { review_id: "review-b", after_snapshot_id: "history-b", after_state_hash: "sha256:history-b" },
      { review_id: "review-a", after_snapshot_id: "history-a", after_state_hash: "sha256:history-a" },
    ],
    review_targets: [
      { target: { target_id: "target-b" } },
      { target: { target_id: "target-a" } },
      { target: { label: "missing id" } },
    ],
    work_cases: [{ work_case_id: "work-case-b" }, { work_case_id: "work-case-a" }],
  };
  const reversed = structuredClone(snapshot);
  for (const key of ["observations", "memory_candidates", "memories", "receipts", "review_history", "review_targets", "work_cases"]) reversed[key].reverse();
  const reversedBefore = structuredClone(reversed);

  assert.deepEqual(contract.computeSnapshotIdentity(snapshot), contract.computeSnapshotIdentity(reversed));
  assert.deepEqual(snapshot.observations.map((item) => item.observation_id), ["observation-b", "observation-a"]);
  assert.deepEqual(reversed, reversedBefore);

  const bindingsChanged = structuredClone(snapshot);
  bindingsChanged.receipts[0].after_snapshot_id = "different-after-snapshot";
  bindingsChanged.receipts[0].after_state_hash = "sha256:different-after-state";
  bindingsChanged.review_history[0].after_snapshot_id = "different-history-snapshot";
  bindingsChanged.review_history[0].after_state_hash = "sha256:different-history-state";
  assert.deepEqual(contract.computeSnapshotIdentity(snapshot), contract.computeSnapshotIdentity(bindingsChanged));
});

test("keeps ambient observation metadata out of identity while retaining semantic changes", () => {
  const snapshot = {
    snapshot_id: "snapshot-source",
    state_hash: "sha256:source",
    education_workspace: {
      state_hash: "sha256:workspace-source",
      l4_preparation: {
        generated_at: "2026-09-23T00:00:00.000Z",
        opportunities: [{ opportunity_id: "opportunity-1", source_revision: "sha256:source-1", action: "ask",
          priority: { score: 1 }, next_wakeup_at: "2026-09-23T01:00:00.000Z" }],
        decisions: [{ decision_id: "decision-1", decided_at: "2026-09-23T00:00:00.000Z", opportunity_id: "opportunity-1", action: "ask" }],
        attention_intents: [{ attention_intent_id: "intent-1", created_at: "2026-09-23T00:00:00.000Z", opportunity_id: "opportunity-1" }],
        attention_deliveries: [{ delivery_id: "delivery-1", status: "queued" }],
      },
    },
  };
  const observedLater = structuredClone(snapshot);
  observedLater.education_workspace.state_hash = "sha256:workspace-derived-later";
  observedLater.education_workspace.l4_preparation.generated_at = "2026-09-23T00:05:00.000Z";
  observedLater.education_workspace.l4_preparation.decisions[0].decision_id = "decision-derived-later";
  observedLater.education_workspace.l4_preparation.decisions[0].decided_at = "2026-09-23T00:05:00.000Z";
  observedLater.education_workspace.l4_preparation.attention_intents[0].created_at = "2026-09-23T00:05:00.000Z";
  assert.deepEqual(contract.computeSnapshotIdentity(snapshot), contract.computeSnapshotIdentity(observedLater));

  for (const mutate of [
    (value) => { value.education_workspace.l4_preparation.opportunities[0].action = "act"; },
    (value) => { value.education_workspace.l4_preparation.opportunities[0].source_revision = "sha256:source-2"; },
    (value) => { value.education_workspace.l4_preparation.opportunities[0].priority.score = 2; },
    (value) => { value.education_workspace.l4_preparation.opportunities[0].next_wakeup_at = "2026-09-23T02:00:00.000Z"; },
    (value) => { value.education_workspace.l4_preparation.attention_deliveries[0].status = "delivered"; },
  ]) {
    const changed = structuredClone(snapshot);
    mutate(changed);
    assert.notDeepEqual(contract.computeSnapshotIdentity(snapshot), contract.computeSnapshotIdentity(changed));
  }
});

function ambientWakeSnapshot(generatedAt) {
  return {
    education_workspace: {
      state_hash: `derived-at-${generatedAt}`,
      l4_preparation: {
        generated_at: generatedAt,
        opportunities: [
          { opportunity_id: "op-a", action: "act", evidence_ids: ["source-a"], next_wakeup_at: generatedAt },
          { opportunity_id: "op-b", action: "act", evidence_ids: ["source-b"], next_wakeup_at: "2026-10-04T01:00:00.000Z" },
        ],
        decisions: ["op-b", "op-a"].map(opportunityId => ({
          opportunity_id: opportunityId, action: "act", evidence_ids: [opportunityId],
          decision_id: `${generatedAt}:${opportunityId}`, decided_at: generatedAt, next_wakeup_at: generatedAt,
        })),
      },
    },
  };
}

test("keeps immediate ambient wake clocks and decision order out of CAS identity", () => {
  const snapshot = ambientWakeSnapshot("2026-10-04T00:00:00.000Z");
  const later = ambientWakeSnapshot("2026-10-04T00:00:01.000Z");
  later.education_workspace.l4_preparation.decisions.reverse();
  const snapshotBefore = structuredClone(snapshot), laterBefore = structuredClone(later);
  assert.deepEqual(contract.computeSnapshotIdentity(snapshot), contract.computeSnapshotIdentity(later));
  assert.deepEqual(snapshot, snapshotBefore, "Identity normalization must not change visible wake times or order");
  assert.deepEqual(later, laterBefore);

  for (const mutate of [
    value => { value.opportunities[0].evidence_ids = ["different-source"]; },
    value => { value.opportunities[0].action = "ask"; },
    value => { value.opportunities[0].next_wakeup_at = "2026-10-04T00:30:00.000Z"; },
    value => { value.opportunities[1].next_wakeup_at = "2026-10-04T02:00:00.000Z"; },
    value => { value.decisions[0].next_wakeup_at = "2026-10-04T00:30:00.000Z"; },
    value => { value.opportunities.reverse(); },
  ]) {
    const changed = structuredClone(snapshot);
    mutate(changed.education_workspace.l4_preparation);
    assert.notDeepEqual(contract.computeSnapshotIdentity(snapshot), contract.computeSnapshotIdentity(changed));
  }
  for (const value of [snapshot, later]) value.education_workspace.l4_preparation.opportunities[0].action = "ask";
  assert.notDeepEqual(contract.computeSnapshotIdentity(snapshot), contract.computeSnapshotIdentity(later), "Non-actionable wake times still participate in CAS");
});

test("matches the pinned Core CAS identity for immediate and scheduled ambient wakes", { skip: !coreRoot }, async () => {
  const coreSnapshot = await jiti.import(path.join(coreRoot, "scripts/edupi_bridge_snapshot.mjs"));
  const snapshot = ambientWakeSnapshot("2026-10-04T00:00:00.000Z");
  const later = ambientWakeSnapshot("2026-10-04T00:00:01.000Z");
  later.education_workspace.l4_preparation.decisions.reverse();
  const nonActionable = structuredClone(snapshot);
  nonActionable.education_workspace.l4_preparation.opportunities[0].action = "ask";
  for (const value of [snapshot, later, nonActionable]) {
    assert.deepEqual(contract.canonicalSnapshotIdentityState(value), coreSnapshot.canonicalSnapshotIdentityState(value));
    assert.deepEqual(contract.computeSnapshotIdentity(value), coreSnapshot.computeSnapshotIdentity(value));
  }
});

test("pins the v1.1 default and opt-in v1.2 occurrence identities", () => {
  const manifest = loadEduPiCompatManifest();
  assert.equal(manifest.core_runtime.core_commit, "00d05a1ecb8f4bbc461305337b7059a02e757b69");
  assert.equal(manifest.core_runtime.component_manifest_hash, "sha256:fd150b8384542e84333f5a12924f09b5190de34a831f5b950f0b225c18b01269");
  assert.equal(manifest.core_runtime.runtime_component_manifest_hash, "sha256:356666c4a97417aebf1b98eb6f4948f0b79bbe02298acd5d791a2c54d61fd018");
  assert.equal(manifest.core_runtime.runtime_schema_hash, "sha256:8b4d701c64fd191019bee627eae7f9b2fbc533c0adbd41df4110ffc7719da9b8");
  assert.equal(manifest.contract_identities[0].schema_hash, "sha256:7f0cffd21c60f9ffa3409dcdb56c3b6683e81377ca3290741344c87a80123e7f");
  assert.ok(manifest.paired_prs.includes("https://github.com/Intellinfinity/edupi/pull/192"));
  assert.ok(manifest.paired_prs.includes("https://github.com/Intellinfinity/edupi/pull/193"));
  assert.ok(manifest.paired_prs.includes("https://github.com/Intellinfinity/edupi/pull/204"));
  assert.ok(manifest.paired_prs.includes("https://github.com/Intellinfinity/edupi/pull/211"));
  assert.ok(manifest.paired_prs.includes("https://github.com/Intellinfinity/edupi/pull/213"));
  assert.ok(manifest.paired_prs.includes("https://github.com/Intellinfinity/edupi/pull/216"));
  assert.ok(manifest.paired_prs.includes("https://github.com/Intellinfinity/edupi/pull/217"));
  assert.ok(manifest.paired_prs.includes("https://github.com/Intellinfinity/edupi/pull/212"));
  assert.ok(manifest.paired_prs.includes("https://github.com/Intellinfinity/edupi-desktop/pull/287"));
  assert.equal(manifest.contract_identities.length, 2);
  assert.deepEqual(manifest.supported_commands, ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"]);
  assert.deepEqual(manifest.contract_identities[0].supported_commands, ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"]);
  assert.deepEqual(manifest.supported_projections, ["education_workspace"]);
  assert.equal(manifest.contract_identities[0].contract_version, "1.1");
  assert.equal(activeBridgeIdentity().contract.contract_id, "edupi-bridge-v1.1");
  assert.deepEqual(scheduleOccurrenceIdentity(), {
    contract_id: "edupi-schedule-occurrence-v1.2",
    contract_version: "1.2",
    schema_path: "contracts/edupi-schedule-occurrence-v1.2.schema.json",
    schema_hash: "sha256:b739852f427520f787ad32c7f41b258976a3b41d60fa6116439696c1495b97cb",
    supported_commands: ["import_calendar"],
    supported_projections: ["schedule_occurrence"],
    depends_on: ["edupi-bridge-v1.1"],
  });
  assert.deepEqual(Object.keys(manifest.unsupported_command_reasons).sort(), [...contract.BRIDGE_COMMAND_TYPES].filter((command) => !manifest.supported_commands.includes(command)).sort());
  assert.equal(Object.keys(manifest.unsupported_command_reasons).length, 8);
});

test("mirrors the complete Core command and decision vocabulary", { skip: !coreRoot }, async () => {
  const coreV1 = await jiti.import(path.join(coreRoot, "contracts", "edupi-bridge-v1.ts"));
  const coreV11 = await jiti.import(path.join(coreRoot, "contracts", "edupi-bridge-v1.1.ts"));
  assert.deepEqual([...contract.BRIDGE_COMMAND_TYPES], [...coreV11.BRIDGE_V1_1_COMMAND_TYPES]);
  assert.deepEqual(Object.fromEntries(coreV1.BRIDGE_COMMAND_TYPES.map((command) => [command, contract.COMMAND_DECISION_MATRIX[command]])), coreV1.COMMAND_DECISION_MATRIX);
  assert.deepEqual(contract.COMMAND_DECISION_MATRIX.create_task, [null]);
  assert.deepEqual(contract.COMMAND_DECISION_MATRIX.move_task_stage, [null]);
  assert.deepEqual(contract.COMMAND_DECISION_MATRIX.update_memory, ["modify"]);
  assert.deepEqual(contract.TARGET_COMMANDS.memory, ["update_memory"]);
  assert.equal(Object.keys(contract.TARGET_COMMANDS).length, 15);
});

test("rejects the legacy read-only fixture after the C1 capability pin", { skip: !coreRoot }, () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(coreRoot, "fixtures", "bridge", "v1.1", "snapshot-education-workspace.json"), "utf8"));
  assert.equal(contract.validateCoreEnvelopeSchema(snapshot), true);
  const projected = consumeCoreEnvelope(snapshot);
  assert.equal(projected.ok, false);
  assert.equal(projected.code, "unsupported_command");
  assert.equal(contract.validateCoreEnvelopeSchema({ ...snapshot, payload: { ...snapshot.payload, education_workspace: { ...snapshot.payload.education_workspace, external_send: true } } }), false);
});

test("fails closed on version, hash, provenance, external_send, and stale state", { skip: !coreRoot }, () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(coreRoot, "fixtures", "bridge", "v1.1", "snapshot-education-workspace.json"), "utf8"));
  for (const [value, code] of [
    [{ ...snapshot, contract_version: "2.0" }, "unknown_version"],
    [{ ...snapshot, schema_hash: "sha256:wrong" }, "unknown_schema_hash"],
    [{ ...snapshot, provenance: [] }, "invalid_envelope"],
    [{ ...snapshot, external_send: "false" }, "invalid_envelope"],
  ]) assert.equal(consumeCoreEnvelope(value).code, code);
  const malformed = { ...snapshot, payload: { ...snapshot.payload, education_workspace: { ...snapshot.payload.education_workspace, tasks: [{}] } } };
  assert.equal(consumeCoreEnvelope(malformed).code, "invalid_envelope");
  const stale = { ...snapshot, payload: { ...snapshot.payload, education_workspace: { ...snapshot.payload.education_workspace, freshness: { ...snapshot.payload.education_workspace.freshness, state: "stale" } } } };
  assert.equal(consumeCoreEnvelope(stale).code, "stale_snapshot");
});

test("enforces command decisions, target pairs, bounded material source, and action token rules", { skip: !coreRoot }, () => {
  const command = JSON.parse(fs.readFileSync(path.join(coreRoot, "fixtures", "bridge", "v1.1", "command-unsupported.json"), "utf8")).command;
  assert.deepEqual(contract.validateCommand(command), { ok: true });
  assert.equal(contract.validateCommand({ ...command, decision: "approve" }).ok, false);
  assert.equal(contract.validateCommand({ command_type: "request_action_preview", action_id: "a", snapshot_id: "s", action_kind: "open_local_file", target_id: null, permission_scope: "teacher_internal", source: command.source, note: null, preview_token: "caller" }).ok, false);
  assert.equal(contract.validateCommand({ command_type: "intake_material", source: command.source, material: { material_id: "m", staging_id: "st", staging_path: "/tmp/x", source_path: null, source_hash: "sha256:x", expected_size_bytes: 1, kind: "other", title: "x", subject: null, class_id: null, source_scope: "arbitrary" } }).ok, false);
  const authorization = { receipt_id: "r", command_id: "c", request_id: "q", command_type: "approve_action", target: { target_kind: "action", target_id: "a", command_type: "approve_action" }, receipt_phase: "authorization", decision: "approve", action_authorization: { execution_token: "synthetic" } };
  assert.equal(contract.validateReceiptSemantics(authorization).ok, true);
  assert.equal(contract.validateReceiptSemantics({ ...authorization, receipt_phase: "result" }).ok, false);
});

test("accepts auditable import history decisions while import command receipts remain decisionless", () => {
  const target = { target_kind: "calendar_import", target_id: "calendar-import-1", command_type: "import_calendar" };
  assert.deepEqual(contract.validateReceiptSemantics({ command_type: "import_calendar", target, decision: null }), { ok: true });
  assert.deepEqual(contract.validateReviewHistorySemantics({ command_type: "import_calendar", target, decision: "modify" }), { ok: true });
  assert.equal(contract.validateReviewHistorySemantics({ command_type: "import_calendar", target, decision: "approve" }).ok, false);
});
