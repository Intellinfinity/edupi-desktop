export type KernelRunDisplayInput = {
  trigger_id?: string;
  fire_key?: string;
  status?: string;
  result_summary?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  attempt_count?: number;
};

export type KernelRunAction = {
  label: string;
  target: "models" | "materials" | "teaching" | "workspace";
};

const TRIGGER_LABELS: Record<string, string> = {
  g1_prepare_due: "课前准备检查",
  g1_prepare_task: "课前准备",
  morning_brief: "早安简报",
  rhythm: "教学节奏检查",
  calendar_work: "校历任务检查",
};

const ERROR_LABELS: Record<string, string> = {
  source_unavailable: "缺少可用材料",
  excerpt_unconfirmed: "材料正文待确认",
  stale_source: "课程或材料已变化",
  model_unavailable: "默认模型不可用",
  stale_revision: "任务已更新",
  invalid_candidate: "任务暂不能执行",
  attempts_exhausted: "自动重试次数已用完",
};

export function kernelRunTitle(run: KernelRunDisplayInput, tasks: readonly { id: string | null; title: string }[]): string {
  const task = tasks.find((item) => item.id && (run.error_message?.startsWith(`${item.id}: `) || run.fire_key?.startsWith(`${item.id}:`)));
  return task?.title || TRIGGER_LABELS[run.trigger_id || ""] || "自动任务";
}

export function kernelRunDetail(run: KernelRunDisplayInput): string {
  if (run.error_code) return ERROR_LABELS[run.error_code] || "运行失败";
  return run.result_summary || `第 ${run.attempt_count || 1} 次执行`;
}

export function kernelRunAction(run: KernelRunDisplayInput): KernelRunAction | null {
  if (run.status !== "failed" && run.status !== "needs_review") return null;
  if (run.error_code === "model_unavailable") return { label: "配置模型", target: "models" };
  if (run.error_code === "source_unavailable") return { label: "补充材料", target: "materials" };
  if (run.error_code === "excerpt_unconfirmed") return { label: "确认材料", target: "materials" };
  if (run.error_code === "stale_source") return { label: "检查材料", target: "materials" };
  if (run.error_code === "stale_revision" || run.error_code === "invalid_candidate") return { label: "查看教学", target: "teaching" };
  return { label: "查看任务", target: "workspace" };
}
