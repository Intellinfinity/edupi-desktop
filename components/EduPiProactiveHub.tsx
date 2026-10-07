"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import type { EducationContract } from "@/lib/edupi-education-contract";
import type { DesktopControlInput } from "@/lib/edupi-desktop-control";
import { readEduPiKernel, type EduPiKernelRun, type EduPiKernelState } from "@/lib/edupi-kernel-client";
import { kernelRunAction, kernelRunDetail, kernelRunTitle, type KernelRunAction, type KernelRunDisplayInput } from "@/lib/edupi-kernel-display";
import type { Reminder } from "@/lib/edupi-reminder-store";
import { compareForegroundReminders, dateOnly, isForegroundDate, isReminderForeground, isTaskForeground, shanghaiDate, type ForegroundContext, type ForegroundPolicy } from "@/lib/edupi-foreground";
import { EduPiListPreview, EduPiPagedRows, useEduPiForegroundPolicy } from "./EduPiForeground";

const EMPTY_KERNEL: EduPiKernelState = { status: "empty", updatedAt: null, running: 0, runs: [] };
const STATUS_LABELS: Record<EduPiKernelRun["status"], string> = {
  running: "运行中",
  awaiting_delivery: "等待交付",
  failed: "需要处理",
  needs_review: "待你确认",
  succeeded: "已完成",
  skipped: "已跳过",
};

function RadarIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 4v3M20 12h-3M12 20v-3M4 12h3" /><path d="m14.2 9.8 4-4" /></svg>;
}

function BellIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0v6l2 3H4l2-3V9Z" /><path d="M10 21h4" /></svg>;
}

function ArrowIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>;
}

function runInput(run: EduPiKernelRun): KernelRunDisplayInput {
  return { trigger_id: run.triggerId, fire_key: run.fireKey ?? undefined, status: run.status, result_summary: run.resultSummary, error_code: run.errorCode, error_message: run.errorMessage };
}

export function isProactiveReminderForeground(item: Reminder, policy: ForegroundPolicy, context: ForegroundContext & Partial<Pick<EducationContract, "continuity">> = {}): boolean {
  return isReminderForeground(item, policy, context);
}

export function isProactiveRunForeground(run: EduPiKernelRun, policy: ForegroundPolicy, context: ForegroundContext = {}): boolean {
  if (run.status === "running" || run.status === "awaiting_delivery") return true;
  const task = context.tasks?.find(row => row.id && (run.fireKey?.startsWith(`${row.id}:`) || run.errorMessage?.startsWith(`${row.id}: `)));
  if (task) return isTaskForeground(task, policy, context);
  const fireDate = dateOnly(run.fireKey?.match(/\d{4}-\d{2}-\d{2}/)?.[0]);
  return isForegroundDate(fireDate || shanghaiDate(run.updatedAt), policy);
}

export function proactiveBadgeCount(kernel: EduPiKernelState, reminders: readonly Reminder[], policy?: ForegroundPolicy, context: ForegroundContext & Partial<Pick<EducationContract, "continuity">> = {}): number {
  const pending = reminders.filter((item) => !item.withdrawn && !item.handled && !item.snoozedUntil && !item.read && (!policy || isProactiveReminderForeground(item, policy, context))).length;
  const attention = kernel.runs.filter((run) => (run.status === "failed" || run.status === "needs_review") && (!policy || isProactiveRunForeground(run, policy, context))).length;
  return kernel.running + pending + attention;
}

export function EduPiProactiveHub({
  open,
  onOpenChange,
  onAction,
  onTarget,
  onOpenReminders,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (action: DesktopControlInput) => boolean | Promise<boolean>;
  onTarget: (target: KernelRunAction["target"]) => void | Promise<void>;
  onOpenReminders: () => void;
}) {
  const policy = useEduPiForegroundPolicy();
  const [kernel, setKernel] = useState<EduPiKernelState>(EMPTY_KERNEL);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [data, setData] = useState<EducationContract | null>(null);
  const tasks = data?.tasks || [];
  const [listMode, setListMode] = useState<"reminders" | "runs" | "history" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useModalDismiss<HTMLElement>(() => onOpenChange(false), open);

  const load = useCallback(async (signal?: AbortSignal, showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const [nextKernel, reminderResult, workspaceResult] = await Promise.all([
        readEduPiKernel(signal),
        fetch("/api/edupi/reminders", { cache: "no-store", signal }).then(async (response) => response.ok ? await response.json() as { items?: Reminder[] } : null).catch(() => null),
        fetch("/api/edupi/workspace", { cache: "no-store", signal }).then(async response => response.ok ? await response.json() as { data?: EducationContract } : null).catch(() => null),
      ]);
      if (signal?.aborted) return;
      setKernel(nextKernel);
      setReminders(Array.isArray(reminderResult?.items) ? reminderResult.items : []);
      if (workspaceResult?.data) setData(workspaceResult.data);
      setError(nextKernel.status === "unavailable" && !reminderResult ? "主动协作状态暂不可用" : "");
    } catch (cause) {
      if (signal?.aborted || (cause instanceof DOMException && cause.name === "AbortError")) return;
      setError("主动协作状态暂不可用");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let visible = false;
    const refreshIfVisible = () => {
      if (visible && document.visibilityState === "visible") void load(controller.signal, true);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      refreshIfVisible();
    });
    if (rootRef.current) observer.observe(rootRef.current);
    const timer = window.setInterval(refreshIfVisible, 30_000);
    return () => { controller.abort(); observer.disconnect(); window.clearInterval(timer); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void load(controller.signal, true);
    return () => controller.abort();
  }, [load, open]);

  const pendingReminders = useMemo(() => reminders.filter((item) => !item.withdrawn && !item.handled && !item.snoozedUntil && isProactiveReminderForeground(item, policy, data || {})).sort((left, right) => compareForegroundReminders(left, right, policy, data || {})), [reminders, policy, data]);
  const allRuns = useMemo(() => kernel.runs.slice().sort((left, right) => Number(right.status === "running" || right.status === "awaiting_delivery") - Number(left.status === "running" || left.status === "awaiting_delivery") || right.updatedAt.localeCompare(left.updatedAt)), [kernel.runs]);
  const runs = useMemo(() => allRuns.filter(run => isProactiveRunForeground(run, policy, data || {})), [allRuns, policy, data]);
  const badge = proactiveBadgeCount(kernel, reminders, policy, data || {});
  const triggerLabel = badge > 0 ? `主动协作，${badge} 项动态` : "主动协作";

  const openReminder = async (item: Reminder) => {
    setBusy(`reminder:${item.id}`);
    setError("");
    try {
      const action: DesktopControlInput = item.kind === "brief"
        ? { action: "open_document", documentId: item.taskId.slice("document:".length) }
        : { action: "open_task", taskId: item.taskId, stage: item.kind === "ready" ? "artifact" : "run" };
      if (!await onAction(action)) throw new Error("事项暂不可用");
      onOpenChange(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "事项暂不可用"); }
    finally { setBusy(null); }
  };

  const openRunTarget = async (run: EduPiKernelRun) => {
    const action = kernelRunAction(runInput(run));
    const task = tasks.find(row => row.id && (run.fireKey?.startsWith(`${row.id}:`) || run.errorMessage?.startsWith(`${row.id}: `)));
    if (!action && !task && run.status !== "running" && run.status !== "awaiting_delivery") return;
    setBusy(`run:${run.runId}`);
    setError("");
    try {
      if (task?.id) {
        if (!await onAction({ action: "open_task", taskId: task.id, stage: "run" })) throw new Error("运行事项暂不可用");
      } else await onTarget(action?.target || (run.triggerId === "morning_brief" ? "workspace" : "teaching"));
      onOpenChange(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "运行事项暂不可用"); }
    finally { setBusy(null); }
  };
  const renderReminder = (item: Reminder) => <div className="edupi-proactive-hub__row" key={item.id}><i className={`is-${item.kind}`} aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.kind === "brief" ? "简报已更新" : item.kind === "ready" ? "产物已准备" : item.kind === "due" ? "任务已到期" : "运行失败"}</small></span><button type="button" disabled={Boolean(busy)} aria-label={`打开${item.title}`} title="打开" onClick={() => void openReminder(item)}>{busy === `reminder:${item.id}` ? "…" : <ArrowIcon />}</button></div>;
  const renderRun = (run: EduPiKernelRun) => {
    const input = runInput(run);
    const action = kernelRunAction(input);
    const task = tasks.find(row => row.id && (run.fireKey?.startsWith(`${row.id}:`) || run.errorMessage?.startsWith(`${row.id}: `)));
    return <div className="edupi-proactive-hub__row" key={run.runId}><i className={`is-${run.status}`} aria-hidden="true" /><span><strong>{kernelRunTitle(input, tasks)}</strong><small>{kernelRunDetail(input)} · {STATUS_LABELS[run.status]}</small></span>{task?.id || action || run.status === "running" || run.status === "awaiting_delivery" ? <button type="button" disabled={Boolean(busy)} aria-label={task ? `打开${task.title}` : action?.label || "查看运行事项"} onClick={() => void openRunTarget(run)}>{busy === `run:${run.runId}` ? "…" : <ArrowIcon />}</button> : null}</div>;
  };

  return <div ref={rootRef} className="edupi-chat-utility edupi-proactive-hub">
    <button type="button" className={`edupi-chat-utility__trigger${open ? " is-open" : ""}${kernel.running > 0 ? " is-running" : ""}`} aria-expanded={open} aria-label={triggerLabel} title={triggerLabel} onMouseDown={event => event.currentTarget.focus()} onClick={event => { event.currentTarget.focus(); onOpenChange(!open); }}><RadarIcon />{badge > 0 ? <span aria-hidden="true">{badge > 99 ? "99+" : badge}</span> : null}</button>
    {open ? <section ref={panelRef} className="edupi-chat-utility__panel edupi-proactive-hub__panel" role="dialog" aria-modal="false" aria-label="主动协作" tabIndex={-1}>
      <header><div>{listMode ? <button type="button" onClick={() => setListMode(null)}>← 主动协作</button> : null}<strong>{listMode === "reminders" ? "待处理" : listMode === "runs" ? "运行事项" : listMode === "history" ? "运行历史" : "主动协作"}</strong></div><button type="button" data-autofocus aria-label="关闭主动协作" title="关闭" onClick={() => onOpenChange(false)}>×</button></header>
      <div className="edupi-chat-utility__scroll">
        {error ? <p className="edupi-proactive-hub__message" role="alert">{error}</p> : null}
        {loading ? <p className="edupi-proactive-hub__empty" role="status">正在读取…</p> : null}
        {!loading && listMode === "reminders" ? <EduPiPagedRows rows={pendingReminders} memoryKey="proactive:reminders" renderRow={renderReminder} /> : null}
        {!loading && (listMode === "runs" || listMode === "history") ? <EduPiPagedRows rows={listMode === "history" ? allRuns : runs} memoryKey={`proactive:${listMode}`} renderRow={renderRun} /> : null}
        {!loading && !listMode && pendingReminders.length > 0 ? <section className="edupi-proactive-hub__group"><h3>待处理</h3><EduPiListPreview rows={pendingReminders} renderRow={renderReminder} onShowAll={() => setListMode("reminders")} /></section> : null}
        {!loading && !listMode && runs.length > 0 ? <section className="edupi-proactive-hub__group"><h3>运行事项</h3><EduPiListPreview rows={runs} renderRow={renderRun} onShowAll={() => setListMode("runs")} /></section> : null}
        {!loading && !listMode && pendingReminders.length === 0 && runs.length === 0 && !error ? <p className="edupi-proactive-hub__empty">暂无主动动态</p> : null}
      </div>
      <footer><button type="button" aria-label="打开全部提醒" title="打开全部提醒" onClick={() => { onOpenChange(false); onOpenReminders(); }}><BellIcon /></button><button type="button" onClick={() => setListMode("history")}>历史 <span>{allRuns.length}</span></button><button type="button" aria-label="刷新主动协作" title="刷新" disabled={loading} onClick={() => void load(undefined, true)}><span aria-hidden="true">↻</span></button></footer>
    </section> : null}
  </div>;
}
