"use client";
import { briefPreview } from "@/lib/edupi-brief-preview";

import type { CalendarFact, EducationContract, EducationEntityDeleteKind, TeacherTask } from "@/lib/edupi-education-contract";
import type { CalendarItemSelection } from "@/lib/edupi-calendar-model";
import { calendarReferenceDate, calendarSortDate, compareForegroundDates, isForegroundDate, shanghaiDate } from "@/lib/edupi-foreground";
import { EduPiListPreview, EduPiPagedRows, useEduPiForegroundPolicy } from "./EduPiForeground";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import {
  taskArtifacts,
  taskDisplayTitle,
  type TaskStage,
  type WorkbenchView,
} from "@/lib/edupi-workbench";
import { EduPiCalendarWorkspace } from "./EduPiCalendarWorkspace";
import { EduPiInsightDatabase } from "./EduPiInsightDatabase";
import { EduPiGrowthWorkspace } from "./EduPiGrowthWorkspace";
import { EduPiMaterialsWorkspace } from "./EduPiMaterialsWorkspace";
import { EduPiMemoryDatabase } from "./EduPiMemoryDatabase";
import { EduPiStudentWorkspace } from "./EduPiStudentWorkspace";
import { EduPiStudentEvents } from "./EduPiStudentEvents";
import { EduPiTeachingWorkspace } from "./EduPiTeachingWorkspace";
import { EduPiTodayWork } from "./EduPiTodayWork";
import { EduPiWorkspaceBoard } from "./EduPiWorkspaceBoard";
import { EduPiPlanMergeSuggestions } from "./EduPiPlanMergeSuggestions";
import type { MaterialStagingDescriptor } from "@/lib/edupi-material-staging-client";
import type { TaskBoardLaneId } from "@/lib/edupi-task-board";
import type { EducationMemoryScopeProjection } from "@/lib/edupi-memory-scopes";
import type { EduPiTeachingSkillLifecycle } from "@/lib/edupi-platform-client";
import type { CreateTeacherTaskInput, CreateTeacherTaskOutcome } from "@/lib/edupi-task-board-command";
import type { CalendarIntakeInput } from "@/lib/edupi-education-intake";
import type { EduPiKernelState } from "@/lib/edupi-kernel-client";
import type { MaterialIntakeMetadata } from "@/lib/edupi-material-rows";
import type { DocumentPairingSubmission } from "@/lib/edupi-document-pairing-contract";

type Props = {
  view: Exclude<WorkbenchView, "chat" | "tasks" | "review">;
  data: EducationContract;
  context: TeacherContextSnapshot | null;
  memoryScopes: EducationMemoryScopeProjection | null;
  teachingSkills: EduPiTeachingSkillLifecycle;
  kernelState: EduPiKernelState;
  query: string;
  selectedStudentId: string | null;
  selectedObjectId: string | null;
  runningAgentCount: number;
  stagedMaterials: MaterialStagingDescriptor[];
  stagingBusy: boolean;
  intakeBusy: boolean;
  stagingMessage: { text: string; tone: "success" | "error" } | null;
  calendarSelection: CalendarItemSelection | null;
  onTask: (task: TeacherTask, stage?: TaskStage) => void;
  onTaskDetail: (task: TeacherTask) => void;
  onEducation: (data: EducationContract) => void;
  onStudent: (student: Record<string, unknown> | null) => void;
  onObject: (id: string) => void;
  onNavigate: (view: WorkbenchView, objectId?: string) => void;
  onUpload: () => void;
  onIntakeMaterial: (item: MaterialStagingDescriptor, metadata: MaterialIntakeMetadata, scheduleSource: { sourceId: string; fingerprint: string; sourceKind: "calendar" | "document" | "timetable" } | null, pairing?: DocumentPairingSubmission | null) => Promise<unknown>;
  onRemoveStagedMaterial: (item: MaterialStagingDescriptor) => Promise<void>;
  onCalendarSelection: (selection: CalendarItemSelection | null) => void;
  onImportCalendar: (event: CalendarIntakeInput) => Promise<void>;
  onImportTimetable: (slot: { slotId: string | null; dayOfWeek: number; period: number; subject: string; classId: string | null; className: string | null; startTime: string | null; timeZone: string | null; kind: "class" | "routine"; notes: string | null }) => Promise<void>;
  onOpenContext: () => void;
  onOpenAdmin: () => void;
  onOpenFile: (path: string) => void;
  onStartAgent: (prompt: string, mode?: "insert" | "replace") => void;
  onTeachingSkills: (lifecycle: EduPiTeachingSkillLifecycle) => void;
  onCreateTask: (input: CreateTeacherTaskInput) => Promise<CreateTeacherTaskOutcome>;
  onMoveTask: (task: TeacherTask, stage: TaskBoardLaneId) => Promise<void>;
  onDeleteEntity: (kind: EducationEntityDeleteKind, id: string, label: string) => Promise<boolean>;
  onReviewTarget?: (target: { kind: "observation" | "memory_candidate"; id: string }) => void;
};

function includesQuery(value: string, query: string): boolean {
  return !query || value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function workspaceFile(workspace: string, relativePath: string): string {
  const separator = workspace.includes("\\") ? "\\" : "/";
  return `${workspace.replace(/[\\/]$/, "")}${separator}${relativePath.replace(/[\\/]/g, separator)}`;
}

function calendarFactSelection(event: CalendarFact): CalendarItemSelection {
  return {
    kind: "calendar",
    sourceId: event.id || `calendar:${event.date || "pending"}:${event.name}`,
    date: event.date,
    title: event.name,
    detail: event.notes,
    sourceLabel: event.source === "official_school_calendar" ? "学校校历" : event.source === "teacher" ? "教师" : event.source === "inferred" ? "材料识别" : "校历",
    statusLabel: event.preparationStatus === "read_only" ? "已确认" : "待确认",
  };
}

function calendarDateLabel(event: CalendarFact): string {
  if (!event.date) return "日期待确认";
  return event.endDate ? `${event.date} — ${event.endDate.slice(5)}` : event.date;
}

function calendarSourceLabel(source: string | null): string {
  if (source === "teacher") return "教师确认";
  if (source === "official_school_calendar") return "学校校历";
  if (source === "inferred") return "待核对";
  return source || "来源待补";
}

function SectionHeader({ title, meta, action, onAction }: { title: string; meta?: string; action?: string; onAction?: () => void }) {
  return <header className="edupi-page-section__header"><div><h2>{title}</h2>{meta ? <span>{meta}</span> : null}</div>{action && onAction ? <button type="button" onClick={onAction}>{action}</button> : null}</header>;
}

export function DashboardView({ data, kernelState, onEducation, onTaskDetail, onNavigate, onUpload, onOpenContext, onOpenFile, onCalendarSelection, selectedObjectId, onObject }: Pick<Props, "data" | "context" | "kernelState" | "runningAgentCount" | "onEducation" | "onTaskDetail" | "onNavigate" | "onUpload" | "onOpenContext" | "onOpenFile" | "onStartAgent" | "onCalendarSelection" | "selectedObjectId" | "onObject">) {
  const policy = useEduPiForegroundPolicy();
  const today = policy.today;
  const currentWeek = data.calendar.find((event) => Boolean(event.date && event.date <= today && (event.endDate || event.date) >= today && /第\d+周/.test(event.name)));
  const upcoming = data.calendar.filter(event => event !== currentWeek && isForegroundDate(calendarReferenceDate(event), policy))
    .sort((left, right) => compareForegroundDates(calendarSortDate(left, today), calendarSortDate(right, today), today) || left.name.localeCompare(right.name));
  const briefs = data.continuity.documents.filter(document => document.kind === "daily").sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
  const latestBrief = briefs[0];
  const latestBriefDate = latestBrief?.date ? shanghaiDate(latestBrief.date) : null;
  const latestBriefRun = kernelState.runs.filter((run) => run.triggerId === "morning_brief" && (shanghaiDate(run.updatedAt) === today || run.status === "running" || run.status === "awaiting_delivery")).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const briefIsFresh = latestBriefDate === today;
  const briefStatus = briefIsFresh
    ? "今日已生成"
    : latestBriefRun?.status === "running" || latestBriefRun?.status === "awaiting_delivery"
      ? "正在生成"
      : latestBriefRun?.status === "failed"
        ? "生成失败"
        : latestBrief
          ? `上次生成 ${latestBriefDate || "日期未知"}`
          : kernelState.status === "unavailable" ? "自动运行未接入" : "今日尚未生成";
  if (selectedObjectId === "today:briefs") return <main className="edupi-module-workspace"><header className="edupi-module-heading"><div><button type="button" className="edupi-back-link" onClick={() => onObject("today:home")}>← 今天</button><h1>简报历史</h1></div></header><EduPiPagedRows rows={briefs} memoryKey="today:briefs" renderRow={document => <div className="edupi-task-history-row" key={document.path}><button type="button" onClick={() => onOpenFile(workspaceFile(data.workspace, document.path))}><strong>{document.title}</strong><time>{document.date ? shanghaiDate(document.date) || "日期待确认" : "日期待确认"}</time></button></div>} /></main>;
  if (selectedObjectId?.startsWith("today:list:")) return <main className="edupi-module-workspace"><EduPiTodayWork data={data} onEducation={onEducation} onTaskDetail={onTaskDetail} selectedObjectId={selectedObjectId} onObject={onObject} onCalendarSelection={onCalendarSelection} /></main>;

  return <main className="edupi-module-workspace edupi-dashboard-workspace">
    <header className="edupi-dashboard-heading">
      <div><h1>今天</h1></div>
      <div className="edupi-dashboard-heading__actions"><button type="button" onClick={onOpenContext}>教学上下文</button><button type="button" className="is-primary" onClick={onUpload}>上传材料</button></div>
    </header>
    <div className="edupi-today-layout">
      <div className="edupi-today-main">
        <section className={`edupi-page-section edupi-daily-brief${briefIsFresh ? " is-fresh" : latestBriefRun?.status === "failed" ? " is-failed" : " is-stale"}`}>
          <SectionHeader title="简报" meta={briefStatus} action={latestBrief ? briefIsFresh ? "打开简报" : "简报历史" : undefined} onAction={latestBrief ? () => briefIsFresh ? onOpenFile(workspaceFile(data.workspace, latestBrief.path)) : onObject("today:briefs") : undefined} />
          {briefIsFresh && latestBrief ? <p>{briefPreview(latestBrief.excerpt)}</p> : <div className="edupi-module-empty">{briefStatus === "正在生成" ? "正在生成今日简报" : briefStatus === "生成失败" ? "今日简报生成失败" : "今天还没有生成简报"}</div>}
          <footer><span>自动运行</span><strong>{latestBriefRun ? ({ running: "正在生成", awaiting_delivery: "等待交付", failed: "生成失败", needs_review: "待确认", succeeded: "已生成", skipped: "已跳过" })[latestBriefRun.status] : kernelState.status === "unavailable" ? "状态不可用" : "尚无运行记录"}</strong></footer>
        </section>
        <EduPiTodayWork data={data} onEducation={onEducation} onTaskDetail={onTaskDetail} selectedObjectId={selectedObjectId} onObject={onObject} onCalendarSelection={onCalendarSelection} />
      </div>
      <aside className="edupi-today-side">
        <section className="edupi-page-section edupi-today-dock">
          <SectionHeader title="接下来" action="日程" onAction={() => onNavigate("calendar")} />
          {currentWeek ? <div className="edupi-today-dock__week"><span>当前</span><strong>{currentWeek.name}</strong><small>{calendarDateLabel(currentWeek)}</small></div> : null}
          <div className="edupi-today-dock__events"><EduPiListPreview rows={upcoming} onShowAll={() => onNavigate("calendar", "calendar:list:upcoming")} renderRow={event => <button type="button" key={event.id || `${event.date}:${event.name}`} onClick={() => onCalendarSelection(calendarFactSelection(event))}><time>{event.date?.slice(5).replace("-", "/") || "日期待确认"}</time><span><strong>{event.name}</strong><small>{event.endDate ? `至 ${event.endDate.slice(5).replace("-", "/")}` : calendarSourceLabel(event.source)}</small></span></button>} /></div>
          {!currentWeek && upcoming.length === 0 ? <button type="button" className="edupi-today-dock__empty" onClick={() => onNavigate("calendar")}>导入校历</button> : null}
        </section>
      </aside>
    </div>
  </main>;
}

function CalendarView({ data, query, onUpload, intakeBusy, calendarSelection, onCalendarSelection, onTaskDetail, onImportCalendar, onImportTimetable, onDeleteEntity, selectedObjectId, onObject }: Pick<Props, "data" | "query" | "onUpload" | "intakeBusy" | "calendarSelection" | "onCalendarSelection" | "onTaskDetail" | "onImportCalendar" | "onImportTimetable" | "onDeleteEntity" | "selectedObjectId" | "onObject">) {
  return <EduPiCalendarWorkspace data={data} query={query} onUpload={onUpload} intakeBusy={intakeBusy} selection={calendarSelection} onSelect={onCalendarSelection} onTaskDetail={onTaskDetail} onImportCalendar={onImportCalendar} onImportTimetable={onImportTimetable} onDeleteEntity={onDeleteEntity} selectedObjectId={selectedObjectId} onObject={onObject} />;
}

function ArtifactsView({ data, query, onTask }: Pick<Props, "data" | "query" | "onTask">) {
  const rows = data.tasks.flatMap((task) => taskArtifacts(task).map((artifact) => ({ task, artifact }))).filter(({ artifact }) => includesQuery(`${artifact.title} ${artifact.summary}`, query));
  return <main className="edupi-module-workspace"><header className="edupi-module-heading"><div><h1>教学产物</h1><p>{rows.length} 项</p></div></header><section className="edupi-artifact-table"><div className="edupi-artifact-table__head"><span>产物</span><span>来源任务</span><span>状态</span></div>{rows.map(({ task, artifact }) => <button type="button" key={artifact.id} onClick={() => onTask(task, "artifact")}><span><strong>{artifact.title}</strong></span><span>{taskDisplayTitle(task)}</span><span className={`is-${artifact.state}`}>{artifact.state === "confirmed" ? "已确认" : "候选"}</span></button>)}{rows.length === 0 ? <div className="edupi-module-empty">暂无教学产物</div> : null}</section></main>;
}

export function EduPiWorkspaceViews(props: Props) {
  if (props.view === "dashboard") return <DashboardView data={props.data} context={props.context} kernelState={props.kernelState} runningAgentCount={props.runningAgentCount} onEducation={props.onEducation} onTaskDetail={props.onTaskDetail} onNavigate={props.onNavigate} onUpload={props.onUpload} onOpenContext={props.onOpenContext} onOpenFile={props.onOpenFile} onStartAgent={props.onStartAgent} onCalendarSelection={props.onCalendarSelection} selectedObjectId={props.selectedObjectId} onObject={props.onObject} />;
  if (props.view === "workspace") return <EduPiWorkspaceBoard data={props.data} query={props.query} onTaskDetail={props.onTaskDetail} onCreateTask={props.onCreateTask} onMoveTask={props.onMoveTask} selectedObjectId={props.selectedObjectId} onObject={props.onObject} mergeSuggestions={<EduPiPlanMergeSuggestions calendar={props.data.calendar} />} />;
  if (props.view === "teaching") return <EduPiTeachingWorkspace data={props.data} context={props.context} query={props.query} selectedObjectId={props.selectedObjectId} onObject={props.onObject} onTask={(task) => props.onTask(task, "brief")} onNavigate={props.onNavigate} onStartAgent={props.onStartAgent} onCalendarSelection={props.onCalendarSelection} onEducation={props.onEducation} onDeleteEntity={props.onDeleteEntity} />;
  if (props.view === "homeroom" || props.view === "students") return <EduPiStudentWorkspace mode={props.view} data={props.data} context={props.context} query={props.query} selectedStudentId={props.selectedStudentId} onStudent={props.onStudent} onEducation={props.onEducation} onTask={(task) => props.onTask(task, "brief")} onStartAgent={props.onStartAgent} onDeleteEntity={props.onDeleteEntity} />;
  if (props.view === "calendar") return <CalendarView data={props.data} query={props.query} onUpload={props.onUpload} intakeBusy={props.intakeBusy} calendarSelection={props.calendarSelection} onCalendarSelection={props.onCalendarSelection} onTaskDetail={props.onTaskDetail} onImportCalendar={props.onImportCalendar} onImportTimetable={props.onImportTimetable} onDeleteEntity={props.onDeleteEntity} selectedObjectId={props.selectedObjectId} onObject={props.onObject} />;
  if (props.view === "memory") return <EduPiMemoryDatabase data={props.data} memoryScopes={props.memoryScopes} query={props.query} selectedObjectId={props.selectedObjectId} onEducation={props.onEducation} onStartAgent={props.onStartAgent} onDeleteEntity={props.onDeleteEntity} />;
  if (props.view === "insights" && props.selectedObjectId?.startsWith("insights:student_records")) return <main className="edupi-module-workspace"><header className="edupi-module-heading" style={{ minHeight: 0 }}><div><h1>学生学习与互动</h1></div></header><EduPiStudentEvents student={null} query={props.query} onAgent={props.onStartAgent} /></main>;
  if (props.view === "insights") return <EduPiInsightDatabase data={props.data} query={props.query} selectedObjectId={props.selectedObjectId} onReviewTarget={props.onReviewTarget} onEducation={props.onEducation} reviewer={props.context?.name || "teacher"} />;
  if (props.view === "growth") return <EduPiGrowthWorkspace onStartAgent={props.onStartAgent} data={props.data} teachingSkills={props.teachingSkills} query={props.query} selectedObjectId={props.selectedObjectId} onOpenFile={props.onOpenFile} onTask={(task) => props.onTask(task, "artifact")} onTeachingSkills={props.onTeachingSkills} />;
  if (props.view === "materials") return <EduPiMaterialsWorkspace data={props.data} context={props.context} query={props.query} selectedObjectId={props.selectedObjectId} onObject={props.onObject} stagedMaterials={props.stagedMaterials} stagingBusy={props.stagingBusy} stagingMessage={props.stagingMessage} onTask={(task) => props.onTask(task, "evidence")} onUpload={props.onUpload} onIntakeMaterial={props.onIntakeMaterial} onRemoveStagedMaterial={props.onRemoveStagedMaterial} onOpenFile={props.onOpenFile} onStartAgent={props.onStartAgent} onEducation={props.onEducation} onDeleteEntity={props.onDeleteEntity} />;
  return <ArtifactsView data={props.data} query={props.query} onTask={props.onTask} />;
}
