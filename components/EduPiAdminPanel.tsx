"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { EducationContract, EducationEntityDeleteKind } from "@/lib/edupi-education-contract";
import type { OnboardingChecklistItem, TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import type { WorkbenchView } from "@/lib/edupi-workbench";
import type { EduPiWorkspaceBundle } from "@/lib/edupi-education-client";
import { APP_VERSION_DISPLAY } from "@/lib/branding";
import { useDesktopChrome, WindowControls } from "./desktop";
import { CONNECTOR_SETUP_IDS, EduPiConnectorSetup } from "./EduPiConnectorSetup";
import { EduPiBackgroundJobs } from "./EduPiBackgroundJobs";
import { startWindowDragging } from "@/lib/desktop-window";
import { formatCoreSchedulerStatus } from "@/lib/edupi-schedule-display";
import { coreExecutionReadinessLabel, type CoreRuntimeHealth, type CoreRuntimeScheduler } from "@/lib/edupi-runtime-health";
import { EduPiCoreCompatibility, type CoreCompatibilitySnapshot } from "./EduPiCoreCompatibility";
import { reconnectEduPiCore, repairEduPiCore } from "@/lib/edupi-runtime-client";
import { kernelRunAction, kernelRunDetail, kernelRunTitle, type KernelRunDisplayInput } from "@/lib/edupi-kernel-display";
import { EduPiDeletedEntities } from "./EduPiDeletedEntities";
import { readEducationEntityDeletions, restoreEducationEntity } from "@/lib/edupi-entity-delete-client";
import { EduPiProactivityCanary } from "./EduPiProactivityCanary";
import { JevSettingsCard } from "./JevSettingsCard";
import { OpenConnectorCatalogCard } from "./OpenConnectorCatalogCard";

type AdminSnapshot = {
  context: TeacherContextSnapshot | null;
  education: EducationContract | null;
  status: {
    core?: { status?: string; reason?: string | null; lifecycle?: string; coreCommit?: string; validationMode?: string; componentManifestHash?: string; runtimeComponentManifestHash?: string; contractVersion?: string; schemaHash?: string; fixtureManifestHash?: string; supportedCommands?: string[]; supportedProjections?: string[]; capabilities?: CoreRuntimeHealth["capabilities"]; scheduler?: CoreRuntimeScheduler | null };
    projection?: { status?: string; reason?: string | null };
    kernel?: {
      status?: string;
      reason?: string | null;
      summary?: { total?: number; running?: number; failed?: number; needs_review?: number; succeeded?: number; skipped?: number };
      runs?: Array<KernelRunDisplayInput & { run_id?: string; updated_at?: string }>;
    };
    proactivity?: {
      status?: "active" | "disabled" | "unavailable";
      attentionDelivery?: boolean;
      teacherFeedback?: boolean;
      currentAttentionDeliveries?: number;
      externalSend?: boolean;
    };
  } | null;
  compatibility?: CoreCompatibilitySnapshot | null;
  models: { modelList?: Array<{ id: string; provider: string }>; defaultModel?: { provider: string; modelId: string } | null } | null;
  platform: {
    status?: "ready" | "partial" | "unavailable";
    teachingSkills?: { mutation_enabled?: boolean; summary?: Record<string, number>; skills?: Array<{ skill_id?: string; title?: string; lifecycle_state?: string; trial_count?: number; can_reuse?: boolean }> } | null;
    connectors?: { connectors?: Array<{ connector_id?: string; label?: string; status?: string; capabilities?: string[] }> } | null;
    agentComputer?: { summary?: Record<string, number>; jobs?: Array<{ job_id?: string; title?: string; job_type?: string; status?: string }> } | null;
    platform?: { tenant_count?: number; multi_harness_ready?: boolean; tenants?: Array<{ tenant_id?: string; label?: string; core_mode?: string; device_count?: number; harness_count?: number }> } | null;
  } | null;
};

export type AdminSectionId = "readiness" | "automation" | "workspace" | "teachingSkills" | "connections" | "platform" | "models" | "people" | "calendar" | "materials" | "tasks" | "deleted" | "system";

type Props = {
  onClose: () => void;
  onOpenContext: () => void;
  onAskStudentUpdate: () => void;
  onNavigate: (view: WorkbenchView) => void;
  onOpenSettings: () => void;
  modelSettingsDirty: boolean;
  modelsPanel: ReactNode;
  initialSection?: AdminSectionId;
  refreshToken?: number;
};

export const ADMIN_SECTIONS: Array<{ id: AdminSectionId; label: string }> = [
  { id: "readiness", label: "概览" },
  { id: "automation", label: "自动运行" },
  { id: "workspace", label: "工作与资源" },
  { id: "connections", label: "连接" },
  { id: "models", label: "AI 与模型" },
  { id: "system", label: "系统" },
  { id: "deleted", label: "回收站" },
];

function visibleSection(section: AdminSectionId): AdminSectionId {
  return (["teachingSkills", "platform", "people", "calendar", "materials", "tasks"] as AdminSectionId[]).includes(section) ? "workspace" : section;
}

const FALLBACK_CHECKLIST: OnboardingChecklistItem[] = [
  { id: "identity", label: "告诉 EduPi 你是谁", status: "next", description: "称呼、学科、年级和工作身份" },
  { id: "calendar", label: "导入本学期校历", status: "optional", description: "考试、放假、会议和学校活动" },
  { id: "timetable", label: "补充课程与周节奏", status: "optional", description: "让今日工作按真实节奏出现" },
  { id: "roster", label: "导入班级名单（可选）", status: "optional", description: "先有名字即可" },
  { id: "material", label: "放入第一份真实材料", status: "optional", description: "作业、错题或课堂记录" },
];
const connectorSetupIds = new Set<string>(CONNECTOR_SETUP_IDS);
function connectorStatusLabel(status: string | undefined): string {
  if (status === "connected" || status === "conversation_verified") return "已连接";
  if (status === "configured") return "已配置";
  if (status === "credentials_verified") return "凭据已验证";
  return "未接入";
}

function systemStatusLabel(status: string | undefined): string {
  if (status === "ready") return "已就绪";
  if (status === "starting") return "启动中";
  if (status === "degraded") return "需要检查";
  if (status === "draining") return "正在停止";
  if (status === "failed") return "启动失败";
  if (status === "stopped") return "已停止";
  return "不可用";
}

async function readJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    return response.ok ? await response.json() as T : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    return null;
  }
}

function AdminSectionHeader({ title, meta, onRefresh }: { title: string; meta?: string; onRefresh?: () => void }) {
  return <header className="edupi-admin-section__header">
    <h1>{title}</h1>
    {meta || onRefresh ? <div>{meta ? <small>{meta}</small> : null}{onRefresh ? <button type="button" onClick={onRefresh}>刷新状态</button> : null}</div> : null}
  </header>;
}

function AdminMetric({ value, label }: { value: string | number; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

export function EduPiAdminPanel({ onClose, onOpenContext, onAskStudentUpdate, onNavigate, onOpenSettings, modelSettingsDirty, modelsPanel, initialSection = "readiness", refreshToken = 0 }: Props) {
  const desktopChrome = useDesktopChrome();
  const [activeSection, setActiveSection] = useState<AdminSectionId>(() => visibleSection(initialSection));
  const [modelsMounted, setModelsMounted] = useState(false);
  const [snapshot, setSnapshot] = useState<AdminSnapshot>({ context: null, education: null, status: null, compatibility: null, models: null, platform: null });
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [coreReconnecting, setCoreReconnecting] = useState(false);
  const [coreReconnectMessage, setCoreReconnectMessage] = useState<string | null>(null);
  const [coreRepairing, setCoreRepairing] = useState(false);
  const [selectedConnector, setSelectedConnector] = useState<string | null>(null);
  const firstNavRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstNavRef.current?.focus();
    return () => {
      const previous = previousFocusRef.current;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (activeSection === "models") setModelsMounted(true);
    workspaceRef.current?.scrollTo({ top: 0 });
  }, [activeSection]);

  useEffect(() => {
    setActiveSection(visibleSection(initialSection));
  }, [initialSection]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      const [bundle, status, platform] = await Promise.all([
        readJson<EduPiWorkspaceBundle>("/api/edupi/workspace", controller.signal),
        readJson<AdminSnapshot["status"] & { compatibility?: CoreCompatibilitySnapshot }>("/api/edupi/status", controller.signal),
        readJson<AdminSnapshot["platform"]>("/api/edupi/platform", controller.signal),
      ]);
      const context = bundle?.context ?? null;
      const education = bundle?.data ?? null;
      const models = await readJson<AdminSnapshot["models"]>(education?.workspace ? `/api/models?cwd=${encodeURIComponent(education.workspace)}` : "/api/models", controller.signal)
        || await readJson<AdminSnapshot["models"]>("/api/models", controller.signal);
      if (!controller.signal.aborted) setSnapshot({ context, education, status, compatibility: status?.compatibility || null, models, platform });
    })().finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshKey, refreshToken]);

  const checklist = useMemo(() => snapshot.context?.checklist ?? FALLBACK_CHECKLIST, [snapshot.context?.checklist]);
  const coreConnected = snapshot.status?.core?.status === "ready";
  const projectionConnected = snapshot.status?.projection?.status === "ready";
  const coreReady = coreConnected && projectionConnected;
  const modelReady = Boolean(snapshot.models?.defaultModel && (snapshot.models.modelList?.length || 0) > 0);
  const allSourcesLoaded = Boolean(snapshot.context && snapshot.education && snapshot.status);
  const readiness = useMemo(() => [
    { id: "core", label: "Core 与教育投影", complete: coreReady, action: () => setActiveSection("system") },
    { id: "model", label: "默认模型", complete: modelReady, action: () => setActiveSection("models") },
    ...checklist.map((item) => ({
      id: item.id,
      label: item.label,
      complete: item.status === "complete",
      action: () => setActiveSection("workspace"),
    })),
  ], [checklist, coreReady, modelReady]);
  const completeCount = readiness.filter((item) => item.complete).length;
  const education = snapshot.education;
  const kernel = snapshot.status?.kernel;
  const kernelSummary = kernel?.summary;
  const kernelRuns = kernel?.runs ?? [];
  const automationStatus = kernel?.reason
    || (!coreConnected ? snapshot.status?.core?.reason || systemStatusLabel(snapshot.status?.core?.status) : null)
    || (kernel?.status === "ready" ? coreExecutionReadinessLabel(snapshot.status?.core?.capabilities) : systemStatusLabel(kernel?.status));
  const defaultModel = snapshot.models?.defaultModel;
  const refresh = () => setRefreshKey((value) => value + 1);
  const restoreDeletedEntity = useCallback(async (kind: EducationEntityDeleteKind, id: string, restoreRequestId: string): Promise<void> => {
    const result = await restoreEducationEntity(kind, id, restoreRequestId);
    setSnapshot((current) => ({ ...current, education: result.data }));
    window.dispatchEvent(new Event("edupi-education-refresh"));
  }, []);
  const reconnectCore = async () => {
    if (coreReconnecting) return;
    setCoreReconnecting(true);
    setCoreReconnectMessage(null);
    try {
      await reconnectEduPiCore();
      setCoreReconnectMessage("Core 已重新连接");
      refresh();
    } catch (error) {
      setCoreReconnectMessage(error instanceof Error ? error.message : "Core 重新连接失败");
    } finally {
      setCoreReconnecting(false);
    }
  };
  const repairCore = async () => {
    if (coreRepairing || !window.confirm("只修复 Core Runtime 状态库，教师记忆、校历和课表不会改动。继续？")) return;
    setCoreRepairing(true);
    setCoreReconnectMessage(null);
    try {
      await repairEduPiCore();
      setCoreReconnectMessage("Core Runtime 已修复并重新连接");
      refresh();
    } catch (error) {
      setCoreReconnectMessage(error instanceof Error ? error.message : "Core Runtime 修复失败");
    } finally {
      setCoreRepairing(false);
    }
  };
  const leaveAdmin = (action: () => void) => {
    if (modelSettingsDirty && !window.confirm("AI 模型设置尚未保存，仍要离开后台吗？")) return;
    action();
  };

  return <section className={`edupi-admin-panel${desktopChrome.isDesktop ? " has-desktop-drag-region" : ""}`} aria-label="EduPi 管理中心">
    {desktopChrome.isDesktop ? <div className="edupi-window-drag-region" {...desktopChrome.dragRegionProps} onMouseDown={(event) => { if (event.button === 0 && event.target === event.currentTarget) void startWindowDragging(); }}><WindowControls /></div> : null}
    <aside className="edupi-admin-sidebar">
      <header><span className="edupi-admin-sidebar__mark" aria-hidden="true">π</span><strong>EduPi</strong></header>
      <nav aria-label="后台管理">
        {ADMIN_SECTIONS.map((section) => <button
          type="button"
          key={section.id}
          ref={section.id === "readiness" ? firstNavRef : undefined}
          aria-current={activeSection === section.id ? "page" : undefined}
          onClick={() => setActiveSection(section.id)}
        ><span aria-hidden="true" />{section.label}</button>)}
      </nav>
      <button className="edupi-admin-sidebar__back" type="button" onClick={() => leaveAdmin(onClose)}><span aria-hidden="true">←</span>返回工作台</button>
    </aside>

    <main ref={workspaceRef} className="edupi-admin-workspace" aria-busy={loading || undefined}>
      {activeSection === "readiness" ? <section className="edupi-admin-section">
        <AdminSectionHeader title="概览" meta={`${completeCount}/${readiness.length} 项就绪`} onRefresh={refresh} />
        <section className="edupi-admin-readiness" aria-labelledby="edupi-admin-readiness-title">
          <header><div><span>上线就绪</span><h2 id="edupi-admin-readiness-title">{loading ? "正在读取" : !allSourcesLoaded ? "数据读取失败" : completeCount === readiness.length ? "已经准备好" : "还需要补充"}</h2></div><strong>{Math.round((completeCount / Math.max(1, readiness.length)) * 100)}%</strong></header>
          <div className="edupi-admin-readiness__bar" aria-hidden="true"><span style={{ width: `${readiness.length ? (completeCount / readiness.length) * 100 : 0}%` }} /></div>
          <div className="edupi-admin-readiness__items">{readiness.map((item) => <button type="button" key={item.id} onClick={item.action}><i className={item.complete ? "is-complete" : ""} aria-hidden="true">{item.complete ? "✓" : "·"}</i><span>{item.label}</span><em>{item.complete ? "完成" : "去设置"}</em></button>)}</div>
        </section>
      </section> : null}

      {activeSection === "automation" ? <section className="edupi-admin-section">
        <AdminSectionHeader title="自动运行" meta={snapshot.status?.core?.status === "ready" ? formatCoreSchedulerStatus(snapshot.status.core.scheduler, kernelRuns.length) : snapshot.status?.core?.reason || "运行状态不可用"} onRefresh={refresh} />
        <div className="edupi-admin-metrics"><AdminMetric value={kernelSummary?.running ?? "—"} label="运行中" /><AdminMetric value={kernelSummary?.needs_review ?? "—"} label="待确认" /><AdminMetric value={kernelSummary?.succeeded ?? "—"} label="已完成" /></div>
        <div className="edupi-admin-metrics"><AdminMetric value={snapshot.status?.proactivity?.status === "active" ? "主动" : snapshot.status?.proactivity?.status === "disabled" ? "按需" : "不可用"} label="主动运行" /><AdminMetric value={snapshot.status?.proactivity?.currentAttentionDeliveries ?? "—"} label="待交付" /><AdminMetric value={snapshot.status?.proactivity?.teacherFeedback ? "可记录" : "未启用"} label="教师反馈" /></div>
        <EduPiProactivityCanary feedbackEnabled={snapshot.status?.proactivity?.teacherFeedback === true} onChanged={refresh} />
        <div className="edupi-admin-runtime" role="list" aria-label="最近自动运行">
          {kernelRuns.length > 0 ? kernelRuns.slice(0, 12).map((run) => {
            const action = kernelRunAction(run);
            return <div role="listitem" key={run.run_id}>
              <i className={`is-${run.status || "unknown"}`} aria-hidden="true" />
              <span><strong>{kernelRunTitle(run, education?.tasks || [])}</strong><small>{kernelRunDetail(run)}</small></span>
              {action ? <button type="button" onClick={() => { const target = action.target; if (target === "models") setActiveSection("models"); else leaveAdmin(() => onNavigate(target)); }}>{action.label}</button> : <em>{run.status === "running" || run.status === "awaiting_delivery" ? "运行中" : run.status === "needs_review" ? "待确认" : run.status === "failed" ? "失败" : run.status === "succeeded" ? "完成" : "无内容"}</em>}
              {run.updated_at ? <time dateTime={run.updated_at}>{new Date(run.updated_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time> : null}
            </div>;
          }) : <div className="is-empty" role="status">还没有运行记录</div>}
        </div>
        <EduPiBackgroundJobs data={snapshot.education} onMaterials={() => onNavigate("materials")} onModels={() => setActiveSection("models")} />
      </section> : null}

      {activeSection === "workspace" ? <section className="edupi-admin-section">
        <AdminSectionHeader title="工作与资源" onRefresh={refresh} />
        <div className="edupi-admin-work-grid">
          <article>
            <h2>任务与产物</h2>
            <strong>{education?.tasks.length ?? "—"}</strong><span>教师任务 · {education?.tasks.filter((task) => task.requiresTeacherReview).length ?? "—"} 项待确认</span>
            <button className="edupi-admin-primary" type="button" onClick={() => leaveAdmin(() => onNavigate("workspace"))}>打开任务工作区</button>
          </article>
          <article>
            <h2>上传内容</h2>
            <strong>{education?.intakeTargets.length ?? "—"}</strong><span>已接入内容</span>
            <button type="button" onClick={() => leaveAdmin(() => onNavigate("materials"))}>打开材料</button>
          </article>
          <article>
            <h2>教学能力</h2>
            <strong>{snapshot.platform ? snapshot.platform.teachingSkills?.summary?.published ?? 0 : "—"}</strong><span>已发布 · {snapshot.platform?.teachingSkills?.summary?.trial ?? "—"} 试用 · {snapshot.platform?.teachingSkills?.summary?.validated ?? "—"} 已验证</span>
            <small>{snapshot.platform?.teachingSkills?.mutation_enabled ? "可编辑" : "只读"}</small>
            {snapshot.platform?.teachingSkills?.skills?.length ? <details className="edupi-admin-work-details"><summary>查看教学能力 {snapshot.platform.teachingSkills.skills.length}</summary><ul>{snapshot.platform.teachingSkills.skills.slice(0, 20).map((skill) => <li key={skill.skill_id}><strong>{skill.title || "教学方法"}</strong><span>{({ draft: "草稿", trial: "试用中", validated: "已验证", published: "已发布", retired: "已停用" } as Record<string, string>)[skill.lifecycle_state || "draft"] || "未知状态"} · {skill.trial_count || 0} 次试用{skill.can_reuse ? " · 可复用" : ""}</span></li>)}</ul>{snapshot.platform.teachingSkills.skills.length > 20 ? <small>仅显示前 20 项</small> : null}</details> : <small>暂无候选</small>}
          </article>
          <article>
            <h2>教师与学生</h2>
            <strong>{education?.students.length ?? "—"}</strong><span>学生档案</span>
            <div className="edupi-admin-work-actions"><button type="button" onClick={() => leaveAdmin(() => onNavigate("students"))}>打开班级</button><button type="button" onClick={() => leaveAdmin(onOpenContext)}>教师信息</button></div>
          </article>
          <article>
            <h2>校历与课表</h2>
            <strong>{education?.calendar.length ?? "—"}</strong><span>校历节点 · {education?.timetable.length ?? "—"} 条课表</span>
            <button type="button" onClick={() => leaveAdmin(() => onNavigate("calendar"))}>打开日程</button>
          </article>
          <article>
            <h2>学校平台</h2>
            <strong>{snapshot.platform ? snapshot.platform.platform?.tenant_count ?? 0 : "—"}</strong><span>学校租户 · {snapshot.platform?.platform?.tenants?.reduce((sum, item) => sum + (item.device_count || 0), 0) ?? "—"} 台设备 · {snapshot.platform?.platform?.tenants?.reduce((sum, item) => sum + (item.harness_count || 0), 0) ?? "—"} 个 Harness</span>
            {snapshot.platform?.platform?.tenants?.length ? <details className="edupi-admin-work-details"><summary>查看学校空间 {snapshot.platform.platform.tenants.length}</summary><ul>{snapshot.platform.platform.tenants.map((tenant) => <li key={tenant.tenant_id}><strong>{tenant.label || tenant.tenant_id}</strong><span>{tenant.core_mode === "hosted" ? "托管 Core" : "本地 Core"} · {tenant.device_count || 0} 台设备 · {tenant.harness_count || 0} 个 Harness</span></li>)}</ul></details> : <small>尚未接入</small>}
          </article>
        </div>
        <button className="edupi-admin-work-student-ai" type="button" onClick={() => leaveAdmin(onAskStudentUpdate)}>让 EduPi 更新学生档案</button>
      </section> : null}

      {activeSection === "connections" ? <section className="edupi-admin-section">
        <AdminSectionHeader title="连接" onRefresh={refresh} />
        <OpenConnectorCatalogCard />
        <JevSettingsCard />
        <h2 className="edupi-admin-connection-title">服务连接</h2>
        <div className="edupi-admin-list">{snapshot.platform?.connectors?.connectors?.map((connector) => {
          const id = connector.connector_id || "";
          const connected = connector.status === "connected" || connector.status === "conversation_verified";
          const content = <><span><strong>{connector.label || id}</strong><small>{connector.capabilities?.join(" · ")}</small></span><em className={connected ? "is-ready" : ""}>{connectorStatusLabel(connector.status)}{connectorSetupIds.has(id) ? " ›" : ""}</em></>;
          return connectorSetupIds.has(id)
            ? <button type="button" key={id} onClick={() => setSelectedConnector(id)}>{content}</button>
            : <div key={id}>{content}</div>;
        })}</div>
        {selectedConnector ? <EduPiConnectorSetup connectorId={selectedConnector} status={snapshot.platform?.connectors?.connectors?.find((item) => item.connector_id === selectedConnector)?.status || "not_configured"} onClose={() => setSelectedConnector(null)} onConfigured={refresh} /> : null}
      </section> : null}

      {modelsMounted ? <section className="edupi-admin-section is-models" hidden={activeSection !== "models"}>
        <AdminSectionHeader title="AI 与模型" meta={snapshot.models === null ? "模型数据不可用" : defaultModel ? `${defaultModel.provider} / ${defaultModel.modelId}` : "默认模型待配置"} />
        <div className="edupi-admin-embedded-models">{modelsPanel}</div>
      </section> : null}

      {activeSection === "deleted" ? <section className="edupi-admin-section">
        <AdminSectionHeader title="回收站" meta="删除与恢复记录" onRefresh={refresh} />
        <EduPiDeletedEntities activeCount={education?.entityDeletionCount ?? 0} historyCount={education?.entityDeletionHistoryCount ?? 0} countUnavailable={education?.entityDeletionLedgerUnavailable ?? true} onLoad={readEducationEntityDeletions} onRestore={restoreDeletedEntity} />
      </section> : null}

      {activeSection === "system" ? <section className="edupi-admin-section">
        <AdminSectionHeader title="系统" meta={education?.workspace || "数据目录待连接"} onRefresh={refresh} />
        <div className="edupi-admin-list">
          <div><span><strong>EduPi Desktop</strong><small>当前安装版本</small></span><em>v{APP_VERSION_DISPLAY}</em></div>
          <button type="button" disabled={coreReconnecting || coreRepairing} onClick={coreConnected ? refresh : () => void reconnectCore()} aria-label={coreConnected ? "检查 Core 状态" : "重新连接 Core"}><span><strong>EduPi Core</strong><small aria-live="polite">{coreReconnectMessage || snapshot.status?.core?.reason || systemStatusLabel(snapshot.status?.core?.lifecycle || snapshot.status?.core?.status)}</small></span><em className={coreConnected ? "is-ready" : ""}>{coreReconnecting ? "连接中" : coreRepairing ? "修复中" : loading ? "检查中" : coreConnected ? "已连接" : "重新连接"}</em></button>
          {desktopChrome.isDesktop && ["runtime_root_invalid", "runtime_state_invalid", "runtime_writer_unavailable"].some((code) => snapshot.status?.core?.reason?.includes(code)) ? <button type="button" disabled={coreRepairing || coreReconnecting} onClick={() => void repairCore()}><span><strong>修复 Core Runtime</strong><small>只清理运行状态绑定，保留教师数据</small></span><em>{coreRepairing ? "处理中" : "修复"}</em></button> : null}
          <div><span><strong>教育投影</strong><small>{snapshot.status?.projection?.reason || systemStatusLabel(snapshot.status?.projection?.status)}</small></span><em className={projectionConnected ? "is-ready" : ""}>{projectionConnected ? "已连接" : "检查"}</em></div>
          <button type="button" onClick={() => setActiveSection("automation")}><span><strong>自动运行内核</strong><small>{automationStatus}</small></span><em>{kernelSummary?.running ? `${kernelSummary.running} 项运行中` : "查看"}</em></button>
          <button type="button" onClick={onOpenSettings}><span><strong>应用更新</strong><small>检查、下载并安装新版本</small></span><em>检查更新</em></button>
        </div>
        <EduPiCoreCompatibility value={snapshot.compatibility} onNavigate={onNavigate} onOpenContext={onOpenContext} />
      </section> : null}
    </main>
  </section>;
}
