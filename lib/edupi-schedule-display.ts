import type { CoreRuntimeScheduler } from "./edupi-runtime-health";

export function formatCoreSchedulerStatus(
  scheduler: CoreRuntimeScheduler | null | undefined,
  recentRuns: number,
): string {
  if (!scheduler?.timer_active) return "自动检查未启动";
  if (scheduler.timer_error_code) return `自动检查失败 · ${scheduler.timer_error_code}`;
  if (scheduler.next_timer_check_at) {
    const next = new Date(scheduler.next_timer_check_at);
    if (!Number.isNaN(next.getTime())) {
      const formatted = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(next);
      return `下次课程准备检查 ${formatted} · 最近 ${recentRuns} 次`;
    }
  }
  if (scheduler.interval_ms) return `每 ${Math.round(scheduler.interval_ms / 60_000)} 分钟检查 · 最近 ${recentRuns} 次`;
  return `自动检查已启动 · 最近 ${recentRuns} 次`;
}
