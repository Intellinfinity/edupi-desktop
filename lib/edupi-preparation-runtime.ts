import { readEduPiKernelProjection, resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import { readEducationContract } from "./edupi-education-server";
import { ensureEduPiRuntime, getPendingEduPiRuntime } from "./edupi-runtime-supervisor";
import { pumpBackgroundJobs } from "./edupi-background-jobs";

type PreparationStatus = { state: "idle" | "running" | "ready" | "error"; updatedAt: string | null; prepared: number; error: string | null; taskId?: string | null };
const shared = globalThis as typeof globalThis & { __edupiPreparationStatus?: PreparationStatus };
const current = () => shared.__edupiPreparationStatus ??= { state: "idle", updatedAt: null, prepared: 0, error: null };

function preparationFailureMessage(code: string): string {
  const messages: Record<string, string> = {
    excerpt_unconfirmed: "请先确认材料内容",
    source_unavailable: "请关联可用材料",
    stale_revision: "任务已更新，请重新打开后再准备",
    stale_source: "材料或课程已变化，请重新核对",
    model_unavailable: "请检查默认模型配置",
    activation_pending: "备课执行尚未接通",
    invalid_candidate: "这项任务暂不能准备",
    attempts_exhausted: "重试次数已用完，请检查材料和模型",
  };
  return messages[code] || "备课暂不可用，请重试";
}

function failure(response: Record<string, unknown>): Error {
  const code = typeof response.error_code === "string" ? response.error_code : "runtime_unavailable";
  return Object.assign(new Error(preparationFailureMessage(code)), { code });
}

export async function preparationStatus(taskId?: string): Promise<PreparationStatus> {
  const status = taskId ? { ...current(), taskId } : current();
  try {
    const roots = resolveEduPiBridgeRoots();
    const { dataRoot } = roots;
    const pending = getPendingEduPiRuntime(dataRoot.root);
    if (!pending && !status.taskId) return { ...status, state: "idle" };
    if (!status.taskId && pending) {
      const health = await (await pending).call("health", null);
      if (!health.ok) throw failure(health);
      const queue = (health.result as { queue?: { queued: number; claimed: number } } | undefined)?.queue;
      if (queue && queue.queued + queue.claimed > 0) return { ...status, state: "running", error: null };
    }
    const [data, kernel] = await Promise.all([readEducationContract(), readEduPiKernelProjection({ roots }).catch(() => null)]);
    const work = status.taskId ? data.workCases.find(item => item.taskId === status.taskId) : null;
    const task = status.taskId ? (data.tasks || []).find(item => item.id === status.taskId) : null;
    const preflight = task ? kernel?.projection.runs.find(item => item.trigger_id === "g1_prepare_task" && item.fire_key === `task:${task.id}:r${task.revision}` && ["failed", "needs_review"].includes(item.status)) : null;
    const prepared = data.workCases.filter(item => item.artifactIds.length > 0 && ["draft_ready", "accepted", "modified", "completed"].includes(item.currentState)).length;
    if (preflight?.error_code) Object.assign(status, { state: "error", error: preparationFailureMessage(preflight.error_code), prepared });
    else if (work && ["queued", "running"].includes(work.currentState)) Object.assign(status, { state: pending ? "running" : "error", error: pending ? null : "备课执行已断开，请重试", prepared });
    else if (work?.currentState === "failed") Object.assign(status, { state: "error", error: "备课未完成，请重试", prepared });
    else if (work?.artifactIds.length || !status.taskId && prepared > 0) Object.assign(status, { state: "ready", error: null, prepared });
    else Object.assign(status, { state: "idle", error: null, prepared });
    return { ...status };
  } catch {
    return { ...status, state: "error", error: "备课状态暂不可用" };
  }
}

export async function startPreparation({ taskId = null }: { taskId?: string | null } = {}): Promise<PreparationStatus> {
  const status = current();
  try {
    const roots = resolveEduPiBridgeRoots();
    const host = await ensureEduPiRuntime(roots);
    let payload: Record<string, unknown> | null = null;
    if (taskId) {
      const data = await readEducationContract();
      const candidate = data.workCandidates.find(item => item.taskId === taskId);
      const revision = candidate?.revision ?? data.tasks?.find(item => item.id === taskId)?.revision;
      if (revision === undefined) throw new Error("请先选择可准备的任务");
      payload = { task_id: taskId, expected_revision: revision };
    }
    let result = await host.call(taskId ? "prepare_task" : "prepare_due", payload);
    if (taskId && !result.ok && result.error_code === "stale_revision") {
      const candidate = (await readEducationContract()).workCandidates.find(item => item.taskId === taskId);
      if (!candidate) throw new Error("请先选择可准备的任务");
      result = await host.call("prepare_task", { task_id: taskId, expected_revision: candidate.revision });
    }
    if (!result.ok) throw failure(result);
    const acknowledgement = result.result as { state?: string; event_id?: string; attempt?: number } | undefined;
    if (taskId && acknowledgement && ["failed", "cancelled"].includes(acknowledgement.state || "")) {
      result = await host.call("retry_preparation", { event_id: acknowledgement.event_id, expected_attempt: acknowledgement.attempt });
      if (!result.ok) throw failure(result);
    }
    const batch = result.result as { tasks?: unknown[]; failures?: Array<{ code: string }> } | undefined;
    if (!taskId && !batch?.tasks?.length && batch?.failures?.length) throw failure({ error_code: batch.failures[0].code });
    const state = taskId && acknowledgement?.state === "completed" ? "ready" : "running";
    Object.assign(status, { taskId, state, updatedAt: new Date().toISOString(), error: null });
    return { ...status };
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (typeof code === "string" && /^[a-z_]{1,64}$/.test(code)) console.warn("[edupi preparation]", code);
    Object.assign(status, { taskId, state: "error", updatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "备课暂不可用" });
    return { ...status };
  }
}

export async function ensurePreparation(): Promise<PreparationStatus> {
  try {
    const host = await ensureEduPiRuntime(resolveEduPiBridgeRoots());
    // Agent-computer recovery is independent from the preparation scan. A
    // malformed calendar source must not leave an unrelated document job stuck.
    void pumpBackgroundJobs().catch(() => console.warn("[edupi background] startup recovery unavailable"));
    // The Core timer performs the same scan every five minutes. Running it
    // once on Desktop startup/resume closes the sleep gap immediately; Core's
    // source revision and queue replay guards keep this idempotent.
    const catchUp = await host.call("prepare_due", null);
    if (!catchUp.ok) throw failure(catchUp);
    return preparationStatus();
  } catch {
    return { ...current(), state: "error", error: "备课执行尚未连接" };
  }
}
