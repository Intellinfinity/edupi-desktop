"use client";

import type { EducationWorkCase, TeacherTask } from "@/lib/edupi-education-contract";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import { workCaseStateLabel, workCaseTransitionLabel } from "@/lib/edupi-work-case";
import {
  taskAgentSteps,
  taskArtifactFile,
  taskArtifacts,
  taskContentReady,
  taskDisplayTitle,
  taskEvidenceRows,
  taskSourceLabel,
  taskStatusLabel,
  taskStatusTone,
  type AgentStep,
} from "@/lib/edupi-workbench";
import type { GeneratedArtifact } from "@/lib/edupi-generated-artifacts";

type Props = {
  task: TeacherTask;
  workCase: EducationWorkCase | null;
  files?: GeneratedArtifact[];
  workspace: string;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onOpenTask: (task: TeacherTask) => void;
  onOpenAgent: (task: TeacherTask) => void;
  onDelete: (task: TeacherTask) => void;
  deleteBusy?: boolean;
};

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || "已准备文件";
}

function stepStateLabel(step: AgentStep): string {
  if (step.detail.startsWith("准备失败")) return "准备失败";
  const state = step.state;
  if (state === "done") return "已完成";
  if (state === "active") return "正在处理";
  return "待处理";
}

function isFailedStep(step: AgentStep): boolean {
  return step.detail.startsWith("准备失败");
}

function nonempty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function flowTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function EduPiTaskDetailDrawer({ task, workCase, files = [], workspace, onClose, onOpenFile, onOpenTask, onOpenAgent, onDelete, deleteBusy = false }: Props) {
  const drawerRef = useModalDismiss<HTMLElement>(onClose);
  const title = taskDisplayTitle(task);
  const source = taskSourceLabel(task);
  const status = taskStatusLabel(task);
  const statusTone = taskStatusTone(task);
  const steps = taskAgentSteps(task);
  const artifacts = taskArtifacts(task);
  const workspaceRoot = workspace.replace(/[\\/]$/, "");
  const preparedFilesById = new Map(files.filter(item => item.task_id === task.id && item.available !== false).map(item => [item.artifact_id, { id: item.artifact_id, title: item.title, relativePath: item.relative_path }]));
  for (const artifact of workCase?.artifacts || []) if (!preparedFilesById.has(artifact.id)) preparedFilesById.set(artifact.id, { id: artifact.id, title: artifact.title, relativePath: artifact.relativePath });
  const preparedFiles = [...preparedFilesById.values()];
  const contentReady = taskContentReady(task);
  const plans = contentReady ? [] : task.deliverables;
  const file = contentReady ? taskArtifactFile(task, workspace) : null;
  const evidenceRows = taskEvidenceRows(task);
  const fileHasVerification = Boolean(file?.hash);
  const evidence = evidenceRows.filter(({ label }) => label !== "来源路径" && label !== "产物文件" && label !== "文件校验");
  const latestReview = [...task.reviewHistory].reverse().find((entry) => nonempty(entry.note ?? entry.review_note) || nonempty(entry.reviewer ?? entry.reviewer_id) || nonempty(entry.reviewed_at));
  const feedbackRows = [
    ["意见", task.reviewNote || nonempty(latestReview?.note ?? latestReview?.review_note)],
    ["审核人", task.reviewer || nonempty(latestReview?.reviewer ?? latestReview?.reviewer_id)],
    ["时间", task.reviewedAt || nonempty(latestReview?.reviewed_at)],
  ].flatMap(([label, value]) => value ? [{ label, value }] : []);
  const flowTransitions = workCase ? workCase.transitions.slice(-12) : [];
  return (
    <div className="edupi-task-detail-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside ref={drawerRef} className="edupi-task-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="edupi-task-detail-title" tabIndex={-1}>
        <header className="edupi-task-detail-drawer__header">
          <div><span>教师任务</span><h2 id="edupi-task-detail-title">{title}</h2></div>
          <button data-autofocus type="button" className="edupi-task-detail-drawer__close" onClick={onClose} aria-label="关闭任务详情">×</button>
        </header>
        <div className="edupi-task-detail-drawer__body">
          <section className="edupi-task-detail-summary" aria-label="任务概览">
            <span className={`edupi-task-detail-status is-${statusTone}`}>{status}</span>
            <dl>
              <div><dt>截止</dt><dd>{task.dueDate || "日期待确认"}</dd></div>
              {task.sourceEventDate ? <div><dt>事件日期</dt><dd>{task.sourceEventDate}</dd></div> : null}
              <div><dt>来源</dt><dd>{source}</dd></div>
            </dl>
          </section>

          {workCase ? <section className="edupi-task-detail-section edupi-task-flow" aria-labelledby="edupi-task-detail-flow">
            <header><h3 id="edupi-task-detail-flow">EduPi 流</h3><span>{workCaseStateLabel(workCase.currentState)} · v{workCase.transitionRevision}</span></header>
            {flowTransitions.length > 0 ? <ol>{flowTransitions.map((transition) => <li className={`is-${transition.state}`} key={transition.id}><i className={`edupi-flow-state is-${transition.state}`} aria-hidden="true" /><div><strong>{workCaseTransitionLabel(transition)}</strong><small>{transition.sourceKind === "teacher_review" ? "教师判断" : "EduPi 执行"}</small></div><time>{flowTime(transition.occurredAt)}</time></li>)}</ol> : <p className="edupi-task-detail-empty">等待第一条执行记录</p>}
          </section> : <section className="edupi-task-detail-section" aria-labelledby="edupi-task-detail-progress">
            <header><h3 id="edupi-task-detail-progress">任务进度</h3><span>{steps.filter((step) => step.state === "done").length}/{steps.length} 步</span></header>
            <ol className="edupi-task-detail-steps">
              {steps.map((step) => { const failed = isFailedStep(step); return <li className={`is-${failed ? "failed" : step.state}`} key={step.id}><span aria-hidden="true">{failed ? "!" : step.state === "done" ? "✓" : step.state === "active" ? "●" : "○"}</span><div><strong>{step.title}</strong><small>{step.detail}</small></div><em>{stepStateLabel(step)}</em></li>; })}
            </ol>
          </section>}

          <section className="edupi-task-detail-section" aria-labelledby="edupi-task-detail-ready">
            <header><h3 id="edupi-task-detail-ready">已准备</h3><span>{artifacts.length} 项</span></header>
            {preparedFiles.length > 0 ? <ul className="edupi-task-detail-artifacts">{preparedFiles.map((artifact) => <li key={artifact.id}><button type="button" onClick={() => { onClose(); onOpenFile(`${workspaceRoot}/${artifact.relativePath}`); }}><strong>{artifact.title}</strong><small>{task.status === "accepted" || task.status === "modified" ? "已确认" : "候选"}</small></button></li>)}</ul> : artifacts.length > 0 ? <ul className="edupi-task-detail-artifacts">{artifacts.map((artifact) => <li key={artifact.id}><div><strong>{artifact.title}</strong><small>{artifact.state === "confirmed" ? "已确认" : "候选"}</small></div></li>)}</ul> : <p className="edupi-task-detail-empty">暂无已准备内容</p>}
            {plans.length > 0 ? <div className="edupi-task-detail-plans"><strong>计划交付</strong><ul>{plans.map((plan) => <li key={plan}>{plan}</li>)}</ul></div> : null}
            {file && preparedFiles.length === 0 ? <div className="edupi-task-detail-file"><span aria-hidden="true">文</span><div><strong>{fileName(file.path)}</strong><small>{fileHasVerification ? "文件已核验" : "文件已留存"}</small></div><button type="button" onClick={() => { onClose(); onOpenFile(file.path); }}>打开产物</button></div> : null}
          </section>

          <section className="edupi-task-detail-section" aria-labelledby="edupi-task-detail-evidence">
            <header><h3 id="edupi-task-detail-evidence">依据</h3><span>{evidence.length} 条</span></header>
            {evidence.length > 0 ? <dl className="edupi-task-detail-evidence">{evidence.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl> : <p className="edupi-task-detail-empty">暂无可展示依据</p>}
          </section>
          {feedbackRows.length > 0 ? <section className="edupi-task-detail-section" aria-labelledby="edupi-task-detail-feedback">
            <header><h3 id="edupi-task-detail-feedback">教师反馈</h3></header>
            <dl className="edupi-task-detail-feedback">{feedbackRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          </section> : null}
        </div>
        <footer className="edupi-task-detail-drawer__footer"><button type="button" className="is-delete" disabled={deleteBusy || !task.id} onClick={() => onDelete(task)}>删除任务</button><button type="button" onClick={() => { onOpenTask(task); onClose(); }}>进入任务</button><button type="button" className="is-primary" onClick={() => { onOpenAgent(task); onClose(); }}>继续让 EduPi 做</button></footer>
      </aside>
    </div>
  );
}
