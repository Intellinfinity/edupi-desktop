import type { EducationModule } from "./edupi-education-ui";
import type { EducationInsight, EducationMemory, EducationWorkCandidate, TeacherTask } from "./edupi-education-contract";
import { taskCategory } from "./edupi-task-category.ts";

const TASK_TYPE_LABELS = {
  teaching: "教学准备",
  student: "学生跟进",
  calendar: "校历节点",
  material: "材料证据",
  activity: "活动安排",
  other: "教师任务",
} as const;

export type WorkbenchView =
  | "chat"
  | "dashboard"
  | "workspace"
  | "teaching"
  | "homeroom"
  | "calendar"
  | "memory"
  | "insights"
  | "growth"
  | "students"
  | "materials"
  | "review"
  | "tasks"
  | "artifacts";
export type TaskStage = "brief" | "run" | "evidence" | "artifact" | "review";

export type WorkbenchChecklistItem = {
  id: string;
  label: string;
  state: "pass" | "attention";
};

export type AgentStep = {
  id: string;
  title: string;
  detail: string;
  material: string;
  state: "done" | "active" | "queued";
};

export const workbenchViews: Array<{ id: WorkbenchView; label: string; shortLabel: string; module: EducationModule }> = [
  { id: "chat", label: "AI 协作", shortLabel: "协作", module: "home" },
  { id: "dashboard", label: "今天", shortLabel: "今天", module: "home" },
  { id: "workspace", label: "工作区", shortLabel: "任务板", module: "tasks" },
  { id: "teaching", label: "教学", shortLabel: "教学", module: "tasks" },
  { id: "homeroom", label: "班级", shortLabel: "班级", module: "students" },
  { id: "calendar", label: "日程", shortLabel: "日程", module: "calendar" },
  { id: "memory", label: "教育记忆", shortLabel: "记忆", module: "home" },
  { id: "insights", label: "观察与洞察", shortLabel: "洞察", module: "home" },
  { id: "growth", label: "成长", shortLabel: "成长", module: "home" },
  { id: "students", label: "学生档案", shortLabel: "学生", module: "students" },
  { id: "materials", label: "材料", shortLabel: "材料", module: "materials" },
  { id: "review", label: "待我确认", shortLabel: "确认", module: "tasks" },
  { id: "tasks", label: "教学任务", shortLabel: "任务", module: "tasks" },
  { id: "artifacts", label: "教学产物", shortLabel: "产物", module: "home" },
];

export function viewFromModule(module: EducationModule): WorkbenchView {
  if (module === "tasks") return "tasks";
  if (module === "students") return "students";
  if (module === "calendar") return "calendar";
  if (module === "materials") return "materials";
  return "dashboard";
}

export function moduleFromView(view: WorkbenchView): EducationModule {
  return workbenchViews.find((item) => item.id === view)?.module ?? "home";
}

export function isWorkbenchView(value: string | null): value is WorkbenchView {
  return workbenchViews.some((item) => item.id === value);
}

export function isTaskStage(value: string | null): value is TaskStage {
  return value === "brief" || value === "run" || value === "evidence" || value === "artifact" || value === "review";
}

export function taskKey(task: TeacherTask): string {
  return task.id || task.sourceEventId || `${task.trigger || "task"}:${task.title}`;
}

export function taskDisplayTitle(task: TeacherTask): string {
  return task.title
    .replace(/：safety跟进/g, "：安全事件跟进")
    .replace(/教师内部核对准备\s*$/, "")
    .replace(/\s*[（(]教师内部[）)]\s*$/, "")
    .trim();
}

/** Translate the execution snapshot into a short teacher-facing status. */
export function taskContentStatusLabel(task: TeacherTask): string | null {
  const status = task.contentStatus?.trim().toLocaleLowerCase().replace(/[\s-]+/g, "_");
  if (status === "unavailable") return "文件索引暂不可用";
  if (status === "generation_failed" || status === "failed" || status === "error") return "准备失败";
  if (status === "draft_ready" || status === "candidate_ready" || status === "ready") return "待你确认";
  if (status === "generating" || status === "queued" || status === "running") return "正在准备";
  return null;
}

export function taskContentReady(task: TeacherTask): boolean {
  const status = task.contentStatus?.trim().toLocaleLowerCase().replace(/[\s-]+/g, "_");
  return status === "candidate_only" || status === "draft_ready" || status === "candidate_ready" || status === "ready" || status === "confirmed";
}

export type TaskPresentationTone = "success" | "warning" | "danger" | "neutral";

export type TaskPresentation = {
  label: string;
  tone: TaskPresentationTone;
};

export function taskPresentation(task: TeacherTask): TaskPresentation {
  if (task.status === "rejected") return { label: "已拒绝", tone: "danger" };
  if (task.boardStage === "done") return { label: "已完成", tone: "success" };
  if (task.boardRevision > 0 && task.boardStage === "progress") return { label: "进行中", tone: "warning" };
  if (task.boardRevision > 0 && task.boardStage === "review") return { label: "待你确认", tone: "warning" };
  if (task.boardRevision > 0 && task.boardStage === "todo") return { label: "待开始", tone: "warning" };
  const contentStatus = taskContentStatusLabel(task);
  if (contentStatus === "准备失败") return { label: contentStatus, tone: "danger" };
  if (task.status === "accepted") return { label: "已接受", tone: "success" };
  if (task.status === "modified") return { label: "修改后接受", tone: "success" };
  if (task.status === "hold") return { label: "已暂缓", tone: "neutral" };
  if (contentStatus === "正在准备" || contentStatus === "待你确认") return { label: contentStatus, tone: "warning" };
  if (task.boardStage === "progress") return { label: "正在准备", tone: "warning" };
  if (task.boardStage === "review") return { label: "待你确认", tone: "warning" };
  if (task.boardStage === "todo") return { label: "待开始", tone: "warning" };
  return { label: "待审核", tone: "warning" };
}

export function taskStatusLabel(task: TeacherTask): string {
  return taskPresentation(task).label;
}

export function taskStatusTone(task: TeacherTask): TaskPresentationTone {
  return taskPresentation(task).tone;
}

export function workCandidateReasonLabel(reason: string): string {
  if (/校历节奏规则\s+[^；;\n]+?\s+触发(?:[；;]\s*来源\b[^\n]*)?/u.test(reason)) return "校历节点临近";
  if (/^课表课次\s+\S+\s+提前\s+\d+\s+天进入教师内部准备。[\s]*$/u.test(reason)) return "临近上课时间";
  return reason;
}

export type WorkCandidateGroups = {
  now: EducationWorkCandidate[];
  later: EducationWorkCandidate[];
  done: EducationWorkCandidate[];
};

export function groupWorkCandidates(candidates: EducationWorkCandidate[]): WorkCandidateGroups {
  const identityOrder = (left: EducationWorkCandidate, right: EducationWorkCandidate): number =>
    left.candidateId.localeCompare(right.candidateId) || left.title.localeCompare(right.title);
  const dueOrder = (left: EducationWorkCandidate, right: EducationWorkCandidate): number =>
    String(left.dueAt).localeCompare(String(right.dueAt)) || identityOrder(left, right);
  const laterOrder = (left: EducationWorkCandidate, right: EducationWorkCandidate): number =>
    String(left.snoozeUntil ?? left.dueAt ?? "9999-12-31").localeCompare(String(right.snoozeUntil ?? right.dueAt ?? "9999-12-31")) || identityOrder(left, right);
  const doneOrder = (left: EducationWorkCandidate, right: EducationWorkCandidate): number =>
    String(right.teacherReview.reviewedAt ?? "").localeCompare(String(left.teacherReview.reviewedAt ?? "")) || identityOrder(left, right);
  return {
    now: candidates.filter((candidate) => candidate.status === "pending_review").slice().sort(dueOrder),
    later: candidates.filter((candidate) => candidate.status === "held" || candidate.status === "snoozed").slice().sort(laterOrder),
    done: candidates.filter((candidate) => candidate.status === "accepted" || candidate.status === "modified" || candidate.status === "rejected" || candidate.status === "suppressed").slice().sort(doneOrder),
  };
}

export function taskTypeLabel(task: TeacherTask): string {
  return TASK_TYPE_LABELS[taskCategory(task)];
}

export function isTaskActionable(task: TeacherTask, today = new Date()): boolean {
  if (task.boardStage === "done") return false;
  if (task.status !== "planned" && task.status !== "hold") return false;
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const todayIso = `${today.getFullYear()}-${month}-${day}`;
  const activationDate = task.triggerDate || task.dueDate;
  return !activationDate || activationDate <= todayIso;
}

export function isUserFacingMemory(memory: EducationMemory): boolean {
  return !memory.tags.includes("主动提醒") && !/^(?:EduPi\s*)?主动提醒/.test(memory.content);
}

export function groupEducationInsights(insights: EducationInsight[]): Array<{ topic: string; insight: EducationInsight; relatedCount: number }> {
  const topicFor = (content: string) => {
    if (/工作总结|截止|待办/.test(content)) return "工作节奏";
    if (/安全|受伤|摔伤|送医|紧急事件/.test(content)) return "安全闭环";
    if (/学生|学习|错因|移项/.test(content)) return "学情观察";
    if (/家长|家校/.test(content)) return "家校沟通";
    if (/提醒|催办|重复/.test(content)) return "提醒策略";
    return content.replace(/^\[[^\]]+\]\s*/, "").slice(0, 18);
  };
  const groups = new Map<string, { topic: string; insight: EducationInsight; relatedCount: number }>();
  for (const insight of [...insights].sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))) {
    const topic = topicFor(insight.content);
    const existing = groups.get(topic);
    if (existing) existing.relatedCount += 1;
    else groups.set(topic, { topic, insight, relatedCount: 1 });
  }
  return [...groups.values()];
}

export function taskSourceLabel(task: TeacherTask): string {
  return task.sourceEventName || task.topic || task.student || "来源待核对";
}

function evidenceText(task: TeacherTask, key: string): string | null {
  const value = task.evidence[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function taskSourceFile(task: TeacherTask, workspace: string): string | null {
  const explicit = evidenceText(task, "file_path");
  if (explicit) return explicit.startsWith("/") ? explicit : `${workspace}/${explicit.replace(/^\.\//, "")}`;
  const memory = evidenceText(task, "source_memory");
  if (memory) return `${workspace}/.edupi/memory/${memory.replace(/^.*[\\/]/, "")}`;
  return null;
}

export type TaskArtifactFile = {
  path: string;
  hash: string | null;
};

/** Resolve the first file reference carried by a task without adding local state. */
export function taskArtifactFile(task: TeacherTask, workspace: string): TaskArtifactFile | null {
  const contentReady = taskContentReady(task);
  const normalizedContentStatus = task.contentStatus?.trim().toLocaleLowerCase().replace(/[\s-]+/g, "_");
  const explicitArtifact = contentReady ? evidenceText(task, "artifact_file_path") || evidenceText(task, "output_file_path") || evidenceText(task, "artifact_path") : null;
  const draftReadyFile = normalizedContentStatus === "draft_ready" ? evidenceText(task, "file_path") : null;
  const explicit = explicitArtifact || draftReadyFile;
  if (!explicit) return null;
  const artifactFile = explicit.startsWith("/") ? explicit : `${workspace}/${explicit.replace(/^\.\//, "")}`;
  return {
    path: artifactFile,
    hash: evidenceText(task, "artifact_file_sha256") || evidenceText(task, "output_file_sha256") || evidenceText(task, "artifact_hash") || evidenceText(task, "output_hash") || (!explicitArtifact && draftReadyFile ? evidenceText(task, "file_sha256") : null),
  };
}

export function taskEvidenceRows(task: TeacherTask): Array<{ label: string; value: string }> {
  const labels: Record<string, string> = {
    source_event_type: "记录类型",
    material_kind: "材料类型",
    source_date_status: "日期状态",
    source_summary: "引用片段",
    inference_status: "推断状态",
  };
  const displayValue = (key: string, value: unknown): string => {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    const values: Record<string, string> = {
      observed: "已观察",
      candidate_only: "候选",
      confirmed: "已确认",
      explicit: "日期明确",
      timetable_class: "课表课次",
      teaching: "教学安排",
      observation: "观察记录",
      festival: "节日节点",
      deadline: "截止事项",
      teacher_material_adjustment: "材料教学调整",
      student_event_follow_up: "学生事件跟进",
      calendar_event_internal: "校历内部准备",
      teacher_internal: "教师内部",
    };
    return values[raw] || raw;
  };
  return Object.entries(task.evidence)
    .filter(([key, value]) => Object.prototype.hasOwnProperty.call(labels, key) && value !== null && value !== undefined && String(value).trim())
    .map(([key, value]) => ({ label: labels[key] || key, value: displayValue(key, value) }));
}

export function taskChecklist(task: TeacherTask): WorkbenchChecklistItem[] {
  const hasSource = Boolean(task.sourceEventId || task.materialId || evidenceText(task, "source_entry_id"));
  const explicitDate = Boolean(task.sourceEventDate || task.dueDate || evidenceText(task, "source_date_status") === "explicit");
  const candidateOnly = evidenceText(task, "inference_status") === "candidate_only" || task.status === "planned";
  return [
    { id: "source", label: "原始材料已保留", state: hasSource ? "pass" : "attention" },
    { id: "trace", label: "来源可追溯", state: hasSource ? "pass" : "attention" },
    { id: "date", label: "日期已明确", state: explicitDate ? "pass" : "attention" },
    { id: "review", label: "教师审核必须", state: task.requiresTeacherReview ? "pass" : "attention" },
    { id: "external", label: "学生 / 家长外发关闭", state: !task.externalSend ? "pass" : "attention" },
    { id: "candidate", label: candidateOnly ? "候选内容未越界" : "审核状态已记录", state: "pass" },
  ];
}

export function taskAgentSteps(task: TeacherTask): AgentStep[] {
  const source = taskSourceLabel(task);
  const evidenceReady = taskEvidenceRows(task).length > 0;
  const contentStatus = taskContentStatusLabel(task);
  const generationFailed = contentStatus === "准备失败";
  const artifactReady = !generationFailed && taskContentReady(task);
  const artifactInProgress = contentStatus === "正在准备" || task.boardStage === "progress";
  const artifactState: AgentStep["state"] = generationFailed
    ? "queued"
    : artifactReady
      ? "done"
      : artifactInProgress || evidenceReady
        ? "active"
        : "queued";
  const reviewed = task.status !== "planned" || task.boardStage === "done";
  return [
    { id: "read", title: "读取原始材料", detail: "来源记录已绑定", material: source, state: evidenceReady ? "done" : "active" },
    { id: "evidence", title: "整理证据", detail: evidenceReady ? "引用与边界已记录" : "等待来源核对", material: source, state: evidenceReady ? "done" : "queued" },
    { id: "artifact", title: "形成教学候选", detail: generationFailed ? "准备失败，可继续让 EduPi 做" : artifactReady ? `${task.deliverables.length} 项候选产物` : artifactInProgress ? "EduPi 正在准备候选" : "尚未形成候选", material: source, state: artifactState },
    { id: "review", title: reviewed ? "教师审核" : "等待教师审核", detail: reviewed ? taskStatusLabel(task) : "需要教师判断", material: "教师审核", state: reviewed ? "done" : artifactReady ? "active" : "queued" },
  ];
}

export function taskArtifacts(task: TeacherTask): Array<{ id: string; title: string; summary: string; state: "candidate_only" | "confirmed" }> {
  if (!taskContentReady(task)) return [];
  const summary = evidenceText(task, "source_summary") || taskSourceLabel(task);
  const state = task.status === "accepted" || task.status === "modified" ? "confirmed" : "candidate_only";
  return task.deliverables.map((title, index) => ({
    id: `${taskKey(task)}:${index}`,
    title,
    summary,
    state,
  }));
}

export function confirmedTaskArtifacts(tasks: TeacherTask[], query = ""): Array<{ task: TeacherTask; artifact: { id: string; title: string; summary: string; state: "confirmed" } }> {
  const normalizedQuery = query.toLocaleLowerCase();
  return tasks.flatMap((task) => taskArtifacts(task)
    .filter((artifact): artifact is { id: string; title: string; summary: string; state: "confirmed" } => artifact.state === "confirmed")
    .map((artifact) => ({ task, artifact })))
    .filter(({ artifact }) => !query || `${artifact.title} ${artifact.summary}`.toLocaleLowerCase().includes(normalizedQuery));
}

export function recordLabel(record: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return fallback;
}
