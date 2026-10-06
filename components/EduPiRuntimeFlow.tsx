"use client";

import { useContext } from "react";
import { taskDisplayTitle, taskStatusLabel } from "@/lib/edupi-workbench";
import { workCaseStateLabel } from "@/lib/edupi-work-case";
import { hasCurrentExplicitBoardStage, taskBoardLaneLabel } from "@/lib/edupi-task-board";
import { EduPiTaskRunContext, type EduPiTaskRunInfo } from "./EduPiTaskRunContext";

type Props = {
  running: boolean;
  toolRunning: boolean;
  compacting: boolean;
  activeTools?: string[];
  sessionId?: string;
};

function taskRunStatus({ task, workCase }: EduPiTaskRunInfo): string {
  if (task.boardStage && hasCurrentExplicitBoardStage(task)) return taskBoardLaneLabel(task.boardStage);
  // A previous execution snapshot must not erase a teacher's later decision.
  if (task.status === "hold") return "已暂缓";
  if (task.status === "rejected") return "已拒绝";
  if (task.status === "accepted") return "已接受";
  if (task.status === "modified") return "修改后接受";
  if (workCase?.taskId === task.id) {
    if (workCase.currentState === "draft_ready") return "待你确认";
    if (workCase.currentState === "completed") return "执行完成";
    return workCaseStateLabel(workCase.currentState);
  }
  return taskStatusLabel(task);
}

export function EduPiRuntimeFlow({ running, toolRunning, compacting, activeTools = [], sessionId }: Props) {
  const context = useContext(EduPiTaskRunContext);
  const info = sessionId && context?.sessionId === sessionId ? context : null;
  const busy = running || toolRunning || compacting;
  if (!info && !busy) return null;

  const activity = compacting ? "整理对话" : activeTools.length || toolRunning ? "正在执行" : info ? "正在协作" : "处理中";
  const activityDetail = busy && !compacting && activeTools.length ? `执行工具：${activeTools.join("、")}` : undefined;
  if (!info) {
    return <div className="edupi-runtime-flow edupi-runtime-flow--generic" role="status"><svg viewBox="0 0 72 16" aria-hidden="true"><circle cx="4" cy="8" r="3" fill="currentColor" /><path d="M10 8H62" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="68" cy="8" r="3" fill="currentColor" /></svg><span title={activityDetail}>{activity}</span></div>;
  }

  const status = busy ? activity : info.unavailable ? "任务状态暂不可用" : taskRunStatus(info);
  const filesUnavailable = info.unavailable || info.artifactsUnavailable;
  return (
    <button
      type="button"
      className={`edupi-task-run-card${busy ? " edupi-runtime-flow" : ""}`}
      data-task-id={info.task.id || undefined}
      onClick={info.onOpen}
    >
      <svg className="edupi-task-run-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
      <span className="edupi-task-run-card__body">
        <strong className="edupi-task-run-card__title">{taskDisplayTitle(info.task) || info.task.title}</strong>
        <span className="edupi-task-run-card__meta" role="status">
          <span className="edupi-task-run-card__status" title={activityDetail}>{status}</span>
          {busy && info.unavailable ? <span>任务状态暂不可用</span> : null}
          <span>{filesUnavailable ? "文件列表暂不可用" : `${info.artifacts.length} 份文件`}</span>
        </span>
      </span>
      <svg className="edupi-task-run-card__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
    </button>
  );
}
