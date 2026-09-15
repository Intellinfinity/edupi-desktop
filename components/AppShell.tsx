"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useGlobalKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useEduPiCompletionMonitor } from "@/hooks/useEduPiCompletionMonitor";
import { reminderNotificationAction, useEduPiReminderNotifications } from "@/hooks/useEduPiReminderNotifications";
import { bindReminderSession } from "@/lib/edupi-reminder-session";
import { reminderPrompt } from "@/lib/edupi-reminder-prompt";
import { readEduPiWorkspace } from "@/lib/edupi-education-client";
import { SessionSidebar } from "./SessionSidebar";
import { EduPiAdminPanel, type AdminSectionId } from "./EduPiAdminPanel";
import { EduPiEducationPanel } from "./EduPiEducationPanel";
import { EduPiReminderInbox } from "./EduPiReminderInbox";
import { EduPiFirstRunGuide } from "./EduPiFirstRunGuide";
import "@/app/edupi-first-run.css";
import type { EducationModule } from "@/lib/edupi-education-ui";
import { moduleFromView, viewFromModule, type TaskStage, type WorkbenchView } from "@/lib/edupi-workbench";
import type { DesktopControlInput } from "@/lib/edupi-desktop-control";
import type { ComputerUseBridgeResult, ComputerUseInput } from "@/lib/edupi-computer-use";
import { runComputerUseFromAgent, setComputerUseEnabledNative } from "@/lib/desktop-computer-use";
import { ChatWindow } from "./ChatWindow";
import { clearDraft, getDraft, setDraft } from "@/lib/draft-store";
import { TabBar, type Tab } from "./TabBar";

// Heavy, rarely-used surfaces are code-split out of the main bundle. The
// config modals may never be opened at all; FileViewer drags in markdown +
// syntax highlighting a second time and only matters once a file tab opens.
const FileViewer = dynamic(() => import("./FileViewer").then((m) => m.FileViewer), { ssr: false });
const ModelsConfig = dynamic(() => import("./ModelsConfig").then((m) => m.ModelsConfig), { ssr: false });
const SkillsConfig = dynamic(() => import("./SkillsConfig").then((m) => m.SkillsConfig), { ssr: false });
const PluginsConfig = dynamic(() => import("./PluginsConfig").then((m) => m.PluginsConfig), { ssr: false });
const AppSettings = dynamic(() => import("./AppSettings").then((m) => m.AppSettings), { ssr: false });
import { ProjectTrustDialog } from "./ProjectTrustDialog";
import { BranchNavigator } from "./BranchNavigator";
import { UpdateReminder } from "./UpdateReminder";
import { announceComputerUseChanged } from "./EduPiComputerUseStop";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { APP_PREF_KEYS, getPrefBool, getPrefJson, setPrefBool, setPrefJson } from "@/lib/app-prefs";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { copyText } from "@/lib/clipboard";
import { useDesktopConnection } from "@/lib/desktop-connection";
import { createDesktopCatchUpCoordinator } from "@/lib/desktop-catch-up";
import { isTauriDesktop, listenDesktopResumeNative, listenQuickEntryNative, setCloseQuitsNative, showMainWindowNative } from "@/lib/desktop-native";
import { getFileName } from "@/lib/file-paths";
import { buildAtMentionText, buildFileAtMentionsText, buildFileLineMentionText } from "@/lib/file-fuzzy";
import { PRODUCT_NAME } from "@/lib/branding";
import {
  resolveInitialNavigation,
  workspaceFileTabsMatchContext,
  type PersistedWorkspace,
} from "@/lib/workspace-state";
import { WindowControls, useDesktopChrome } from "./desktop";
import {
  getDefaultRightPanelWidth,
  getRightPanelMaxWidth,
  getSidebarMaxWidth,
  RIGHT_PANEL_FALLBACK_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/lib/panel-layout";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ProjectTrustStatus } from "@/lib/api-types";
import type { ChatInputHandle } from "./ChatInput";
import type { SessionStatsInfo } from "@/lib/pi-types";

type SessionCopyField = "file" | "id";
type SidebarFooterAction = {
  id: string;
  label: string;
  onClick: () => void;
  disabled: boolean;
  iconOnly?: boolean;
  icon: React.ReactNode;
};

type AutoNameStatus =
  | { kind: "idle" }
  | { kind: "naming" }
  | { kind: "success" }
  | { kind: "error"; message: string };

const TOP_BAR_ICON_BUTTON_SIZE = 36;
export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [desktopMode] = useState(() => isTauriDesktop());
  const [persistedWorkspace] = useState(() => (
    desktopMode ? getPrefJson<PersistedWorkspace>(APP_PREF_KEYS.workspace) : null
  ));
  const [initialNavigation] = useState(() => resolveInitialNavigation(searchParams, persistedWorkspace));
  const [workspaceHydrated, setWorkspaceHydrated] = useState(() => !desktopMode);
  const { isDark, toggleTheme } = useTheme();
  const { locale, t: translate } = useI18n();
  const isMobile = useIsMobile();
  useViewportHeight();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [initialCwdStatus, setInitialCwdStatus] = useState<"idle" | "validating" | "ready" | "error">(
    () => initialNavigation.requestedCwd ? "validating" : "idle",
  );
  const [initialCwdError, setInitialCwdError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [educationRefreshKey, setEducationRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [skillsConfigOpen, setSkillsConfigOpen] = useState(false);
  const [pluginsConfigOpen, setPluginsConfigOpen] = useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [firstRunGuideOpen, setFirstRunGuideOpen] = useState(false);
  useEffect(() => {
    setFirstRunGuideOpen(!getPrefBool(APP_PREF_KEYS.edupiFirstRunGuideComplete, false));
  }, []);
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const quickEntryOpenRef = useRef(false);
  quickEntryOpenRef.current = quickEntryOpen;
  useEffect(() => {
    const closeTopmostQuickEntry = (event: KeyboardEvent) => {
      if (!quickEntryOpenRef.current || event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setQuickEntryOpen(false);
    };
    window.addEventListener("keydown", closeTopmostQuickEntry, true);
    return () => window.removeEventListener("keydown", closeTopmostQuickEntry, true);
  }, []);
  useEffect(() => {
    const handler = () => {
      setAppSettingsOpen(false);
      setEduPiEducationModule("context");
    };
    window.addEventListener("edupi-open-context", handler);
    return () => window.removeEventListener("edupi-open-context", handler);
  }, []);

  const [edupiAdminOpen, setEduPiAdminOpen] = useState(false);
  const [edupiAdminSection, setEduPiAdminSection] = useState<AdminSectionId>("readiness");
  const [adminModelsDirty, setAdminModelsDirty] = useState(false);
  const [edupiEducationModule, setEduPiEducationModule] = useState<EducationModule | null>("home");
  const edupiChatActive = edupiEducationModule !== null && searchParams.get("view") === "chat";
  const [projectTrust, setProjectTrust] = useState<ProjectTrustStatus | null>(null);
  const [projectTrustDialogOpen, setProjectTrustDialogOpen] = useState(false);
  const [projectTrustBusy, setProjectTrustBusy] = useState(false);
  const [projectTrustError, setProjectTrustError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [mobileSidebarReady, setMobileSidebarReady] = useState(false);
  // The desktop window has no native title bar. macOS keeps its traffic lights
  // and only needs the top bar inset for them; other platforms get the buttons
  // from <WindowControls />, which renders nothing in a browser build.
  const desktopChrome = useDesktopChrome();
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const rightPanelWidthRef = useRef(RIGHT_PANEL_FALLBACK_WIDTH);
  const getResponsiveRightPanelWidth = useCallback(
    () => typeof window === "undefined"
      ? RIGHT_PANEL_FALLBACK_WIDTH
      : getDefaultRightPanelWidth(window.innerWidth),
    [],
  );
  const getResponsiveSidebarMaxWidth = useCallback(
    () => typeof window === "undefined"
      ? SIDEBAR_MAX_WIDTH
      : getSidebarMaxWidth({
        viewportWidth: window.innerWidth,
        rightPanelOpen,
        rightPanelWidth: rightPanelWidthRef.current,
      }),
    [rightPanelOpen],
  );
  const getResponsiveRightPanelMaxWidth = useCallback(
    () => typeof window === "undefined"
      ? RIGHT_PANEL_MAX_WIDTH
      : getRightPanelMaxWidth({
        viewportWidth: window.innerWidth,
        sidebarOpen,
        sidebarWidth: sidebarWidthRef.current,
      }),
    [sidebarOpen],
  );
  const sidebarResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeSidebar"),
    cssVariable: "--sidebar-width",
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    getMaxWidth: getResponsiveSidebarMaxWidth,
    growthDirection: "right",
    maxWidth: SIDEBAR_MAX_WIDTH,
    minWidth: SIDEBAR_MIN_WIDTH,
    storageKey: "pi-sidebar-width",
    widthRef: sidebarWidthRef,
  });
  const rightPanelResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeFilePanel"),
    cssVariable: "--right-panel-width",
    defaultWidth: RIGHT_PANEL_FALLBACK_WIDTH,
    getDefaultWidth: getResponsiveRightPanelWidth,
    getMaxWidth: getResponsiveRightPanelMaxWidth,
    growthDirection: "left",
    maxWidth: RIGHT_PANEL_MAX_WIDTH,
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    storageKey: "pi-right-panel-width",
    widthRef: rightPanelWidthRef,
  });
  const reclampSidebarWidth = sidebarResizer.reclampWidth;
  const reclampRightPanelWidth = rightPanelResizer.reclampWidth;
  // On mobile the sidebar is an overlay drawer; hide it by default so the chat
  // is visible on load. Runs once the breakpoint resolves after hydration.
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  useEffect(() => {
    setMobileSidebarReady(true);
  }, []);
  useEffect(() => {
    if (!desktopMode) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const catchUp = createDesktopCatchUpCoordinator(() => Promise.allSettled([
        fetch("/api/edupi/connectors/dingtalk/runtime", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ensure" }) }),
        fetch("/api/edupi/preparation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ensure" }) }),
      ]));
    const refreshVisible = () => { if (document.visibilityState === "visible") catchUp.trigger(); };
    const recoverOnline = () => catchUp.trigger(true);
    catchUp.trigger(true);
    void listenDesktopResumeNative(() => catchUp.trigger(true)).then((next) => {
      if (disposed) next();
      else unlisten = next;
    }).catch(() => {});
    window.addEventListener("online", recoverOnline);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      disposed = true;
      catchUp.dispose();
      unlisten?.();
      window.removeEventListener("online", recoverOnline);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [desktopMode]);
  useEffect(() => {
    if (!rightPanelOpen) return;
    reclampSidebarWidth();
    reclampRightPanelWidth();
  }, [reclampRightPanelWidth, reclampSidebarWidth, rightPanelOpen]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const requestedEducationModule = searchParams.get("module");
    const allowed: EducationModule[] = ["home", "context", "students", "calendar", "materials", "tasks"];
    if (requestedEducationModule && allowed.includes(requestedEducationModule as EducationModule)) setEduPiEducationModule(requestedEducationModule as EducationModule);
    else if (searchParams.get("edupi") === "1") setEduPiEducationModule("home");
  }, [searchParams]);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const educationActivationRequestIdRef = useRef(0);
  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    branchLeafChangeFnRef.current = onLeafChange;
  }, []);

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
  }, []);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const [autoNameStatus, setAutoNameStatus] = useState<AutoNameStatus>({ kind: "idle" });
  const autoNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSessionIdRef = useRef<string | null>(selectedSession?.id ?? null);
  activeSessionIdRef.current = selectedSession?.id ?? null;
  const handleSessionStatsChange = useCallback((stats: SessionStatsInfo | null) => {
    setSessionStats(stats);
  }, []);
  const [copiedSessionField, setCopiedSessionField] = useState<SessionCopyField | null>(null);
  const sessionCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopySessionField = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      setCopiedSessionField(field);
      sessionCopyTimerRef.current = setTimeout(() => setCopiedSessionField(null), 1400);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    };
  }, []);

  // Context usage — populated by ChatWindow, displayed in top bar
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const handleContextUsageChange = useCallback((usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => {
    setContextUsage(usage);
  }, []);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<"branches" | "system" | "session" | null>(null);
  const [topMoreOpen, setTopMoreOpen] = useState(false);
  const topMoreRef = useRef<HTMLDivElement>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const toggleTopPanel = useCallback((panel: "branches" | "system" | "session") => {
    if (isMobile) setSidebarOpen(false);
    setTopMoreOpen(false);
    setActiveTopPanel((cur) => cur === panel ? null : panel);
  }, [isMobile]);

  const openSessionStatsPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel("session");
  }, [isMobile]);

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) setActiveTopPanel(null);
    setSidebarOpen((open) => !open);
  }, [isMobile]);

  useEffect(() => {
    if (!topMoreOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!topMoreRef.current?.contains(event.target as Node)) setTopMoreOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTopMoreOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [topMoreOpen]);

  useEffect(() => {
    setTopMoreOpen(false);
  }, [selectedSession?.id]);

  useEffect(() => {
    if (!activeTopPanel) return;

    const handlePointerDown = (event: MouseEvent) => {
      // Panel DOM lives under topBarRef (fixed-position child); treat the whole
      // top bar — including toggle buttons — as inside so toggles stay reliable.
      if (!topBarRef.current?.contains(event.target as Node)) setActiveTopPanel(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveTopPanel(null);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [activeTopPanel]);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const topBarRect = topBarRef.current!.getBoundingClientRect();
      setTopPanelPos({ top: topBarRect.bottom, left: topBarRect.left, width: topBarRect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    return () => ro.disconnect();
  }, [activeTopPanel, isMobile]);

  // Right panel — file tabs only
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);

  useEffect(() => {
    if (desktopMode) {
      void setCloseQuitsNative(getPrefBool(APP_PREF_KEYS.closeQuits, false));
      const computerUseEnabled = getPrefBool(APP_PREF_KEYS.computerUseEnabled, false);
      void setComputerUseEnabledNative(computerUseEnabled).catch(() => {
        setPrefBool(APP_PREF_KEYS.computerUseEnabled, false);
        announceComputerUseChanged(false);
      });
    }
  }, [desktopMode]);

  const { state: connectionState, retry: retryConnection } = useDesktopConnection(desktopMode);

  const openEducationModule = useCallback((module: EducationModule = "home") => {
    setEduPiEducationModule(module);
    const params = new URLSearchParams(searchParams.toString());
    params.set("edupi", "1");
    params.set("module", module);
    params.set("view", viewFromModule(module));
    params.delete("task");
    params.delete("stage");
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const openEduPiAdmin = useCallback((section: AdminSectionId = "readiness") => {
    setEduPiAdminSection(section);
    setEduPiAdminOpen(true);
  }, []);

  const openEducationView = useCallback((view: WorkbenchView) => {
    setEduPiAdminOpen(false);
    const educationModule = moduleFromView(view);
    setEduPiEducationModule(educationModule);
    const params = new URLSearchParams(searchParams.toString());
    params.set("edupi", "1");
    params.set("module", educationModule);
    params.set("view", view);
    params.delete("task");
    params.delete("stage");
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const finishFirstRunGuide = useCallback(() => {
    setPrefBool(APP_PREF_KEYS.edupiFirstRunGuideComplete, true);
    setFirstRunGuideOpen(false);
  }, []);

  const askEduPiToUpdateStudents = useCallback(() => {
    openEducationView("chat");
    requestAnimationFrame(() => chatInputRef.current?.replaceText("请根据我接下来提供的班级名单、课堂记录或作业材料，整理学生档案更新候选；保留来源，先让我审核，不要直接写入或外发。"));
  }, [openEducationView]);

  const openQuickEntry = useCallback(() => {
    setQuickEntryOpen(true);
    if (!edupiEducationModule) openEducationModule("home");
  }, [edupiEducationModule, openEducationModule]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenQuickEntryNative(openQuickEntry).then((next) => {
      if (disposed) next();
      else unlisten = next;
    }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, [openQuickEntry]);
  // Same @mention format as the chat input's @ autocomplete, so the agent's read tool resolves it the same way (it strips the @ prefix).
  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
  }, []);

  const handleAtMentions = useCallback((relativePaths: string[]) => {
    const mentions = buildFileAtMentionsText(relativePaths);
    if (mentions) chatInputRef.current?.insertText(mentions);
  }, []);

  const handleFileLineMention = useCallback((relativePath: string, startLine: number, endLine: number) => {
    chatInputRef.current?.insertText(buildFileLineMentionText(relativePath, startLine, endLine));
  }, []);

  const initialSessionId = initialNavigation.sessionId;
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const activeProjectRootRef = useRef<string | null>(null);
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);

  useEffect(() => {
    const requestedCwd = initialNavigation.requestedCwd;
    if (!requestedCwd) return;

    const controller = new AbortController();
    setInitialCwdStatus("validating");
    setInitialCwdError(null);

    void fetch("/api/cwd/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: requestedCwd }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { cwd?: string; error?: string };
        if (!response.ok || !data.cwd) {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }

        // The sidebar will notify us when it adopts this cwd. Avoid remounting
        // the just-created empty chat during that initial synchronization.
        suppressCwdBumpRef.current = true;
        setNewSessionCwd(data.cwd);
        setInitialCwdStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setInitialCwdError(error instanceof Error ? error.message : String(error));
        setInitialCwdStatus("error");
      });

    return () => controller.abort();
  }, [initialNavigation]);

  const handleCwdChange = useCallback((cwd: string | null, projectRoot?: string | null) => {
    setActiveCwd(cwd);
    // Skip if cwd is null (initial mount).
    if (!cwd) return;
    const newProject = projectRoot ?? cwd;
    const currentProject = activeProjectRootRef.current
      ?? (selectedSession ? (selectedSession.projectRoot ?? selectedSession.cwd) : null);
    activeProjectRootRef.current = newProject;

    // Keep the project identity in sync during the initial URL restore without
    // remounting the just-created or restored chat.
    if (suppressCwdBumpRef.current) {
      suppressCwdBumpRef.current = false;
      return;
    }
    // Worktrees of one repo share a project root. Moving the effective cwd
    // within the same project (e.g. switching worktree, or clicking a session
    // that lives in another worktree) must not close the open session.
    if (currentProject === newProject) {
      return;
    }
    // Close any session that belongs to a different project — it no longer
    // matches the selected project directory.
    setSelectedSession(null);
    setNewSessionCwd((prev) => {
      if (prev && prev !== cwd) return null;
      return prev;
    });
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    // File tabs are keyed by absolute path, so tabs opened in the previous
    // project would otherwise linger after switching to a different project.
    // Reached only past the same-project early return above, so worktrees of
    // one repo keep their open tabs. Mirror handleCloseFileTab and close the
    // now-empty right panel.
    setFileTabs([]);
    setActiveFileTabId(null);
    setRightPanelOpen(false);
    if (!edupiEducationModule) router.replace("/", { scroll: false });
  }, [edupiEducationModule, router, selectedSession]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    // Do not bump sessionKey here — ChatWindow stays mounted and swaps
    // session data in place so the fixed input dock does not flash.
    setBranchTree([]);
    setBranchActiveLeafId(null);
    branchLeafChangeFnRef.current = null;
    setSystemPrompt(null);
    setSessionStats(null);
    setContextUsage(null);
    setActiveTopPanel(null);
    setTopMoreOpen(false);
    setInitialSessionRestored(true);
    // On mobile, collapse the overlay drawer so the chat is revealed after pick.
    if (isMobile && !isRestore) setSidebarOpen(false);
    if (isRestore) {
      // Suppress the redundant sessionKey bump that would come from the
      // onCwdChange effect firing after setSelectedCwd in the sidebar
      suppressCwdBumpRef.current = true;
    }
    // Skip router.replace when restoring from URL — the param is already correct
    // and calling replace in production Next.js triggers a Suspense remount loop
    if (!isRestore) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [router, isMobile]);

  const handleEducationSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    branchLeafChangeFnRef.current = null;
    setSystemPrompt(null);
    setSessionStats(null);
    setContextUsage(null);
    setActiveTopPanel(null);
    setTopMoreOpen(false);
    setInitialSessionRestored(true);
    if (isRestore) {
      suppressCwdBumpRef.current = true;
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("edupi", "1");
    params.set("view", "chat");
    params.set("session", session.id);
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const handleNewSession = useCallback((_sessionId: string, cwd: string) => {
    // "New task" is an explicit reset. A cwd-based blank-task draft would
    // otherwise be reloaded immediately when the composer remounts.
    clearDraft(`new:${cwd}`);
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setEduPiEducationModule(null);
    // A second click in the same cwd must still create a clean composer. The
    // cwd-derived session identity alone cannot distinguish those blank tasks.
    setSessionKey((key) => key + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    branchLeafChangeFnRef.current = null;
    setSystemPrompt(null);
    setSessionStats(null);
    setContextUsage(null);
    setActiveTopPanel(null);
    if (isMobile) setSidebarOpen(false);
    router.replace("/", { scroll: false });
  }, [router, isMobile]);

  const handleEducationNewSession = useCallback((_sessionId: string, cwd: string) => {
    clearDraft(`new:${cwd}`);
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((key) => key + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    branchLeafChangeFnRef.current = null;
    setSystemPrompt(null);
    setSessionStats(null);
    setContextUsage(null);
    setActiveTopPanel(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("edupi", "1");
    params.set("view", "chat");
    params.delete("session");
    params.delete("task");
    params.delete("reminders");
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  // Global keyboard shortcuts (handles Esc, Ctrl+Alt+N etc.)
  useGlobalKeyboardShortcuts({
    onNewSession: (cwd: string) => (edupiChatActive ? handleEducationNewSession : handleNewSession)(`kb-${Date.now()}`, cwd),
    activeCwd,
    onQuickEntry: openQuickEntry,
  });

  // Client-built transient SessionInfo (new session / fork) lacks the
  // server-computed projectRoot, which the same-project check in
  // handleCwdChange relies on. Hydrate it from the session list so switching
  // worktrees right after creating a session doesn't close the chat.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    void fetch("/api/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
      .then((d) => {
        const full = d?.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) => (prev && prev.id === sessionId && !prev.projectRoot ? full : prev));
      })
      .catch(() => {});
  }, []);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setRefreshKey((k) => k + 1);
    hydrateSelectedSession(session.id);
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [router, hydrateSelectedSession]);

  const [pendingReminderBinding, setPendingReminderBinding] = useState<{ taskId: string; sessionId: string } | null>(null);
  const retryReminderBinding = useCallback(async (binding: { taskId: string; sessionId: string }) => {
    try { await bindReminderSession(binding.taskId, binding.sessionId); setPendingReminderBinding(null); }
    catch { setPendingReminderBinding(binding); }
  }, []);
  const handleEducationSessionCreated = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setRefreshKey((key) => key + 1);
    hydrateSelectedSession(session.id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("edupi", "1");
    params.set("session", session.id);
    const taskId = params.get("task");
    if (taskId && params.get("view") === "chat") void retryReminderBinding({ taskId, sessionId: session.id });
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [hydrateSelectedSession, router, searchParams, retryReminderBinding]);

  const handleActivateEducationAgentSession = useCallback(async ({ taskId, sessionId, cwd, view, stage, signal }: { taskId: string; sessionId: string | null; cwd: string; view: "tasks" | "review"; stage: TaskStage; signal: AbortSignal }): Promise<"existing" | "new"> => {
    const requestId = educationActivationRequestIdRef.current + 1;
    educationActivationRequestIdRef.current = requestId;
    const throwIfStale = () => {
      if (educationActivationRequestIdRef.current !== requestId || signal.aborted) {
        throw new DOMException("Education Agent activation was cancelled", "AbortError");
      }
    };

    throwIfStale();
    if (sessionId) {
      const response = await fetch("/api/sessions", { cache: "no-store", signal });
      throwIfStale();
      const result = response.ok ? await response.json() as { sessions?: SessionInfo[] } : {};
      throwIfStale();
      let session = result.sessions?.find((item) => item.id === sessionId && item.cwd === cwd);
      if (!session) {
        const runtimeResponse = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, { cache: "no-store", signal });
        throwIfStale();
        const runtime = runtimeResponse.ok ? await runtimeResponse.json() as { running?: boolean } : {};
        throwIfStale();
        if (runtime.running) {
          const timestamp = new Date().toISOString();
          session = { id: sessionId, path: "", cwd, created: timestamp, modified: timestamp, messageCount: 0, firstMessage: "" };
        }
      }
      if (session) {
        throwIfStale();
        setNewSessionCwd(null);
        setSelectedSession(session);
        setBranchTree([]);
        setBranchActiveLeafId(null);
        branchLeafChangeFnRef.current = null;
        setSystemPrompt(null);
        setSessionStats(null);
        setContextUsage(null);
        setActiveTopPanel(null);
        setTopMoreOpen(false);
        throwIfStale();
        const params = new URLSearchParams(searchParams.toString());
        params.set("edupi", "1");
        params.set("module", "tasks");
        params.set("view", view);
        params.set("task", taskId);
        params.set("stage", stage);
        params.set("session", session.id);
        router.replace(`/?${params.toString()}`, { scroll: false });
        return "existing";
      }
    }

    throwIfStale();
    clearDraft(`new:${cwd}`);
    throwIfStale();
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((key) => key + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    branchLeafChangeFnRef.current = null;
    setSystemPrompt(null);
    setSessionStats(null);
    setContextUsage(null);
    setActiveTopPanel(null);
    throwIfStale();
    const params = new URLSearchParams(searchParams.toString());
    params.set("edupi", "1");
    params.set("module", "tasks");
    params.set("view", view);
    params.set("task", taskId);
    params.set("stage", stage);
    params.delete("session");
    router.replace(`/?${params.toString()}`, { scroll: false });
    return "new";
  }, [router, searchParams]);

  const handleEduPiAppAction = useCallback(async (action: DesktopControlInput): Promise<boolean> => {
    if (action.action === "show_window") {
      if (!isTauriDesktop()) return false;
      await showMainWindowNative();
      return true;
    }
    if (action.action === "open_settings") {
      setAppSettingsOpen(true);
      return true;
    }
    if (action.action === "open_context") {
      setAppSettingsOpen(false);
      setEduPiEducationModule("context");
      return true;
    }
    if (action.action === "close_panel") {
      setAppSettingsOpen(false);
      setModelsConfigOpen(false);
      setSkillsConfigOpen(false);
      setPluginsConfigOpen(false);
      window.dispatchEvent(new CustomEvent("edupi-close-panel"));
      return true;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("edupi", "1");
    if (action.action === "set_inspector") {
      params.set("inspector", action.open ? "1" : "0");
      router.replace(`/?${params.toString()}`, { scroll: false });
      return true;
    }
    if (action.action === "open_document") {
      const response = await fetch("/api/edupi/workspace", { cache: "no-store" });
      if (!response.ok) return false;
      const { data } = await response.json();
      if (!data.continuity.documents.some((item: { id: string }) => item.id === action.documentId)) return false;
      params.set("module", "home"); params.set("view", "dashboard"); params.set("document", action.documentId);
      params.delete("task"); params.delete("stage");
      router.replace(`/?${params.toString()}`, { scroll: false });
      return true;
    }
    if (action.action === "open_task") {
      const response = await fetch("/api/edupi/education", { cache: "no-store" });
      const data = response.ok ? await response.json() as { tasks?: Array<{ id: string | null }> } : {};
      if (!data.tasks?.some((task) => task.id === action.taskId)) return false;
      setEduPiEducationModule("tasks");
      params.set("module", "tasks");
      params.set("view", "tasks");
      params.set("task", action.taskId);
      params.set("stage", action.stage || "brief");
      router.replace(`/?${params.toString()}`, { scroll: false });
      return true;
    }

    const nextModule = moduleFromView(action.view);
    setEduPiEducationModule(nextModule);
    params.set("module", nextModule);
    params.set("view", action.view);
    if (action.view !== "tasks" && action.view !== "review") {
      params.delete("task");
      params.delete("stage");
    }
    router.replace(`/?${params.toString()}`, { scroll: false });
    return true;
  }, [router, searchParams]);

  const [reminderDraft, setReminderDraft] = useState<{ taskId: string; text: string; title: string } | null>(null);
  const continueReminder = useCallback(async (taskId: string) => {
    const response = await fetch("/api/edupi/workspace", { cache: "no-store" });
    if (!response.ok) throw new Error("事项读取失败");
    const { data } = await response.json();
    const task = data.tasks.find((item: { id: string }) => item.id === taskId);
    const document = data.continuity.documents.find((item: { id: string }) => `document:${item.id}` === taskId);
    if (!task && !document) throw new Error("事项已移除");
    const title = task?.title || document.title;
    const sessionId = data.taskSessions[taskId]?.sessionId || null;
    const workspaceDraftKey = `new:${data.workspace}`;
    const workspaceDraft = getDraft(workspaceDraftKey);
    const reminderKey = `reminder:${data.workspace}:${taskId}`;
    const draftKey = sessionId || reminderKey;
    const draft = getDraft(draftKey);
    const result = await handleActivateEducationAgentSession({ taskId, sessionId, cwd: data.workspace, view: "tasks", stage: "run", signal: new AbortController().signal });
    if (workspaceDraft) setDraft(workspaceDraftKey, workspaceDraft);
    const key = result === "existing" ? sessionId! : reminderKey;
    if (draft && (draft.value || draft.images.length)) { setDraft(key, draft); setReminderDraft({ taskId, text: draft.value, title }); }
    else if (result === "existing") setReminderDraft({ taskId, text: "", title });
    else {
      const text = task ? reminderPrompt(task) : `关于${document.title}：\n${document.excerpt}\n来源文件：${document.path}\n\n我想补充：\n`;
      setDraft(key, { value: text, images: [] });
      setReminderDraft({ taskId, text, title });
    }
    const params = new URLSearchParams({ edupi: "1", module: "home", view: "chat", task: taskId });
    if (result === "existing" && sessionId) params.set("session", sessionId);
    router.replace(`/?${params.toString()}`, { scroll: false });
    chatInputRef.current?.focus();
  }, [handleActivateEducationAgentSession, router]);

  const closeReminderPanel = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("reminders");
    params.set("view", "chat");
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const handleEduPiComputerAction = useCallback((action: ComputerUseInput, expiresAt?: number): Promise<ComputerUseBridgeResult> => {
    return runComputerUseFromAgent(action, expiresAt);
  }, []);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
    setEducationRefreshKey((key) => key + 1);
    window.dispatchEvent(new Event("edupi-artifacts-updated"));
  }, []);

  const handleEducationImportCompleted = useCallback(() => {
    setEducationRefreshKey((key) => key + 1);
  }, []);

  const focusEducationChat = useCallback(() => { chatInputRef.current?.focus(); }, []);

  const handleEducationProjectionChanged = useCallback(() => {
    setEducationRefreshKey((key) => key + 1);
  }, []);
  useEduPiCompletionMonitor({ onRefresh: handleEducationProjectionChanged, notifications: false });
  const openReminderNotification = useCallback((target: import("@/lib/desktop-native").ReminderNotificationTarget | null) => {
    const inbox = () => router.replace("/?edupi=1&module=home&view=chat&reminders=1", { scroll: false });
    const action = reminderNotificationAction(target);
    if (!action) { inbox(); return; }
    void handleEduPiAppAction(action).then(opened => { if (!opened) inbox(); }).catch(inbox);
  }, [handleEduPiAppAction, router]);
  useEduPiReminderNotifications(openReminderNotification);

  const handleProjectFilesImported = useCallback(() => {
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleAutoName = useCallback(async () => {
    const sessionId = selectedSession?.id;
    if (!sessionId || autoNameStatus.kind === "naming") return;
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setActiveTopPanel(null);
    setAutoNameStatus({ kind: "naming" });

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/auto-name`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { title?: string; error?: string };
      if (!response.ok || !body.title) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }

      const title = body.title.trim();
      setRefreshKey((key) => key + 1);
      if (activeSessionIdRef.current !== sessionId) return;
      setSelectedSession((current) => current?.id === sessionId ? { ...current, name: title } : current);
      setSessionStats((current) => current?.sessionId === sessionId ? { ...current, sessionName: title } : current);
      setAutoNameStatus({ kind: "success" });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 1800);
    } catch (error) {
      if (activeSessionIdRef.current !== sessionId) return;
      const message = error instanceof Error ? error.message : String(error);
      setAutoNameStatus({ kind: "error", message });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 5000);
    }
  }, [autoNameStatus.kind, selectedSession?.id]);

  useEffect(() => {
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setAutoNameStatus({ kind: "idle" });
  }, [selectedSession?.id]);

  const handleSessionForked = useCallback((newSessionId: string) => {
    setRefreshKey((k) => k + 1);
    setNewSessionCwd(null);
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
    }));
    hydrateSelectedSession(newSessionId);
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [router, hydrateSelectedSession]);

  const handleEducationSessionForked = useCallback((newSessionId: string) => {
    setRefreshKey((key) => key + 1);
    setNewSessionCwd(null);
    setSelectedSession((previous) => ({
      ...(previous ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
    }));
    hydrateSelectedSession(newSessionId);
    const params = new URLSearchParams(searchParams.toString());
    params.set("edupi", "1");
    params.set("session", newSessionId);
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [hydrateSelectedSession, router, searchParams]);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setRefreshKey((k) => k + 1);
    if (selectedSession?.id === sessionId) {
      const cwd = selectedSession.cwd;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setActiveTopPanel(null);
      if (edupiEducationModule) {
        const params = new URLSearchParams(searchParams.toString());
        params.set("edupi", "1");
        params.delete("session");
        router.replace(`/?${params.toString()}`, { scroll: false });
      } else {
        router.replace("/", { scroll: false });
      }
    }
  }, [edupiEducationModule, router, searchParams, selectedSession]);

  const handleOpenFile = useCallback((
    filePath: string,
    fileName: string,
    options?: { sourceSessionId?: string | null; modeHint?: "diff" },
  ) => {
    const sourceSessionId = options?.sourceSessionId;
    const modeHint = options?.modeHint;
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => {
      const existing = prev.find((t) => t.id === tabId);
      if (!existing) {
        return [...prev, {
          id: tabId,
          label: fileName,
          filePath,
          sourceSessionId,
          initialDisplayMode: modeHint,
        }];
      }
      const sourceUnchanged = !sourceSessionId || existing.sourceSessionId === sourceSessionId;
      const modeUnchanged = !modeHint || existing.initialDisplayMode === modeHint;
      if (sourceUnchanged && modeUnchanged) return prev;
      return prev.map((t) => {
        if (t.id !== tabId) return t;
        const next: Tab = { ...t };
        if (sourceSessionId) next.sourceSessionId = sourceSessionId;
        if (modeHint) next.initialDisplayMode = modeHint;
        return next;
      });
    });
    setActiveFileTabId(tabId);
    setRightPanelOpen(true);
    // On mobile the file panel is full-screen; close the drawer so it shows.
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleOpenLinkedFile = useCallback((filePath: string) => {
    handleOpenFile(filePath, getFileName(filePath), { sourceSessionId: selectedSession?.id ?? null });
  }, [handleOpenFile, selectedSession?.id]);

  const handleCloseFileTab = useCallback((tabId: string) => {
    setFileTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0) setRightPanelOpen(false);
      return next;
    });
    setActiveFileTabId((cur) => {
      if (cur !== tabId) return cur;
      const remaining = fileTabs.filter((t) => t.id !== tabId);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
  }, [fileTabs]);

  const handleViewFullHistory = useCallback(() => {
    if (!selectedSession) return;
    // Absolute URL so Tauri's open_external_url (http/https only) can hand the
    // page to the system browser for inline viewing — not a save dialog.
    const exportUrl = new URL(
      `/api/sessions/${encodeURIComponent(selectedSession.id)}/export?inline=1`,
      window.location.origin,
    ).href;
    void import("@/lib/desktop-native").then(({ openExternal }) => {
      void openExternal(exportUrl).catch((error) => {
        console.error("Failed to open full history:", error);
      });
    });
  }, [selectedSession]);

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  useEffect(() => {
    if (!edupiChatActive || selectedSession || effectiveNewSessionCwd || !initialSessionRestored) return;
    const controller = new AbortController();
    void readEduPiWorkspace({ signal: controller.signal }).then(async bundle => {
      const response = await fetch("/api/cwd/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: bundle.data.workspace }), signal: controller.signal });
      if (!response.ok) throw new Error("教育工作区无法打开");
      if (!controller.signal.aborted) setNewSessionCwd(bundle.data.workspace);
    }).catch(() => { /* Education panel exposes workspace errors and retry. */ });
    return () => controller.abort();
  }, [edupiChatActive, selectedSession, effectiveNewSessionCwd, initialSessionRestored]);
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  const projectTrustCwd = selectedSession?.cwd ?? effectiveNewSessionCwd;
  const showPlaceholder = initialSessionRestored && !showChat;

  // Reopen the last file tabs after the cold-start session/cwd restore settles.
  useEffect(() => {
    if (!desktopMode || !initialSessionRestored || workspaceHydrated) return;

    const cwd = selectedSession?.cwd ?? newSessionCwd ?? activeCwd;
    const canMatch = workspaceFileTabsMatchContext(
      persistedWorkspace,
      selectedSession?.id ?? null,
      cwd,
    );
    const hasSavedTabs = Boolean(persistedWorkspace?.fileTabs?.length);

    // Wait for sidebar auto-select before giving up on tab restore.
    if (hasSavedTabs && !canMatch && !cwd && !showPlaceholder) return;

    if (canMatch && persistedWorkspace) {
      const tabs: Tab[] = persistedWorkspace.fileTabs.map((tab) => ({
        id: `file:${tab.filePath}`,
        label: tab.label,
        filePath: tab.filePath,
        sourceSessionId: tab.sourceSessionId,
        initialDisplayMode: tab.initialDisplayMode,
      }));
      setFileTabs(tabs);
      const activeId = persistedWorkspace.activeFileTabId;
      setActiveFileTabId(
        activeId && tabs.some((tab) => tab.id === activeId)
          ? activeId
          : (tabs[0]?.id ?? null),
      );
      setRightPanelOpen(Boolean(persistedWorkspace.rightPanelOpen && tabs.length > 0));
    }
    setWorkspaceHydrated(true);
  }, [
    initialSessionRestored,
    desktopMode,
    workspaceHydrated,
    persistedWorkspace,
    selectedSession?.id,
    selectedSession?.cwd,
    newSessionCwd,
    activeCwd,
    showPlaceholder,
  ]);

  // Persist workspace so the next desktop cold start can restore chat + files.
  useEffect(() => {
    if (!desktopMode || !workspaceHydrated) return;
    setPrefJson(APP_PREF_KEYS.workspace, {
      sessionId: selectedSession?.id ?? null,
      cwd: selectedSession?.cwd ?? newSessionCwd ?? activeCwd,
      fileTabs: fileTabs.map((tab) => ({
        filePath: tab.filePath,
        label: tab.label,
        sourceSessionId: tab.sourceSessionId,
        initialDisplayMode: tab.initialDisplayMode,
      })),
      activeFileTabId,
      rightPanelOpen,
    } satisfies PersistedWorkspace);
  }, [
    workspaceHydrated,
    desktopMode,
    selectedSession?.id,
    selectedSession?.cwd,
    newSessionCwd,
    activeCwd,
    fileTabs,
    activeFileTabId,
    rightPanelOpen,
  ]);

  useEffect(() => {
    setProjectTrust(null);
    setProjectTrustDialogOpen(false);
    setProjectTrustError(null);
    if (!projectTrustCwd) return;

    const controller = new AbortController();
    fetch(`/api/project-trust?cwd=${encodeURIComponent(projectTrustCwd)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json() as ProjectTrustStatus & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        setProjectTrust(data);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to load project trust:", error);
      });
    return () => controller.abort();
  }, [projectTrustCwd]);

  const handleTrustProject = useCallback(async () => {
    if (!projectTrustCwd || projectTrustBusy) return;
    setProjectTrustBusy(true);
    setProjectTrustError(null);
    try {
      const response = await fetch("/api/project-trust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectTrustCwd }),
      });
      const data = await response.json() as ProjectTrustStatus & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setProjectTrust(data);
      setProjectTrustDialogOpen(false);
      setModelsRefreshKey((key) => key + 1);
      setSessionKey((key) => key + 1);
    } catch (error) {
      setProjectTrustError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectTrustBusy(false);
    }
  }, [projectTrustBusy, projectTrustCwd]);

  const activeFileTab = fileTabs.find((t) => t.id === activeFileTabId) ?? null;
  const activeCwdName = activeCwd ? getFileName(activeCwd) || activeCwd : null;
  const windowTitle = activeCwdName ? `${activeCwdName} - ${PRODUCT_NAME}` : PRODUCT_NAME;
  const topBarTitle = selectedSession
    ? selectedSession.name || selectedSession.firstMessage || "未命名教学任务"
    : showChat
      ? "新建教学任务"
      : PRODUCT_NAME;
  const topBarSubtitle = activeCwdName ? `教育工作区 · ${activeCwdName}` : "教师教学任务与材料协作";

  useEffect(() => {
    const syncWindowTitle = () => {
      if (document.title !== windowTitle) document.title = windowTitle;
    };

    syncWindowTitle();
    const observer = new MutationObserver(syncWindowTitle);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [windowTitle]);

  // Theme + collapse controls at the sidebar's own top-right (Claude Desktop
  // style). When the sidebar is closed, the topbar shows a reopen button.
  const sidebarHeaderControls = (
    <>
      <button
        className="sidebar-chrome-button"
        onClick={toggleTheme}
        title={isDark ? translate("theme.light") : translate("theme.dark")}
        aria-label={isDark ? translate("theme.light") : translate("theme.dark")}
        aria-pressed={isDark}
      >
        {isDark ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>
      <button
        className="sidebar-chrome-button"
        onClick={handleSidebarToggle}
        title={translate("sidebar.hide")}
        aria-label={translate("sidebar.hide")}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </button>
    </>
  );

  const sidebarFooterActions: SidebarFooterAction[] = [
    { id: "help-primary", label: "帮助", onClick: () => setFirstRunGuideOpen(true), disabled: false, icon: <span aria-hidden="true">?</span> },
    { id: "models", label: "模型设置", onClick: () => setModelsConfigOpen(true), disabled: false, icon: <span aria-hidden="true">⌘</span> },
    { id: "skills", label: "教学能力", onClick: () => setSkillsConfigOpen(true), disabled: !activeCwd && !selectedSession?.cwd && !newSessionCwd, icon: <span aria-hidden="true">◇</span> },
    { id: "plugins", label: "扩展管理", onClick: () => setPluginsConfigOpen(true), disabled: !activeCwd && !selectedSession?.cwd && !newSessionCwd, icon: <span aria-hidden="true">◌</span> },
    { id: "settings", label: "教师设置", onClick: () => setAppSettingsOpen(true), disabled: false, iconOnly: true, icon: <span aria-hidden="true">⚙</span> },
  ];

  const renderSessionSidebar = (presentation: "default" | "embedded-chat" = "default") => (
      <SessionSidebar
        selectedSessionId={selectedSession?.id ?? null}
        onSelectSession={presentation === "embedded-chat" ? handleEducationSelectSession : handleSelectSession}
        onNewSession={presentation === "embedded-chat" ? handleEducationNewSession : handleNewSession}
        initialSessionId={initialSessionId}
        skipInitialProjectSelection={initialNavigation.requestedCwd !== null}
        onInitialRestoreDone={handleInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onOpenFile={handleOpenFile}
        selectedFilePath={activeFileTab?.filePath ?? null}
        explorerRefreshKey={explorerRefreshKey}
        onAtMention={handleAtMention}
        onAtMentions={handleAtMentions}
        headerControls={presentation === "embedded-chat" ? undefined : sidebarHeaderControls}
        onOpenEduPiAdmin={openEducationModule}
        onOpenContext={() => openEducationModule("context")}
        presentation={presentation}
      />
  );

  const sidebarContent = (
    <>
      {renderSessionSidebar()}
      <div className="sidebar-footer" style={{ padding: "8px", flexShrink: 0, display: "flex", justifyContent: "space-between", gap: 4 }}>
        {sidebarFooterActions.map(({ id, label, onClick, disabled, iconOnly, icon }) => (
          <button
            key={id}
            onClick={onClick}
            disabled={disabled}
            title={label}
            aria-label={label}
            style={{
              flex: iconOnly ? "0 0 32px" : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              height: 32, padding: 0, background: "none", border: "none",
              borderRadius: 9, color: "var(--text-muted)", cursor: disabled ? "default" : "pointer",
              fontSize: 12, opacity: disabled ? 0.35 : 1,
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {icon}
            {!iconOnly && label}
          </button>
        ))}
      </div>
    </>
  );

  const edupiChatWindow = (
    <>
    {pendingReminderBinding ? <div role="alert">对话已保存，任务关联失败 <button type="button" className="native-button" onClick={() => void retryReminderBinding(pendingReminderBinding)}>重试关联</button></div> : null}
    <ChatWindow
      key={`edupi-chat-${sessionKey}`}
      session={selectedSession}
      newSessionCwd={effectiveNewSessionCwd}
      onAgentEnd={handleAgentEnd}
      onSessionCreated={handleEducationSessionCreated}
      onSessionForked={handleEducationSessionForked}
      modelsRefreshKey={modelsRefreshKey}
      chatInputRef={chatInputRef}
      onBranchDataChange={handleBranchDataChange}
      onSystemPromptChange={handleSystemPromptChange}
      onSessionStatsChange={handleSessionStatsChange}
      onSessionStatsPanelOpen={openSessionStatsPanel}
      onContextUsageChange={handleContextUsageChange}
      onEducationImportCompleted={handleEducationImportCompleted}
      onEduPiAction={handleEduPiAppAction}
      reminderText={reminderDraft?.taskId === searchParams.get("task") ? reminderDraft.text : undefined}
      reminderTitle={reminderDraft?.taskId === searchParams.get("task") ? reminderDraft.title : undefined}
      reminderDraftKey={!selectedSession && searchParams.get("task") && effectiveNewSessionCwd ? `reminder:${effectiveNewSessionCwd}:${searchParams.get("task")}` : undefined}
      onEduPiComputerAction={handleEduPiComputerAction}
      onOpenFile={handleOpenLinkedFile}
      onProjectFilesImported={handleProjectFilesImported}
      emptyTitle="新建对话"
      emptySubtitle="从教学任务、材料或课堂问题开始。"
    />
    </>
  );

  const edupiReminderPanel = <EduPiReminderInbox standalone onAction={handleEduPiAppAction} onContinue={continueReminder} onClose={closeReminderPanel} />;

  return (
    <>
    <style>{`
      @keyframes session-info-pop {
        from { opacity: 0; transform: translateY(-4px) scale(0.99); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .session-info-popover { position: relative; overflow: hidden; transform-origin: top right; animation: session-info-pop 160ms var(--ease-native) both; will-change: transform, opacity; }
      .session-info-popover::after { display: none; }
      @media (prefers-reduced-motion: reduce) { .session-info-popover, .session-info-popover::after { animation: none; } }
      @media (max-width: 640px) {
        .sidebar-overlay-backdrop.sidebar-mobile-pending { opacity: 0 !important; pointer-events: none !important; }
        .sidebar-container.sidebar-mobile-pending.sidebar-open { transform: translateX(calc(-100% - env(safe-area-inset-left))); box-shadow: none; }
      }
    `}</style>
    <div
      className="app-shell"
      inert={edupiAdminOpen ? true : undefined}
      aria-hidden={edupiAdminOpen ? true : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "var(--app-viewport-height, 100dvh)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
        overflow: "hidden",
        background: "var(--bg)",
      } as React.CSSProperties}
    >
      {connectionState === "offline" && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            flexShrink: 0,
            padding: "7px 12px",
            background: "color-mix(in srgb, var(--danger) 14%, var(--bg-panel))",
            borderBottom: "1px solid color-mix(in srgb, var(--danger) 35%, var(--border))",
            color: "var(--text)",
            fontSize: 12,
            zIndex: 300,
          }}
        >
          <span>{translate("connection.offline")}</span>
          <button
            type="button"
            onClick={retryConnection}
            style={{
              height: 24,
              padding: "0 10px",
              border: "1px solid var(--border)",
              borderRadius: 5,
              background: "var(--bg)",
              color: "var(--accent)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {translate("connection.retry")}
          </button>
        </div>
      )}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Mobile overlay backdrop */}
      <div
        className={`sidebar-overlay-backdrop${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
        onClick={() => setSidebarOpen(false)}
        style={{
          display: edupiEducationModule ? "none" : "block",
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,0.4)",
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Left sidebar */}
      <div
        ref={sidebarResizer.panelRef}
        id="session-sidebar"
        className={`app-sidebar sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}${sidebarResizer.isResizing ? " sidebar-resizing" : ""}`}
        style={{
          "--sidebar-width": `${sidebarResizer.width}px`,
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          display: edupiEducationModule ? "none" : "flex",
          flexDirection: "column",
          flexShrink: 0,
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          zIndex: 200,
        } as React.CSSProperties}
      >
        {edupiChatActive ? null : sidebarContent}
      </div>
      {!edupiEducationModule && sidebarOpen && (
        <div
          {...sidebarResizer.separatorProps}
          aria-controls="session-sidebar"
          className={`panel-resize-handle sidebar-resize-handle${sidebarResizer.isResizing ? " is-resizing" : ""}`}
          data-resize-handle="sidebar"
          title={`${translate("layout.resizeSidebar")}: ${translate("layout.resizeHint")}`}
        />
      )}

      {/* Center: chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Top bar with sidebar toggle */}
        <div
          ref={topBarRef}
          className={`app-topbar${desktopChrome.isMacOS && (!sidebarOpen || isMobile) ? " app-topbar--mac-inset" : ""}`}
          {...desktopChrome.dragRegionProps}
          style={{ display: edupiEducationModule ? "none" : "flex", alignItems: "center", flexShrink: 0, borderBottom: "1px solid var(--border)", height: "calc(36px + env(safe-area-inset-top))", paddingTop: "env(safe-area-inset-top)", background: "var(--bg-panel)" }}
        >
          {/* Sidebar reopen — only while the sidebar (and its own toggle) is hidden */}
          {!sidebarOpen && (
            <button
              className="native-icon-button"
              onClick={handleSidebarToggle}
              title={translate("sidebar.show")}
              aria-label={translate("sidebar.show")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0,
                background: "none", border: "none", borderRight: "1px solid var(--border)",
                color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
          )}
          <div className="app-topbar-title" title={topBarTitle}>
            <span>{topBarTitle}</span>
            <small>{topBarSubtitle}</small>
          </div>
          {showChat && projectTrust?.requiresTrust && !projectTrust.trusted && (
            <button
              type="button"
              onClick={() => {
                setProjectTrustError(null);
                setProjectTrustDialogOpen(true);
              }}
              title={translate("trust.resourcesNotLoaded")}
              aria-label={translate("trust.resourcesNotLoaded")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: "100%",
                padding: isMobile ? "0 10px" : "0 12px",
                background: "none",
                border: "none",
                borderRight: "1px solid var(--border)",
                color: "#d97706",
                cursor: "pointer",
                flexShrink: 0,
                fontSize: 11,
                whiteSpace: "nowrap",
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
              </svg>
              {!isMobile && <span>{translate("trust.resourcesNotLoaded")}</span>}
            </button>
          )}
          {showChat && (
            <div className="app-topbar-actions" style={{ display: "flex", alignItems: "stretch", height: "100%" }}>
              <button
                className="native-toolbar-button"
                onClick={handleViewFullHistory}
                disabled={!selectedSession}
                 title={selectedSession ? translate("history.full") : translate("history.unsaved")}
                 aria-label={translate("history.full")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: "100%",
                  padding: "0 12px",
                  background: "none",
                  border: "none",
                  borderTop: "2px solid transparent",
                  borderRight: "1px solid var(--border)",
                  color: selectedSession ? "var(--text-muted)" : "var(--text-dim)",
                  cursor: selectedSession ? "pointer" : "not-allowed",
                  opacity: selectedSession ? 1 : 0.45,
                  flexShrink: 0,
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  transition: "color 0.1s, background 0.1s, opacity 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!selectedSession) return;
                  e.currentTarget.style.color = "var(--text)";
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = selectedSession ? "var(--text-muted)" : "var(--text-dim)";
                  e.currentTarget.style.background = "none";
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    color: selectedSession ? "var(--text-muted)" : "var(--text-dim)",
                    flexShrink: 0,
                  }}
                >
                  <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M12 7v5l3 2" />
                </svg>
                 {!isMobile && <span>{translate("history.label")}</span>}
              </button>
              <BranchNavigator
                tree={branchTree}
                activeLeafId={branchActiveLeafId}
                onLeafChange={handleBranchLeafChange}
                inline
                compact={isMobile}
                containerRef={topBarRef}
                open={activeTopPanel === "branches"}
                onToggle={() => toggleTopPanel("branches")}
                hasSession
              />
              {(() => {
                const hasMessages = Boolean(
                  selectedSession
                  && (sessionStats?.userMessages ?? selectedSession.messageCount) > 0,
                );
                const nameDisabled = !selectedSession || !hasMessages || autoNameStatus.kind === "naming";
                const isSuccess = autoNameStatus.kind === "success";
                const isError = autoNameStatus.kind === "error";
                const nameLabel = autoNameStatus.kind === "naming"
                  ? translate("title.generating")
                  : isSuccess
                    ? translate("title.updated")
                    : isError
                      ? translate("title.failed")
                      : translate("title.generate");
                const nameDescription = !hasMessages
                  ? translate("appshell.afterFirstMessage")
                  : isError
                    ? autoNameStatus.message
                    : translate("title.generateSession");

                return (
                  <div className="app-topbar-more" ref={topMoreRef}>
                    <button
                      className="native-toolbar-button app-topbar-more-trigger"
                      type="button"
                      onClick={() => {
                        setActiveTopPanel(null);
                        setTopMoreOpen((open) => !open);
                      }}
                      title={translate("appshell.moreActions")}
                      aria-label={translate("appshell.moreActions")}
                      aria-expanded={topMoreOpen}
                      aria-haspopup="menu"
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        height: "100%", padding: "0 12px",
                        background: topMoreOpen ? "var(--bg-selected)" : "none",
                        border: "none",
                        borderTop: topMoreOpen ? "2px solid var(--accent)" : "2px solid transparent",
                        color: topMoreOpen ? "var(--text)" : "var(--text-muted)",
                        cursor: "pointer",
                        fontSize: 11, whiteSpace: "nowrap",
                        transition: "color 0.1s, background 0.1s",
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <circle cx="5" cy="12" r="1.65" />
                        <circle cx="12" cy="12" r="1.65" />
                        <circle cx="19" cy="12" r="1.65" />
                      </svg>
                      {!isMobile && <span>{translate("appshell.more")}</span>}
                    </button>
                    {topMoreOpen && (
                      <div className="native-popover app-topbar-more-menu" role="menu" aria-label={translate("appshell.moreActions")}>
                        <button
                          className="app-topbar-more-item"
                          type="button"
                          role="menuitem"
                          disabled={nameDisabled}
                          onClick={() => {
                            setTopMoreOpen(false);
                            void handleAutoName();
                          }}
                        >
                          <span
                            className="app-topbar-more-icon"
                            style={{
                              color: isError
                                ? "var(--danger)"
                                : isSuccess
                                  ? "var(--accent)"
                                  : nameDisabled
                                    ? "var(--text-dim)"
                                    : "var(--text-muted)",
                            }}
                          >
                            {autoNameStatus.kind === "naming" ? (
                              <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            ) : isSuccess ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="m15 4 5 5L7 22l-5-5Z" />
                                <path d="m14 5 5 5" />
                                <path d="M6 4V2M5 3H3M19 19v3M17.5 20.5h3" />
                              </svg>
                            )}
                          </span>
                          <span className="app-topbar-more-copy">
                            <span>{nameLabel}</span>
                            <small>{nameDescription}</small>
                          </span>
                        </button>
                        <button
                          className="app-topbar-more-item"
                          type="button"
                          role="menuitem"
                          onClick={() => toggleTopPanel("system")}
                        >
                          <span
                            className="app-topbar-more-icon"
                            style={{ color: systemPrompt !== null ? "var(--accent)" : "var(--text-muted)" }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                              <line x1="8" y1="13" x2="16" y2="13" />
                              <line x1="8" y1="17" x2="13" y2="17" />
                            </svg>
                          </span>
                          <span className="app-topbar-more-copy">
                            <span>{translate("system.prompt")}</span>
                            <small>{systemPrompt === null ? translate("appshell.systemLoads") : systemPrompt ? translate("appshell.viewInstructions") : translate("appshell.toolsDisabled")}</small>
                          </span>
                        </button>
                        {(() => {
                          const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
                          const t = sessionStats?.tokens;
                          const c = sessionStats?.cost ?? 0;
                          const parts: string[] = [];
                          if (t && t.input > 0) parts.push(`↑${fmt(t.input)}`);
                          if (t && t.output > 0) parts.push(`↓${fmt(t.output)}`);
                          if (c > 0) parts.push(c >= 0.01 ? `$${c.toFixed(2)}` : "<$0.01");
                          if (contextUsage?.contextWindow && contextUsage.percent !== null) {
                            parts.push(`${contextUsage.percent.toFixed(0)}% ctx`);
                          }
                          const summary = parts.length > 0 ? parts.join(" · ") : translate("appshell.statsHint");
                          return (
                            <button
                              className="app-topbar-more-item"
                              type="button"
                              role="menuitem"
                              disabled={!sessionStats && !contextUsage}
                              onClick={() => toggleTopPanel("session")}
                            >
                              <span
                                className="app-topbar-more-icon"
                                style={{ color: activeTopPanel === "session" ? "var(--accent)" : "var(--text-muted)" }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <line x1="18" y1="20" x2="18" y2="10" />
                                  <line x1="12" y1="20" x2="12" y2="4" />
                                  <line x1="6" y1="20" x2="6" y2="14" />
                                </svg>
                              </span>
                              <span className="app-topbar-more-copy">
                                <span>{translate("appshell.sessionStats")}</span>
                                <small>{summary}</small>
                              </span>
                            </button>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
          {/* Top panel dropdown — shared, only one active at a time */}
          {activeTopPanel && topPanelPos && (
            <div style={{
              position: "fixed",
              top: topPanelPos.top,
              left: topPanelPos.left,
              width: topPanelPos.width,
              maxHeight: `calc(100dvh - ${topPanelPos.top}px)`,
              overflowY: "auto",
              zIndex: 500,
            }}>
              {activeTopPanel === "system" && (
                <div style={{
                  background: "var(--surface-elevated)",
                  borderBottom: "1px solid var(--border)",
                }}>
                  {systemPrompt ? (
                    <div style={{
                      maxHeight: "min(600px, 75vh)",
                      overflowY: "auto",
                      padding: "12px 16px",
                      color: "var(--text-muted)",
                      fontSize: 12,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      fontFamily: "var(--font-mono)",
                    }}>
                      {systemPrompt}
                    </div>
                  ) : systemPrompt === "" ? (
                    <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                       {translate("system.empty")}
                    </div>
                  ) : (
                    <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                       {translate("system.load")}
                    </div>
                  )}
                </div>
              )}
              {activeTopPanel === "session" && (
                <div className="session-info-popover" style={{
                  background: "var(--surface-elevated)",
                  borderBottom: "1px solid var(--border)",
                  boxShadow: "var(--shadow-popover)",
                  padding: "12px 16px",
                }}>
                  {sessionStats ? (() => {
                    const sessionRows = [
                       ...(sessionStats.sessionName ? [{ label: translate("session.name"), value: sessionStats.sessionName, copyField: null }] : []),
                       { label: translate("session.file"), value: sessionStats.sessionFile ?? translate("session.inMemory"), copyField: "file" as const },
                       { label: translate("session.id"), value: sessionStats.sessionId, copyField: "id" as const },
                    ];
                    const messageRows = [
                       [translate("session.user"), sessionStats.userMessages.toLocaleString(locale)],
                       [translate("session.assistant"), sessionStats.assistantMessages.toLocaleString(locale)],
                       [translate("session.toolCalls"), sessionStats.toolCalls.toLocaleString(locale)],
                       [translate("session.toolResults"), sessionStats.toolResults.toLocaleString(locale)],
                       [translate("session.total"), sessionStats.totalMessages.toLocaleString(locale)],
                    ];
                    const tokenRows = [
                       [translate("session.input"), sessionStats.tokens.input.toLocaleString(locale)],
                       [translate("session.output"), sessionStats.tokens.output.toLocaleString(locale)],
                       ...(sessionStats.tokens.cacheRead > 0 ? [[translate("session.cacheRead"), sessionStats.tokens.cacheRead.toLocaleString(locale)]] : []),
                       ...(sessionStats.tokens.cacheWrite > 0 ? [[translate("session.cacheWrite"), sessionStats.tokens.cacheWrite.toLocaleString(locale)]] : []),
                       [translate("session.total"), sessionStats.tokens.total.toLocaleString(locale)],
                    ];
                    const ctx = contextUsage ?? sessionStats.contextUsage;
                    const formatCompact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
                    const extraTokenRows = [
                       ...(sessionStats.cost > 0 ? [[translate("session.cost"), `$${sessionStats.cost.toFixed(4)}`]] : []),
                       ...(ctx?.contextWindow ? [[translate("session.context"), `${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompact(ctx.contextWindow)}`]] : []),
                    ];
                    const section = (
                      title: string,
                      sectionRows: string[][],
                      valueAlign: "left" | "right" = "left",
                      compact = false,
                    ) => (
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{title}</div>
                          <div style={{
                            display: "grid",
                            gridTemplateColumns: compact ? "max-content max-content" : "auto minmax(0, 1fr)",
                            columnGap: compact ? 14 : 12,
                            rowGap: 4,
                            justifyContent: compact ? "start" : undefined,
                          }}>
                            {sectionRows.map(([label, value]) => (
                              <div key={`${title}:${label}`} style={{ display: "contents" }}>
                                <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{label}</div>
                                <div style={{
                                  color: "var(--text-muted)",
                                  minWidth: 0,
                                  overflowWrap: compact ? "normal" : "anywhere",
                                  textAlign: valueAlign,
                                  whiteSpace: valueAlign === "right" ? "nowrap" : "normal",
                                }}>{value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    const copyButton = (field: SessionCopyField, value: string) => {
                      const copied = copiedSessionField === field;
                      return (
                        <button
                          type="button"
                           title={copied ? translate("session.copied") : translate(field === "file" ? "session.copyFile" : "session.copyId")}
                          onClick={() => handleCopySessionField(field, value)}
                          style={{
                            alignSelf: "start",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 22,
                            height: 22,
                            marginTop: -2,
                            color: copied ? "var(--accent)" : "var(--text-dim)",
                            background: "transparent",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            cursor: "pointer",
                            flex: "0 0 auto",
                            transition: "color 0.12s, border-color 0.12s, background 0.12s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = "var(--accent)";
                            e.currentTarget.style.borderColor = "var(--accent)";
                            e.currentTarget.style.background = "var(--bg-hover)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = copied ? "var(--accent)" : "var(--text-dim)";
                            e.currentTarget.style.borderColor = "var(--border)";
                            e.currentTarget.style.background = "transparent";
                          }}
                        >
                          {copied ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          )}
                        </button>
                      );
                    };
                    const sessionInfoSection = (
                      <div style={{ minWidth: 0 }}>
                         <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{translate("session.infoSection")}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", columnGap: 12, rowGap: 8, alignItems: "start" }}>
                          {sessionRows.map((row) => (
                            <div key={`session-info:${row.label}`} style={{ display: "contents" }}>
                              <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{row.label}</div>
                              <div style={{
                                color: "var(--text-muted)",
                                minWidth: 0,
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                                whiteSpace: "normal",
                              }}>{row.value}</div>
                              <div>{row.copyField ? copyButton(row.copyField, row.value) : null}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );

                    return (
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: isMobile
                          ? "1fr"
                          : "minmax(360px, 1.7fr) minmax(140px, 0.55fr) minmax(190px, 0.75fr)",
                        gap: isMobile ? 16 : 24,
                        fontSize: 12,
                        lineHeight: 1.5,
                        fontFamily: "var(--font-mono)",
                      }}>
                        {sessionInfoSection}
                         {section(translate("session.messages"), messageRows)}
                         {section(translate("session.tokens"), [...tokenRows, ...extraTokenRows], "right", true)}
                      </div>
                    );
                  })() : (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                       {translate("session.load")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <WindowControls />
        </div>

        {/* Chat content */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {edupiEducationModule ? (
            <EduPiEducationPanel
              initialModule={edupiEducationModule}
              activeAgentSessionId={selectedSession?.id ?? null}
              onActivateAgentSession={handleActivateEducationAgentSession}
              onOpenAdmin={() => openEduPiAdmin()}
              onOpenGuide={() => setFirstRunGuideOpen(true)}
              onPrepareAgentPrompt={(prompt) => chatInputRef.current?.insertText(`${prompt}\n`)}
              onReplaceAgentPrompt={(prompt) => chatInputRef.current?.replaceText(prompt)}
              quickEntryOpen={quickEntryOpen}
              onCloseQuickEntry={() => setQuickEntryOpen(false)}
              onFocusAgentChat={focusEducationChat}
              refreshKey={educationRefreshKey}
              chatPanel={edupiChatWindow}
              reminderPanel={edupiReminderPanel}
              chatSidebar={renderSessionSidebar("embedded-chat")}
              renderFilePreview={(filePath) => (
                <FileViewer
                  filePath={filePath}
                  cwd={activeCwd ?? undefined}
                  sourceSessionId={selectedSession?.id ?? null}
                  gitRefreshKey={explorerRefreshKey}
                  onOpenFile={(nextPath: string) => handleOpenFile(nextPath, getFileName(nextPath), { sourceSessionId: selectedSession?.id ?? null })}
                />
              )}
            />
          ) : null}
          {!edupiEducationModule && showChat ? (
            <ChatWindow
              key={sessionKey}
              session={selectedSession}
              newSessionCwd={effectiveNewSessionCwd}
              onAgentEnd={handleAgentEnd}
              onSessionCreated={handleSessionCreated}
              onSessionForked={handleSessionForked}
              modelsRefreshKey={modelsRefreshKey}
              chatInputRef={chatInputRef}
              onBranchDataChange={handleBranchDataChange}
              onSystemPromptChange={handleSystemPromptChange}
              onSessionStatsChange={handleSessionStatsChange}
              onSessionStatsPanelOpen={openSessionStatsPanel}
              onContextUsageChange={handleContextUsageChange}
              onEducationImportCompleted={handleEducationImportCompleted}
              onEduPiAction={handleEduPiAppAction}
              reminderText={reminderDraft?.taskId === searchParams.get("task") ? reminderDraft.text : undefined}
              reminderTitle={reminderDraft?.taskId === searchParams.get("task") ? reminderDraft.title : undefined}
              reminderDraftKey={!selectedSession && searchParams.get("task") && effectiveNewSessionCwd ? `reminder:${effectiveNewSessionCwd}:${searchParams.get("task")}` : undefined}
              onEduPiComputerAction={handleEduPiComputerAction}
              onOpenFile={handleOpenLinkedFile}
              onProjectFilesImported={handleProjectFilesImported}
            />
          ) : !edupiEducationModule && initialCwdStatus === "validating" ? (
            <div
              role="status"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
            >
               <div style={{ fontSize: 14, color: "var(--text)" }}>{translate("workspace.opening")}</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {initialNavigation.requestedCwd}
              </div>
            </div>
          ) : !edupiEducationModule && initialCwdStatus === "error" ? (
            <div
              role="alert"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
            >
               <div style={{ fontSize: 14, color: "#dc2626" }}>{translate("workspace.unable")}</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {initialNavigation.requestedCwd}
              </div>
              <div style={{ maxWidth: 720, fontSize: 12 }}>{initialCwdError}</div>
            </div>
          ) : !edupiEducationModule && showPlaceholder ? (
            activeCwd ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 15 }}>
                 {translate("workspace.selectSession")}
              </div>
            ) : (
              <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "flex-start", gap: 8, userSelect: "none", pointerEvents: "none" }}>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, flexShrink: 0 }}>
                  <line x1="20" y1="12" x2="4" y2="12" /><polyline points="10 6 4 12 10 18" />
                </svg>
                <div>
                   <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>{translate("workspace.getStarted")}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
                     <span style={{ color: "var(--text-dim)", marginRight: 6 }}>1.</span>{translate("workspace.selectProject")}<br />
                     <span style={{ color: "var(--text-dim)", marginRight: 6 }}>2.</span>{translate("workspace.addModels")}
                  </div>
                </div>
              </div>
            )
          ) : null}
        </div>
      </div>

      <div
        aria-hidden="true"
        className={`right-panel-overlay-backdrop${rightPanelOpen ? " is-open" : ""}`}
        onClick={() => setRightPanelOpen(false)}
        style={{ display: edupiEducationModule ? "none" : undefined }}
      />
      {!edupiEducationModule && rightPanelOpen && (
        <div
          {...rightPanelResizer.separatorProps}
          aria-controls="file-panel"
          className={`panel-resize-handle right-panel-resize-handle${rightPanelResizer.isResizing ? " is-resizing" : ""}`}
          data-resize-handle="right-panel"
          title={`${translate("layout.resizeFilePanel")}: ${translate("layout.resizeHint")}`}
        />
      )}

      {/* Right panel: file viewer — always mounted, width animated via CSS */}
      <div
        ref={rightPanelResizer.panelRef}
        id="file-panel"
        className={`right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}${rightPanelResizer.isResizing ? " right-panel-resizing" : ""}`}
        style={{
          "--right-panel-width": `${rightPanelResizer.width}px`,
          display: edupiEducationModule ? "none" : "flex",
          flexDirection: "column",
          borderLeft: "1px solid var(--border)",
          background: "var(--bg)",
        } as React.CSSProperties}
      >
        {/* Right panel tab bar */}
        <div className="right-panel-tab-strip" style={{ height: "calc(36px + env(safe-area-inset-top))", paddingTop: "env(safe-area-inset-top)" }}>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <TabBar
              tabs={fileTabs}
              activeTabId={activeFileTabId ?? ""}
              onSelectTab={setActiveFileTabId}
              onCloseTab={handleCloseFileTab}
            />
          </div>
          {/* Panel close — only shown while the file panel is open */}
          <button
            className="right-panel-close"
            onClick={() => setRightPanelOpen(false)}
            title={translate("files.hidePanel")}
            aria-label={translate("files.hidePanel")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>
        </div>

        {/* File content */}
        <div style={{ flex: 1, overflow: "hidden", paddingBottom: "env(safe-area-inset-bottom)" }}>
          {activeFileTab?.filePath ? (
            <FileViewer
              filePath={activeFileTab.filePath}
              cwd={activeCwd ?? undefined}
              sourceSessionId={activeFileTab.sourceSessionId}
              gitRefreshKey={explorerRefreshKey}
              initialDisplayMode={activeFileTab.initialDisplayMode}
              onMentionLines={rightPanelOpen ? handleFileLineMention : undefined}
              onOpenFile={(filePath: string) => handleOpenFile(
                filePath,
                getFileName(filePath),
                { sourceSessionId: activeFileTab.sourceSessionId },
              )}
            />
          ) : (
            <div className="file-panel-empty-state">
              <span className="file-panel-empty-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z" />
                </svg>
              </span>
              <strong>{translate("files.noneOpen")}</strong>
              <span>{translate("files.choosePreview")}</span>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
    {modelsConfigOpen && <ModelsConfig onClose={() => { setModelsConfigOpen(false); setModelsRefreshKey((k) => k + 1); }} />}
    {projectTrustDialogOpen && projectTrustCwd && (
      <ProjectTrustDialog
        cwd={projectTrustCwd}
        busy={projectTrustBusy}
        error={projectTrustError}
        onCancel={() => {
          if (!projectTrustBusy) setProjectTrustDialogOpen(false);
        }}
        onConfirm={() => void handleTrustProject()}
      />
    )}
    {skillsConfigOpen && projectTrustCwd && (
      <SkillsConfig cwd={projectTrustCwd} onClose={() => setSkillsConfigOpen(false)} />
    )}
    {pluginsConfigOpen && projectTrustCwd && (
      <PluginsConfig
        cwd={projectTrustCwd}
        sessionId={selectedSession?.id ?? null}
        onClose={() => setPluginsConfigOpen(false)}
        onReloaded={() => setSessionKey((k) => k + 1)}
      />
    )}
    {appSettingsOpen && <AppSettings onClose={() => setAppSettingsOpen(false)} />}
    {edupiAdminOpen && <EduPiAdminPanel
      refreshToken={modelsRefreshKey}
      initialSection={edupiAdminSection}
      modelSettingsDirty={adminModelsDirty}
      modelsPanel={<ModelsConfig
        embedded
        onClose={() => setAdminModelsDirty(false)}
        onDirtyChange={setAdminModelsDirty}
        onSaved={() => setModelsRefreshKey((k) => k + 1)}
      />}
      onClose={() => setEduPiAdminOpen(false)}
      onOpenContext={() => { setEduPiAdminOpen(false); openEducationModule("context"); }}
      onAskStudentUpdate={askEduPiToUpdateStudents}
      onNavigate={openEducationView}
      onOpenSettings={() => { setEduPiAdminOpen(false); setAppSettingsOpen(true); }}
    />}
    {firstRunGuideOpen && (
      <EduPiFirstRunGuide
        onOpenModels={() => openEduPiAdmin("models")}
        onOpenContext={() => { setEduPiAdminOpen(false); openEducationModule("context"); }}
        onOpenCalendar={() => openEducationView("calendar")}
        onOpenMaterials={() => openEducationView("materials")}
        onOpenStudents={() => openEducationView("students")}
        onOpenTeaching={() => openEducationView("teaching")}
        onEnterToday={() => openEducationModule("home")}
        onComplete={finishFirstRunGuide}
        onSkip={finishFirstRunGuide}
      />
    )}
    <UpdateReminder onOpenSettings={() => setAppSettingsOpen(true)} />
    </>
  );
}
