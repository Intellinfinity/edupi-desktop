import type { EducationContract, TeacherTask } from "./edupi-education-contract";
import { MATERIAL_CATEGORIES, materialCategory, type MaterialCategoryId } from "./edupi-domain-navigation";
import { taskArtifactFile, taskArtifacts, taskDisplayTitle, taskKey, taskStatusLabel } from "./edupi-workbench";
export type MaterialRow = { id: string; title: string; category: Exclude<MaterialCategoryId, "all">; type: string; subject: string; source: string; date: string | null; status: string; summary: string; task: TeacherTask | null; filePath: string | null; deleteKind: "task" | "material" | "generated" | null };
export type MaterialIntakeMetadata = { title: string; materialKind: "worksheet" | "lesson_note" | "assessment" | "classroom_record" | "other"; subject: string; classId: string };

function workspaceFile(workspace: string, relative: string): string {
  const separator = workspace.includes("\\") ? "\\" : "/";
  return relative.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relative) ? relative : `${workspace.replace(/[\\/]$/, "")}${separator}${relative.replace(/^[\\/]+/, "").replace(/[\\/]/g, separator)}`;
}

function preparationRowContext(data: EducationContract, task: TeacherTask | null) {
  const workCase = task ? data.workCases.find(item => item.taskId === task.id) : undefined;
  const teaching = workCase?.kind === "teaching_before_class" || task?.trigger === "teaching_before_class";
  const calendar = workCase?.kind === "calendar_preparation";
  const type = teaching ? "课前准备" : task?.trigger === "meeting_preparation" ? "会议准备" : calendar ? "日程准备" : "准备产物";
  let subject = "—";
  if (teaching && task) {
    const sourceIds = new Set([task.sourceEventId, workCase?.triggerId, ...(workCase?.sourceIds || [])].filter(Boolean));
    const slots = data.timetable.filter(slot => {
      const id = String(slot.slot_id || slot.id || "");
      return sourceIds.has(id) || [...sourceIds].some(source => typeof source === "string" && source.startsWith(`timetable:${id}:`) && /^\d{4}-\d{2}-\d{2}$/.test(source.slice(`timetable:${id}:`.length)));
    });
    if (slots.length === 1) subject = [slots[0].subject, slots[0].class_name].filter(value => typeof value === "string" && value.trim()).join(" · ") || "—";
  }
  if (subject === "—" && task?.materialId) {
    const material = data.teacherMaterials?.find(item => item.material_id === task.materialId);
    if (material) subject = [material.subject, material.class_id].filter(Boolean).join(" · ") || "—";
  }
  return { type, subject, source: teaching ? "EduPi 备课" : calendar || task?.trigger === "meeting_preparation" ? "EduPi 日程准备" : "EduPi 生成" };
}

export function buildMaterialRows(data: EducationContract, query = ""): MaterialRow[] {
  const generated = data.generatedArtifacts || [];
    const taskRows = data.tasks.filter((task) => task.materialId || task.trigger === "teaching_adjustment_candidate").map((task) => { const itemCategory = materialCategory({ materialKind: task.materialKind, title: task.title }); return { id: taskKey(task), title: taskDisplayTitle(task), category: itemCategory, type: MATERIAL_CATEGORIES.find((item) => item.id === itemCategory)?.label || "其他", subject: task.topic || "—", source: task.sourceEventName || "教学任务", date: task.sourceEventDate || task.dueDate, status: taskStatusLabel(task), summary: String(task.evidence.sourceSummary || task.evidence.materialKind || "已保留任务证据"), task, filePath: null, deleteKind: "task" as const }; });
    const intakeRows: MaterialRow[] = (data.teacherMaterials ?? []).map(source => {
      const receipt = data.intakeReceipts?.find(item => item.commandType === "intake_material" && item.appliedIds.includes(source.material_id));
      const target = receipt?.target ? data.intakeTargets?.find(item => item.targetId === receipt.target?.targetId) : undefined;
      return { id: source.material_id, title: source.title, category: materialCategory({ title: source.title, materialKind: source.kind }), type: "已接入材料", subject: [source.subject, source.class_id].filter(Boolean).join(" · ") || "—", source: "教师上传", date: target?.reviewedAt || receipt?.createdAt || null, status: source.available === false ? "文件已移动或删除" : "已接入", summary: target?.summary || source.title, task: null, filePath: source.relative_path && source.available !== false ? workspaceFile(data.workspace, source.relative_path) : null, deleteKind: "material" };
    });
    const documentRows = data.continuity.documents.map((item) => ({ id: `document:${item.id}`, title: item.title, category: "other" as const, type: item.kind === "daily" ? "每日简报" : item.kind === "weekly" ? "周复盘" : item.kind === "insight" ? "洞察报告" : "后台整理", subject: "—", source: "EduPi 生成", date: item.date, status: "可打开", summary: item.excerpt, task: null, filePath: workspaceFile(data.workspace, item.path), deleteKind: null }));
    const artifactRows = data.tasks.flatMap((task) => { const file = taskArtifactFile(task, data.workspace); if (!file) return []; const artifact = taskArtifacts(task)[0]; return [{ id: `artifact-file:${taskKey(task)}`, title: artifact?.title || taskDisplayTitle(task), category: materialCategory({ materialKind: task.materialKind, title: artifact?.title || task.title }), type: "教学产物", subject: task.topic || "—", source: taskDisplayTitle(task), date: task.reviewedAt || task.dueDate, status: artifact?.state === "confirmed" ? "已确认" : "候选", summary: artifact?.summary || taskDisplayTitle(task), task, filePath: file.path, deleteKind: null }]; });
    const unique = new Map<string, MaterialRow>();
    const generatedRows: MaterialRow[] = generated.map((item) => { const task = data.tasks.find(task => task.id === item.task_id) || null; const context = preparationRowContext(data, task); return ({ id: item.artifact_id, title: item.title, category: materialCategory({ title: item.title }), type: item.origin === "preparation" ? context.type : "对话生成", subject: context.subject, source: item.origin === "preparation" ? context.source : "EduPi 对话", date: item.updated_at, status: item.available === false ? "文件已移动或删除" : item.origin === "preparation" ? (data.tasks.some(task => task.id === item.task_id && ["accepted","modified"].includes(task.status)) ? "已确认" : "候选") : "已生成", summary: item.title, task, filePath: item.available === false ? null : workspaceFile(data.workspace, item.relative_path), deleteKind: item.origin === "preparation" ? null : "generated" }); });
    for (const item of [...documentRows, ...artifactRows, ...taskRows, ...intakeRows, ...generatedRows]) unique.set(item.filePath || item.id, item);
    return [...unique.values()].filter((item) => !query || `${item.title} ${item.type} ${item.subject} ${item.source} ${item.summary}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
}

export function defaultMaterialIntakeMetadata(title: string, context: { subject?: string; classes?: string[] } | null | undefined): MaterialIntakeMetadata {
  const classes = [...new Set((context?.classes || []).map(value => value.trim()).filter(Boolean))];
  return { title, materialKind: "other", subject: context?.subject?.trim() || "", classId: classes.length === 1 ? classes[0] : "" };
}
