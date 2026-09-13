"use client";

import { useEffect, useState } from "react";
import type { EducationWorkCase, TaskReviewAction, TeacherTask } from "@/lib/edupi-education-contract";
import type { TaskSessionBinding } from "@/lib/edupi-task-sessions";
import {
  taskAgentSteps,
  taskArtifactFile,
  taskEvidenceRows,
  taskSourceFile,
  taskSourceLabel,
  type TaskStage,
} from "@/lib/edupi-workbench";
import { EduPiTaskPreparationAction } from "./EduPiTaskPreparationAction";
import type { GeneratedArtifact } from "@/lib/edupi-generated-artifacts";

export type ReviewPayload = {
  note?: string;
  title?: string;
  dueDate?: string;
  deliverables?: string[];
};

type Props = {
  task: TeacherTask;
  workCase: EducationWorkCase | null;
  files?: GeneratedArtifact[];
  workReview?: boolean;
  stage: TaskStage;
  workspace: string;
  contextLabel: string;
  reviewEnabled: boolean;
  reviewBlocked: boolean;
  reviewReason: string;
  reviewBusy: TaskReviewAction | null;
  reviewMessage: string | null;
  agentSession: TaskSessionBinding | null;
  taskSessionBusy: boolean;
  taskSessionError: string | null;
  onReview: (action: TaskReviewAction, payload: ReviewPayload) => Promise<void>;
  onOpenAgent: () => void;
  onOpenFile: (path: string) => void;
  onStage: (stage: TaskStage) => void;
  canPrepare: boolean;
};

function BriefStage({ task, contextLabel }: { task: TeacherTask; contextLabel: string }) {
  return <div className="edupi-stage-brief"><dl><div><dt>任务来源</dt><dd>{taskSourceLabel(task)}</dd></div><div><dt>班级 / 学科</dt><dd>{contextLabel}</dd></div><div><dt>截止节点</dt><dd>{task.dueDate || "日期待确认"}</dd></div><div><dt>工作范围</dt><dd>教师内部</dd></div></dl><section><h3>预期产物</h3><ul>{(task.deliverables.length ? task.deliverables : ["待教师补充"]).map((item) => <li key={item}>{item}</li>)}</ul></section></div>;
}

function RunStage({ task, agentSession, busy, error, onOpenAgent, canPrepare, onStage }: { task: TeacherTask; agentSession: TaskSessionBinding | null; busy: boolean; error: string | null; onOpenAgent: () => void; canPrepare: boolean; onStage: (stage: TaskStage) => void }) {
  const steps = taskAgentSteps(task);
  const runtime = agentSession?.status === "running"
    ? { title: "Agent 正在运行", action: "查看进行中", tone: "running" }
    : agentSession?.status === "idle"
      ? { title: "协作记录已绑定", action: "继续协作", tone: "idle" }
      : agentSession?.status === "missing"
        ? { title: "协作记录需要恢复", action: "恢复协作", tone: "missing" }
        : { title: "尚未建立协作会话", action: "开始协作", tone: "unbound" };
  return <div className="edupi-stage-run"><div className={`edupi-agent-session is-${runtime.tone}`}><span className="edupi-agent-session__dot" aria-hidden="true" /><div><strong>{runtime.title}</strong><small>{agentSession ? `Session ${agentSession.sessionId.slice(0, 8)}` : "将为此任务建立独立 Session"}</small></div><button type="button" disabled={busy} onClick={onOpenAgent}>{busy ? "正在准备" : runtime.action}</button></div>{canPrepare && task.id ? <EduPiTaskPreparationAction taskId={task.id} onReady={() => onStage("artifact")} /> : null}{error ? <div className="edupi-agent-session__error" role="alert">{error}</div> : null}<div className="edupi-stage-toolbar"><span>教学工作流</span></div><ol>{steps.map((step) => <li key={step.id} className={`is-${step.state}`}><span className="edupi-run-step__state">{step.state === "done" ? "✓" : step.state === "active" ? "●" : "○"}</span><div><strong>{step.title}</strong><p>{step.detail}</p><small>材料：{step.material}</small></div><em>{step.state === "done" ? "已完成" : step.state === "active" ? "当前步骤" : "待执行"}</em></li>)}</ol></div>;
}

function EvidenceStage({ task, workspace, onOpenFile }: { task: TeacherTask; workspace: string; onOpenFile: (path: string) => void }) {
  const rows = taskEvidenceRows(task);
  const sourceFile = taskSourceFile(task, workspace);
  return <div className="edupi-stage-evidence"><div className="edupi-source-file"><span aria-hidden="true">文</span><div><strong>{taskSourceLabel(task)}</strong><small>{sourceFile || "来源路径待补"}</small></div>{sourceFile ? <button type="button" onClick={() => onOpenFile(sourceFile)}>预览</button> : null}</div><dl>{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}{rows.length === 0 ? <div><dt>证据状态</dt><dd>等待来源核对</dd></div> : null}</dl></div>;
}

function ArtifactStage({ task, workCase, files = [], workspace, onOpenFile, reviewable, onStage }: { task: TeacherTask; workCase: EducationWorkCase | null; files?: GeneratedArtifact[]; workspace: string; onOpenFile: (path: string) => void; reviewable: boolean; onStage: (stage: TaskStage) => void }) {
  const legacy = taskArtifactFile(task,workspace);
  const workspaceRoot = workspace.replace(/[\\/]$/, "");
  const indexed = new Map(files.map(file => [file.artifact_id, { id:file.artifact_id, title:file.title, path:`${workspaceRoot}/${file.relative_path}`, available:file.available !== false }]));
  for (const artifact of workCase?.artifacts || []) if (!indexed.has(artifact.id)) indexed.set(artifact.id, { id:artifact.id, title:artifact.title, path:`${workspaceRoot}/${artifact.relativePath}`, available:true });
  const artifacts = indexed.size ? [...indexed.values()] : legacy ? [{id:legacy.path,title:task.deliverables[0] || "教学产物",path:legacy.path,available:true}] : [];
  const confirmed = task.status === "accepted" || task.status === "modified";
  return <div className="edupi-stage-artifacts"><div className="edupi-stage-toolbar"><span>{artifacts.length} 份文件</span><button type="button" disabled={!reviewable} onClick={() => { if (reviewable) onStage("review"); }}>{reviewable ? "进入审核" : "等待产物"}</button></div><div className="edupi-artifact-list">{artifacts.map(artifact => <article key={artifact.id}><span aria-hidden="true" className="edupi-artifact-list__icon">文</span><button type="button" className="native-button" disabled={!artifact.available} onClick={() => onOpenFile(artifact.path)}>{artifact.title}</button><span className={confirmed ? "is-confirmed" : "is-candidate_only"}>{!artifact.available ? "文件已移动或删除" : confirmed ? "已确认" : "候选"}</span></article>)}</div>{!artifacts.length ? <p>暂无可打开的产物</p> : null}</div>;
}

function historyText(entry: Record<string, unknown>, key: string, fallback = "-"): string {
  const value = entry[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function reviewActionLabel(value: string): string {
  return { accept: "接受", modify: "修改后接受", reject: "拒绝", hold: "暂缓", rollback: "回滚" }[value] || value;
}

function ReviewStage({ task, workReview = false, enabled, blocked, reason, busy, message, onReview, onOpenAgent, taskSessionBusy, taskSessionError }: { task: TeacherTask; workReview?: boolean; enabled: boolean; blocked: boolean; reason: string; busy: TaskReviewAction | null; message: string | null; onReview: (action: TaskReviewAction, payload: ReviewPayload) => Promise<void>; onOpenAgent: () => void; taskSessionBusy: boolean; taskSessionError: string | null }) {
  const [note, setNote] = useState("");
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate || "");
  const [deliverables, setDeliverables] = useState(task.deliverables.join("\n"));
  const [changingDecision, setChangingDecision] = useState(false);
  useEffect(() => {
    setNote("");
    setTitle(task.title);
    setDueDate(task.dueDate || "");
    setDeliverables(task.deliverables.join("\n"));
    setChangingDecision(false);
  }, [task]);
  const submit = (action: TaskReviewAction) => onReview(action, {
    note: note.trim() || undefined,
    ...(action === "modify" ? { title: title.trim(), dueDate: dueDate || undefined, deliverables: deliverables.split("\n").map((item) => item.trim()).filter(Boolean) } : {}),
  });
  const decisionRequiresNote = !note.trim();
  const canRollback = task.reviewHistory.length > 0 && task.reviewHistory.at(-1)?.action !== "rollback";
  const decisionRecorded = task.status !== "planned";
  const showDecisionEditor = enabled && !blocked && (!decisionRecorded || changingDecision);
  const reviewFields = showDecisionEditor ? (
    <div className="edupi-review-fields">
      <label>审核意见<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="补充判断依据" /></label>
      <details><summary>修改内容</summary><div className="edupi-review-edit-grid"><label>任务标题<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>截止日期<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>{!workReview ? <label>教学产物<textarea rows={4} value={deliverables} onChange={(event) => setDeliverables(event.target.value)} /></label> : null}</div></details>
    </div>
  ) : null;
  const reviewActions = showDecisionEditor ? (
    <div className="edupi-review-actions" aria-label="教师审核动作">
      <button type="button" className="is-primary" disabled={!enabled || busy !== null} onClick={() => void submit("accept")}>{busy === "accept" ? "正在记录" : "接受"}</button>
      <button type="button" disabled={!enabled || busy !== null || !title.trim()} onClick={() => void submit("modify")}>{busy === "modify" ? "正在记录" : "修改后接受"}</button>
      <button type="button" disabled={!enabled || busy !== null || decisionRequiresNote} onClick={() => void submit("hold")}>{busy === "hold" ? "正在记录" : "暂缓"}</button>
      <button type="button" className="is-danger" disabled={!enabled || busy !== null || decisionRequiresNote} onClick={() => void submit("reject")}>{busy === "reject" ? "正在记录" : "拒绝"}</button>
      {!workReview ? <button type="button" className="is-quiet" disabled={!enabled || busy !== null || !canRollback} onClick={() => void submit("rollback")}>{busy === "rollback" ? "正在回滚" : "回滚"}</button> : null}
    </div>
  ) : blocked || enabled ? null : (
    <div className="edupi-review-actions" aria-label="AI 协作动作">
      <button type="button" className="is-primary" disabled={taskSessionBusy} onClick={onOpenAgent}>{taskSessionBusy ? "正在准备" : "在 AI 协作中处理"}</button>
    </div>
  );
  return <div className="edupi-stage-review">{decisionRecorded && !changingDecision ? <section className={`edupi-review-decision is-${task.status}`} role="status"><div><strong>{{ accepted: "已接受", modified: "已修改", rejected: "已拒绝", hold: "已暂缓", planned: "待审核" }[task.status]}</strong><span>{task.reviewedAt || "审核结果已记录"}{task.reviewer ? ` · ${task.reviewer}` : ""}</span></div>{enabled && !blocked ? <button type="button" disabled={busy !== null} onClick={() => setChangingDecision(true)}>修改决定</button> : null}</section> : null}{reviewFields}{blocked || !enabled ? <div className="edupi-review-notice" role="status">{reason}</div> : null}{reviewActions}{blocked ? null : !enabled && taskSessionError ? <div className="edupi-agent-session__error" role="alert">{taskSessionError}</div> : null}{message ? <div className="edupi-review-message" role="status">{message}</div> : null}<section className="edupi-review-history"><h3>审核历史<span>{task.reviewHistory.length}</span></h3>{task.reviewHistory.slice().reverse().map((entry, index) => <div key={`${historyText(entry, "review_id", String(index))}:${index}`}><strong>{reviewActionLabel(historyText(entry, "action"))}</strong><span>{historyText(entry, "reviewed_at")}</span><p>{historyText(entry, "note", "无备注")}</p></div>)}{task.reviewHistory.length === 0 ? <p className="edupi-review-history__empty">暂无审核记录</p> : null}</section></div>;
}

export function EduPiTaskStage(props: Props) {
  if (props.stage === "brief") return <BriefStage task={props.task} contextLabel={props.contextLabel} />;
  if (props.stage === "run") return <RunStage task={props.task} agentSession={props.agentSession} busy={props.taskSessionBusy} error={props.taskSessionError} onOpenAgent={props.onOpenAgent} canPrepare={props.canPrepare} onStage={props.onStage} />;
  if (props.stage === "evidence") return <EvidenceStage task={props.task} workspace={props.workspace} onOpenFile={props.onOpenFile} />;
  if (props.stage === "artifact") return <ArtifactStage task={props.task} workCase={props.workCase} files={props.files} workspace={props.workspace} onOpenFile={props.onOpenFile} reviewable={!props.reviewBlocked} onStage={props.onStage} />;
  return <ReviewStage task={props.task} workReview={props.workReview} enabled={props.reviewEnabled} blocked={props.reviewBlocked} reason={props.reviewReason} busy={props.reviewBusy} message={props.reviewMessage} onReview={props.onReview} onOpenAgent={props.onOpenAgent} taskSessionBusy={props.taskSessionBusy} taskSessionError={props.taskSessionError} />;
}
