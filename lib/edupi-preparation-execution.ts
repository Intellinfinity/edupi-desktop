export type PreparationPhase = { profile: "g1_linear_equations_v1"; key: "plan" | "draft" | "validate"; state: "active"; started_at: string };
export type PreparationExecutionState = "idle" | "queued" | "running" | "draft_ready" | "pending_receipt" | "failed" | "stale" | "cancelled" | "held";
export type PreparationExecution = {
  version: 1; root_ref: string; owner_id: string; task_id: string; task_revision: number; work_case_id: string;
  source_revision: string | null; source_current: boolean; execution_id: string | null; event_id: string | null; attempt: number | null;
  state: PreparationExecutionState; active: boolean; phase: PreparationPhase | null; failure_code: string | null; updated_at: string | null;
  artifact_ids: string[]; history: Array<{ sequence: number; execution_id: string; attempt: number; state: PreparationExecutionState;
    occurred_at: string; failure_code: string | null; artifact_ids: string[] }>;
  history_truncated: boolean; history_inferred: boolean; actions: { cancel: boolean; retry: boolean };
  relations: null; steps_total: null; read_only: true; external_send: false;
};
export class PreparationExecutionError extends Error {
  constructor(readonly code: string) { super("Preparation execution unavailable."); this.name = "PreparationExecutionError"; }
}
const HASH = /^sha256:[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const STATES = new Set(["idle", "queued", "running", "draft_ready", "pending_receipt", "failed", "stale", "cancelled", "held"]);
const FAILURES = new Set(["model_unavailable", "source_unavailable", "invalid_candidate", "invalid_model_output", "model_error", "deadline_exceeded",
  "invalid_result", "artifact_write_failed", "attempts_exhausted", "cancelled", "permission_denied", "budget_exhausted", "stale_source", "stale_claim",
  "excerpt_unconfirmed", "activation_pending", "unknown_failure"]);
const KEYS = ["version", "root_ref", "owner_id", "task_id", "task_revision", "work_case_id", "source_revision", "source_current", "execution_id", "event_id",
  "attempt", "state", "active", "phase", "failure_code", "updated_at", "artifact_ids", "history", "history_truncated", "history_inferred", "actions", "relations", "steps_total", "read_only", "external_send"];
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = (value: unknown): value is string => typeof value === "string" && ID.test(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const time = (value: unknown) => typeof value === "string" && value.length <= 32 && TIME.test(value) && Number.isFinite(Date.parse(value));
const ids = (value: unknown) => Array.isArray(value) && value.length <= 20 && value.every(id) && new Set(value).size === value.length;
const failure = (value: unknown) => value === null || typeof value === "string" && FAILURES.has(value);

export function decodePreparationExecution(value: unknown, expected: { taskId: string; revision: number; rootRef?: string; ownerId?: string }): PreparationExecution {
  const raw = record(value), phase = record(raw?.phase), actions = record(raw?.actions);
  const invalid = () => { throw new PreparationExecutionError("invalid_response"); };
  if (!raw || !exact(raw, KEYS) || raw.version !== 1 || raw.read_only !== true || raw.external_send !== false
    || typeof raw.root_ref !== "string" || !HASH.test(raw.root_ref) || !id(raw.owner_id) || !id(raw.task_id) || !id(raw.work_case_id)
    || raw.task_id !== expected.taskId || raw.task_revision !== expected.revision || !integer(raw.task_revision)
    || expected.rootRef !== undefined && raw.root_ref !== expected.rootRef || expected.ownerId !== undefined && raw.owner_id !== expected.ownerId
    || raw.source_revision !== null && (typeof raw.source_revision !== "string" || !HASH.test(raw.source_revision))
    || typeof raw.source_current !== "boolean" || raw.execution_id !== null && !id(raw.execution_id) || raw.event_id !== null && !id(raw.event_id)
    || raw.attempt !== null && !integer(raw.attempt, 0, 3) || typeof raw.state !== "string" || !STATES.has(raw.state) || typeof raw.active !== "boolean"
    || !failure(raw.failure_code) || raw.updated_at !== null && !time(raw.updated_at) || !ids(raw.artifact_ids)
    || typeof raw.history_truncated !== "boolean" || typeof raw.history_inferred !== "boolean" || raw.relations !== null || raw.steps_total !== null
    || !actions || !exact(actions, ["cancel", "retry"]) || typeof actions.cancel !== "boolean" || typeof actions.retry !== "boolean") invalid();
  if (raw!.phase !== null && (!phase || !exact(phase, ["profile", "key", "state", "started_at"]) || phase.profile !== "g1_linear_equations_v1"
    || !["plan", "draft", "validate"].includes(String(phase.key)) || phase.state !== "active" || !time(phase.started_at))) invalid();
  if (phase && (!raw!.active || !raw!.source_current || raw!.state !== "running")
    || raw!.active && (!raw!.source_current || raw!.state !== "running" || !raw!.execution_id || !raw!.event_id || !raw!.source_revision || !integer(raw!.attempt, 1, 3))
    || !raw!.source_current && (raw!.active || actions!.cancel || actions!.retry)
    || actions!.cancel && !raw!.active && (raw!.state !== "queued" || !raw!.event_id)
    || actions!.retry && (!raw!.event_id || !["failed", "cancelled"].includes(String(raw!.state)) || !integer(raw!.attempt, 0, 2))) invalid();
  if (!Array.isArray(raw!.history) || raw!.history.length > 50) invalid();
  let sequence = 0;
  for (const value of raw!.history as unknown[]) {
    const entry = record(value);
    if (!entry || !exact(entry, ["sequence", "execution_id", "attempt", "state", "occurred_at", "failure_code", "artifact_ids"])
      || !integer(entry.sequence, 1) || entry.sequence <= sequence || !id(entry.execution_id) || !integer(entry.attempt, 1, 3)
      || typeof entry.state !== "string" || !STATES.has(entry.state) || !time(entry.occurred_at) || !failure(entry.failure_code) || !ids(entry.artifact_ids)) invalid();
    sequence = entry!.sequence as number;
  }
  try { if (JSON.stringify(value).length > 256 * 1024) invalid(); } catch { invalid(); }
  return structuredClone(value) as PreparationExecution;
}

export function preparationPhaseLabel(phase: PreparationPhase | null): string | null {
  return phase ? { plan: "制定计划", draft: "生成草稿", validate: "核验内容" }[phase.key] : null;
}
export function preparationStateLabel(state: PreparationExecutionState): string {
  return { idle: "尚未执行", queued: "已排队", running: "正在准备", draft_ready: "草稿待确认", pending_receipt: "等待回执",
    failed: "准备失败", stale: "旧执行只读", cancelled: "已取消", held: "已暂缓" }[state];
}
export function preparationExecutionErrorMessage(error: unknown): string {
  const code = error instanceof PreparationExecutionError ? error.code : "unavailable";
  if (code === "forbidden") return "请在桌面应用中查看执行";
  if (["stale_revision", "stale_source", "stale_binding"].includes(code)) return "运行已变化，请重新读取";
  if (code.startsWith("owner_") || code === "permission_denied") return "执行权限暂不可用";
  return "执行状态暂不可用";
}
