import type { TeacherTask, EducationDocument, EducationWorkCase } from "./edupi-education-contract";
import { completionSnapshot } from "./edupi-completion-monitor";

export type ReminderEvent = { taskId: string; title: string; completion: "ready" | "failed" | "due" | "brief" | null; identity: string; nativeSource?: "teacher_created" };
const TEACHER_CREATED_TASK_ID = /^teacher-task-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function reminderEvents(tasks: TeacherTask[], workspace: string, now = new Date(), documents: EducationDocument[] = [], workCases?: EducationWorkCase[]): Record<string, ReminderEvent> {
  const activeTasks = tasks.filter(task => !["rejected", "hold", "accepted"].includes(task.status) && task.boardStage !== "done");
  // The Desktop task-board ID and source shape exclude Core work-case ownership.
  const standalone = new Set(workCases ? activeTasks.filter(task => task.id && TEACHER_CREATED_TASK_ID.test(task.id) && task.trigger === "teacher_created" && task.sourceEventId === null
    && !workCases.some(workCase => workCase.id === task.id || workCase.taskId === task.id)).map(task => task.id) : []);
  const result: Record<string, ReminderEvent> = completionSnapshot(activeTasks, workspace);
  for (const event of Object.values(result)) if (standalone.has(event.taskId)) event.nativeSource = "teacher_created";
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
