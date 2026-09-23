"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type ReactElement, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { EducationContract, EducationEntityDeleteKind, TaskReviewAction, TeacherTask } from "@/lib/edupi-education-contract";
import { calendarSelectionFromLink, calendarSelectionLink, type CalendarItemSelection } from "@/lib/edupi-calendar-model";
import { isEducationModule, type EducationModule } from "@/lib/edupi-education-ui";
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
import type { CalendarIntakeInput } from "@/lib/edupi-education-intake";
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
import { materialItemRoute, objectItemForView, reviewTargetObjectId, reviewTargetRoute, viewKeepsObjectItem, type ReviewTargetRoute } from "@/lib/edupi-domain-navigation";
import { APP_PREF_KEYS } from "@/lib/app-prefs";
import { materialRecognitionSummary } from "@/lib/edupi-material-recognition-status";
import type { DocumentPairingSubmission } from "@/lib/edupi-document-pairing-contract";
import { preserveUnavailableWorkspaceResources, readEduPiWorkspace } from "@/lib/edupi-education-client";
import { EduPiPreparationArtifactEditor } from "./EduPiPreparationArtifactEditor";
import { deleteEducationEntity } from "@/lib/edupi-entity-delete-client";
import { readEducationMemoryScopes, type EducationMemoryScopeProjection } from "@/lib/edupi-memory-scopes";
import { readEduPiTeachingSkills, type EduPiTeachingSkillLifecycle } from "@/lib/edupi-platform-client";
import type { MaterialIntakeMetadata } from "@/lib/edupi-material-rows";
import { normalizeKernelState, readEduPiKernel, type EduPiKernelState } from "@/lib/edupi-kernel-client";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import type { CreateTeacherTaskInput, CreateTeacherTaskOutcome } from "@/lib/edupi-task-board-command";
import { hasEveryTrackedTask, refreshUntilTaskVisible } from "@/lib/edupi-task-refresh";
import { isTerminalPreparationRead, workspaceHasReadyPreparation } from "@/lib/edupi-preparation-status";

function RetryWorkspaceIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>;
}

function InspectorIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h16v16H4z" /><path d="M14 4v16M17 8h1M17 12h1" /></svg>;
}

type Props = {
  initialModule?: EducationModule;
  refreshKey?: number;
  activeAgentSessionId: string | null;
  onActivateAgentSession: (input: { taskId: string; sessionId: string | null; cwd: string; view: "tasks" | "review"; stage: TaskStage; signal: AbortSignal }) => Promise<"existing" | "new">;
  chatPanel: ReactNode;
  reminderPanel: ReactNode;
  chatSidebar: ReactNode;
  renderFilePreview: (path: string) => ReactNode;
  onOpenAdmin: () => void;
  onOpenProactive: () => void;
  onOpenGuide: () => void;
  onOpenPhoneControl: () => void;
  onPrepareAgentPrompt: (prompt: string) => void;
  onReplaceAgentPrompt: (prompt: string) => void;
  onPrepareTeacherDraft: (text: string) => void;
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

type AgentPromptMode = "insert" | "replace" | "teacher" | "teacher-main";

type EducationIntakeApiResult = {
  error?: string;
  staged?: MaterialStagingDescriptor[];
  recognition?: { eventCount?: number; slotCount?: number; ocrStatus?: "trusted" | "unavailable" };
  scheduleNeedsReview?: boolean;
  receipt?: { status?: string };
  calendarSourceId?: string;
  documentSourceId?: string | null;
  calendarCommitted?: boolean;
  documentCommitted?: boolean;
  removedEventCount?: number;
};

type BoardPreparationStatus = { taskId?: string | null; state?: "idle" | "running" | "ready" | "error"; error?: string | null; retryable?: boolean };

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

export function EduPiEducationPanel({ initialModule = "home", refreshKey, activeAgentSessionId, onActivateAgentSession, chatPanel, reminderPanel, chatSidebar, renderFilePreview, onOpenAdmin, onOpenProactive, onOpenGuide, onOpenPhoneControl, onPrepareAgentPrompt, onReplaceAgentPrompt, onPrepareTeacherDraft, quickEntryOpen, onCloseQuickEntry, onFocusAgentChat }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const desktopChrome = useDesktopChrome();
  const requestedView = searchParams.get("view");
  const requestedModule = searchParams.get("module");
  const requestedStage = searchParams.get("stage");
  const requestedTaskKey = searchParams.get("task");
  const requestedStudentId = searchParams.get("student");
  const requestedObjectId = searchParams.get("item");
  const requestedReviewTarget = reviewTargetRoute(searchParams.get("reviewTarget"));
  const routeView = isWorkbenchView(requestedView) ? requestedView : viewFromModule(isEducationModule(requestedModule) ? requestedModule : initialModule);
  const [activeView, setActiveView] = useState<WorkbenchView>(() => routeView);
  const [activeStage, setActiveStage] = useState<TaskStage>(() => isTaskStage(requestedStage) ? requestedStage : "brief");
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(() => requestedTaskKey);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(() => requestedStudentId);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(() => objectItemForView(routeView, requestedObjectId));
  const [reviewMode, setReviewMode] = useState<"board" | "task" | "c1">(() => searchParams.get("task") && requestedStage === "review" ? "task" : requestedReviewTarget ? "c1" : "board");
  const [selectedC1Target, setSelectedC1Target] = useState<ReviewTargetRoute | null>(() => requestedReviewTarget);
  const [education, setEducation] = useState<EducationContract | null>(null);
  const [context, setContext] = useState<TeacherContextSnapshot | null>(null);
  const [memoryScopes, setMemoryScopes] = useState<EducationMemoryScopeProjection | null>(null);
  const [teachingSkills, setTeachingSkills] = useState<EduPiTeachingSkillLifecycle>({ status: "unavailable", generatedAt: null, mutationEnabled: false, skills: [], teacherGrowth: [], mutationReceipts: [] });
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
  const [pendingAgentPromptMode, setPendingAgentPromptMode] = useState<AgentPromptMode>("teacher");
  const [pendingTaskBinding, setPendingTaskBinding] = useState<{ taskId: string; previousSessionId: string | null } | null>(null);
  const [taskSessionBusy, setTaskSessionBusy] = useState(false);
  const [taskSessionError, setTaskSessionError] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [fileReturnTaskKey, setFileReturnTaskKey] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState<TaskReviewAction | null>(null);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [stagedMaterials, setStagedMaterials] = useState<MaterialStagingDescriptor[]>([]);
  const [materialStagingBusy, setMaterialStagingBusy] = useState(false);
  const [educationIntakeBusy, setEducationIntakeBusy] = useState(false);
  const [materialStagingMessage, setMaterialStagingMessage] = useState<{ tone: "success" | "error"; text: string; sticky?: boolean } | null>(null);
  const [calendarSelection, setCalendarSelection] = useState<CalendarItemSelection | null>(null);
  const appliedCalendarLink = useRef<{ key: string; education: EducationContract } | null>(null);
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
  const durableTaskIdsRef = useRef(new Set<string>());
  const workspaceLoadSequenceRef = useRef(0);
  const workspaceMinimumApplySequenceRef = useRef(0);
  const objectSider = useEduPiContentSiderCollapse(false);
  const navigationRail = useEduPiContentSiderCollapse(false, APP_PREF_KEYS.edupiNavigationRailCollapsed);

  const commitEducationSnapshot = useCallback((nextEducation: EducationContract) => {
    workspaceMinimumApplySequenceRef.current = Math.max(workspaceMinimumApplySequenceRef.current, workspaceLoadSequenceRef.current + 1);
    setEducation(nextEducation);
  }, []);

  const cancelActivation = useCallback(() => {
    activationRequestsRef.current.cancel();
    taskSessionOpeningRef.current = false;
    setTaskSessionBusy(false);
  }, []);

  const loadWorkspace = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++workspaceLoadSequenceRef.current;
    const [workspace, scopeResponse, nextTeachingSkills, nextKernelState] = await Promise.all([
      readEduPiWorkspace({ signal }),
      readEducationMemoryScopes({ signal }).then((projection) => ({ projection })).catch(() => null),
      readEduPiTeachingSkills(signal),
      readEduPiKernel(signal),
    ]);
    const { context: nextContext, data: nextEducation } = workspace;
    if (sequence < workspaceMinimumApplySequenceRef.current) return null;
    if (!hasEveryTrackedTask(nextEducation, durableTaskIdsRef.current)) return null;
    durableTaskIdsRef.current.clear();
    workspaceMinimumApplySequenceRef.current = Math.max(workspaceMinimumApplySequenceRef.current, sequence);
    setContext(nextContext);
    setEducation((current) => current ? preserveUnavailableWorkspaceResources(current, nextEducation) : nextEducation);
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
    durableTaskIdsRef.current.delete(taskId);
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
              if (next.taskId === taskId && isTerminalPreparationRead(next)) {
                const refreshed = await loadWorkspace(controller.signal).catch(() => null);
                if (refreshed && (next.state === "error" || workspaceHasReadyPreparation(refreshed, taskId))) return;
              }
              if (next.taskId === taskId && next.state === "idle") {
                const refreshed = await loadWorkspace(controller.signal).catch(() => null);
                if (refreshed && !refreshed.tasks.some((task) => task.id === taskId)) { stopTaskTracking(taskId); return; }
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
  }, [loadWorkspace, stopTaskTracking]);

  const refreshCommittedTask = useCallback((taskId: string) => {
    if (taskRefreshesRef.current.has(taskId)) return;
    const controller = new AbortController();
    taskRefreshesRef.current.set(taskId, controller);
    void refreshUntilTaskVisible({ taskId, signal: controller.signal, read: async (signal) => await loadWorkspace(signal) ?? { tasks: [] } })
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
    if (!materialStagingMessage || materialStagingMessage.sticky || materialStagingMessage.text.endsWith("…")) return;
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

  const intakeStagedMaterial = useCallback(async (item: MaterialStagingDescriptor, metadata: MaterialIntakeMetadata, scheduleSource: { sourceId: string; fingerprint: string; sourceKind: "calendar" | "document" } | null, pairing?: DocumentPairingSubmission | null) => {
    const calendarSource = item.kind === "calendar" ? scheduleSource : null;
    const documentSource = item.kind !== "calendar" ? scheduleSource : null;
    const result = await submitEducationIntake({
      kind: "material",
      stagingId: item.staging_id,
      title: metadata.title,
      materialKind: metadata.materialKind,
      subject: metadata.subject,
      classId: metadata.classId,
      recognize: true,
      calendarSourceId: calendarSource?.sourceId ?? null,
      calendarSourceFingerprint: calendarSource?.fingerprint ?? null,
      documentSourceId: documentSource?.sourceId ?? null,
      documentSourceFingerprint: documentSource?.fingerprint ?? null,
      documentPairingFingerprint: pairing?.recognitionFingerprint ?? null,
      documentPairings: pairing?.pairings ?? null,
    });
    const eventCount = result.recognition?.eventCount || 0;
    const slotCount = result.recognition?.slotCount || 0;
    if (item.kind === "calendar") {
      if (!result.calendarCommitted) {
        setMaterialStagingMessage({ tone: "error", sticky: true, text: `${item.original_name} 的部分变更待核对，请以当前日历显示为准。` });
        return result;
      }
      const removed = result.removedEventCount ? `，撤回 ${result.removedEventCount} 项旧安排` : "";
      setMaterialStagingMessage({ tone: "success", text: `${item.original_name} 已导入 ${eventCount} 项日程${removed}。` });
      return result;
    }
    if (result.scheduleNeedsReview) {
      setMaterialStagingMessage({ tone: "error", sticky: true, text: `${item.original_name} 的材料已接入，识别出的时间安排尚未全部生效；请核对文件或在日程手动更正。` });
      return result;
    }
    if (result.recognition?.ocrStatus === "unavailable") {
      setMaterialStagingMessage({ tone: "error", sticky: true, text: `${item.original_name} 已接入；文字识别未完成，日程和课表未导入。请核对原文件。` });
      return result;
    }
    const recognized = materialRecognitionSummary({ eventCount, slotCount, ocrStatus: result.recognition?.ocrStatus });
    setMaterialStagingMessage({ tone: "success", text: `${item.original_name} 已接入 EduPi${recognized}。` });
    return result;
  }, [submitEducationIntake]);

  const importCalendarEvent = useCallback(async (event: CalendarIntakeInput) => {
    const timeInterval = event.startAt && event.endAt && event.timeZone
      ? { start: event.startAt, end: event.endAt, timeZone: event.timeZone } : undefined;
    const result = await submitEducationIntake({ kind: "calendar", events: [{ eventId: event.eventId, date: event.date,
      endDate: event.endDate, name: event.name, type: event.type, notes: event.notes, confidence: "teacher_confirmed",
      sourceOccurrenceRef: event.sourceOccurrenceRef, timeInterval, location: event.location }] });
    setMaterialStagingMessage(result.receipt?.status === "held"
      ? { tone: "error", sticky: true, text: "日程更改待核对。" }
      : { tone: "success", text: event.eventId ? "日程更改已保存。" : "日程已写入 EduPi 行事历。" });
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
    setActiveView(routeView);
  }, [routeView]);

  useEffect(() => {
    if (initialModule === "context") setContextOpen(true);
  }, [initialModule]);

  useEffect(() => {
    setActiveStage(isTaskStage(requestedStage) ? requestedStage : "brief");
  }, [requestedStage]);

  useEffect(() => {
    setSelectedTaskKey(routeView === "tasks" || routeView === "review" ? requestedTaskKey : null);
  }, [requestedTaskKey, routeView]);

  useEffect(() => {
    if (!education || !requestedTaskKey || (routeView !== "tasks" && routeView !== "review")) return;
    if (education.tasks.some((task) => taskKey(task) === requestedTaskKey)) return;
    setSelectedTaskKey(null);
    setActiveStage("brief");
    setReviewMode((current) => current === "task" ? "board" : current);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("task");
    params.delete("stage");
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [education, requestedTaskKey, routeView, router, searchParams]);

  useEffect(() => {
    setSelectedStudentId(routeView === "homeroom" || routeView === "students" ? requestedStudentId : null);
  }, [requestedStudentId, routeView]);

  useEffect(() => {
    if (!education || !requestedStudentId || (routeView !== "homeroom" && routeView !== "students")) return;
    const exists = education.students.some((student, index) => studentRecordKey(student, index) === requestedStudentId);
    if (exists) return;
    setSelectedStudentId(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("student");
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [education, requestedStudentId, routeView, router, searchParams]);

  useEffect(() => {
    const nextObjectId = objectItemForView(routeView, requestedObjectId);
    setSelectedObjectId(nextObjectId);
    if (!requestedObjectId || nextObjectId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("item");
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [requestedObjectId, routeView, router, searchParams]);

  useEffect(() => {
    const id = searchParams.get("calendarItem");
    const kind = searchParams.get("calendarKind");
    const date = searchParams.get("date");
    const clearCalendarLink = () => {
      setCalendarSelection(null);
      appliedCalendarLink.current = null;
      const params = new URLSearchParams(searchParams.toString());
      params.delete("calendarKind");
      params.delete("calendarItem");
      params.delete("date");
      router.replace(`/?${params.toString()}`, { scroll: false });
    };
    if (!id) {
      if (appliedCalendarLink.current !== null) setCalendarSelection(null);
      appliedCalendarLink.current = null;
      if (kind || date) clearCalendarLink();
      return;
    }
    if (routeView !== "calendar") { clearCalendarLink(); return; }
    const key = JSON.stringify([kind, id, date]);
    if (!education) return;
    const applied = appliedCalendarLink.current;
    if (applied?.key === key && applied.education === education) return;
    const selection = calendarSelectionFromLink(education, { kind, id, date });
    if (selection) { setCalendarSelection(selection); appliedCalendarLink.current = { key, education }; }
    else clearCalendarLink();
  }, [education, routeView, router, searchParams]);

  useEffect(() => {
    const requested = searchParams.get("inspector");
    setInspectorOpen(requested === "1");
  }, [searchParams]);

  useEffect(() => {
    const close = () => {
      cancelActivation();
      setDrawer(null);
      setFileReturnTaskKey(null);
      setTaskDetailTask(null);
      setAgentTask(null);
      if (!contextBusy) setContextOpen(false);
      setPendingTaskBinding(null);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("taskDetail");
      router.replace(`/?${params.toString()}`, { scroll: false });
    };
    window.addEventListener("edupi-close-panel", close);
    return () => window.removeEventListener("edupi-close-panel", close);
  }, [cancelActivation, contextBusy, router, searchParams]);

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
  const factPendingCount = (education?.factSpine?.factCandidates ?? []).filter((item) => item.status === "candidate" || item.status === "pending_review" || item.status === "held").length;
  const teacherContextPendingCount = (education?.teacherContextCandidates ?? []).filter((item) => item.status === "pending_review" || item.status === "held" || item.teacherReview.state === "pending_review" || item.teacherReview.state === "held").length;
  const teacherContextLabel = [context?.name, context?.subject, context?.grade].filter(Boolean).join(" · ") || "教师工作区";

  useEffect(() => {
    if (activeView === "review" && reviewMode === "c1" && c1PendingCount === 0) setReviewMode("board");
  }, [activeView, c1PendingCount, pendingCount, reviewMode]);

  const updateLocation = useCallback((view: WorkbenchView, task: TeacherTask | undefined, stage: TaskStage | undefined, nextInspector = inspectorOpen, nextStudentId = selectedStudentId, nextObjectId = selectedObjectId, nextCalendarSelection = calendarSelection, nextReviewTarget: ReviewTargetRoute | null = null) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("edupi", "1");
    params.set("module", moduleFromView(view));
    params.set("view", view);
    if (task) params.set("task", taskKey(task)); else params.delete("task");
    params.delete("taskDetail");
    if (stage) params.set("stage", stage); else params.delete("stage");
    if (view === "review" && nextReviewTarget) params.set("reviewTarget", reviewTargetObjectId(nextReviewTarget)); else params.delete("reviewTarget");
    if ((view === "homeroom" || view === "students") && nextStudentId) params.set("student", nextStudentId); else params.delete("student");
    if (viewKeepsObjectItem(view) && nextObjectId) params.set("item", nextObjectId); else params.delete("item");
    const calendarLink = view === "calendar" ? calendarSelectionLink(nextCalendarSelection) : null;
    if (calendarLink) {
      params.set("calendarKind", calendarLink.kind);
      params.set("calendarItem", calendarLink.id);
      if (calendarLink.date) params.set("date", calendarLink.date); else params.delete("date");
    } else {
      params.delete("calendarKind");
      params.delete("calendarItem");
      params.delete("date");
    }
    params.set("inspector", nextInspector ? "1" : "0");
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [calendarSelection, inspectorOpen, router, searchParams, selectedObjectId, selectedStudentId]);

  const updateTaskDetailLocation = useCallback((key: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key) {
      params.set("taskDetail", key);
      params.delete("calendarKind");
      params.delete("calendarItem");
      params.delete("date");
    } else {
      params.delete("taskDetail");
    }
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  useEffect(() => {
    if (drawer === "file") return;
    const requested = searchParams.get("taskDetail");
    if (!requested) { setTaskDetailTask(null); return; }
    const selected = tasks.find((task) => taskKey(task) === requested) || null;
    setTaskDetailTask(selected);
    if (!selected && education) updateTaskDetailLocation(null);
  }, [drawer, education, searchParams, tasks, updateTaskDetailLocation]);

  useEffect(() => {
    const rawTarget = searchParams.get("reviewTarget");
    const requested = reviewTargetRoute(rawTarget);
    if (!rawTarget) {
      setSelectedC1Target(null);
      setReviewMode((current) => current === "c1" ? "board" : current);
      return;
    }
    if (requestedView !== "review" || !requested) {
      setSelectedC1Target(null);
      setReviewMode((current) => current === "c1" ? "board" : current);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("reviewTarget");
      router.replace(`/?${params.toString()}`, { scroll: false });
      return;
    }
    if (!education) return;
    const available = requested.kind === "observation"
      ? education.observations.some((item) => item.observationId === requested.id && (item.teacherReview.state === "pending_review" || item.teacherReview.state === "held"))
      : education.memoryCandidates.some((item) => item.candidateId === requested.id && (item.teacherReview.state === "pending_review" || item.teacherReview.state === "held"));
    if (available) {
      setSelectedC1Target(requested);
      setReviewMode("c1");
      return;
    }
    setSelectedC1Target(null);
    setReviewMode("board");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("reviewTarget");
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [education, requestedView, router, searchParams]);

  const selectView = useCallback((view: WorkbenchView, requestedObjectId?: string, requestedStudentId?: string | null, requestedCalendarSelection?: CalendarItemSelection | null) => {
    const stage = view === "tasks" ? activeStage : undefined;
    const nextObjectId = objectItemForView(view, requestedObjectId ?? selectedObjectId);
    const nextStudentId = requestedStudentId === undefined ? selectedStudentId : requestedStudentId;
    const nextCalendarSelection = requestedCalendarSelection === undefined ? (view === "calendar" ? calendarSelection : null) : requestedCalendarSelection;
    cancelActivation();
    setDrawer(null);
    setFileReturnTaskKey(null);
    setTaskDetailTask(null);
    setAgentTask(null);
    setQuery("");
    setPendingTaskBinding(null);
    setCalendarSelection(nextCalendarSelection);
    if (view === "review") setReviewMode("board");
    setSelectedC1Target(null);
    setActiveView(view);
    setSelectedObjectId(nextObjectId);
    if (requestedStudentId !== undefined) setSelectedStudentId(requestedStudentId);
    if (stage) setActiveStage(stage);
    updateLocation(view, view === "tasks" ? activeTask : undefined, stage, inspectorOpen, nextStudentId, nextObjectId, nextCalendarSelection);
  }, [activeStage, activeTask, calendarSelection, cancelActivation, inspectorOpen, selectedObjectId, selectedStudentId, updateLocation]);

  const selectCalendarItem = useCallback((selection: CalendarItemSelection | null) => {
    if (!selection) {
      setCalendarSelection(null);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("calendarKind");
      params.delete("calendarItem");
      params.delete("date");
      router.replace(`/?${params.toString()}`, { scroll: false });
      return;
    }
    if (activeView !== "calendar") {
      selectView("calendar", undefined, undefined, selection);
      return;
    }
    setCalendarSelection(selection);
    updateLocation("calendar", undefined, undefined, inspectorOpen, selectedStudentId, selectedObjectId, selection);
  }, [activeView, inspectorOpen, router, searchParams, selectView, selectedObjectId, selectedStudentId, updateLocation]);

  const selectTask = useCallback((task: TeacherTask, stage: TaskStage = "brief") => {
    const view = stage === "review" && activeView === "review" ? "review" : "tasks";
    cancelActivation();
    setSelectedTaskKey(taskKey(task));
    setActiveView(view);
    setActiveStage(stage);
    setReviewMessage(null);
    setSelectedC1Target(null);
    setDrawer(null);
    setFileReturnTaskKey(null);
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
    updateLocation(activeView, activeTask, activeView === "tasks" || activeView === "review" ? activeStage : undefined, next, selectedStudentId, selectedObjectId, calendarSelection, activeView === "review" && reviewMode === "c1" ? selectedC1Target : null);
  }, [activeStage, activeTask, activeView, calendarSelection, inspectorOpen, reviewMode, selectedC1Target, selectedObjectId, selectedStudentId, updateLocation]);

  const focusC1Review = useCallback((target: ReviewTargetRoute) => {
    cancelActivation();
    setActiveView("review");
    setSelectedTaskKey(null);
    setQuery("");
    setReviewMode("c1");
    setSelectedC1Target(target);
    setDrawer(null);
    setFileReturnTaskKey(null);
    setTaskDetailTask(null);
    setAgentTask(null);
    setPendingTaskBinding(null);
    updateLocation("review", undefined, undefined, inspectorOpen, null, null, null, target);
    requestAnimationFrame(() => {
      document.getElementById(`edupi-c1-review-${target.kind}-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [cancelActivation, inspectorOpen, updateLocation]);

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
        commitEducationSnapshot(result.data);
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
      commitEducationSnapshot(result.data);
      const nextTask = result.data.tasks.find((task) => task.id === activeTask.id);
      if (nextTask) setSelectedTaskKey(taskKey(nextTask));
      setReviewMessage(reviewLabels[action]);
    } catch (error) {
      if (error instanceof TodayWorkReviewError && error.data) commitEducationSnapshot(error.data);
      setReviewMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setReviewBusy(null);
    }
  }, [activeTask, commitEducationSnapshot, education]);

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
      filters: [{ name: "教学材料", extensions: ["jpg", "jpeg", "png", "webp", "pdf", "doc", "docx", "ics"] }],
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
    setFileReturnTaskKey(null);
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
    setFileReturnTaskKey(null);
    setAgentTask(null);
    setPendingTaskBinding(null);
    setCalendarSelection(null);
    setTaskDetailTask(task);
    updateTaskDetailLocation(taskKey(task));
  }, [cancelActivation, updateTaskDetailLocation]);

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
    selectCalendarItem({
      kind: "calendar",
      sourceId: event.id,
      date: event.date,
      title: event.name,
      detail: event.notes,
      sourceLabel: event.source === "teacher" ? "教师" : event.source === "official_school_calendar" ? "学校校历" : event.type || "校历",
      statusLabel: calendarQuickEntryStatusLabel(event),
    });
  }, [education?.calendar, onCloseQuickEntry, onFocusAgentChat, selectCalendarItem, selectTask, selectView, tasks]);

  const openTaskFile = useCallback((path: string) => {
    setFileReturnTaskKey(taskDetailTask ? taskKey(taskDetailTask) : null);
    setTaskDetailTask(null);
    setPreviewPath(path);
    setDrawer("file");
  }, [taskDetailTask]);

  const closeTaskDetail = useCallback(() => {
    setFileReturnTaskKey(null);
    setTaskDetailTask(null);
    updateTaskDetailLocation(null);
  }, [updateTaskDetailLocation]);

  const createBoardTask = useCallback(async (input: CreateTeacherTaskInput): Promise<CreateTeacherTaskOutcome> => {
    const response = await fetch("/api/edupi/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const result = await response.json() as { error?: string; taskId?: string; data?: EducationContract | null; refreshPending?: boolean; preparation?: { state?: string; error?: string; taskId?: string | null } | null };
    if (!response.ok || !result.taskId) throw new Error(result.error || `任务创建失败（HTTP ${response.status}）`);
    durableTaskIdsRef.current.add(result.taskId);
    workspaceMinimumApplySequenceRef.current = Math.max(workspaceMinimumApplySequenceRef.current, workspaceLoadSequenceRef.current + 1);
    if (result.data && hasEveryTrackedTask(result.data, durableTaskIdsRef.current)) { durableTaskIdsRef.current.clear(); commitEducationSnapshot(result.data); }
    if (!result.data?.tasks.some((task) => task.id === result.taskId)) refreshCommittedTask(result.taskId);
    if (!input.preparationSource) return { preparationState: null, preparationError: null };
    if (!result.taskId || result.preparation?.taskId !== result.taskId || !["running", "ready"].includes(result.preparation?.state || "")) {
      return { preparationState: "error", preparationError: result.preparation?.error || "请打开任务后重试" };
    }
    if (result.preparation.state === "running") pollBoardPreparation(result.taskId);
    else window.dispatchEvent(new Event("edupi-preparation-updated"));
    return { preparationState: result.preparation.state as "running" | "ready", preparationError: null };
  }, [commitEducationSnapshot, pollBoardPreparation, refreshCommittedTask]);

  const moveBoardTask = useCallback(async (task: TeacherTask, stage: TaskBoardLaneId) => {
    if (!task.id) throw new Error("任务缺少可写标识。");
    const response = await fetch(`/api/edupi/tasks/${encodeURIComponent(task.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage, expectedRevision: task.boardRevision, note: null }) });
    const result = await response.json() as { error?: string; data?: EducationContract };
    if (!response.ok || !result.data) throw new Error(result.error || `任务移动失败（HTTP ${response.status}）`);
    commitEducationSnapshot(result.data);
  }, [commitEducationSnapshot]);

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
      if (kind === "task") { stopTaskTracking(id); closeTaskDetail(); setSelectedTaskKey(null); }
      commitEducationSnapshot(education && result.data.workspaceResourcesUnavailable
        ? preserveUnavailableWorkspaceResources(education, result.data, { removedMaterialId: kind === "material" ? result.target.id : null })
        : result.data);
      if (kind === "calendar" || kind === "timetable") selectCalendarItem(null);
      if (kind === "student") setSelectedStudentId(null);
      setMaterialStagingMessage({ tone: "success", text: `已删除：${label}` });
      return true;
    } catch (error) {
      setMaterialStagingMessage({ tone: "error", text: error instanceof Error ? error.message : "删除失败" });
      throw error;
    } finally {
      setDeleteBusy(null);
    }
  }, [closeTaskDetail, commitEducationSnapshot, deleteBusy, education, selectCalendarItem, stopTaskTracking]);

  const closeDrawer = useCallback((restoreTask = true) => {
    const returnTask = restoreTask && drawer === "file" && fileReturnTaskKey
      ? tasks.find((task) => taskKey(task) === fileReturnTaskKey) || null
      : null;
    cancelActivation();
    setDrawer(null);
    setFileReturnTaskKey(null);
    setTaskDetailTask(returnTask);
    setAgentTask(null);
    setPendingTaskBinding(null);
  }, [cancelActivation, drawer, fileReturnTaskKey, tasks]);

  const activateAgent = useCallback((task: TeacherTask, view: "tasks" | "review", stage: TaskStage) => {
    if (taskSessionOpeningRef.current) return;
    if (!task.id || !education) {
      setFileReturnTaskKey(null);
      setAgentTask(task || null);
      setDrawer("agent");
      return;
    }
    const binding = education.taskSessions[task.id];
    const reusableSessionId = binding && binding.status !== "missing" ? binding.sessionId : null;
    const prompt = [
      `教学任务：${task.title}`,
      `任务 ID：${task.id}`,
      `来源：${taskSourceLabel(task)}`,
      `截止：${task.dueDate || "日期待确认"}`,
    ].join("\n");
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
        setFileReturnTaskKey(null);
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
      setFileReturnTaskKey(null);
      setAgentTask(null);
      setDrawer("agent");
      return;
    }
    const activation = { view: (activeView === "review" ? "review" : "tasks") as "tasks" | "review", stage: activeStage };
    activateAgent(task, activation.view, activation.stage);
  }, [activeStage, activeTask, activeView, activateAgent]);

  const startAgent = useCallback((prompt: string, mode: AgentPromptMode = "teacher") => {
    setFileReturnTaskKey(null);
    setAgentTask(null);
    setPendingAgentPromptMode(mode);
    setPendingAgentPrompt(mode === "replace" || mode === "teacher" || mode === "teacher-main" ? prompt.trim() : [
      prompt.trim(),
      "",
      `教学上下文：${teacherContextLabel}`,
      "边界：仅在教师内部处理，保留来源，不外发；写回事实或产物前等待教师确认。",
    ].join("\n"));
    if (mode === "replace" || mode === "teacher-main") {
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
      if (result.data) commitEducationSnapshot(result.data);
      setPendingTaskBinding(null);
    }).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setTaskSessionError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!controller.signal.aborted) setTaskSessionBusy(false);
    });
    return () => controller.abort();
  }, [activeAgentSessionId, commitEducationSnapshot, pendingTaskBinding]);

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
      if (mode === "teacher" || mode === "teacher-main") onPrepareTeacherDraft(pendingAgentPrompt);
      else if (mode === "replace") onReplaceAgentPrompt(pendingAgentPrompt);
      else onPrepareAgentPrompt(pendingAgentPrompt);
      setPendingAgentPrompt(null);
      setPendingAgentPromptMode("teacher");
    });
    return () => cancelAnimationFrame(frame);
  }, [activeView, drawer, onPrepareAgentPrompt, onReplaceAgentPrompt, onPrepareTeacherDraft, pendingAgentPrompt, pendingAgentPromptMode]);

  if (shouldShowBlockingEducationLoad(education)) {
    return <section className={`edupi-teacher-shell is-loading${desktopChrome.isDesktop ? " has-desktop-drag-region" : ""}`}>{desktopChrome.isDesktop ? <div className="edupi-window-drag-region" {...desktopChrome.dragRegionProps}><WindowControls /></div> : null}<div className="edupi-workbench-loading" role={loadError ? "alert" : "status"}><span>π</span><strong>{loadError || "正在读取教育工作区"}</strong>{loadError ? <div><button type="button" onClick={retryLoadWorkspace}>重试</button><button type="button" onClick={onOpenAdmin}>打开管理中心</button></div> : null}</div></section>;
  }

  const taskStage = activeStage;
  const inspectorAvailable = (activeView === "tasks" || activeView === "review") && Boolean(activeTask);
  const objectSiderAvailable = activeView !== "dashboard" && activeView !== "chat" && activeView !== "workspace";
  const showObjectSider = objectSiderAvailable && !objectSider.collapsed;
  const showingReminders = activeView === "chat" && searchParams.get("reminders") === "1";
  const taskDetail = taskDetailTask ? tasks.find((task) => taskKey(task) === taskKey(taskDetailTask)) || taskDetailTask : null;
  const currentAgentTask = agentTask ? tasks.find((task) => taskKey(task) === taskKey(agentTask)) || agentTask : null;
  const bodyControlCount = Number(Boolean(loadError)) + Number(inspectorAvailable);
  const studentDetailOpen = (activeView === "homeroom" || activeView === "students") && Boolean(selectedStudentId) && education.students.some((student, index) => studentRecordKey(student, index) === selectedStudentId);
  const detailSurfaceOpen = Boolean(drawer || taskDetail || calendarSelection || studentDetailOpen || (activeView === "materials" && materialItemRoute(selectedObjectId)));
  const bodyControlsVisible = bodyControlCount > 0 && !detailSurfaceOpen;
  const bodyControlStyle = bodyControlsVisible ? { "--edupi-body-controls-width": `${bodyControlCount * 36}px` } as CSSProperties : undefined;
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
      <EduPiNavigationRail activeView={activeView} pendingReviewCount={pendingCount + c1PendingCount + factPendingCount + teacherContextPendingCount} runningAgentCount={runningAgentCount} memoryCount={education.continuity.memories.filter((memory) => memory.state === "active" && isUserFacingMemory(memory)).length} workspaceLabel={context?.school || context?.name || "教师工作区"} collapsed={navigationRail.collapsed} onSelect={selectView} onOpenAdmin={onOpenAdmin} onOpenProactive={onOpenProactive} onOpenGuide={onOpenGuide} onOpenPhoneControl={onOpenPhoneControl} onCollapse={navigationRail.toggle} />
      <div className="edupi-teacher-app">
        <div className={`edupi-teacher-body${activeView === "chat" ? " is-chat" : ""}${showingReminders ? " is-reminders" : ""}${bodyControlsVisible ? " has-body-controls" : ""}${detailSurfaceOpen ? " has-detail-surface" : ""}${objectSiderAvailable ? " has-object-sider" : ""}${objectSiderAvailable && objectSider.collapsed ? " is-object-sider-collapsed" : ""}${inspectorAvailable && inspectorOpen ? " has-inspector" : ""}`} style={bodyControlStyle}>
          {bodyControlsVisible ? <div className="edupi-teacher-body__controls">{loadError ? <button className="edupi-teacher-body__icon-button" type="button" onClick={retryLoadWorkspace} aria-label="重试读取工作区" title={`重试读取工作区：${loadError}`}><RetryWorkspaceIcon /></button> : null}{inspectorAvailable ? <button className={`edupi-teacher-body__icon-button${inspectorOpen ? " is-open" : ""}`} type="button" onClick={toggleInspector} aria-label={inspectorOpen ? "收起检查" : "打开检查"} title={inspectorOpen ? "收起检查" : "打开检查"} aria-pressed={inspectorOpen}><InspectorIcon /></button> : null}</div> : null}
          {activeView === "chat" && !showingReminders ? <aside className="edupi-chat-session-sidebar" aria-label="对话与文件">{chatSidebar}</aside> : showObjectSider ? <EduPiObjectSider view={activeView} data={education} context={context} memoryScopes={memoryScopes} teachingSkills={teachingSkills} query={query} onQuery={setQuery} selectedStudentId={selectedStudentId} onStudent={selectStudent} selectedObjectId={selectedObjectId} onObject={selectObject} selectedTaskKey={activeTask ? taskKey(activeTask) : null} onTask={selectTask} onReviewTarget={focusC1Review} selectedCalendarSourceId={calendarSelection?.sourceId ?? null} onCalendarItem={selectCalendarItem} onUpload={openUpload} onCollapse={objectSider.toggle} /> : objectSiderAvailable ? <button type="button" className="edupi-object-sider-strip" onClick={objectSider.toggle} aria-label="展开列表"><span aria-hidden="true">›</span></button> : null}
          <div className={`edupi-teacher-main${activeView === "chat" ? " is-chat" : ""}`}>
            <EduPiPersistentChatHost mode={showingReminders ? "hidden" : drawer === "agent" ? "drawer" : activeView === "chat" ? "main" : "hidden"} task={drawer === "agent" ? currentAgentTask : null} onClose={closeDrawer} onPreparePrompt={onPrepareAgentPrompt}>{chatPanel}</EduPiPersistentChatHost>
            {showingReminders ? <div className="edupi-reminder-surface">{reminderPanel}</div> : null}
            {activeView === "review" ? <div className="edupi-review-surface">
            {reviewMode === "board" ? <EduPiReviewBoard data={education} query={query} onTask={(task) => selectTask(task, "review")} onReviewTarget={focusC1Review} onEducation={commitEducationSnapshot} reviewer={context?.name || "teacher"} /> : null}
            {reviewMode === "task" && activeTask ? <section className="edupi-c1-review-task-bridge"><div className="edupi-c1-review-task-bridge__heading"><h2>任务审核</h2><span>{pendingCount} 项</span></div><EduPiTaskWorkspace workReview={activeWorkReview} files={education.generatedArtifacts} task={activeTask} workCase={workCaseForTask(education, activeTask.id)} stage={taskStage} workspace={education.workspace} context={context} reviewEnabled={(activeWorkReview ? education.capabilities.workCandidateReview : education.capabilities.taskReview).enabled} reviewReason={(activeWorkReview ? education.capabilities.workCandidateReview : education.capabilities.taskReview).reason} reviewBusy={reviewBusy} reviewMessage={reviewMessage} agentSession={activeTask.id ? education.taskSessions[activeTask.id] ?? null : null} taskSessionBusy={taskSessionBusy} taskSessionError={taskSessionError} onStage={selectStage} onReview={reviewTask} onOpenAgent={openAgent} onOpenFile={openFile} /></section> : null}
            {reviewMode === "c1" ? <EduPiC1Review data={education} reviewerId={context?.name || "teacher"} onRefresh={async () => { await loadWorkspace(); }} query={query} selectedTarget={selectedC1Target} /> : null}
            {reviewMode === "task" && !activeTask ? <section className="edupi-c1-review-task-empty"><span>任务审核</span><strong>暂无待审核任务</strong></section> : null}
            </div> : null}
            {activeView === "tasks" && activeTask ? <EduPiTaskWorkspace workReview={activeWorkReview} files={education.generatedArtifacts} task={activeTask} workCase={workCaseForTask(education, activeTask.id)} stage={taskStage} workspace={education.workspace} context={context} reviewEnabled={(activeWorkReview ? education.capabilities.workCandidateReview : education.capabilities.taskReview).enabled} reviewReason={(activeWorkReview ? education.capabilities.workCandidateReview : education.capabilities.taskReview).reason} reviewBusy={reviewBusy} reviewMessage={reviewMessage} agentSession={activeTask.id ? education.taskSessions[activeTask.id] ?? null : null} taskSessionBusy={taskSessionBusy} taskSessionError={taskSessionError} onStage={selectStage} onReview={reviewTask} onOpenAgent={openAgent} onOpenFile={openFile} /> : null}
            {activeView === "tasks" && !activeTask ? <main className="edupi-module-workspace"><header className="edupi-module-heading"><div><h1>暂无任务</h1></div><button type="button" onClick={openUpload}>上传材料</button></header></main> : null}
            {activeView !== "chat" && activeView !== "tasks" && activeView !== "review" ? <EduPiWorkspaceViews view={activeView} data={education} context={context} memoryScopes={memoryScopes} teachingSkills={teachingSkills} kernelState={kernelState} query={query} selectedStudentId={selectedStudentId} selectedObjectId={selectedObjectId} runningAgentCount={runningAgentCount} stagedMaterials={stagedMaterials} stagingBusy={materialStagingBusy || educationIntakeBusy} intakeBusy={educationIntakeBusy} stagingMessage={materialStagingMessage ? { text: materialStagingMessage.text, tone: materialStagingMessage.tone } : null} calendarSelection={calendarSelection} onCalendarSelection={selectCalendarItem} onTask={selectTask} onTaskDetail={openTaskDetail} onEducation={commitEducationSnapshot} onStudent={selectStudent} onObject={selectObject} onNavigate={selectView} onUpload={openUpload} onIntakeMaterial={intakeStagedMaterial} onRemoveStagedMaterial={removeStagedMaterialEntry} onImportCalendar={importCalendarEvent} onImportTimetable={importTimetableSlot} onOpenContext={() => setContextOpen(true)} onOpenAdmin={onOpenAdmin} onOpenFile={openFile} onStartAgent={(prompt, mode) => startAgent(prompt, mode)} onTeachingSkills={setTeachingSkills} onCreateTask={createBoardTask} onMoveTask={moveBoardTask} onDeleteEntity={deleteEntity} onReviewTarget={focusC1Review} /> : null}
          </div>
          {inspectorAvailable ? <EduPiInspector open={inspectorOpen} data={education} task={activeTask} onClose={toggleInspector} onOpenAgent={openAgent} onStage={selectStage} /> : null}
        </div>
      </div>
      {taskDetail ? <EduPiTaskDetailDrawer task={taskDetail} workCase={workCaseForTask(education, taskDetail.id)} files={education.generatedArtifacts} workspace={education.workspace} onClose={closeTaskDetail} onOpenFile={openTaskFile} onOpenTask={selectTask} onOpenAgent={openAgentForTask} onDelete={(task) => { if (task.id) void deleteEntity("task", task.id, task.title).catch(() => {}); }} deleteBusy={deleteBusy === `task:${taskDetail.id}`} /> : null}
      <EduPiQuickEntry open={quickEntryOpen} education={education} onClose={onCloseQuickEntry} onSelect={selectQuickEntry} />
      {deleteLabel ? <EduPiDeleteConfirmation label={deleteLabel} onResolve={resolveDeleteConfirmation} /> : null}
      {drawer === "file" ? <FileWorkspaceDrawer kind="file" task={activeView === "tasks" || activeView === "review" ? activeTask : undefined} filePath={previewPath} fileTitle={education?.generatedArtifacts?.find(file => previewPath?.replaceAll("\\", "/").endsWith(`/${file.relative_path.replaceAll("\\", "/")}`))?.title || education?.teacherMaterials?.find(file => previewPath?.replaceAll("\\", "/").endsWith(`/${file.relative_path.replaceAll("\\", "/")}`))?.title} filePanel={previewPath ? (() => { const artifact = education?.generatedArtifacts?.find(file => file.origin === "preparation" && file.available !== false && `${education.workspace.replace(/[\\/]$/, "")}/${file.relative_path}`.replaceAll("\\", "/") === previewPath.replaceAll("\\", "/")); const preview = renderFilePreview(previewPath); return artifact ? <EduPiPreparationArtifactEditor key={artifact.artifact_id} artifactId={artifact.artifact_id} preview={preview} onSaved={value => { setPreviewPath(`${education!.workspace.replace(/[\\/]$/, "")}/${value.relative_path}`); window.dispatchEvent(new Event("edupi-preparation-updated")); }} onAgent={prompt => { closeDrawer(false); startAgent(prompt, "replace"); }} /> : preview; })() : null} onClose={closeDrawer} onPreparePrompt={onPrepareAgentPrompt} /> : null}
      <input ref={materialUploadInputRef} type="file" multiple hidden accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.ics" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void stageBrowserFiles(files); }} />
      {materialStagingMessage && activeView !== "materials" ? <div className={`edupi-material-staging-toast is-${materialStagingMessage.tone}`} role={materialStagingMessage.tone === "error" ? "alert" : "status"} aria-live="polite"><span>{materialStagingMessage.text}</span>{materialStagingMessage.sticky ? <button type="button" onClick={() => setMaterialStagingMessage(null)} aria-label="关闭提示" title="关闭提示">×</button> : null}</div> : null}
      {contextOpen ? <div className="edupi-context-modal" onMouseDown={(event) => { if (event.target === event.currentTarget && !contextBusy) setContextOpen(false); }}><div ref={contextModalRef} className="edupi-context-modal__panel" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="edupi-context-editor-title"><button data-autofocus type="button" className="edupi-context-modal__close" disabled={contextBusy} onClick={() => { if (!contextBusy) setContextOpen(false); }} aria-label="关闭教育上下文">×</button><EduPiContextEditor initial={context} candidate={education?.teacherContextCandidates[0] ?? null} capability={education?.capabilities.teacherContextReview ?? null} history={education?.teacherContextReviewHistory ?? []} onBusyChange={setContextBusy} onClose={() => { if (!contextBusy) setContextOpen(false); }} onReviewed={async () => await loadWorkspace() ?? education} onAgentRequest={(prompt) => { if (!contextBusy) { setContextOpen(false); startAgent(prompt, "teacher-main"); } }} /></div></div> : null}
    </section>
  );
}
