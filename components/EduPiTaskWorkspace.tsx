"use client";

import type { EducationWorkCase, TaskReviewAction, TeacherTask } from "@/lib/edupi-education-contract";
import type { TaskSessionBinding } from "@/lib/edupi-task-sessions";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import { taskDisplayTitle, taskStatusLabel, taskStatusTone, taskTypeLabel, type TaskStage } from "@/lib/edupi-workbench";
import { isTaskReviewable, workCaseStateLabel } from "@/lib/edupi-work-case";
import { EduPiTaskStage, type ReviewPayload } from "./EduPiTaskStage";
import type { GeneratedArtifact } from "@/lib/edupi-generated-artifacts";

type Props = {
  task: TeacherTask;
  files?: GeneratedArtifact[];
  workReview?: boolean;
  workCase: EducationWorkCase | null;
  stage: TaskStage;
  workspace: string;
  context: TeacherContextSnapshot | null;
  reviewEnabled: boolean;
  reviewReason: string;
  reviewBusy: TaskReviewAction | null;
  reviewMessage: string | null;
  agentSession: TaskSessionBinding | null;
  taskSessionBusy: boolean;
  taskSessionError: string | null;
  onStage: (stage: TaskStage) => void;
  onReview: (action: TaskReviewAction, payload: ReviewPayload) => Promise<void>;
  onOpenAgent: () => void;
  onOpenFile: (path: string) => void;
};

const stages: Array<{ id: TaskStage; label: string }> = [
  { id: "brief", label: "任务目标" },
  { id: "run", label: "Agent 执行" },
  { id: "evidence", label: "材料与证据" },
  { id: "artifact", label: "教学产物" },
  { id: "review", label: "教师审核" },
];

export function EduPiTaskWorkspace(props: Props) {
  const contextLabel = [props.context?.school, props.context?.grade, props.context?.subject].filter(Boolean).join(" · ") || "教育上下文待设置";
  const stageLabel = stages.find((item) => item.id === props.stage)?.label || "任务阶段";
  const workCaseTone = props.workCase?.currentState === "failed"
    ? "danger"
    : props.workCase?.currentState === "draft_ready" || props.workCase?.currentState === "queued" || props.workCase?.currentState === "running"
      ? "warning"
      : props.workCase?.currentState === "accepted" || props.workCase?.currentState === "modified" || props.workCase?.currentState === "completed"
        ? "success"
        : "neutral";
  const statusLabel = props.task.status !== "planned" || !props.workCase ? taskStatusLabel(props.task) : workCaseStateLabel(props.workCase.currentState);
  const statusTone = props.task.status !== "planned" || !props.workCase ? taskStatusTone(props.task) : workCaseTone;
  const dateLabel = props.task.trigger === "teaching_before_class" && props.task.sourceEventDate
    ? `上课 ${props.task.sourceEventDate}${props.task.dueDate ? ` · 截止 ${props.task.dueDate}` : ""}`
    : props.task.dueDate || "日期待确认";
  const reviewable = isTaskReviewable(props.task, props.workCase) || Boolean(props.workReview && props.task.reviewHistory.length > 0 && props.task.status !== "planned");
  const reviewReason = reviewable ? props.reviewReason : "等待产物";
  const selectStage = (stage: TaskStage) => {
    if (stage === "review" && !reviewable) return;
    props.onStage(stage);
  };
  return (
    <main className="edupi-task-workspace" data-stage={props.stage}>
      <header className="edupi-task-workspace__header">
        <div>
          <div className="edupi-task-workspace__meta"><span>{taskTypeLabel(props.task)}</span><span>教师内部</span></div>
          <h1>{taskDisplayTitle(props.task)}</h1>
          <p>{contextLabel} · {dateLabel}</p>
        </div>
        <span className={`edupi-task-status is-${statusTone}`}>{statusLabel}</span>
      </header>
      <div className="edupi-task-workspace__flow">
        <nav className="edupi-stage-tabs" aria-label="教学任务工作流">
          {stages.map((stage, index) => <button key={stage.id} type="button" data-stage={stage.id} className={props.stage === stage.id ? "is-active" : ""} aria-current={props.stage === stage.id ? "step" : undefined} disabled={stage.id === "review" && !reviewable} onClick={() => selectStage(stage.id)}><span>{index + 1}</span><strong>{stage.label}</strong></button>)}
        </nav>
        <section className="edupi-task-workspace__surface" aria-label={stageLabel}>
          <h2 className="edupi-visually-hidden">{stageLabel}</h2>
          <EduPiTaskStage
          task={props.task}
          workCase={props.workCase}
          workReview={props.workReview}
          files={props.files?.filter(file => file.task_id === props.task.id)}
          stage={props.stage}
          workspace={props.workspace}
          contextLabel={contextLabel}
          reviewEnabled={props.reviewEnabled}
          reviewBlocked={!reviewable}
          reviewReason={reviewReason}
          reviewBusy={props.reviewBusy}
          reviewMessage={props.reviewMessage}
          agentSession={props.agentSession}
          taskSessionBusy={props.taskSessionBusy}
          taskSessionError={props.taskSessionError}
          onReview={props.onReview}
          onOpenAgent={props.onOpenAgent}
          onOpenFile={props.onOpenFile}
          onStage={props.onStage}
          canPrepare={Boolean(props.workCase && ["teaching_before_class", "calendar_preparation"].includes(props.workCase.kind)
            || props.task.trigger === "teaching_before_class" && props.task.sourceEventId && props.task.sourceEventDate && props.task.materialId && props.task.deliverables.length)}
          />
        </section>
      </div>
    </main>
  );
}
