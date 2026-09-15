export type TaskCategoryId = "teaching" | "student" | "calendar" | "material" | "activity" | "other";

export const TASK_CATEGORY_CONFIG: ReadonlyArray<{ id: TaskCategoryId; label: string }> = [
  { id: "teaching", label: "教学准备" },
  { id: "student", label: "学生跟进" },
  { id: "calendar", label: "校历节点" },
  { id: "material", label: "材料证据" },
  { id: "activity", label: "活动安排" },
  { id: "other", label: "其他" },
];
const TASK_CATEGORY_LABELS = Object.fromEntries(TASK_CATEGORY_CONFIG.map((item) => [item.id, item.label])) as Record<TaskCategoryId, string>;
const TEACHING_TRIGGERS = new Set(["teaching_before_class", "teaching_adjustment_candidate", "teaching_node_preparation"]);
const CALENDAR_TRIGGERS = new Set(["calendar_event_internal", "calendar_event_preparation", "holiday_preparation"]);
const ACTIVITY_TRIGGERS = new Set(["festival", "monthly_class_activity"]);

type TaskCategoryInput = {
  title?: string | null;
  trigger?: string | null;
  dueDate?: string | null;
  triggerDate?: string | null;
  sourceEventDate?: string | null;
  sourceEventName?: string | null;
  student?: string | null;
  materialId?: string | null;
  materialKind?: string | null;
  topic?: string | null;
};

export function taskCategory(task: TaskCategoryInput): TaskCategoryId {
  if (task.trigger === "student_follow_up" || task.student) return "student";
  if (TEACHING_TRIGGERS.has(task.trigger || "")) return "teaching";
  if (CALENDAR_TRIGGERS.has(task.trigger || "")) return "calendar";
  if (ACTIVITY_TRIGGERS.has(task.trigger || "")) return "activity";
  if (task.materialId || task.materialKind) return "material";
  if (task.topic || /备课|教案|课前准备|教学准备/.test(task.title || "")) return "teaching";
  return "other";
}

export function matchesTaskQuery(task: TaskCategoryInput, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const category = TASK_CATEGORY_LABELS[taskCategory(task)];
  return [task.title, category, task.dueDate, task.triggerDate, task.sourceEventDate, task.sourceEventName, task.student, task.topic, task.materialKind]
    .filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized);
}

export function groupTasksByCategory<T extends TaskCategoryInput>(tasks: readonly T[]): Record<TaskCategoryId, T[]> {
  const groups: Record<TaskCategoryId, T[]> = {
    teaching: [],
    student: [],
    calendar: [],
    material: [],
    activity: [],
    other: [],
  };
  for (const task of tasks) groups[taskCategory(task)].push(task);
  return groups;
}
