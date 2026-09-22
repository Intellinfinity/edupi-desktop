import crypto from "node:crypto";
import { Value } from "typebox/value";
import type { TSchema } from "typebox";
import bridgeSchema from "../contracts/edupi-bridge-v1.1.schema.json";

export const BRIDGE_COMMAND_TYPES = [
  "review_observation", "review_memory_candidate", "review_task", "review_teacher_context",
  "review_work_candidate", "review_teaching_adjustment", "review_follow_up", "import_calendar",
  "import_timetable", "intake_material", "review_insight", "review_growth_candidate",
  "review_learning_candidate", "request_action_preview", "approve_action", "stop_action",
  "report_action_result",
  "create_task", "move_task_stage", "update_memory",
] as const;

export type CoreCommandType = typeof BRIDGE_COMMAND_TYPES[number];
export type ReviewDecision = "accept" | "modify" | "reject" | "hold" | "rollback" | "snooze" | "suppress" | "not_useful" | "approve" | "stop";

export const COMMAND_DECISION_MATRIX: Record<CoreCommandType, readonly (ReviewDecision | null)[]> = {
  review_observation: ["accept", "modify", "reject", "hold"],
  review_memory_candidate: ["accept", "modify", "reject", "hold"],
  review_task: ["accept", "modify", "reject", "hold", "rollback"],
  review_teacher_context: ["accept", "modify", "reject", "hold"],
  review_work_candidate: ["accept", "modify", "reject", "hold", "snooze", "suppress"],
  review_teaching_adjustment: ["accept", "modify", "reject", "hold"],
  review_follow_up: ["accept", "modify", "reject", "hold"],
  import_calendar: [null], import_timetable: [null], intake_material: [null],
  review_insight: ["accept", "reject", "hold", "not_useful", "suppress"],
  review_growth_candidate: ["accept", "reject", "hold"],
  review_learning_candidate: ["accept", "reject", "hold"],
  request_action_preview: [null], approve_action: ["approve"], stop_action: ["stop"], report_action_result: [null],
  create_task: [null], move_task_stage: [null], update_memory: ["modify"],
};

export const TARGET_COMMANDS = {
  observation: ["review_observation"], memory_candidate: ["review_memory_candidate"], task: ["review_task", "create_task", "move_task_stage"],
  teacher_context: ["review_teacher_context"], work_candidate: ["review_work_candidate"], teaching_adjustment: ["review_teaching_adjustment"],
  follow_up: ["review_follow_up"], calendar_import: ["import_calendar"], timetable_import: ["import_timetable"], material_intake: ["intake_material"],
  insight: ["review_insight"], growth_candidate: ["review_growth_candidate"], learning_candidate: ["review_learning_candidate"],
  action: ["request_action_preview", "approve_action", "stop_action", "report_action_result"],
  memory: ["update_memory"],
} as const;

export type BridgeErrorCode = "unknown_version" | "unknown_schema_hash" | "invalid_envelope" | "stale_snapshot" | "stale_revision" | "unsupported_command";
export type ValidationResult = { ok: true } | { ok: false; code: BridgeErrorCode; reason: string };

/** Run the complete pinned v1.1 JSON Schema before any semantic checks. */
export function validateCoreEnvelopeSchema(value: unknown): boolean {
  try {
    return Value.Check(bridgeSchema as TSchema, value);
  } catch {
    return false;
  }
}

export function validateCoreEnvelopeSchemaWithFactIsolation(value: unknown): boolean {
  if (validateCoreEnvelopeSchema(value)) return true;
  const envelope = record(value);
  const payload = record(envelope?.payload);
  const workspace = record(payload?.education_workspace);
  if (!envelope || !payload || !workspace || !Object.hasOwn(workspace, "fact_spine")) return false;
  const sanitizedWorkspace = { ...workspace };
  delete sanitizedWorkspace.fact_spine;
  return validateCoreEnvelopeSchema({ ...envelope, payload: { ...payload, education_workspace: sanitizedWorkspace } });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedArray(value: unknown, max: number): boolean {
  return Array.isArray(value) && value.length <= max;
}

function rawExecutionToken(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(rawExecutionToken);
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => key === "execution_token" || rawExecutionToken(child));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalize(source[key])]));
}

function stateHash(value: Record<string, unknown>): string {
  const state = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "state_hash"));
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonicalize(state))).digest("hex")}`;
}

function ambientPreparationIdentity(value: unknown): unknown {
  const preparation = record(value);
  if (!preparation) return value;
  const identity = structuredClone(preparation);
  delete identity.generated_at;
  if (Array.isArray(identity.decisions)) identity.decisions = identity.decisions.map((value) => {
    const decision = record(value);
    if (!decision) return value;
    const next = { ...decision };
    delete next.decision_id;
    delete next.decided_at;
    return next;
  });
  if (Array.isArray(identity.attention_intents)) identity.attention_intents = identity.attention_intents.map((value) => {
    const intent = record(value);
    if (!intent) return value;
    const next = { ...intent };
    delete next.created_at;
    return next;
  });
  return identity;
}

/**
 * The first C1 snapshot implementation used the payload's own snapshot_id as
 * part of its state hash.  Keep that verifier for the pre-C1 empty review
 * fixtures, but do not use it for a snapshot carrying the enabled review
 * capability: the Core C1 identity is derived from the content itself.
 */
export function computeLegacySnapshotStateHash(value: Record<string, unknown>): string {
  return stateHash(value);
}

function identityRecordWithoutCircularBindings(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const copy = { ...(value as Record<string, unknown>) };
  delete copy.after_snapshot_id;
  delete copy.after_state_hash;
  return copy;
}

const IDENTITY_ARRAY_KEYS: Record<string, (value: unknown) => unknown> = {
  observations: (value) => record(value)?.observation_id,
  memory_candidates: (value) => record(value)?.candidate_id,
  memories: (value) => record(value)?.memory_id,
  receipts: (value) => record(value)?.receipt_id,
  review_history: (value) => record(value)?.review_id,
  review_targets: (value) => record(record(value)?.target)?.target_id,
  work_cases: (value) => record(value)?.work_case_id,
};

/**
 * Return the same non-circular snapshot identity basis used by Core.  The
 * top-level identity fields are derived values and receipt/history after
 * bindings point back to that identity, so neither may participate in the
 * digest.
 */
export function canonicalSnapshotIdentityState(value: Record<string, unknown>): Record<string, unknown> {
  const state = { ...value };
  delete state.snapshot_id;
  delete state.state_hash;
  const workspace = record(state.education_workspace);
  if (workspace?.l4_preparation) {
    const nextWorkspace: Record<string, unknown> = { ...workspace, l4_preparation: ambientPreparationIdentity(workspace.l4_preparation) };
    delete nextWorkspace.state_hash;
    state.education_workspace = nextWorkspace;
  }
  for (const key of ["receipts", "review_history"]) {
    if (Array.isArray(state[key])) state[key] = state[key].map(identityRecordWithoutCircularBindings);
  }
  for (const [key, idFor] of Object.entries(IDENTITY_ARRAY_KEYS)) {
    if (Array.isArray(state[key])) {
      state[key] = state[key].slice().sort((left, right) => String(idFor(left) || "").localeCompare(String(idFor(right) || "")));
    }
  }
  return canonicalize(state) as Record<string, unknown>;
}

export function computeSnapshotIdentity(value: Record<string, unknown>): { snapshot_id: string; state_hash: string } {
  const canonical = canonicalSnapshotIdentityState(value);
  const state_hash = `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
  return {
    snapshot_id: `snapshot_${state_hash.slice("sha256:".length)}`,
    state_hash,
  };
}

export function validateCommand(value: unknown): ValidationResult {
  const command = record(value);
  if (!command) return { ok: false, code: "invalid_envelope", reason: "invalid command" };
  const type = command.command_type;
  if (typeof type !== "string" || !BRIDGE_COMMAND_TYPES.includes(type as CoreCommandType)) return { ok: false, code: "invalid_envelope", reason: "unknown command" };
  const commandType = type as CoreCommandType;
  const decision = command.decision ?? (commandType === "approve_action" ? "approve" : commandType === "stop_action" ? "stop" : null);
  if (!COMMAND_DECISION_MATRIX[commandType].includes(decision as ReviewDecision | null)) return { ok: false, code: "invalid_envelope", reason: "invalid command decision" };
  if (commandType === "request_action_preview" && Object.hasOwn(command, "preview_token")) return { ok: false, code: "invalid_envelope", reason: "preview token is Core-generated" };
  if (commandType === "intake_material") {
    const material = record(command.material);
    if (!material || !["desktop_staging", "core_project_root", "approved_import"].includes(String(material.source_scope)) || Number(material.expected_size_bytes) > 268435456) return { ok: false, code: "invalid_envelope", reason: "invalid material source" };
  }
  if (commandType === "import_calendar" && !boundedArray(command.events, 200)) return { ok: false, code: "invalid_envelope", reason: "calendar import too large" };
  if (commandType === "import_timetable" && !boundedArray(command.slots, 200)) return { ok: false, code: "invalid_envelope", reason: "timetable import too large" };
  if (commandType === "report_action_result" && !["claim", "final"].includes(String(command.phase))) return { ok: false, code: "invalid_envelope", reason: "invalid action result phase" };
  return { ok: true };
}

export function validateReceiptSemantics(value: unknown): ValidationResult {
  const receipt = record(value);
  if (!receipt) return { ok: false, code: "invalid_envelope", reason: "invalid receipt" };
  const type = receipt.command_type;
  if (typeof type !== "string" || !BRIDGE_COMMAND_TYPES.includes(type as CoreCommandType)) return { ok: false, code: "invalid_envelope", reason: "unknown receipt command" };
  const target = record(receipt.target);
  if (target && target.command_type !== type) return { ok: false, code: "invalid_envelope", reason: "receipt target mismatch" };
  const unsupported = receipt.status === "failed" && receipt.reason_code === "unsupported_command";
  if (!unsupported && !COMMAND_DECISION_MATRIX[type as CoreCommandType].includes((receipt.decision ?? null) as ReviewDecision | null)) return { ok: false, code: "invalid_envelope", reason: "invalid receipt decision" };
  const authorization = record(receipt.action_authorization);
  const hasToken = typeof authorization?.execution_token === "string";
  if (hasToken && !(type === "approve_action" && receipt.receipt_phase === "authorization")) return { ok: false, code: "invalid_envelope", reason: "raw execution token outside authorization" };
  if (!hasToken && rawExecutionToken(receipt)) return { ok: false, code: "invalid_envelope", reason: "raw execution token" };
  return { ok: true };
}

export function validateReviewHistorySemantics(value: unknown): ValidationResult {
  const history = record(value);
  if (!history) return { ok: false, code: "invalid_envelope", reason: "invalid review history" };
  const type = history.command_type;
  if (typeof type !== "string" || !BRIDGE_COMMAND_TYPES.includes(type as CoreCommandType)) return { ok: false, code: "invalid_envelope", reason: "unknown history command" };
  const target = record(history.target);
  if (target && target.command_type !== type) return { ok: false, code: "invalid_envelope", reason: "history target mismatch" };
  if (["import_calendar", "import_timetable", "intake_material"].includes(type)) {
    if (!["accept", "modify", "hold"].includes(String(history.decision))) return { ok: false, code: "invalid_envelope", reason: "invalid intake history decision" };
  } else if (!COMMAND_DECISION_MATRIX[type as CoreCommandType].includes((history.decision ?? null) as ReviewDecision | null)) {
    return { ok: false, code: "invalid_envelope", reason: "invalid history decision" };
  }
  if (rawExecutionToken(history)) return { ok: false, code: "invalid_envelope", reason: "raw execution token" };
  return { ok: true };
}

export type SnapshotSemanticOptions = {
  /** Exact ordered list from the active Desktop capability manifest. */
  supportedCommands?: readonly string[];
  /** Alias accepted by callers that name the values as expectations. */
  expectedSupportedCommands?: readonly string[];
  /** Exact ordered projection list from the active Desktop capability manifest. */
  supportedProjections?: readonly string[];
  /** Alias accepted by callers that name the values as expectations. */
  expectedSupportedProjections?: readonly string[];
};

function sameList(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

export function validateSnapshotSemantics(value: unknown, options: SnapshotSemanticOptions = {}): ValidationResult {
  const snapshot = record(value);
  if (!snapshot || typeof snapshot.snapshot_id !== "string" || typeof snapshot.state_hash !== "string") return { ok: false, code: "invalid_envelope", reason: "invalid snapshot" };
  const workspace = record(snapshot.education_workspace);
  if (!workspace || workspace.projection_kind !== "education_workspace" || workspace.projection_version !== "1.1" || workspace.external_send !== false || workspace.requires_teacher_review !== true) return { ok: false, code: "invalid_envelope", reason: "invalid education workspace projection" };
  if (record(workspace.freshness)?.state === "stale") return { ok: false, code: "stale_snapshot", reason: "education workspace freshness is stale" };
  for (const key of ["observations", "memory_candidates", "memories", "receipts", "review_history", "review_targets", "action_states", "tasks"]) if (!boundedArray(snapshot[key], key === "receipts" || key === "review_history" ? 100 : 200)) return { ok: false, code: "invalid_envelope", reason: `invalid ${key}` };
  if (snapshot.work_cases !== undefined && !boundedArray(snapshot.work_cases, 200)) return { ok: false, code: "invalid_envelope", reason: "invalid work_cases" };
  if (rawExecutionToken(snapshot)) return { ok: false, code: "invalid_envelope", reason: "raw execution token in snapshot" };
  for (const item of snapshot.receipts as unknown[]) {
    const result = validateReceiptSemantics(item);
    if (!result.ok) return result;
  }
  for (const item of snapshot.review_history as unknown[]) {
    const result = validateReviewHistorySemantics(item);
    if (!result.ok) return result;
  }
  for (const item of snapshot.review_targets as unknown[]) {
    const projection = record(item);
    const target = record(projection?.target);
    if (!projection || !target || projection.projection_kind !== target.target_kind) return { ok: false, code: "invalid_envelope", reason: "projection target mismatch" };
  }
  const capabilities = record(snapshot.capabilities);
  const expectedCommands = options.expectedSupportedCommands || options.supportedCommands;
  const expectedProjections = options.expectedSupportedProjections || options.supportedProjections;
  const actualCommands = capabilities?.supported_commands;
  const actualProjections = capabilities?.supported_projections;
  const projectionExpectation = expectedProjections || ["education_workspace"];
  if (!sameList(actualProjections, projectionExpectation)) return { ok: false, code: "invalid_envelope", reason: "unsupported projection capability" };
  const commandExpectation = expectedCommands || [];
  if (!sameList(actualCommands, commandExpectation)) return { ok: false, code: "unsupported_command", reason: "Core snapshot capability does not match the active manifest" };
  // Empty supported_commands is the legacy read-only snapshot shape.  A
  // non-empty expected list opts into the non-circular C1 identity verifier.
  if (commandExpectation.length > 0) {
    const identity = computeSnapshotIdentity(snapshot);
    if (identity.snapshot_id !== snapshot.snapshot_id || identity.state_hash !== snapshot.state_hash) return { ok: false, code: "invalid_envelope", reason: "snapshot identity mismatch" };
  } else if (stateHash(snapshot) !== snapshot.state_hash) {
    return { ok: false, code: "invalid_envelope", reason: "snapshot state hash mismatch" };
  } else if (["observations", "memory_candidates", "memories", "receipts", "review_history", "review_targets"].some((key) => (snapshot[key] as unknown[]).length > 0)) {
    return { ok: false, code: "unsupported_command", reason: "C1 review data is present without an enabled review capability" };
  }
  if (typeof workspace.state_hash !== "string" || stateHash(workspace) !== workspace.state_hash) return { ok: false, code: "invalid_envelope", reason: "education workspace state hash mismatch" };
  if (!Array.isArray(workspace.tasks) || workspace.tasks.some((item) => {
    const task = record(item);
    return !task || task.external_send !== false || task.requires_teacher_review !== true || task.scope !== "teacher_internal";
  })) return { ok: false, code: "invalid_envelope", reason: "invalid education task boundary" };
  return { ok: true };
}
