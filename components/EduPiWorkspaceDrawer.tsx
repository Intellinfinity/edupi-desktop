"use client";

import type { ReactNode } from "react";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import type { TeacherTask } from "@/lib/edupi-education-contract";
import { taskDisplayTitle, taskSourceLabel } from "@/lib/edupi-workbench";

type Props = {
  kind: "agent" | "file" | null;
  task: TeacherTask | undefined;
  filePath: string | null;
  fileTitle?: string;
  agentPanel: ReactNode;
  filePanel: ReactNode;
  onClose: () => void;
  onPreparePrompt: (prompt: string) => void;
};

export function EduPiWorkspaceDrawer({ kind, task, filePath, fileTitle, agentPanel, filePanel, onClose, onPreparePrompt }: Props) {
  const drawerRef = useModalDismiss<HTMLElement>(onClose, Boolean(kind));
  if (!kind) return null;
  const prompt = task ? [
    `教学任务：${task.title}`,
    `来源：${taskSourceLabel(task)}`,
    `截止：${task.dueDate || "日期待确认"}`,
  ].join("\n") : "当前教学工作";
  return (
    <aside ref={drawerRef} className={`edupi-workspace-drawer is-${kind}`} role="dialog" aria-modal="true" aria-label={kind === "agent" ? "任务内协作" : "材料预览"}>
      <header>
        <div><span>{kind === "agent" ? task ? "任务内协作" : "全局协作" : "材料预览"}</span><h2>{kind === "agent" ? task ? taskDisplayTitle(task) : "EduPi Agent" : fileTitle || filePath?.split(/[\\/]/).pop() || "文件"}</h2></div>
        <div>{kind === "agent" ? <button type="button" onClick={() => onPreparePrompt(prompt)}>带入任务</button> : null}<button type="button" className="is-close" data-autofocus onClick={onClose} aria-label="关闭侧栏">×</button></div>
      </header>
      <div className="edupi-workspace-drawer__body">{kind === "agent" ? agentPanel : filePanel}</div>
    </aside>
  );
}
