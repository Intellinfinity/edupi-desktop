"use client";

import type { EducationContract, EducationMemoryCandidate, EducationObservation, TeacherTask } from "@/lib/edupi-education-contract";
import { filterTimetableSlots, type CalendarItemSelection } from "@/lib/edupi-calendar-model";
import { useStudentObservationRows } from "@/hooks/useStudentObservationRows";
import { isRecognizedTimetableNote } from "@/lib/edupi-recognition-markers";
import { INSIGHT_CATEGORIES, INSIGHT_STATUSES, MATERIAL_CATEGORIES, MEMORY_CATEGORIES, TEACHING_SECTIONS, filterSubjectKnowledgeItems, filterTeachingPriorityItems, insightCategory, materialCategoryRoute, matchesWorkspaceQuery as match, memoryCategoryRoute, memoryObjectId, memorySemesterRoute, routePart, type InsightCategoryId, type InsightStatusId, type MaterialCategoryId } from "@/lib/edupi-domain-navigation";
import { scopedMemoryIds, type EducationMemoryScopeProjection } from "@/lib/edupi-memory-scopes";
import type { EduPiTeachingSkillLifecycle } from "@/lib/edupi-platform-client";
import { groupTasksByCategory, matchesTaskQuery, taskCategory, TASK_CATEGORY_CONFIG } from "@/lib/edupi-task-category";
import { studentRecordKey, studentRecordName } from "@/lib/edupi-student-roster-model";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import { confirmedTaskArtifacts, isTaskActionable, isUserFacingMemory, recordLabel, taskArtifacts, taskDisplayTitle, taskKey, taskStatusLabel, taskStatusTone, taskTypeLabel, type TaskStage, type WorkbenchView } from "@/lib/edupi-workbench";
import { isTaskReviewable, workCaseForTask } from "@/lib/edupi-work-case";
import { EduPiContentSider } from "./EduPiContentSider";
import { buildMaterialRows } from "@/lib/edupi-material-rows";
import { factInsightCategory, factInsightStatus } from "@/lib/edupi-fact-lifecycle-model";

type Props = {
  view: WorkbenchView;
  data: EducationContract;
  context: TeacherContextSnapshot | null;
  memoryScopes: EducationMemoryScopeProjection | null;
  teachingSkills: EduPiTeachingSkillLifecycle;
  query: string;
  onQuery: (query: string) => void;
  selectedStudentId: string | null;
  onStudent: (student: Record<string, unknown>) => void;
  selectedObjectId: string | null;
  onObject: (id: string) => void;
  selectedTaskKey: string | null;
  onTask: (task: TeacherTask, stage?: TaskStage) => void;
  onReviewTarget?: (target: { kind: "observation" | "memory_candidate"; id: string }) => void;
  selectedCalendarSourceId?: string | null;
  onCalendarItem?: (selection: CalendarItemSelection) => void;
  onUpload: () => void;
  onCollapse: () => void;
};

type C1ObjectTarget =
  | { kind: "observation"; item: EducationObservation; id: string }
  | { kind: "memory_candidate"; item: EducationMemoryCandidate; id: string };

const viewTitles: Record<WorkbenchView, string> = {
  chat: "AI 协作",
  dashboard: "今天",
  workspace: "工作区",
  teaching: "教学",
  homeroom: "班级",
  calendar: "日程",
  memory: "教育记忆",
  insights: "观察与洞察",
  growth: "成长",
  students: "学生档案",
  materials: "材料",
  review: "待我确认",
  tasks: "教学任务",
  artifacts: "教学产物",
};

function GroupTitle({ children, count }: { children: string; count?: number }) {
  return <div className="edupi-object-group__title"><strong>{children}</strong>{count !== undefined ? <span>{count}</span> : null}</div>;
}

function TaskRow({ task, selected, onClick }: { task: TeacherTask; selected: boolean; onClick: () => void }) {
  return <button type="button" className={`edupi-object-row${selected ? " is-selected" : ""}`} onClick={onClick}><span className={`edupi-object-row__marker is-${taskStatusTone(task)}`} aria-hidden="true" /><span className="edupi-object-row__copy"><strong>{taskDisplayTitle(task)}</strong><small>{task.dueDate || taskTypeLabel(task)}</small></span><em>{taskStatusLabel(task)}</em></button>;
}

function C1ReviewRow({ target, onClick }: { target: C1ObjectTarget; onClick: () => void }) {
  const isObservation = target.kind === "observation";
  const content = isObservation ? target.item.text : target.item.proposedContent;
  const source = isObservation
    ? target.item.provenance.find((entry) => entry.sourceKind === "teacher_message")?.sourceId || "教师消息"
    : target.item.basedOnObservationIds.length > 0 ? `观察 ${target.item.basedOnObservationIds[0]}` : "观察来源待补";
  return <button type="button" className="edupi-object-row edupi-c1-object-row" onClick={onClick} aria-label={`打开${isObservation ? "教师观察" : "记忆候选"}：${content}`}><span className="edupi-object-row__marker is-warning" aria-hidden="true" /><span className="edupi-object-row__copy"><strong>{content}</strong><small>{isObservation ? "教师观察" : "记忆候选"} · {source}</small></span><em>待确认</em></button>;
}

function CategoryRow({ label, count, selected, onClick }: { label: string; count?: number; selected: boolean; onClick: () => void }) {
  return <button type="button" className={`edupi-object-category${selected ? " is-selected" : ""}`} onClick={onClick}><strong>{label}</strong>{count !== undefined ? <span>{count}</span> : null}<em>›</em></button>;
}

function ObjectStudentRow({ student, index, selected, onClick }: { student: Record<string, unknown>; index: number; selected: boolean; onClick: () => void }) {
  const name = studentRecordName(student);
  const patterns = Array.isArray(student.error_patterns) ? student.error_patterns : [];
  const trajectory = Array.isArray(student.trajectory) ? student.trajectory : [];
  const latest = patterns.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
  return <button type="button" className={`edupi-object-row edupi-object-student${selected ? " is-selected" : ""}`} onClick={onClick}><span className={`edupi-object-student__avatar is-tint-${index % 4}`}>{name.slice(0, 1)}</span><span className="edupi-object-row__copy"><strong>{name}</strong><small>{typeof student.class_name === "string" ? `${student.class_name} · ` : ""}{latest ? recordLabel(latest, ["description", "desc"], "学习观察") : `${patterns.length} 个模式 · ${trajectory.length} 个节点`}</small></span><em>›</em></button>;
}

export function EduPiObjectSider({ view, data, context, memoryScopes, teachingSkills, query, onQuery, selectedStudentId, onStudent, selectedObjectId, onObject, selectedTaskKey, onTask, onReviewTarget, selectedCalendarSourceId, onCalendarItem, onUpload, onCollapse }: Props) {
  const tasks = data.tasks.filter((task) => matchesTaskQuery(task, query));
  const pending = tasks.filter((task) => isTaskActionable(task));
  const pendingC1: C1ObjectTarget[] = [
    ...data.observations.filter((item) => (item.teacherReview.state === "pending_review" || item.teacherReview.state === "held") && match(`${item.text} ${item.observationId} ${item.evidenceIds.join(" ")}`, query)).map((item) => ({ kind: "observation" as const, item, id: item.observationId })),
    ...data.memoryCandidates.filter((item) => item.teacherReview.state !== "rejected" && (item.teacherReview.state === "pending_review" || item.teacherReview.state === "held") && match(`${item.proposedContent} ${item.candidateId} ${item.tags.join(" ")}`, query)).map((item) => ({ kind: "memory_candidate" as const, item, id: item.candidateId })),
  ];
  const pendingReview = pending.filter((task) => isTaskReviewable(task, workCaseForTask(data, task.id)));
  const pendingFacts = (data.factSpine?.factCandidates || []).filter((fact) => (fact.status === "candidate" || fact.status === "pending_review" || fact.status === "held") && match(`${fact.value} ${fact.predicate} ${fact.subjectRef || ""} ${fact.topicRef || ""}`, query));
  const reviewed = tasks.filter((task) => task.boardStage === "done" || (task.status !== "planned" && task.status !== "hold"));
  const teachingTasks = tasks.filter((task) => taskCategory(task) === "teaching");
  const homeroomTasks = tasks.filter((task) => task.trigger === "student_follow_up");
  const materials = buildMaterialRows(data, query);
  const artifacts = tasks.filter((task) => taskArtifacts(task).length > 0);
  const confirmedGrowthArtifacts = confirmedTaskArtifacts(data.tasks, query);
  const students = data.students.filter((student) => match(recordLabel(student, ["name", "student_name", "display_name"], ""), query));
  const calendar = data.calendar.filter((event) => match(`${event.name} ${event.date || ""}`, query));
  const timetable = filterTimetableSlots(data.timetable, query);
  const subjectKnowledge = filterSubjectKnowledgeItems(data.continuity.subjectKnowledge, query);
  const teachingPriorities = filterTeachingPriorityItems(data.continuity.teachingPriorities, query);
  const memories = data.continuity.memories.filter((memory) => memory.state === "active" && isUserFacingMemory(memory) && match(`${memory.content} ${memory.student || ""} ${memory.tags.join(" ")}`, query));
  const observations = data.observations.filter((observation) => match(`${observation.text} ${observation.subject || ""} ${observation.classId || ""} ${observation.studentIds.join(" ")}`, query));
  const insights = data.continuity.insights.filter((insight) => !insight.content.startsWith("[主题候选]") && match(`${insight.content} ${insight.evidenceIds.join(" ")}`, query)).sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  const signals = data.continuity.signals.filter((signal) => match(`${signal.content} ${signal.related.join(" ")}`, query)).sort((left, right) => right.strength - left.strength);
  const facts = [...(data.factSpine?.acceptedFacts || []), ...(data.factSpine?.factCandidates || [])].filter((fact) => match(`${fact.value} ${fact.predicate} ${fact.subjectRef || ""} ${fact.topicRef || ""}`, query));
  const documents = data.continuity.documents.filter((document) => document.kind !== "daily" && document.kind !== "dream" && match(`${document.title} ${document.excerpt}`, query));
  const teachingSection = routePart(selectedObjectId, "teaching", "home");
  const memoryCategory = memoryCategoryRoute(selectedObjectId);
  const memorySemesterId = memorySemesterRoute(selectedObjectId, memoryScopes?.active_semester_id || null);
  const visibleMemoryIds = scopedMemoryIds(memoryScopes, memorySemesterId);
  const scopedMemories = visibleMemoryIds ? memories.filter((memory) => visibleMemoryIds.has(memory.id)) : memories;
  const [insightCategoryRoute = "learning", insightStatusRoute = "all"] = routePart(selectedObjectId, "insights", "learning:all").split(":") as [InsightCategoryId, InsightStatusId];
  const growthCategory = routePart(selectedObjectId, "growth", "teacher");
  const materialCategoryId = materialCategoryRoute(selectedObjectId);
  const learningRecords = useStudentObservationRows(view === "insights" ? "learning" : "", "all", query, 0);
  const interactionRecords = useStudentObservationRows(view === "insights" ? "class" : "", "all", query, 0);
  const studentCount = (category: InsightCategoryId) => category === "learning" ? learningRecords.total : category === "class" ? interactionRecords.total : 0;
  const insightCategoryCount = (category: InsightCategoryId) => observations.filter((item) => insightCategory(item.text) === category).length + insights.filter((item) => insightCategory(item.content) === category).length + signals.filter((item) => insightCategory(item.content) === category).length + facts.filter((item) => factInsightCategory(item) === category).length + studentCount(category);
  const insightStatusCount = (status: InsightStatusId) => {
    const categoryObservations = observations.filter((item) => insightCategory(item.text) === insightCategoryRoute);
    const categoryInsights = insights.filter((item) => insightCategory(item.content) === insightCategoryRoute);
    const categorySignals = signals.filter((item) => insightCategory(item.content) === insightCategoryRoute);
    const categoryFacts = facts.filter((item) => factInsightCategory(item) === insightCategoryRoute);
    if (status === "observation") return categoryObservations.length + studentCount(insightCategoryRoute);
    if (status === "fact_confirmed" || status === "fact_pending" || status === "fact_held") return categoryFacts.filter((item) => factInsightStatus(item) === status).length;
    if (status === "signal") return categorySignals.length;
    if (status === "surfaced" || status === "brewing") return categoryInsights.filter((item) => item.status === status).length;
    return categoryObservations.length + categoryFacts.length + categoryInsights.length + categorySignals.length + studentCount(insightCategoryRoute);
  };
  const materialCount = (category: MaterialCategoryId) => category === "all" ? materials.length : materials.filter(item => item.category === category).length;
  const tasksByCategory = groupTasksByCategory(tasks);
  const taskRows = (rows: TeacherTask[], stage: TaskStage) => rows.map((task) => <TaskRow key={taskKey(task)} task={task} selected={taskKey(task) === selectedTaskKey} onClick={() => onTask(task, stage)} />);

  return (
    <EduPiContentSider width={244} ariaLabel={`${viewTitles[view]}对象列表`} header={<><div className="edupi-object-sider__header"><div><span>当前模块</span><strong>{viewTitles[view]}</strong></div><button type="button" onClick={onCollapse} aria-label="收起列表">‹</button></div><label className="edupi-object-sider__search"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder={`搜索${viewTitles[view]}`} aria-label={`搜索${viewTitles[view]}`} /></label></>}>
      {view === "dashboard" ? <><section className="edupi-object-group"><GroupTitle count={pending.length}>需要处理</GroupTitle>{taskRows(pending, "review")}{pending.length === 0 ? <div className="edupi-object-empty">暂无待处理事项</div> : null}</section><section className="edupi-object-group"><GroupTitle count={reviewed.length}>最近完成</GroupTitle>{taskRows(reviewed.slice(0, 6), "brief")}</section></> : null}
      {view === "teaching" ? <section className="edupi-object-group"><GroupTitle>教学工作区</GroupTitle>{TEACHING_SECTIONS.map((section) => <CategoryRow key={section.id} label={section.label} count={section.id === "schedule" ? timetable.length : section.id === "knowledge" ? subjectKnowledge.length + teachingPriorities.length + (data.factSpine?.teachingView.acceptedFactIds.length || 0) : section.id === "tasks" ? teachingTasks.length : section.id === "memory" ? memories.filter((item) => item.category === "teaching").length : undefined} selected={teachingSection === section.id} onClick={() => onObject(`teaching:${section.id}`)} />)}</section> : null}
      {view === "homeroom" ? <><section className="edupi-object-group"><GroupTitle count={homeroomTasks.length}>学生跟进</GroupTitle>{taskRows(homeroomTasks, "run")}{homeroomTasks.length === 0 ? <div className="edupi-object-empty">暂无跟进事项</div> : null}</section><section className="edupi-object-group"><GroupTitle count={students.length}>学生</GroupTitle>{students.map((student, index) => { const id = studentRecordKey(student, index); return <ObjectStudentRow key={id} student={student} index={index} selected={id === selectedStudentId} onClick={() => onStudent(student)} />; })}</section></> : null}
      {view === "tasks" ? <>{TASK_CATEGORY_CONFIG.map((category) => { const rows = tasksByCategory[category.id]; return rows.length > 0 ? <section className="edupi-object-group" key={category.id}><GroupTitle count={rows.length}>{category.label}</GroupTitle>{taskRows(rows, "brief")}</section> : null; })}{tasks.length === 0 ? <div className="edupi-object-empty">暂无匹配任务</div> : null}</> : null}
      {view === "review" ? <><section className="edupi-object-group"><GroupTitle>审核入口</GroupTitle><CategoryRow label="审核看板" count={pendingReview.length + pendingC1.length + pendingFacts.length} selected={selectedObjectId === "review:board" || !selectedObjectId} onClick={() => onObject("review:board")} /></section><section className="edupi-object-group"><GroupTitle count={pendingFacts.length}>事实</GroupTitle><CategoryRow label="事实确认" count={pendingFacts.length} selected={selectedObjectId === "review:board" || !selectedObjectId} onClick={() => onObject("review:board")} /></section><section className="edupi-object-group"><GroupTitle count={pendingC1.length}>观察与记忆</GroupTitle>{pendingC1.map((target) => <C1ReviewRow key={`${target.kind}:${target.id}`} target={target} onClick={() => onReviewTarget?.({ kind: target.kind, id: target.id })} />)}{pendingC1.length === 0 ? <div className="edupi-object-empty">暂无待确认内容</div> : null}</section><section className="edupi-object-group"><GroupTitle count={pendingReview.length}>任务审核</GroupTitle>{taskRows(pendingReview, "review")}{pendingReview.length === 0 ? <div className="edupi-object-empty">暂无待审核任务</div> : null}</section></> : null}
      {view === "students" ? <><section className="edupi-object-group"><GroupTitle>班级</GroupTitle>{(context?.classes?.length ? context.classes : [context?.grade || "年级待设置"]).map((name) => <div className="edupi-object-fact" key={name}><strong>{name}</strong><span>{context?.subject || "学科待设置"}</span></div>)}</section><section className="edupi-object-group"><GroupTitle count={students.length}>学生</GroupTitle>{students.map((student, index) => { const id = studentRecordKey(student, index); return <ObjectStudentRow key={id} student={student} index={index} selected={id === selectedStudentId} onClick={() => onStudent(student)} />; })}{students.length === 0 ? <div className="edupi-object-empty">暂无学生事实</div> : null}</section></> : null}
      {view === "calendar" ? <><section className="edupi-object-group"><GroupTitle count={timetable.length}>本周课程</GroupTitle>{timetable.map((slot, index) => { const sourceId = recordLabel(slot, ["slot_id", "id"], `timetable:${index}`); const title = recordLabel(slot, ["subject"], "课程"); const detail = `周${String(slot.day_of_week ?? "-")} · 第 ${String(slot.period ?? "-")} 节`; const recognized = isRecognizedTimetableNote(slot.notes); return <button type="button" className={`edupi-object-fact is-interactive${selectedCalendarSourceId === sourceId ? " is-selected" : ""}`} key={sourceId} onClick={() => onCalendarItem?.({ kind: "timetable", sourceId, date: null, title, detail, sourceLabel: recognized ? "材料识别" : "课程表", statusLabel: recognized ? "待确认" : "已确认" })}><strong>{title}</strong><span>{detail}{recognized ? " · 待确认" : ""}</span></button>; })}{timetable.length === 0 ? <div className="edupi-object-empty">暂无课程表</div> : null}</section><section className="edupi-object-group"><GroupTitle count={calendar.length}>校历节点</GroupTitle>{calendar.map((event) => { const sourceId = event.id || `calendar:${event.date || "pending"}:${event.name}`; return <button type="button" className={`edupi-object-fact is-interactive${selectedCalendarSourceId === sourceId ? " is-selected" : ""}`} key={sourceId} onClick={() => onCalendarItem?.({ kind: "calendar", sourceId, date: event.date, title: event.name, detail: event.notes, sourceLabel: event.source === "official_school_calendar" ? "学校校历" : event.source === "teacher" ? "教师" : event.source === "inferred" ? "材料识别" : "校历", statusLabel: event.preparationStatus === "read_only" ? "已确认" : "待确认" })}><strong>{event.name}</strong><span>{event.date || "日期待确认"}</span></button>; })}</section></> : null}
      {view === "memory" ? <><section className="edupi-object-group"><GroupTitle count={memoryScopes?.semesters.length}>学期</GroupTitle>{memoryScopes?.semesters.map((semester) => <CategoryRow key={semester.semester_id} label={semester.label} count={semester.memory_count} selected={memorySemesterId === semester.semester_id} onClick={() => onObject(memoryObjectId(semester.semester_id, memoryCategory))} />)}{!memoryScopes ? <div className="edupi-object-empty">当前学期</div> : null}</section><section className="edupi-object-group"><GroupTitle count={scopedMemories.length}>记忆分类</GroupTitle>{MEMORY_CATEGORIES.map((category) => <CategoryRow key={category.id} label={category.label} count={scopedMemories.filter((item) => item.category === category.id).length} selected={memoryCategory === category.id} onClick={() => onObject(memoryObjectId(memorySemesterId, category.id))} />)}</section></> : null}
      {view === "insights" ? <><section className="edupi-object-group"><GroupTitle>一级分类</GroupTitle>{INSIGHT_CATEGORIES.map((category) => <CategoryRow key={category.id} label={category.label} count={insightCategoryCount(category.id)} selected={insightCategoryRoute === category.id} onClick={() => onObject(`insights:${category.id}:${insightStatusRoute}`)} />)}</section><section className="edupi-object-group"><GroupTitle>状态筛选</GroupTitle>{INSIGHT_STATUSES.map((status) => <CategoryRow key={status.id} label={status.label} count={insightStatusCount(status.id)} selected={insightStatusRoute === status.id} onClick={() => onObject(`insights:${insightCategoryRoute}:${status.id}`)} />)}</section></> : null}
      {view === "growth" ? <section className="edupi-object-group"><GroupTitle>成长对象</GroupTitle><CategoryRow label="教师专业成长" count={documents.filter(item => item.kind === "weekly").length + confirmedGrowthArtifacts.length} selected={growthCategory === "teacher"} onClick={() => onObject("growth:teacher")} /><CategoryRow label="EduPi 能力成长" count={teachingSkills.skills.length} selected={growthCategory === "edupi"} onClick={() => onObject("growth:edupi")} /></section> : null}
      {view === "materials" ? <section className="edupi-object-group"><div className="edupi-object-group__actions"><GroupTitle count={materials.length}>材料分类</GroupTitle><button type="button" onClick={onUpload}>上传</button></div>{MATERIAL_CATEGORIES.map((category) => <CategoryRow key={category.id} label={category.label} count={materialCount(category.id)} selected={materialCategoryId === category.id} onClick={() => onObject(`materials:${category.id}`)} />)}</section> : null}
      {view === "artifacts" ? <section className="edupi-object-group"><GroupTitle count={artifacts.reduce((total, task) => total + taskArtifacts(task).length, 0)}>最近产物</GroupTitle>{taskRows(artifacts, "artifact")}{artifacts.length === 0 ? <div className="edupi-object-empty">暂无教学产物</div> : null}</section> : null}
      {view === "insights" ? <section className="edupi-object-group"><GroupTitle>学生记录</GroupTitle><CategoryRow label="学生学习与互动" selected={Boolean(selectedObjectId?.startsWith("insights:student_records"))} onClick={() => onObject("insights:student_records")} /></section> : null}
    </EduPiContentSider>
  );
}
