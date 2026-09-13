"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type ReactElement, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { EducationContract, EducationEntityDeleteKind, TaskReviewAction, TeacherTask } from "@/lib/edupi-education-contract";
import { calendarSelectionFromLink, type CalendarItemSelection } from "@/lib/edupi-calendar-model";
import type { EducationModule } from "@/lib/edupi-education-ui";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import {
  isTaskStage,
  isTaskActionable,
  isUserFacingMemory,
  isWorkbenchView,
  moduleFromView,
  taskKey,
  taskSourceLabel,
  viewFromModule,
  type TaskStage,
  type WorkbenchView,
} from "@/lib/edupi-workbench";
import { EduPiContextEditor } from "./EduPiContextEditor";
import { EduPiPersistentChatHost } from "./EduPiPersistentChatHost";
import { EduPiInspector } from "./EduPiInspector";
import { EduPiNavigationRail } from "./EduPiNavigationRail";
import { EduPiObjectSider } from "./EduPiObjectSider";
import { EduPiTaskDetailDrawer } from "./EduPiTaskDetailDrawer";
import { EduPiTaskWorkspace } from "./EduPiTaskWorkspace";
import { EduPiDeleteConfirmation } from "./EduPiDeleteConfirmation";
import type { ReviewPayload } from "./EduPiTaskStage";
import { submitTodayWorkReview, TodayWorkReviewError } from "@/lib/edupi-today-work";
import { EduPiWorkspaceDrawer } from "./EduPiWorkspaceDrawer";
import { EduPiWorkspaceViews } from "./EduPiWorkspaceViews";
import { EduPiC1Review } from "./EduPiC1Review";
import { EduPiReviewBoard } from "./EduPiReviewBoard";
import { EduPiQuickEntry } from "./EduPiQuickEntry";
import { useDesktopChrome, WindowControls } from "./desktop";
import { useEduPiContentSiderCollapse } from "@/hooks/useEduPiContentSiderCollapse";
import { useDragDrop } from "@/hooks/useDragDrop";
import { createActivationRequestTracker } from "@/lib/edupi-activation-request";
import { shouldShowBlockingEducationLoad } from "@/lib/edupi-workspace-load-state";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { listDesktopStagedMaterials, removeDesktopStagedMaterial, selectFilesNative, stageDesktopMaterialFiles, stageDesktopMaterialPaths } from "@/lib/desktop-native";
import { loadStagedMaterials, removeStagedMaterial, stageBrowserMaterialFiles, type MaterialStagingDescriptor } from "@/lib/edupi-material-staging-client";
import type { TaskBoardLaneId } from "@/lib/edupi-task-board";
import { calendarQuickEntryKey, calendarQuickEntryStatusLabel, type EduPiQuickEntryItem } from "@/lib/edupi-quick-entry";
import { isTaskReviewable, workCaseForTask } from "@/lib/edupi-work-case";
import { studentRecordKey } from "@/lib/edupi-student-roster-model";
import { objectItemForView, viewKeepsObjectItem } from "@/lib/edupi-domain-navigation";
import { APP_PREF_KEYS } from "@/lib/app-prefs";
import { appendTeacherInputSlot } from "@/lib/edupi-teacher-input-slot";
import { readEduPiWorkspace } from "@/lib/edupi-education-client";
import { EduPiPreparationArtifactEditor } from "./EduPiPreparationArtifactEditor";
import { deleteEducationEntity } from "@/lib/edupi-entity-delete-client";
import type { EducationMemoryScopeProjection } from "@/lib/edupi-memory-scopes";
import { readEduPiTeachingSkills, type EduPiTeachingSkillLifecycle } from "@/lib/edupi-platform-client";
import type { MaterialIntakeMetadata } from "@/lib/edupi-material-rows";
import { normalizeKernelState, readEduPiKernel, type EduPiKernelState } from "@/lib/edupi-kernel-client";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import type { CreateTeacherTaskInput, CreateTeacherTaskOutcome } from "@/lib/edupi-task-board-command";
import { refreshUntilTaskVisible } from "@/lib/edupi-task-refresh";

type Props = {
  initialModule?: EducationModule;
  refreshKey?: number;
  activeAgentSessionId: string | null;
  onActivateAgentSession: (input: { taskId: string; sessionId: string | null; cwd: string; view: "tasks" | "review"; stage: TaskStage; signal: AbortSignal }) => Promise<"existing" | "new">;
  chatPanel: ReactNode;
  chatSidebar: ReactNode;
  renderFilePreview: (path: string) => ReactNode;
  onOpenAdmin: () => void;
  onOpenGuide: () => void;
  onPrepareAgentPrompt: (prompt: string) => void;
  onReplaceAgentPrompt: (prompt: string) => void;
  quickEntryOpen: boolean;
  onCloseQuickEntry: () => void;
  onFocusAgentChat: () => void;
};

type FileWorkspaceDrawerProps = {
  kind: "file";
  fileTitle?: string;
  task: TeacherTask | undefined;
  filePath: string | null;
  filePanel: ReactNode;
  onClose: () => void;
  onPreparePrompt: (prompt: string) => void;
};

const FileWorkspaceDrawer = EduPiWorkspaceDrawer as unknown as (props: FileWorkspaceDrawerProps) => ReactElement | null;

type AgentPromptMode = "insert" | "replace";

type EducationIntakeApiResult = {
  error?: string;
  staged?: MaterialStagingDescriptor[];
  recognition?: { eventCount?: number; slotCount?: number };
};

type BoardPreparationStatus = { taskId?: string | null; state?: "idle" | "running" | "ready" | "error"; error?: string | null };

const reviewLabels: Record<TaskReviewAction, string> = {
  accept: "已接受",
  modify: "已修改并接受",
  reject: "已拒绝",
  hold: "已暂缓",
  rollback: "已回滚",
};
const STATUS_MESSAGE_MS = 4_000;
const ERROR_MESSAGE_MS = 8_000;

function hasDroppedFiles(event: ReactDragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function EduPiEducationPanel({ initialModule = "home", refreshKey, activeAgentSessionId, onActivateAgentSession, chatPanel, chatSidebar, renderFilePreview, onOpenAdmin, onOpenGuide, onPrepareAgentPrompt, onReplaceAgentPrompt, quickEntryOpen, onCloseQuickEntry, onFocusAgentChat }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const desktopChrome = useDesktopChrome();
  const requestedView = searchParams.get("view");
  const requestedStage = searchParams.get("stage");
  const [activeView, setActiveView] = useState<WorkbenchView>(() => isWorkbenchView(requestedView) ? requestedView : viewFromModule(initialModule));
  const [activeStage, setActiveStage] = useState<TaskStage>(() => isTaskStage(requestedStage) ? requestedStage : "brief");
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(() => searchParams.get("task"));
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(() => searchParams.get("student"));
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(() => searchParams.get("item"));
  const [reviewMode, setReviewMode] = useState<"board" | "task" | "c1">(() => searchParams.get("task") && requestedStage === "review" ? "task" : "board");
  const [selectedC1Target, setSelectedC1Target] = useState<{ kind: "observation" | "memory_candidate"; id: string } | null>(null);
  const [education, setEducation] = useState<EducationContract | null>(null);
  const [context, setContext] = useState<TeacherContextSnapshot | null>(null);
  const [memoryScopes, setMemoryScopes] = useState<EducationMemoryScopeProjection | null>(null);
  const [teachingSkills, setTeachingSkills] = useState<EduPiTeachingSkillLifecycle>({ status: "unavailable", generatedAt: null, mutationEnabled: false, skills: [] });
  const [runningSessionCount, setRunningSessionCount] = useState(0);
  const [runningKernelCount, setRunningKernelCount] = useState(0);
  const [kernelState, setKernelState] = useState<EduPiKernelState>({ status: "unavailable", updatedAt: null, running: 0, runs: [] });
  const runningAgentCount = runningSessionCount + runningKernelCount;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(() => searchParams.get("inspector") === "1");
  const [contextOpen, setContextOpen] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const [drawer, setDrawer] = useState<"agent" | "file" | null>(null);
  const [pendingAgentPrompt, setPendingAgentPrompt] = useState<string | null>(null);
  const [pendingAgentPromptMode, setPendingAgentPromptMode] = useState<AgentPromptMode>("insert");
  const [pendingTaskBinding, setPendingTaskBinding] = useState<{ taskId: string; previousSessionId: string | null } | null>(null);
  const [taskSessionBusy, setTaskSessionBusy] = useState(false);
  const [taskSessionError, setTaskSessionError] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState<TaskReviewAction | null>(null);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [stagedMaterials, setStagedMaterials] = useState<MaterialStagingDescriptor[]>([]);
  const [materialStagingBusy, setMaterialStagingBusy] = useState(false);
  const [educationIntakeBusy, setEducationIntakeBusy] = useState(false);
  const [materialStagingMessage, setMaterialStagingMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [calendarSelection, setCalendarSelection] = useState<CalendarItemSelection | null>(null);
  const appliedCalendarLink = useRef<string | null>(null);
  const [taskDetailTask, setTaskDetailTask] = useState<TeacherTask | null>(null);
  const [agentTask, setAgentTask] = useState<TeacherTask | null>(null);
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null);
  const [deleteLabel,setDeleteLabel]=useState<string|null>(null);
  const deleteResolver=useRef<((confirmed:boolean)=>void)|null>(null);
  const resolveDeleteConfirmation=(confirmed:boolean)=>{
    const resolve=deleteResolver.current;
    deleteResolver.current=null;
    setDeleteLabel(null);
    resolve?.(confirmed);
  };
  useEffect(()=>()=>{deleteResolver.current?.(false);deleteResolver.current=null;},[]);
  const taskSessionOpeningRef = useRef(false);
  const contextModalRef = useModalDismiss<HTMLDivElement>(() => { if (!contextBusy) setContextOpen(false); }, contextOpen);
  const materialUploadInputRef = useRef<HTMLInputElement>(null);
  const activationRequestsRef = useRef(createActivationRequestTracker());
  const preparationPollsRef = useRef(new Map<string, AbortController>());
  const taskRefreshesRef = useRef(new Map<string, AbortController>());
  const objectSider = useEduPiContentSiderCollapse(false);
  const navigationRail = useEduPiContentSiderCollapse(false, APP_PREF_KEYS.edupiNavigationRailCollapsed);

  const cancelActivation = useCallback(() => {
    activationRequestsRef.current.cancel();
    taskSessionOpeningRef.current = false;
    setTaskSessionBusy(false);
  }, []);

  const loadWorkspace = useCallback(async (signal?: AbortSignal) => {
    const [workspace, scopeResponse, nextTeachingSkills, nextKernelState] = await Promise.all([
      readEduPiWorkspace({ signal }),
      fetch("/api/edupi/memory-scopes", { cache: "no-store", signal })
        .then(async (response) => response.ok ? await response.json() as { projection?: EducationMemoryScopeProjection } : null)
        .catch(() => null),
      readEduPiTeachingSkills(signal),
      readEduPiKernel(signal),
    ]);
    const { context: nextContext, data: nextEducation } = workspace;
    setContext(nextContext);
    setEducation(nextEducation);
    setMemoryScopes(scopeResponse?.projection?.projection_kind === "scoped_education_memory" ? scopeResponse.projection : null);
    setTeachingSkills(nextTeachingSkills);
    setKernelState(nextKernelState);
    setRunningKernelCount(nextKernelState.running);
    return nextEducation;
  }, []);

  const stopTaskTracking = useCallback((taskId: string) => {
    preparationPollsRef.current.get(taskId)?.abort();
    preparationPollsRef.current.delete(taskId);
    taskRefreshesRef.current.get(taskId)?.abort();
    taskRefreshesRef.current.delete(taskId);
  }, []);

  const pollBoardPreparation = useCallback((taskId: string) => {
    if (preparationPollsRef.current.has(taskId)) return;
    const controller = new AbortController();
    preparationPollsRef.current.set(taskId, controller);
    const poll = async () => {
      try {
        while (!controller.signal.aborted) {
          try {
            const response = await fetch(`/api/edupi/preparation?taskId=${encodeURIComponent(taskId)}`, { cache: "no-store", signal: controller.signal });
            if (response.ok) {
              const next = await response.json() as BoardPreparationStatus;
              if (next.taskId === taskId && (next.state === "ready" || next.state === "error")) {
                await loadWorkspace(controller.signal).catch(() => {});
                if (!controller.signal.aborted) window.dispatchEvent(new Event("edupi-preparation-updated"));
                return;
              }
              if (next.taskId === taskId && next.state === "idle") {
                const refreshed = await loadWorkspace(controller.signal).catch(() => null);
                if (refreshed && !refreshed.tasks.some((task) => task.id === taskId)) return;
              }
            }
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        }
      } finally {
        if (preparationPollsRef.current.get(taskId) === controller) preparationPollsRef.current.delete(taskId);
      }
    };
    void poll();
  }, [loadWorkspace]);

  const refreshCommittedTask = useCallback((taskId: string) => {
    if (taskRefreshesRef.current.has(taskId)) return;
    const controller = new AbortController();
    taskRefreshesRef.current.set(taskId, controller);
    void refreshUntilTaskVisible({ taskId, signal: controller.signal, read: loadWorkspace })
      .finally(() => {
        if (taskRefreshesRef.current.get(taskId) === controller) taskRefreshesRef.current.delete(taskId);
      });
  }, [loadWorkspace]);

  useEffect(() => () => {
    for (const controller of preparationPollsRef.current.values()) controller.abort();
    preparationPollsRef.current.clear();
    for (const controller of taskRefreshesRef.current.values()) controller.abort();
    taskRefreshesRef.current.clear();
  }, []);

  const retryLoadWorkspace = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    void loadWorkspace()
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setLoading(false));
  }, [loadWorkspace]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    void loadWorkspace(controller.signal).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLoadError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [loadWorkspace, refreshKey]);

  useEffect(() => { if (initialModule === "context") setContextOpen(true); }, [initialModule]);

  useEffect(() => {
    const refresh = () => { void loadWorkspace().catch(() => {}); };
    window.addEventListener("edupi-preparation-updated", refresh);
    window.addEventListener("edupi-artifacts-updated", refresh);
    window.addEventListener("edupi-education-refresh", refresh);
    return () => { window.removeEventListener("edupi-preparation-updated", refresh); window.removeEventListener("edupi-artifacts-updated", refresh); window.removeEventListener("edupi-education-refresh", refresh); };
  }, [loadWorkspace]);

  useEffect(() => {
    if (!materialStagingMessage || materialStagingMessage.text.endsWith("…")) return;
    const timer = window.setTimeout(() => setMaterialStagingMessage(null), materialStagingMessage.tone === "error" ? ERROR_MESSAGE_MS : STATUS_MESSAGE_MS);
    return () => window.clearTimeout(timer);
  }, [materialStagingMessage]);

  const submitEducationIntake = useCallback(async (body: Record<string, unknown>): Promise<EducationIntakeApiResult> => {
    if (educationIntakeBusy) throw new Error("材料正在接入 EduPi。");
    setEducationIntakeBusy(true);
    setMaterialStagingMessage(null);
    try {
      const response = await fetch("/api/edupi/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as EducationIntakeApiResult;
      if (!response.ok) throw new Error(result.error || `接入失败（HTTP ${response.status}）`);
      if (Array.isArray(result.staged)) setStagedMaterials(result.staged);
      await loadWorkspace();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "教育数据接入失败。";
      setMaterialStagingMessage({ tone: "error", text: message });
      throw error;
    } finally {
      setEducationIntakeBusy(false);
    }
  }, [educationIntakeBusy, loadWorkspace]);

  const intakeStagedMaterial = useCallback(async (item: MaterialStagingDescriptor, metadata: MaterialIntakeMetadata) => {
    const result = await submitEducationIntake({
      kind: "material",
      stagingId: item.staging_id,
      title: metadata.title,
      materialKind: metadata.materialKind,
      subject: metadata.subject,
      classId: metadata.classId,
      recognize: true,
    });
    const eventCount = result.recognition?.eventCount || 0;
    const slotCount = result.recognition?.slotCount || 0;
    const recognized = eventCount + slotCount > 0 ? `，识别到 ${eventCount} 条日程、${slotCount} 条课表` : "，未发现日程或课表";
    setMaterialStagingMessage({ tone: "success", text: `${item.original_name} 已接入 EduPi${recognized}。` });
    return result;
  }, [submitEducationIntake]);

  const importCalendarEvent = useCallback(async (event: { eventId: string | null; date: string; endDate: string | null; name: string; type: string; notes: string | null }) => {
    await submitEducationIntake({ kind: "calendar", events: [{ ...event, confidence: "teacher_confirmed" }] });
    setMaterialStagingMessage({ tone: "success", text: event.eventId ? "日程更改已保存。" : "日程已写入 EduPi 行事历。" });
  }, [submitEducationIntake]);

  const importTimetableSlot = useCallback(async (slot: { slotId: string | null; dayOfWeek: number; period: number; subject: string; className: string | null; kind: "class" | "routine"; notes: string | null }) => {
    await submitEducationIntake({ kind: "timetable", slots: [slot] });
    setMaterialStagingMessage({ tone: "success", text: slot.slotId ? "课程更改已保存。" : "课程安排已写入 EduPi 周视图。" });
  }, [submitEducationIntake]);

  useEffect(() => {
    const events = new EventSource("/api/agent/running/events");
    events.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { runningSessionIds?: unknown };
        const runningIds = Array.isArray(payload.runningSessionIds)
          ? payload.runningSessionIds.filter((id): id is string => typeof id === "string")
          : [];
        const running = new Set(runningIds);
        setRunningSessionCount(runningIds.length);
        setEducation((current) => current ? {
          ...current,
          taskSessions: Object.fromEntries(Object.entries(current.taskSessions).map(([taskId, binding]) => [
            taskId,
            { ...binding, status: binding.status === "missing" ? "missing" : running.has(binding.sessionId) ? "running" : "idle" },
          ])),
        } : current);
      } catch {
        // Ignore malformed frames; EventSource will continue with the next snapshot.
      }
    };
    return () => events.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch("/api/edupi/kernel", { cache: "no-store", signal: controller.signal });
          const next = response.ok ? normalizeKernelState(await response.json()) : { status: "unavailable" as const, updatedAt: null, running: 0, runs: [] };
          if (!controller.signal.aborted) { setKernelState(next); setRunningKernelCount(next.running); }
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError") && !controller.signal.aborted) setRunningKernelCount(0);
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 20_000);
    };
    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (isWorkbenchView(requestedView)) setActiveView(requestedView);
    else setActiveView(viewFromModule(initialModule));
  }, [initialModule, requestedView]);

  useEffect(() => {
    if (initialModule === "context") setContextOpen(true);
  }, [initialModule]);

  useEffect(() => {
    if (isTaskStage(requestedStage)) setActiveStage(requestedStage);
  }, [requestedStage]);

  useEffect(() => {
    const requestedTask = searchParams.get("task");
    if (requestedTask) setSelectedTaskKey(requestedTask);
  }, [searchParams]);

  useEffect(() => {
    const id = searchParams.get("calendarItem");
    const kind = searchParams.get("calendarKind");
    const date = searchParams.get("date");
    if (!id) { appliedCalendarLink.current = null; return; }
    const key = JSON.stringify([kind, id, date]);
    if (appliedCalendarLink.current === key || !education) return;
    const selection = calendarSelectionFromLink(education, { kind, id, date });
    if (selection) { setCalendarSelection(selection); appliedCalendarLink.current = key; }
  }, [searchParams, education]);

  useEffect(() => {
    const requested = searchParams.get("inspector");
    setInspectorOpen(requested === "1");
  }, [searchParams]);

  useEffect(() => {
    const close = () => {
      cancelActivation();
      setDrawer(null);
      setTaskDetailTask(null);
      setAgentTask(null);
      if (!contextBusy) setContextOpen(false);
      setPendingTaskBinding(null);
    };
    window.addEventListener("edupi-close-panel", close);
    return () => window.removeEventListener("edupi-close-panel", close);
  }, [cancelActivation, contextBusy]);

  useEffect(() => () => cancelActivation(), [cancelActivation]);

  const tasks = useMemo(() => education?.tasks ?? [], [education]);
  const activeTask = useMemo(() => {
    const requested = selectedTaskKey ? tasks.find((task) => taskKey(task) === selectedTaskKey) : undefined;
    if (activeView === "review") {
      const reviewable = (task: TeacherTask) => isTaskActionable(task) && isTaskReviewable(task, education ? workCaseForTask(education, task.id) : null);
      return requested ?? tasks.find(reviewable);
    }
    return requested ?? tasks.find((task) => task.boardStage !== "done" && task.status === "planned") ?? tasks[0];
  }, [activeView, education, selectedTaskKey, tasks]);
  const activeWorkReview = Boolean(education?.workCandidates.some(item => item.taskId === activeTask?.id));
  const pendingCount = tasks.filter((task) => isTaskActionable(task) && isTaskReviewable(task, education ? workCaseForTask(education, task.id) : null)).length;
  const c1PendingCount = (education?.observations ?? []).filter((item) => item.teacherReview.state === "pending_review" || item.teacherReview.state === "held").length
    + (education?.memoryCandidates ?? []).filter((item) => item.teacherReview.state === "pending_review" || item.teacherReview.state === "held").length;
  const teacherContextPendingCount = (education?.teacherContextCandidates ?? []).filter((item) => item.status === "pending_review" || item.status === "held" || item.teacherReview.state === "pending_review" || item.teacherReview.state === "held").length;
  const teacherContextLabel = [context?.name, context?.subject, context?.grade].filter(Boolean).join(" · ") || "教师工作区";

  useEffect(() => {
    if (activeView === "review" && reviewMode === "c1" && c1PendingCount === 0) setReviewMode("board");
  }, [activeView, c1PendingCount, pendingCount, reviewMode]);

  const updateLocation = useCallback((view: WorkbenchView, task: TeacherTask | undefined, stage: TaskStage | undefined, nextInspector = inspectorOpen, nextStudentId = selectedStudentId, nextObjectId = selectedObjectId) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("edupi", "1");
    params.set("module", moduleFromView(view));
    params.set("view", view);
    if (task) params.set("task", taskKey(task)); else params.delete("task");
    if (stage) params.set("stage", stage); else params.delete("stage");
    if ((view === "homeroom" || view === "students") && nextStudentId) params.set("student", nextStudentId); else params.delete("student");
    if (viewKeepsObjectItem(view) && nextObjectId) params.set("item", nextObjectId); else params.delete("item");
    params.set("inspector", nextInspector ? "1" : "0");
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [inspectorOpen, router, searchParams, selectedObjectId, selectedStudentId]);

  const selectView = useCallback((view: WorkbenchView, requestedObjectId?: string) => {
    const stage = view === "tasks" ? activeStage : undefined;
    const nextObjectId = objectItemForView(view, requestedObjectId ?? selectedObjectId);
    cancelActivation();
    setDrawer(null);
    setTaskDetailTask(null);
    setAgentTask(null);
    setQuery("");
    setPendingTaskBinding(null);
    if (view !== "calendar") setCalendarSelection(null);
    if (view === "review") setReviewMode("board");
    setActiveView(view);
    setSelectedObjectId(nextObjectId);
    if (stage) setActiveStage(stage);
    updateLocation(view, view === "tasks" ? activeTask : undefined, stage, inspectorOpen, selectedStudentId, nextObjectId);
  }, [activeStage, activeTask, cancelActivation, inspectorOpen, selectedObjectId, selectedStudentId, updateLocation]);

  const selectTask = useCallback((task: TeacherTask, stage: TaskStage = "brief") => {
    const view = stage === "review" && activeView === "review" ? "review" : "tasks";
    cancelActivation();
    setSelectedTaskKey(taskKey(task));
    setActiveView(view);
    setActiveStage(stage);
    setReviewMessage(null);
    setDrawer(null);
    setTaskDetailTask(null);
    setAgentTask(null);
    setPendingTaskBinding(null);
    if (view === "review") setReviewMode("task");
    updateLocation(view, task, stage);
  }, [activeView, cancelActivation, updateLocation]);

  const selectStage = useCallback((stage: TaskStage) => {
    cancelActivation();
    setActiveStage(stage);
    updateLocation(activeView === "review" ? "review" : "tasks", activeTask, stage);
  }, [activeTask, activeView, cancelActivation, updateLocation]);

  const toggleInspector = useCallback(() => {
    const next = !inspectorOpen;
    setInspectorOpen(next);
    updateLocation(activeView, activeTask, activeView === "tasks" || activeView === "review" ? activeStage : undefined, next);
  }, [activeStage, activeTask, activeView, inspectorOpen, updateLocation]);

  const focusC1Review = useCallback((target: { kind: "observation" | "memory_candidate"; id: string }) => {
    if (activeView !== "review") selectView("review");
    setReviewMode("c1");
    setSelectedC1Target(target);
    requestAnimationFrame(() => {
      document.getElementById(`edupi-c1-review-${target.kind}-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [activeView, selectView]);

  const selectStudent = useCallback((student: Record<string, unknown> | null) => {
    if (!student) {
      setSelectedStudentId(null);
      updateLocation(activeView, undefined, undefined, inspectorOpen, null);
      return;
    }
    const index = education?.students.indexOf(student) ?? -1;
    const id = studentRecordKey(student, Math.max(0, index));
    setSelectedStudentId(id);
    updateLocation(activeView, undefined, undefined, inspectorOpen, id);
    if (window.matchMedia("(max-width: 820px)").matches && !objectSider.collapsed) objectSider.toggle();
  }, [activeView, education?.students, inspectorOpen, objectSider, updateLocation]);

  const selectObject = useCallback((id: string) => {
    if (id === "review:board") setReviewMode("board");
    setSelectedObjectId(id);
    updateLocation(activeView, undefined, undefined, inspectorOpen, selectedStudentId, id);
    if (window.matchMedia("(max-width: 820px)").matches && !objectSider.collapsed) objectSider.toggle();
  }, [activeView, inspectorOpen, objectSider, selectedStudentId, updateLocation]);

  const reviewTask = useCallback(async (action: TaskReviewAction, payload: ReviewPayload) => {
    if (!activeTask?.id || !education) return;
    const candidate = education.workCandidates.find(item => item.taskId === activeTask.id);
    if (!(candidate ? education.capabilities.workCandidateReview.enabled : education.capabilities.taskReview.enabled)) return;
    setReviewBusy(action);
    setReviewMessage(null);
    try {
      if (candidate) {
        if (action === "rollback") throw new Error("请使用修改决定调整审核结果");
        const result = await submitTodayWorkReview({ candidate, decision: action, ...(action === "modify" ? {patch:{title:payload.title,dueAt:payload.dueDate ?? null}} : {}), note:payload.note });
        setEducation(result.data);
        setReviewMessage(reviewLabels[action]);
        return;
      }
      const response = await fetch(`/api/edupi/tasks/${encodeURIComponent(activeTask.id)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: action,
          expectedRevision: activeTask.revision,
          patch: action === "modify" ? {
            title: payload.title,
            dueDate: payload.dueDate ?? null,
            deliverables: payload.deliverables,
          } : null,
          note: payload.note ?? null,
        }),
      });
      const result = await response.json() as { error?: string; data?: EducationContract };
      if (!response.ok || !result.data) throw new Error(result.error || `审核失败（HTTP ${response.status}）`);
      setEducation(result.data);
      const nextTask = result.data.tasks.find((task) => task.id === activeTask.id);
      if (nextTask) setSelectedTaskKey(taskKey(nextTask));
      setReviewMessage(reviewLabels[action]);
    } catch (error) {
      if (error instanceof TodayWorkReviewError && error.data) setEducation(error.data);
      setReviewMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setReviewBusy(null);
    }
  }, [activeTask, education]);

  const rememberStaged = useCallback((items: MaterialStagingDescriptor[]) => {
    setStagedMaterials((current) => {
      const byId = new Map(current.map((item) => [item.staging_id, item]));
      for (const item of items) byId.set(item.staging_id, item);
      return [...byId.values()].sort((left, right) => left.staging_id.localeCompare(right.staging_id));
    });
  }, []);

  const showStagedMaterials = useCallback((items: MaterialStagingDescriptor[]) => {
    rememberStaged(items);
    selectView("materials");
    setMaterialStagingMessage({ tone: "success", text: `${items.length} 份材料已暂存，请确认类型、学科和班级。` });
  }, [rememberStaged, selectView]);

  const stageBrowserFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    if (materialStagingBusy || educationIntakeBusy) {
      setMaterialStagingMessage({ tone: "error", text: "上一批材料正在处理，请稍候。" });
      return;
    }
    setMaterialStagingBusy(true);
    setMaterialStagingMessage(null);
    try {
      const staged = isTauriDesktop()
        ? await stageDesktopMaterialFiles(files)
        : await stageBrowserMaterialFiles(files);
      showStagedMaterials(staged);
    } catch (error) {
      setMaterialStagingMessage({ tone: "error", text: error instanceof Error ? error.message : "材料暂存失败。" });
    } finally {
      setMaterialStagingBusy(false);
    }
  }, [educationIntakeBusy, materialStagingBusy, showStagedMaterials]);

  const { isDragOver: educationFileDragOver, handleDragEnter: handleEducationFileDragEnter, handleDragOver: handleEducationFileDragOver, handleDragLeave: handleEducationFileDragLeave, handleDrop: handleEducationFileDrop } = useDragDrop((files) => { void stageBrowserFiles(files); });
  const onEducationDragEnterCapture = useCallback((event: ReactDragEvent) => {
    if (!hasDroppedFiles(event)) return;
    event.stopPropagation();
    handleEducationFileDragEnter(event);
  }, [handleEducationFileDragEnter]);
  const onEducationDragOverCapture = useCallback((event: ReactDragEvent) => {
    if (!hasDroppedFiles(event)) return;
    event.stopPropagation();
    handleEducationFileDragOver(event);
  }, [handleEducationFileDragOver]);
  const onEducationDragLeaveCapture = useCallback((event: ReactDragEvent) => {
    if (!hasDroppedFiles(event)) return;
    event.stopPropagation();
    handleEducationFileDragLeave();
  }, [handleEducationFileDragLeave]);
  const onEducationDropCapture = useCallback((event: ReactDragEvent) => {
    if (!hasDroppedFiles(event)) return;
    event.stopPropagation();
    handleEducationFileDrop(event);
  }, [handleEducationFileDrop]);

  const openUpload = useCallback(() => {
    if (materialStagingBusy || educationIntakeBusy) return;
    if (!isTauriDesktop()) {
      materialUploadInputRef.current?.click();
      return;
    }
    setMaterialStagingBusy(true);
    setMaterialStagingMessage(null);
    void selectFilesNative({
      multiple: true,
      title: "选择教学材料",
      filters: [{ name: "教学材料", extensions: ["jpg", "jpeg", "png", "webp", "pdf", "doc", "docx"] }],
    }).then(async (paths) => {
      if (paths.length === 0) return;
      const staged = await stageDesktopMaterialPaths(paths);
      showStagedMaterials(staged);
    }).catch((error) => {
      setMaterialStagingMessage({ tone: "error", text: error instanceof Error ? error.message : "材料暂存失败。" });
    }).finally(() => setMaterialStagingBusy(false));
  }, [educationIntakeBusy, materialStagingBusy, showStagedMaterials]);

  const removeStagedMaterialEntry = useCallback(async (item: MaterialStagingDescriptor) => {
    if (materialStagingBusy || educationIntakeBusy) {
      setMaterialStagingMessage({ tone: "error", text: "上一批材料正在处理，请稍候。" });
      return;
    }
    setMaterialStagingBusy(true);
    setMaterialStagingMessage(null);
    try {
      const next = isTauriDesktop()
        ? await removeDesktopStagedMaterial(item.staging_id)
        : await removeStagedMaterial(item.staging_id);
      setStagedMaterials(next);
      setMaterialStagingMessage({ tone: "success", text: `${item.original_name} 已从待接入列表移除。` });
    } catch (error) {
      setMaterialStagingMessage({ tone: "error", text: error instanceof Error ? error.message : "移除暂存材料失败。" });
    } finally {
      setMaterialStagingBusy(false);
    }
  }, [educationIntakeBusy, materialStagingBusy]);

  useEffect(() => {
    let active = true;
    const request = isTauriDesktop() ? listDesktopStagedMaterials() : loadStagedMaterials();
    void request.then((items) => { if (active) setStagedMaterials(items); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const openFile = useCallback((path: string) => {
    setPreviewPath(path);
    setDrawer("file");
  }, []);

  const reminderDocumentId = searchParams.get("document");
  useEffect(() => {
    if (!reminderDocumentId || !education) return;
    const document = education.continuity.documents.find(item => item.id === reminderDocumentId);
    if (!document) return;
    openFile(`${education.workspace.replace(/[\\/]$/, "")}/${document.path}`);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("document");
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [reminderDocumentId, education, openFile, searchParams, router]);

  const openTaskDetail = useCallback((task: TeacherTask) => {
    cancelActivation();
    setDrawer(null);
    setAgentTask(null);
    setPendingTaskBinding(null);
    setCalendarSelection(null);
    setTaskDetailTask(task);
  }, [cancelActivation]);

  const selectQuickEntry = useCallback((item: EduPiQuickEntryItem) => {
    onCloseQuickEntry();
    if (item.kind === "chat") {
      selectView("chat");
      requestAnimationFrame(onFocusAgentChat);
      return;
    }
    if (item.kind === "task" || item.kind === "artifact") {
      const task = tasks.find((value) => taskKey(value) === item.targetKey);
      if (task) selectTask(task, item.kind === "artifact" ? "artifact" : "brief");
      return;
    }
    const index = education?.calendar.findIndex((event, eventIndex) => calendarQuickEntryKey(event, eventIndex) === item.targetKey) ?? -1;
    const event = index >= 0 ? education?.calendar[index] : null;
    if (!event) return;
    selectView("calendar");
    setCalendarSelection({
      kind: "calendar",
      sourceId: event.id,
      date: event.date,
      title: event.name,
      detail: event.notes,
      sourceLabel: event.source === "teacher" ? "教师" : event.source === "official_school_calendar" ? "学校校历" : event.type || "校历",
      statusLabel: calendarQuickEntryStatusLabel(event),
    });
  }, [education?.calendar, onCloseQuickEntry, onFocusAgentChat, selectTask, selectView, tasks]);

  const openTaskFile = useCallback((path: string) => {
    setTaskDetailTask(null);
    openFile(path);
  }, [openFile]);

  const closeTaskDetail = useCallback(() => {
    setTaskDetailTask(null);
  }, []);

  const createBoardTask = useCallback(async (input: CreateTeacherTaskInput): Promise<CreateTeacherTaskOutcome> => {
    const response = await fetch("/api/edupi/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const result = await response.json() as { error?: string; taskId?: string; data?: EducationContract | null; refreshPending?: boolean; preparation?: { state?: string; error?: string; taskId?: string | null } | null };
    if (!response.ok || !result.taskId) throw new Error(result.error || `任务创建失败（HTTP ${response.status}）`);
    if (result.data) setEducation(result.data);
    if (!result.data?.tasks.some((task) => task.id === result.taskId)) refreshCommittedTask(result.taskId);
    if (!input.preparationSource) return { preparationState: null, preparationError: null };
    if (!result.taskId || result.preparation?.taskId !== result.taskId || !["running", "ready"].includes(result.preparation?.state || "")) {
      return { preparationState: "error", preparationError: result.preparation?.error || "请打开任务后重试" };
    }
    if (result.preparation.state === "running") pollBoardPreparation(result.taskId);
    else window.dispatchEvent(new Event("edupi-preparation-updated"));
    return { preparationState: result.preparation.state as "running" | "ready", preparationError: null };
  }, [pollBoardPreparation, refreshCommittedTask]);

  const moveBoardTask = useCallback(async (task: TeacherTask, stage: TaskBoardLaneId) => {
    if (!task.id) throw new Error("任务缺少可写标识。");
    const response = await fetch(`/api/edupi/tasks/${encodeURIComponent(task.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage, expectedRevision: task.boardRevision, note: null }) });
    const result = await response.json() as { error?: string; data?: EducationContract };
    if (!response.ok || !result.data) throw new Error(result.error || `任务移动失败（HTTP ${response.status}）`);
    setEducation(result.data);
  }, []);

  const deleteEntity = useCallback(async (kind: EducationEntityDeleteKind, id: string, label: string): Promise<boolean> => {
    const key = `${kind}:${id}`;
    if (deleteBusy || !education?.capabilities.entityDelete.enabled || !education.capabilities.entityDelete.targetKinds.includes(kind)) return false;
    if (deleteResolver.current) return false;
    const confirmed=await new Promise<boolean>(resolve=>{deleteResolver.current=resolve;setDeleteLabel(label);});
    if (!confirmed) return false;
    setDeleteBusy(key);
    setMaterialStagingMessage({ tone: "success", text: "删除中…" });
    try {
      const result = await deleteEducationEntity(kind, id);
      setEducation(result.data);
      if (kind === "calendar" || kind === "timetable") setCalendarSelection(null);
      if (kind === "student") setSelectedStudentId(null);
      if (kind === "task") { stopTaskTracking(id); setTaskDetailTask(null); setSelectedTaskKey(null); }
      setMaterialStagingMessage({ tone: "success", text: `已删除：${label}` });
      return true;
    } catch (error) {
      setMaterialStagingMessage({ tone: "error", text: error instanceof Error ? error.message : "删除失败" });
      throw error;
    } finally {
      setDeleteBusy(null);
    }
  }, [deleteBusy, education, stopTaskTracking]);

  const closeDrawer = useCallback(() => {
    cancelActivation();
    setDrawer(null);
    setTaskDetailTask(null);
    setAgentTask(null);
    setPendingTaskBinding(null);
  }, [cancelActivation]);

  const activateAgent = useCallback((task: TeacherTask, view: "tasks" | "review", stage: TaskStage) => {
    if (taskSessionOpeningRef.current) return;
    if (!task.id || !education) {
      setAgentTask(task || null);
      setDrawer("agent");
      return;
    }
    const binding = education.taskSessions[task.id];
    const reusableSessionId = binding && binding.status !== "missing" ? binding.sessionId : null;
    const prompt = appendTeacherInputSlot([
      `教学任务：${task.title}`,
      `任务 ID：${task.id}`,
      `来源：${taskSourceLabel(task)}`,
      `截止：${task.dueDate || "日期待确认"}`,
      "要求：仅在教师内部协作，保留来源，不外发；写回事实或产物前等待教师确认。",
    ].join("\n"), "我要让 EduPi 处理的内容（在这里输入或口述）：");
    taskSessionOpeningRef.current = true;
    const request = activationRequestsRef.current.begin();
    setTaskSessionBusy(true);
    setTaskSessionError(null);
    void onActivateAgentSession({ taskId: task.id, sessionId: reusableSessionId, cwd: education.workspace, view, stage, signal: request.signal })
      .then((mode) => {
        if (!activationRequestsRef.current.isCurrent(request)) return;
        setAgentTask(task);
        setPendingTaskBinding(mode === "new" ? { taskId: task.id!, previousSessionId: activeAgentSessionId } : null);
        setPendingAgentPromptMode("replace");
        setPendingAgentPrompt(prompt);
        setDrawer("agent");
      })
      .catch((error) => {
        if (!activationRequestsRef.current.isCurrent(request) || (error instanceof DOMException && error.name === "AbortError")) return;
        setTaskSessionError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!activationRequestsRef.current.isCurrent(request)) return;
        taskSessionOpeningRef.current = false;
        setTaskSessionBusy(false);
      });
  }, [activeAgentSessionId, education, onActivateAgentSession]);

  const openAgentForTask = useCallback((task: TeacherTask) => {
    activateAgent(task, "tasks", "run");
  }, [activateAgent]);

  const openAgent = useCallback(() => {
    const task = activeView === "tasks" || activeView === "review" ? activeTask : undefined;
    if (!task) {
      setAgentTask(null);
      setDrawer("agent");
      return;
    }
    const activation = { view: (activeView === "review" ? "review" : "tasks") as "tasks" | "review", stage: activeStage };
    activateAgent(task, activation.view, activation.stage);
  }, [activeStage, activeTask, activeView, activateAgent]);

  const startAgent = useCallback((prompt: string, mode: AgentPromptMode = "insert") => {
    setAgentTask(null);
    setPendingAgentPromptMode(mode);
    setPendingAgentPrompt(mode === "replace" ? `${prompt.trim()}\n` : [
      prompt.trim(),
      "",
      `教学上下文：${teacherContextLabel}`,
      "边界：仅在教师内部处理，保留来源，不外发；写回事实或产物前等待教师确认。",
    ].join("\n"));
    if (mode === "replace") {
      selectView("chat");
      return;
    }
    setDrawer("agent");
  }, [selectView, teacherContextLabel]);

  useEffect(() => {
    if (!pendingTaskBinding || !activeAgentSessionId || activeAgentSessionId === pendingTaskBinding.previousSessionId) return;
    const controller = new AbortController();
    setTaskSessionBusy(true);
    void fetch(`/api/edupi/tasks/${encodeURIComponent(pendingTaskBinding.taskId)}/session`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: activeAgentSessionId }),
      signal: controller.signal,
    }).then(async (response) => {
      const result = await response.json() as { error?: string; data?: EducationContract };
      if (!response.ok) throw new Error(result.error || `任务会话绑定失败（HTTP ${response.status}）`);
      if (result.data) setEducation(result.data);
      setPendingTaskBinding(null);
    }).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setTaskSessionError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!controller.signal.aborted) setTaskSessionBusy(false);
    });
    return () => controller.abort();
  }, [activeAgentSessionId, pendingTaskBinding]);

  useEffect(() => {
    if (drawer !== "agent" || (activeView !== "tasks" && activeView !== "review") || pendingTaskBinding || !activeTask?.id || !activeAgentSessionId || !education) return;
    const binding = education.taskSessions[activeTask.id];
    if (binding && binding.sessionId !== activeAgentSessionId) {
      setPendingTaskBinding({ taskId: activeTask.id, previousSessionId: binding.sessionId });
    }
  }, [activeAgentSessionId, activeTask, activeView, drawer, education, pendingTaskBinding]);

  useEffect(() => {
    if (!pendingAgentPrompt || (drawer !== "agent" && activeView !== "chat")) return;
    const mode = pendingAgentPromptMode;
    const frame = requestAnimationFrame(() => {
      if (mode === "replace") onReplaceAgentPrompt(pendingAgentPrompt);
      else onPrepareAgentPrompt(pendingAgentPrompt);
      setPendingAgentPrompt(null);
      setPendingAgentPromptMode("insert");
    });
    return () => cancelAnimationFrame(frame);
  }, [activeView, drawer, onPrepareAgentPrompt, onReplaceAgentPrompt, pendingAgentPrompt, pendingAgentPromptMode]);

  if (shouldShowBlockingEducationLoad(education)) {
    return <section className={`edupi-teacher-shell is-loading${desktopChrome.isDesktop ? " has-desktop-drag-region" : ""}`}>{desktopChrome.isDesktop ? <div className="edupi-window-drag-region" {...desktopChrome.dragRegionProps}><WindowControls /></div> : null}<div className="edupi-workbench-loading" role={loadError ? "alert" : "status"}><span>π</span><strong>{loadError || "正在读取教育工作区"}</strong>{loadError ? <div><button type="button" onClick={retryLoadWorkspace}>重试</button><button type="button" onClick={onOpenAdmin}>打开管理中心</button></div> : null}</div></section>;
  }

  const taskStage = activeStage;
  const inspectorAvailable = (activeView === "tasks" || activeView === "review") && Boolean(activeTask);
  const objectSiderAvailable = activeView !== "dashboard" && activeView !== "chat" && activeView !== "workspace";
  const showObjectSider = objectSiderAvailable && !objectSider.collapsed;
  const taskDetail = taskDetailTask ? tasks.find((task) => taskKey(task) === taskKey(taskDetailTask)) || taskDetailTask : null;
  const currentAgentTask = agentTask ? tasks.find((task) => taskKey(task) === taskKey(agentTask)) || agentTask : null;
  return (
    <section
      className={`edupi-teacher-shell${navigationRail.collapsed ? " is-navigation-collapsed" : ""}${desktopChrome.isDesktop ? " has-desktop-drag-region" : ""}`}
      data-view={activeView}
      aria-busy={loading ? true : undefined}
      onDragEnterCapture={onEducationDragEnterCapture}
      onDragOverCapture={onEducationDragOverCapture}
      onDragLeaveCapture={onEducationDragLeaveCapture}
      onDropCapture={onEducationDropCapture}
    >
      {desktopChrome.isDesktop ? <div className="edupi-window-drag-region" {...desktopChrome.dragRegionProps}><WindowControls /></div> : null}
      {educationFileDragOver ? <div className="edupi-global-material-drop" role="status" aria-live="polite"><strong>放入 EduPi</strong><span>松开后识别材料、日程与课表</span></div> : null}
      <EduPiNavigationRail activeView={activeView} pendingReviewCount={pendingCount + c1PendingCount + teacherContextPendingCount} runningAgentCount={runningAgentCount} memoryCount={education.continuity.memories.filter((memory) => memory.state === "active" && isUserFacingMemory(memory)).length} workspaceLabel={context?.school || context?.name || "教师工作区"} collapsed={navigationRail.collapsed} onSelect={selectView} onOpenAdmin={onOpenAdmin} onOpenGuide={onOpenGuide} onCollapse={navigationRail.toggle} />
      <div className="edupi-teacher-app">
        <div className={`edupi-teacher-body${activeView === "chat" ? " is-chat" : ""}${objectSiderAvailable ? " has-object-sider" : ""}${objectSiderAvailable && objectSider.collapsed ? " is-object-sider-collapsed" : ""}${inspectorAvailable && inspectorOpen ? " has-inspector" : ""}`}>
          {(loadError || inspectorAvailable) ? <div className="edupi-teacher-body__controls">{loadError ? <button type="button" onClick={retryLoadWorkspace} title={loadError}>重试</button> : null}{inspectorAvailable ? <button type="button" onClick={toggleInspector}>{inspectorOpen ? "收起检查" : "检查"}</button> : null}</div> : null}
          {activeView === "chat" ? <aside className="edupi-chat-session-sidebar" aria-label="对话与文件">{chatSidebar}</aside> : showObjectSider ? <EduPiObjectSider view={activeView} data={education} context={context} memoryScopes={memoryScopes} teachingSkills={teachingSkills} query={query} onQuery={setQuery} selectedStudentId={selectedStudentId} onStudent={selectStudent} selectedObjectId={selectedObjectId} onObject={selectObject} selectedTaskKey={activeTask ? taskKey(activeTask) : null} onTask={selectTask} onReviewTarget={focusC1Review} selectedCalendarSourceId={calendarSelection?.sourceId ?? null} onCalendarItem={setCalendarSelection} onUpload={openUpload} onCollapse={objectSider.toggle} /> : objectSiderAvailable ? <button type="button" className="edupi-object-sider-strip" onClick={objectSider.toggle} aria-label="展开列表"><span aria-hidden="true">›</span></button> : null}
          <div className={`edupi-teacher-main${activeView === "chat" ? " is-chat" : ""}`}>
            <EduPiPersistentChatHost mode={drawer === "agent" ? "drawer" : activeView === "chat" ? "main" : "hidden"} task={drawer === "agent" ? currentAgentTask : null} onClose={closeDrawer} onPreparePrompt={onPrepareAgentPrompt}>{chatPanel}</EduPiPersistentChatHost>
            {activeView === "review" ? <div className="edupi-review-surface">
            {reviewMode === "board" ? <EduPiReviewBoard data={education} query={query} onTask={(task) => selectTask(task, "review")} onReviewTarget={focusC1Review} /> : null}
            {reviewMode === "task" && activeTask ? <section className="edupi-c1-review-task-bridge"><div className="edupi-c1-review-task-bridge__heading"><h2>任务审核</h2><span>{pendingCount} 项</span></div><EduPiTaskWorkspace workReview={activeWorkReview} files={education.generatedArtifacts} task={activeTask} workCase={workCaseForTask(education, activeTask.id)} stage={taskStage} workspace={education.workspace} context={context} reviewEnabled={(activeWorkReview ? education.capabilities.workCandidateReview : education.capabilities.taskReview).enabled} reviewReason={(activeWorkReview ? education.capabilities.workCandidateReview : education.capabilities.taskReview).reason} reviewBusy={reviewBusy} reviewMessage={reviewMessage} agentSession={activeTask.id ? education.taskSessions[activeTask.id] ?? null : null} taskSessionBusy={taskSessionBusy} taskSessionError={taskSessionError} onStage={selectStage} onReview={reviewTask} onOpenAgent={openAgent} onOpenFile={openFile} /></section> : null}
            {reviewMode === "c1" ? <EduPiC1Review data={education} reviewerId={context?.name || "teacher"} onRefresh={loadWorkspace} query={query} selectedTarget={selectedC1Target} /> : null}
            {reviewMode === "task" && !activeTask ? <section className="edupi-c1-review-task-empty"><span>任务审核</span><strong>暂无待审核任务</strong></section> : null}
            </div> : null}
            {activeView === "tasks" && activeTask ? <EduPiTaskWorkspace workReview={activeWorkReview} files={education.generatedArtifacts} task={activeTask} workCase={workCaseForTask(education, activeTask.id)} stage={taskStage} workspace={education.workspace} context={context} reviewEnabled={(activeWorkReview ? education.capabilities.workCandidateReview : education.capabilities.taskReview).enabled} reviewReason={(activeWorkReview ? education.capabilities.workCandidateReview : education.capabilities.taskReview).reason} reviewBusy={reviewBusy} reviewMessage={reviewMessage} agentSession={activeTask.id ? education.taskSessions[activeTask.id] ?? null : null} taskSessionBusy={taskSessionBusy} taskSessionError={taskSessionError} onStage={selectStage} onReview={reviewTask} onOpenAgent={openAgent} onOpenFile={openFile} /> : null}
            {activeView === "tasks" && !activeTask ? <main className="edupi-module-workspace"><header className="edupi-module-heading"><div><h1>暂无任务</h1></div><button type="button" onClick={openUpload}>上传材料</button></header></main> : null}
            {activeView !== "chat" && activeView !== "tasks" && activeView !== "review" ? <EduPiWorkspaceViews view={activeView} data={education} context={context} memoryScopes={memoryScopes} teachingSkills={teachingSkills} kernelState={kernelState} query={query} selectedStudentId={selectedStudentId} selectedObjectId={selectedObjectId} runningAgentCount={runningAgentCount} stagedMaterials={stagedMaterials} stagingBusy={materialStagingBusy || educationIntakeBusy} intakeBusy={educationIntakeBusy} stagingMessage={materialStagingMessage?.text ?? null} calendarSelection={calendarSelection} onCalendarSelection={setCalendarSelection} onTask={selectTask} onTaskDetail={openTaskDetail} onEducation={setEducation} onStudent={selectStudent} onObject={selectObject} onNavigate={selectView} onUpload={openUpload} onIntakeMaterial={intakeStagedMaterial} onRemoveStagedMaterial={removeStagedMaterialEntry} onImportCalendar={importCalendarEvent} onImportTimetable={importTimetableSlot} onOpenContext={() => setContextOpen(true)} onOpenAdmin={onOpenAdmin} onOpenFile={openFile} onStartAgent={(prompt, mode) => startAgent(prompt, mode)} onCreateTask={createBoardTask} onMoveTask={moveBoardTask} onDeleteEntity={deleteEntity} onReviewTarget={focusC1Review} /> : null}
          </div>
          {inspectorAvailable ? <EduPiInspector open={inspectorOpen} data={education} task={activeTask} onClose={toggleInspector} onOpenAgent={openAgent} onStage={selectStage} /> : null}
        </div>
      </div>
      {taskDetail ? <EduPiTaskDetailDrawer task={taskDetail} workCase={workCaseForTask(education, taskDetail.id)} files={education.generatedArtifacts} workspace={education.workspace} onClose={closeTaskDetail} onOpenFile={openTaskFile} onOpenTask={selectTask} onOpenAgent={openAgentForTask} onDelete={(task) => { if (task.id) void deleteEntity("task", task.id, task.title).catch(() => {}); }} deleteBusy={deleteBusy === `task:${taskDetail.id}`} /> : null}
      <EduPiQuickEntry open={quickEntryOpen} education={education} onClose={onCloseQuickEntry} onSelect={selectQuickEntry} />
      {deleteLabel ? <EduPiDeleteConfirmation label={deleteLabel} onResolve={resolveDeleteConfirmation} /> : null}
      {drawer === "file" ? <FileWorkspaceDrawer kind="file" task={activeView === "tasks" || activeView === "review" ? activeTask : undefined} filePath={previewPath} fileTitle={education?.generatedArtifacts?.find(file => previewPath?.replaceAll("\\", "/").endsWith(`/${file.relative_path.replaceAll("\\", "/")}`))?.title || education?.teacherMaterials?.find(file => previewPath?.replaceAll("\\", "/").endsWith(`/${file.relative_path.replaceAll("\\", "/")}`))?.title} filePanel={previewPath ? (() => { const artifact = education?.generatedArtifacts?.find(file => file.origin === "preparation" && file.available !== false && `${education.workspace.replace(/[\\/]$/, "")}/${file.relative_path}`.replaceAll("\\", "/") === previewPath.replaceAll("\\", "/")); const preview = renderFilePreview(previewPath); return artifact ? <EduPiPreparationArtifactEditor key={artifact.artifact_id} artifactId={artifact.artifact_id} preview={preview} onSaved={value => { openFile(`${education!.workspace.replace(/[\\/]$/, "")}/${value.relative_path}`); window.dispatchEvent(new Event("edupi-preparation-updated")); }} onAgent={prompt => { closeDrawer(); startAgent(prompt, "replace"); }} /> : preview; })() : null} onClose={closeDrawer} onPreparePrompt={onPrepareAgentPrompt} /> : null}
      <input ref={materialUploadInputRef} type="file" multiple hidden accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void stageBrowserFiles(files); }} />
      {materialStagingMessage && activeView !== "materials" ? <div className={`edupi-material-staging-toast is-${materialStagingMessage.tone}`} role={materialStagingMessage.tone === "error" ? "alert" : "status"} aria-live="polite">{materialStagingMessage.text}</div> : null}
      {contextOpen ? <div className="edupi-context-modal" onMouseDown={(event) => { if (event.target === event.currentTarget && !contextBusy) setContextOpen(false); }}><div ref={contextModalRef} className="edupi-context-modal__panel" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="edupi-context-editor-title"><button data-autofocus type="button" className="edupi-context-modal__close" disabled={contextBusy} onClick={() => { if (!contextBusy) setContextOpen(false); }} aria-label="关闭教育上下文">×</button><EduPiContextEditor initial={context} candidate={education?.teacherContextCandidates[0] ?? null} capability={education?.capabilities.teacherContextReview ?? null} onBusyChange={setContextBusy} onClose={() => { if (!contextBusy) setContextOpen(false); }} onReviewed={async () => loadWorkspace()} onAgentRequest={(prompt) => { if (!contextBusy) { setContextOpen(false); startAgent(prompt, "replace"); } }} /></div></div> : null}
    </section>
  );
}
