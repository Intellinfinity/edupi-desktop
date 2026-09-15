import type { EducationContract, EducationWorkCase, EducationWorkCaseState, EducationWorkTransition, TeacherTask } from "./edupi-education-contract";
import { hasCurrentExplicitBoardStage, taskBoardLane, taskBoardLaneLabel } from "./edupi-task-board.ts";
import { taskArtifacts, taskDisplayTitle, taskStatusLabel } from "./edupi-workbench.ts";

const STATE_LABELS: Record<EducationWorkCaseState, string> = {
  planned: "计划中",
  accepted: "已接受",
  modified: "已调整",
  rejected: "已拒绝",
  held: "已暂缓",
  queued: "已排队",
  running: "正在准备",
  draft_ready: "已准备",
  failed: "准备失败",
  completed: "已完成",
};

const TRANSITION_LABELS: Record<EducationWorkTransition["state"], string> = {
  planned: "回到计划",
  accepted: "教师接受",
  modified: "教师调整",
  rejected: "教师拒绝",
  held: "教师暂缓",
  queued: "进入队列",
  running: "开始准备",
  draft_ready: "准备完成",
  failed: "准备失败",
  stale: "旧版本失效",
};

const ACTIVE_ORDER: Partial<Record<EducationWorkCaseState, number>> = { running: 0, queued: 1, draft_ready: 2, failed: 3 };

export function workCaseForTask(data: Pick<EducationContract, "workCases">, taskId: string | null | undefined): EducationWorkCase | null {
  if (!taskId) return null;
  return data.workCases.find((workCase) => workCase.taskId === taskId) ?? null;
}

export function taskRequiresWorkCase(task: Pick<TeacherTask, "id" | "sourceEventId" | "externalSend">): boolean {
  return task.externalSend === false && Boolean(task.id?.trim()) && Boolean(task.sourceEventId?.trim());
}

export function isTaskReviewable(task: TeacherTask, workCase: EducationWorkCase | null): boolean {
  const projectedArtifacts = taskArtifacts(task);
  if (projectedArtifacts.length === 0) return false;
  if (!workCase) return !taskRequiresWorkCase(task);
  return workCase.artifactIds.length > 0;
}

export function workCaseStateLabel(state: EducationWorkCaseState): string {
  return STATE_LABELS[state];
}

export function workCaseTransitionLabel(transition: EducationWorkTransition): string {
  return TRANSITION_LABELS[transition.state];
}

export function taskWorkStatusLabel(task: TeacherTask, workCase: EducationWorkCase | null): string {
  if (task.boardStage && hasCurrentExplicitBoardStage(task)) return taskBoardLaneLabel(task.boardStage);
  if (workCase && ["queued", "running", "draft_ready", "failed"].includes(workCase.currentState)) return workCaseStateLabel(workCase.currentState);
  return taskStatusLabel(task);
}

export function activeLivingWorkCases(workCases: EducationWorkCase[]): EducationWorkCase[] {
  return workCases
    .filter((workCase) => ACTIVE_ORDER[workCase.currentState] !== undefined)
    .sort((left, right) => Number(ACTIVE_ORDER[left.currentState]) - Number(ACTIVE_ORDER[right.currentState])
      || String(left.dueDate || "9999-12-31").localeCompare(String(right.dueDate || "9999-12-31"))
      || left.id.localeCompare(right.id));
}

export type TodayActiveTask = {
  task: TeacherTask;
  workCase: EducationWorkCase | null;
  title: string;
  dueDate: string | null;
  state: EducationWorkCaseState | "progress";
  stateLabel: string;
};

export function todayActiveTasks(data: Pick<EducationContract, "tasks" | "taskSessions" | "workCandidates" | "workCases">): TodayActiveTask[] {
  const active = activeLivingWorkCases(data.workCases);
  const taskById = new Map(data.tasks.filter((task) => task.id).map((task) => [task.id!, task]));
  const workCaseByTask = new Map(data.workCases.map((workCase) => [workCase.taskId, workCase]));
  const candidateByTask = new Map(data.workCandidates.map((candidate) => [candidate.taskId, candidate]));
  const activeRows = active.flatMap((workCase) => {
    const task = taskById.get(workCase.taskId);
    return task ? [{ task, workCase, title: taskDisplayTitle(task), dueDate: task.dueDate || workCase.dueDate, state: workCase.currentState, stateLabel: workCaseStateLabel(workCase.currentState) } satisfies TodayActiveTask] : [];
  });
  const activeTaskIds = new Set(activeRows.map((row) => row.task.id));
  const manuallyActive = data.tasks.flatMap((task) => {
    if (!task.id || activeTaskIds.has(task.id)) return [];
    const session = data.taskSessions[task.id] ?? null;
    if (taskBoardLane(task, session, candidateByTask.get(task.id)) !== "progress") return [];
    const explicitBoardStage = hasCurrentExplicitBoardStage(task);
    let stateLabel = "进行中";
    if (!explicitBoardStage && session?.status === "running") stateLabel = "Agent 运行中";
    else if (!explicitBoardStage && session?.status === "idle") stateLabel = "继续协作";
    else if (!explicitBoardStage && session?.status === "missing") stateLabel = "协作待恢复";
    const workCase = workCaseByTask.get(task.id) ?? null;
    return [{ task, workCase, title: workCase?.title || taskDisplayTitle(task), dueDate: workCase?.dueDate || task.dueDate, state: "progress", stateLabel } satisfies TodayActiveTask];
  }).sort((left, right) => String(left.dueDate || "9999-12-31").localeCompare(String(right.dueDate || "9999-12-31"))
    || String(left.task.id).localeCompare(String(right.task.id)));
  return [...activeRows, ...manuallyActive];
}
