"use client";

import type { EducationContract, EducationEntityDeleteKind, TeacherTask } from "@/lib/edupi-education-contract";
import { filterTimetableSlots, type CalendarItemSelection } from "@/lib/edupi-calendar-model";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import { filterSubjectKnowledgeItems, routePart, type TeachingSectionId } from "@/lib/edupi-domain-navigation";
import { isUserFacingMemory, taskDisplayTitle, taskKey, taskStatusLabel } from "@/lib/edupi-workbench";
import { buildTeachingPriorityConversationPrompt } from "@/lib/edupi-teaching-priority-prompt";
import { isTaskReviewable, workCaseForTask, workCaseStateLabel } from "@/lib/edupi-work-case";
import { EduPiTimetableGrid } from "./EduPiTimetableGrid";
import { taskCategory } from "@/lib/edupi-task-category";
import { EduPiPreparationStatus } from "./EduPiPreparationStatus";
import { EduPiTeachingFacts } from "./EduPiTeachingFacts";
import { EduPiTeachingPriorities } from "./EduPiTeachingPriorities";

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function localDateOnly(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function weekBounds(value: string): { start: string; end: string } {
  const start = new Date(`${value}T00:00:00`);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start: localDateOnly(start), end: localDateOnly(end) };
}

function teachingPreparationSummary(task: TeacherTask): string {
  const sourceSummary = typeof task.evidence.source_summary === "string" ? task.evidence.source_summary : "";
  const parts = sourceSummary.split("；").map((part) => part.trim()).filter(Boolean);
  const compact = (label: string, take: number) => {
    const part = parts.find((item) => item.startsWith(`${label}：`));
    if (!part) return null;
    const values = part.slice(label.length + 1).split("、").map((item) => item.trim()).filter(Boolean);
    return values.length ? `${label}：${values.slice(0, take).join("、")}${values.length > take ? "等" : ""}` : null;
  };
  const material = compact("可用材料", 2);
  return [compact("教学重点", 2), compact("班级依据", 1), material === "可用材料：尚未关联" ? null : material].filter(Boolean).join(" · ") || task.deliverables.join(" · ");
}

export function EduPiTeachingWorkspace({ data, context, query, selectedObjectId, onObject, onTask, onNavigate, onStartAgent, onCalendarSelection, onEducation, onDeleteEntity }: { data: EducationContract; context: TeacherContextSnapshot | null; query: string; selectedObjectId: string | null; onObject: (id: string) => void; onTask: (task: TeacherTask) => void; onNavigate: (view: "calendar" | "tasks" | "memory", objectId?: string) => void; onStartAgent: (prompt: string, mode?: "insert" | "replace") => void; onCalendarSelection: (selection: CalendarItemSelection) => void; onEducation: (data: EducationContract) => void; onDeleteEntity: (kind: EducationEntityDeleteKind, id: string, label: string) => Promise<boolean> }) {
  const section = routePart(selectedObjectId, "teaching", "home") as TeachingSectionId;
  const slots = filterTimetableSlots(data.timetable, query);
  const knowledge = filterSubjectKnowledgeItems(data.continuity.subjectKnowledge, query);
  const activePriorities = data.continuity.teachingPriorities.filter((priority) => priority.status === "active" && (!query || `${priority.subject} ${priority.className || ""} ${priority.topic} ${priority.note || ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const beforeClassTasks = data.tasks.filter((task) => task.trigger === "teaching_before_class");
  const teachingCases = data.workCases.filter((workCase) => workCase.kind === "teaching_before_class");
  const tasks = data.tasks.filter((task) => taskCategory(task) === "teaching" && (!query || `${task.title} ${task.topic || ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const memories = data.continuity.memories.filter((memory) => memory.state === "active" && memory.category === "teaching" && isUserFacingMemory(memory) && (!query || `${memory.content} ${memory.tags.join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const weekday = new Date().getDay() || 7;
  const orderedSlots = data.timetable.slice().sort((left, right) => Number(left.day_of_week) - Number(right.day_of_week) || Number(left.period) - Number(right.period));
  const nextSlot = orderedSlots.find((slot) => Number(slot.day_of_week) >= weekday) || orderedSlots[0];
  const today = localDateOnly();
  const currentWeek = weekBounds(today);
  const weekPreparations = beforeClassTasks.filter((task) => Boolean(task.sourceEventDate && task.sourceEventDate >= currentWeek.start && task.sourceEventDate <= currentWeek.end)).sort((left, right) => String(left.sourceEventDate).localeCompare(String(right.sourceEventDate)) || left.title.localeCompare(right.title));
  const weekPreparationIds = new Set(weekPreparations.map((task) => task.id).filter(Boolean));
  const nextTeachingTask = weekPreparations.find((task) => Boolean(task.sourceEventDate && task.sourceEventDate >= today)) || beforeClassTasks.filter((task) => Boolean(task.sourceEventDate && task.sourceEventDate >= today)).sort((left, right) => String(left.sourceEventDate).localeCompare(String(right.sourceEventDate)))[0] || null;
  const nextWorkCase = workCaseForTask(data, nextTeachingTask?.id);
  const preparedCount = teachingCases.filter((workCase) => {
    const task = beforeClassTasks.find((candidate) => candidate.id === workCase.taskId);
    return weekPreparationIds.has(workCase.taskId)
      && (workCase.currentState === "draft_ready" || workCase.currentState === "accepted" || workCase.currentState === "modified" || workCase.currentState === "completed")
      && Boolean(task && isTaskReviewable(task, workCase));
  }).length;
  const nextSubject = String(nextTeachingTask?.sourceEventName || nextSlot?.subject || context?.subject || "下一节课");
  const subjectLabel = [context?.subject, context?.grade].filter(Boolean).join(" · ") || "教学工作区";
  const priorityPrompt = buildTeachingPriorityConversationPrompt({ subject: context?.subject || null, grade: context?.grade || null, currentTopics: [...activePriorities.map((item) => item.topic), ...knowledge.map((item) => item.topic)] });
  const selectCourse = (selection: CalendarItemSelection) => { onCalendarSelection(selection); onNavigate("calendar"); };
  const openNextPreparation = () => nextTeachingTask ? onTask(nextTeachingTask) : onStartAgent(`请为${nextSubject}准备下一节课的重点、材料和课堂检查点，结合现有学情与教育记忆，先给我可审核候选。`);

  const header = <><header className="edupi-module-heading edupi-teaching-heading"><div>{section !== "home" ? <button type="button" className="edupi-back-link" onClick={() => onObject("teaching:home")}>← 教学首页</button> : <span>教学工作区</span>}<h1>{section === "home" ? "教学" : section === "schedule" ? "课程表" : section === "knowledge" ? "教学重点" : section === "tasks" ? "备课任务" : "教学记忆"}</h1><p>{subjectLabel}</p></div><div className="edupi-teaching-heading__actions"><button type="button" onClick={() => onStartAgent(priorityPrompt, "replace")}>对话补充重点</button><button type="button" className="is-primary" onClick={openNextPreparation}>{nextTeachingTask ? "查看下一节准备" : "准备下一节课"}</button></div></header><EduPiPreparationStatus /></>;

  if (section === "schedule") return <main className="edupi-module-workspace edupi-teaching-workspace">{header}<EduPiTimetableGrid slots={slots} onSelect={selectCourse} /></main>;
  if (section === "knowledge") return <main className="edupi-module-workspace edupi-teaching-workspace">{header}<EduPiTeachingPriorities priorities={data.continuity.teachingPriorities} defaultSubject={context?.subject || ""} defaultClassName={context?.classes?.[0] || String(nextSlot?.class_name || "")} query={query} onEducation={onEducation} onStartAgent={onStartAgent} onDeleteEntity={onDeleteEntity} /><EduPiTeachingFacts factSpine={data.factSpine} query={query} /><section className="edupi-database"><div className="edupi-database__head edupi-teaching-knowledge-grid"><span>主题</span><span>共性问题</span><span>需关注学生</span><span>掌握度</span></div>{knowledge.map((item) => <details className="edupi-database-row" key={item.id}><summary className="edupi-teaching-knowledge-grid"><strong>{item.topic}</strong><span>{item.commonErrors[0]?.description || "暂无"}</span><span>{item.strugglingStudents.join("、") || "—"}</span><span>{item.mastery === null ? "—" : `${Math.round(item.mastery * 100)}%`}</span></summary><div className="edupi-database-row__detail"><div><span>学科</span><strong>{item.subject}</strong></div><div><span>前置知识</span><strong>{item.prerequisites.join("、") || "—"}</strong></div><div><span>最近更新</span><strong>{shortDate(item.updatedAt)}</strong></div></div></details>)}</section></main>;
  if (section === "tasks") return <main className="edupi-module-workspace edupi-teaching-workspace">{header}<section className="edupi-database"><div className="edupi-database__head edupi-teaching-task-grid"><span>任务</span><span>主题</span><span>上课日期</span><span>状态</span></div>{tasks.map((task) => { const workCase = workCaseForTask(data, task.id); return <button type="button" className="edupi-database-button-row edupi-teaching-task-grid" key={taskKey(task)} onClick={() => onTask(task)}><strong>{taskDisplayTitle(task)}</strong><span>{task.topic || task.sourceEventName || "教学准备"}</span><span>{task.sourceEventDate || task.dueDate || "待确认"}</span><span>{workCase ? workCaseStateLabel(workCase.currentState) : taskStatusLabel(task)}</span></button>; })}</section></main>;
  if (section === "memory") return <main className="edupi-module-workspace edupi-teaching-workspace">{header}<section className="edupi-database"><div className="edupi-database__head edupi-teaching-memory-grid"><span>记忆</span><span>标签</span><span>累计</span><span>更新</span></div>{memories.map((memory) => <details className="edupi-database-row" key={memory.id}><summary className="edupi-teaching-memory-grid"><strong>{memory.content}</strong><span>{memory.tags.slice(0, 3).join(" · ") || "—"}</span><span>{memory.count} 次</span><span>{shortDate(memory.updatedAt || memory.createdAt)}</span></summary><div className="edupi-database-row__detail"><button type="button" onClick={() => onNavigate("memory", "memory:teaching")}>打开教育记忆</button></div></details>)}</section></main>;

  return <main className="edupi-module-workspace edupi-teaching-workspace">{header}<section className="edupi-teaching-next-line"><div><span>下一节课</span><strong>{nextSubject}</strong><p>{nextTeachingTask?.sourceEventDate || (nextSlot ? `周${String(nextSlot.day_of_week)} · 第 ${String(nextSlot.period)} 节${nextSlot.class_name ? ` · ${String(nextSlot.class_name)}` : ""}` : "课表待导入")} {nextWorkCase ? `· ${workCaseStateLabel(nextWorkCase.currentState)}` : ""}</p></div><button type="button" onClick={nextTeachingTask ? openNextPreparation : () => onObject("teaching:schedule")}>{nextTeachingTask ? "查看准备" : "课程表"}</button></section><section className="edupi-teaching-preparation"><header><h2>本周课前准备</h2><span>{weekPreparations.length} 节{preparedCount > 0 ? ` · ${preparedCount} 已准备` : ""}</span></header><div>{weekPreparations.map((task) => { const workCase = workCaseForTask(data, task.id); return <button type="button" key={taskKey(task)} onClick={() => onTask(task)}><time>{task.sourceEventDate?.slice(5).replace("-", "/") || "--/--"}</time><span><strong>{task.sourceEventName || taskDisplayTitle(task)}</strong><small>{teachingPreparationSummary(task)}</small></span><em className={`is-${workCase?.currentState || "planned"}`}><i className={`edupi-flow-state is-${workCase?.currentState || "planned"}`} aria-hidden="true" />{workCase ? workCaseStateLabel(workCase.currentState) : taskStatusLabel(task)}</em></button>; })}{weekPreparations.length === 0 ? <p>本周课前工作包尚未形成</p> : null}</div></section><section className="edupi-teaching-home-section"><header><h2>本周课程</h2><button type="button" onClick={() => onObject("teaching:schedule")}>完整课程表</button></header><EduPiTimetableGrid slots={slots} onSelect={selectCourse} compact /></section><div className="edupi-teaching-home-columns"><section><header><h2>当前教学重点</h2><button type="button" onClick={() => onObject("teaching:knowledge")}>全部</button></header>{activePriorities.length > 0 ? activePriorities.slice(0, 4).map((item) => <details key={item.id}><summary><strong>{item.topic}</strong><span>{item.note || "教师维护"}</span></summary><p>{item.subject} · {item.className || "全部班级"}</p></details>) : knowledge.slice(0, 4).map((item) => <details key={item.id}><summary><strong>{item.topic}</strong><span>{item.commonErrors[0]?.description || "暂无共性问题"}</span></summary><p>{item.strugglingStudents.length ? `需关注：${item.strugglingStudents.join("、")}` : "暂无需特别关注学生"}</p></details>)}</section><section><header><h2>备课任务</h2><button type="button" onClick={() => onObject("teaching:tasks")}>全部</button></header>{tasks.slice(0, 5).map((task) => { const workCase = workCaseForTask(data, task.id); return <button type="button" key={taskKey(task)} onClick={() => onTask(task)}><strong>{taskDisplayTitle(task)}</strong><span>{workCase ? workCaseStateLabel(workCase.currentState) : task.dueDate || taskStatusLabel(task)}</span></button>; })}</section></div></main>;
}
