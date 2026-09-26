import type { TeacherTask, EducationContract, EducationDocument, EducationWorkCase } from "./edupi-education-contract";
import { completionSnapshot } from "./edupi-completion-monitor";

export type ReminderEvent = { taskId: string; title: string; completion: "ready" | "failed" | "due" | "brief" | null; identity: string; nativeSource?: "teacher_created" | "core_g1" };
const TEACHER_CREATED_TASK_ID = /^teacher-task-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function currentCoreG1Completion(task: TeacherTask, workCases: EducationWorkCase[], availableArtifacts: Set<string>): boolean {
  if (!task.id || task.trigger !== "teaching_before_class" || !task.sourceEventId
    || task.scope !== "teacher_internal" || task.requiresTeacherReview !== true || task.externalSend !== false) return false;
  const expectedState = task.contentStatus === "draft_ready" ? "draft_ready"
    : task.contentStatus === "generation_failed" ? "failed" : null;
  if (!expectedState) return false;
  return workCases.some(workCase => workCase.taskId === task.id && workCase.kind === "teaching_before_class"
    && workCase.externalSend === false && workCase.currentState === expectedState
    && (expectedState !== "draft_ready" || workCase.artifactIds.length > 0
      && workCase.artifactIds.every(id => availableArtifacts.has(`${task.id}\u0000${id}`))));
}

export function reminderEvents(tasks: TeacherTask[], workspace: string, now = new Date(), documents: EducationDocument[] = [],
  workCases?: EducationWorkCase[], generatedArtifacts: EducationContract["generatedArtifacts"] = []): Record<string, ReminderEvent> {
  const activeTasks = tasks.filter(task => !["rejected", "hold", "accepted"].includes(task.status) && task.boardStage !== "done");
  const availableArtifacts = new Set(generatedArtifacts?.filter(artifact => artifact.available === true)
    .map(artifact => `${artifact.task_id}\u0000${artifact.artifact_id}`));
  // The Desktop task-board ID and source shape exclude Core work-case ownership.
  const standalone = new Set(workCases ? activeTasks.filter(task => task.id && TEACHER_CREATED_TASK_ID.test(task.id) && task.trigger === "teacher_created" && task.sourceEventId === null
    && !workCases.some(workCase => workCase.id === task.id || workCase.taskId === task.id)).map(task => task.id) : []);
  const coreG1 = new Set(workCases ? activeTasks.filter(task => currentCoreG1Completion(task, workCases, availableArtifacts)).map(task => task.id) : []);
  const result: Record<string, ReminderEvent> = completionSnapshot(activeTasks, workspace);
  for (const event of Object.values(result)) if (standalone.has(event.taskId)) event.nativeSource = "teacher_created";
  for (const event of Object.values(result)) if (coreG1.has(event.taskId) && (event.completion === "ready" || event.completion === "failed")) event.nativeSource = "core_g1";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  for (const task of activeTasks) {
    if (!task.id || !task.dueDate || task.dueDate > today || ["rejected", "hold", "accepted"].includes(task.status) || task.contentStatus === "draft_ready") continue;
    result[`due:${task.id}`] = { taskId: task.id, title: task.title, completion: "due", identity: `due:${task.dueDate}`,
      ...(standalone.has(task.id) ? { nativeSource: "teacher_created" as const } : {}) };
  }
  for (const document of documents) {
    if (document.kind !== "daily" || !document.date || document.date.slice(0,10) !== today) continue;
    const key = `document:${document.id}`;
    result[key] = { taskId: key, title: document.title, completion: "brief", identity: `brief:${document.id}` };
  }
  return result;
}
