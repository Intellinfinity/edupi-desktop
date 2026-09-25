const PREPARATION_ISSUES: Record<string, { detail: string; summary: string }> = {
  source_unavailable: { detail: "缺少可用材料", summary: "有课前任务缺少可用材料" },
  binding_incomplete: { detail: "课次与任务尚未关联", summary: "有课前任务缺少课次关联" },
  excerpt_unconfirmed: { detail: "材料正文待确认", summary: "有材料正文待确认" },
  stale_source: { detail: "课程或材料已变化", summary: "有课程或材料需要重新核对" },
  model_unavailable: { detail: "默认模型不可用", summary: "默认模型不可用" },
  stale_revision: { detail: "任务已更新", summary: "有任务已更新" },
  invalid_candidate: { detail: "任务暂不能执行", summary: "有任务暂不能执行" },
  attempts_exhausted: { detail: "自动重试次数已用完", summary: "有任务已停止自动重试" },
};

export function preparationIssueLabel(code: string | null | undefined): string | null {
  return code ? PREPARATION_ISSUES[code]?.summary || null : null;
}

export function preparationIssueDetail(code: string | null | undefined): string | null {
  return code ? PREPARATION_ISSUES[code]?.detail || null : null;
}

export function isPreparationIssue(code: string | null | undefined): boolean {
  return preparationIssueLabel(code) !== null;
}
