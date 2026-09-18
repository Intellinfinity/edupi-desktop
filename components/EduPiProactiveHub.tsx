"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import type { EducationContract } from "@/lib/edupi-education-contract";
import type { DesktopControlInput } from "@/lib/edupi-desktop-control";
import { readEduPiKernel, type EduPiKernelRun, type EduPiKernelState } from "@/lib/edupi-kernel-client";
import { kernelRunAction, kernelRunDetail, kernelRunTitle, type KernelRunAction, type KernelRunDisplayInput } from "@/lib/edupi-kernel-display";
import type { Reminder } from "@/lib/edupi-reminder-store";

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

export function proactiveBadgeCount(kernel: EduPiKernelState, reminders: readonly Reminder[]): number {
  const pending = reminders.filter((item) => !item.withdrawn && !item.handled && !item.snoozedUntil && !item.read).length;
  const attention = kernel.runs.filter((run) => run.status === "failed" || run.status === "needs_review").length;
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
  const [kernel, setKernel] = useState<EduPiKernelState>(EMPTY_KERNEL);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [tasks, setTasks] = useState<EducationContract["tasks"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useModalDismiss<HTMLElement>(() => onOpenChange(false), open);

  const load = useCallback(async (signal?: AbortSignal, showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const [nextKernel, reminderResult] = await Promise.all([
        readEduPiKernel(signal),
        fetch("/api/edupi/reminders", { cache: "no-store", signal }).then(async (response) => response.ok ? await response.json() as { items?: Reminder[] } : null).catch(() => null),
      ]);
      if (signal?.aborted) return;
      setKernel(nextKernel);
      setReminders(Array.isArray(reminderResult?.items) ? reminderResult.items : []);
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
    void (async () => {
      await load(controller.signal, true);
      for (let attempt = 0; attempt < 2 && !controller.signal.aborted; attempt += 1) {
        try {
          const response = await fetch("/api/edupi/workspace", { cache: "no-store", signal: controller.signal });
          if (response.ok) {
            const result = await response.json() as { data?: EducationContract };
            if (!controller.signal.aborted) setTasks(result.data?.tasks ?? []);
            return;
          }
        } catch { if (controller.signal.aborted) return; }
        if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 350));
      }
    })();
    return () => controller.abort();
  }, [load, open]);

  const pendingReminders = useMemo(() => reminders.filter((item) => !item.withdrawn && !item.handled && !item.snoozedUntil).slice().reverse(), [reminders]);
  const runs = useMemo(() => kernel.runs.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 8), [kernel.runs]);
  const badge = proactiveBadgeCount(kernel, reminders);
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
    if (!action) return;
    setBusy(`run:${run.runId}`);
    try { await onTarget(action.target); onOpenChange(false); }
    finally { setBusy(null); }
  };

  return <div ref={rootRef} className="edupi-chat-utility edupi-proactive-hub">
    <button type="button" className={`edupi-chat-utility__trigger${open ? " is-open" : ""}${kernel.running > 0 ? " is-running" : ""}`} aria-expanded={open} aria-label={triggerLabel} title={triggerLabel} onMouseDown={event => event.currentTarget.focus()} onClick={event => { event.currentTarget.focus(); onOpenChange(!open); }}><RadarIcon />{badge > 0 ? <span aria-hidden="true">{badge > 99 ? "99+" : badge}</span> : null}</button>
    {open ? <section ref={panelRef} className="edupi-chat-utility__panel edupi-proactive-hub__panel" role="dialog" aria-modal="false" aria-label="主动协作" tabIndex={-1}>
      <header><div><strong>主动协作</strong><span>{kernel.running > 0 ? `${kernel.running} 项正在运行` : pendingReminders.length > 0 ? `${pendingReminders.length} 项等你处理` : "Core 当前没有待处理事项"}</span></div><button type="button" data-autofocus aria-label="关闭主动协作" title="关闭" onClick={() => onOpenChange(false)}>×</button></header>
      <div className="edupi-chat-utility__scroll">
        {error ? <p className="edupi-proactive-hub__message" role="alert">{error}</p> : null}
        {loading ? <p className="edupi-proactive-hub__empty" role="status">正在读取…</p> : null}
        {!loading && pendingReminders.length > 0 ? <section className="edupi-proactive-hub__group"><h3>待处理</h3>{pendingReminders.slice(0, 5).map((item) => <div className="edupi-proactive-hub__row" key={item.id}><i className={`is-${item.kind}`} aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.kind === "brief" ? "简报已更新" : item.kind === "ready" ? "产物已准备" : item.kind === "due" ? "任务已到期" : "运行失败"}</small></span><button type="button" disabled={Boolean(busy)} aria-label={`打开${item.title}`} title="打开" onClick={() => void openReminder(item)}>{busy === `reminder:${item.id}` ? "…" : <ArrowIcon />}</button></div>)}</section> : null}
        {!loading && runs.length > 0 ? <section className="edupi-proactive-hub__group"><h3>Core 运行</h3>{runs.map((run) => {
          const input = runInput(run);
          const action = kernelRunAction(input);
          return <div className="edupi-proactive-hub__row" key={run.runId}><i className={`is-${run.status}`} aria-hidden="true" /><span><strong>{kernelRunTitle(input, tasks)}</strong><small>{kernelRunDetail(input)} · {STATUS_LABELS[run.status]}</small></span>{action ? <button type="button" disabled={Boolean(busy)} aria-label={action.label} title={action.label} onClick={() => void openRunTarget(run)}>{busy === `run:${run.runId}` ? "…" : <ArrowIcon />}</button> : null}</div>;
        })}</section> : null}
        {!loading && pendingReminders.length === 0 && runs.length === 0 && !error ? <p className="edupi-proactive-hub__empty">暂无主动动态</p> : null}
      </div>
      <footer><button type="button" aria-label="打开全部提醒" title="打开全部提醒" onClick={() => { onOpenChange(false); onOpenReminders(); }}><BellIcon /></button><button type="button" aria-label="刷新主动协作" title="刷新" disabled={loading} onClick={() => void load(undefined, true)}><span aria-hidden="true">↻</span></button></footer>
    </section> : null}
  </div>;
}
