"use client";

import type { EducationContract, TeacherTask } from "@/lib/edupi-education-contract";
import { taskChecklist, taskStatusLabel, taskStatusTone, type TaskStage } from "@/lib/edupi-workbench";
import { isTaskReviewable, workCaseForTask } from "@/lib/edupi-work-case";
import { EduPiIconButton } from "./EduPiActionIcon";

type Props = {
  open: boolean;
  data: EducationContract;
  task: TeacherTask | undefined;
  onClose: () => void;
  onOpenAgent: () => void;
  onStage: (stage: TaskStage) => void;
};

export function EduPiInspector({ open, data, task, onClose, onOpenAgent, onStage }: Props) {
  if (!open) return null;
  const checklist = task ? taskChecklist(task) : [];
  const agentSession = task?.id ? data.taskSessions[task.id] : undefined;
  const agentSessionLabel = agentSession?.status === "running" ? "运行中" : agentSession?.status === "idle" ? "已绑定" : agentSession?.status === "missing" ? "需恢复" : "未建立";
  const reviewable = task ? isTaskReviewable(task, workCaseForTask(data, task.id)) : false;
  const openReview = () => {
    if (!reviewable) return;
    onStage("review");
  };
  return (
    <aside className="edupi-task-inspector" aria-label="任务检查">
      <header><div><h2>属性</h2></div><EduPiIconButton type="button" icon="close" label="隐藏任务检查" onClick={onClose}/></header>
      {task ? <>
        <section><h3>状态</h3><dl><div><dt>任务状态</dt><dd><span className={`edupi-task-status is-${taskStatusTone(task)}`}>{taskStatusLabel(task)}</span></dd></div><div><dt>协作会话</dt><dd>{agentSessionLabel}</dd></div><div><dt>版本</dt><dd>{task.revision}</dd></div></dl></section>
        <section><h3>安全边界</h3><dl><div><dt>范围</dt><dd>教师内部</dd></div><div><dt>受众</dt><dd>教师</dd></div><div><dt>外发</dt><dd>{task.externalSend ? "异常开启" : "关闭"}</dd></div><div><dt>审核</dt><dd>{task.requiresTeacherReview ? "必须" : "异常关闭"}</dd></div></dl></section>
        <section><h3>检查清单</h3><ul className="edupi-inspector-checklist">{checklist.map((item) => <li key={item.id} className={`is-${item.state}`}><span>{item.state === "pass" ? "✓" : "!"}</span>{item.label}</li>)}</ul></section>
        <section><h3>协作</h3><button type="button" className="edupi-inspector-action" onClick={onOpenAgent}>打开协作</button><button type="button" className="edupi-inspector-action" disabled={!reviewable} onClick={openReview}>{reviewable ? "进入审核" : "等待产物"}</button></section>
      </> : <section><h3>工作区</h3><dl><div><dt>范围</dt><dd>教师内部</dd></div><div><dt>外发</dt><dd>关闭</dd></div><div><dt>任务审核</dt><dd>{data.capabilities.taskReview.enabled ? "可用" : "只读"}</dd></div></dl></section>}
    </aside>
  );
}
