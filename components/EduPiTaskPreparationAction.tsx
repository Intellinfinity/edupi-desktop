"use client";

import { useEffect, useRef, useState } from "react";

type PreparationState = { taskId?: string | null; state: "idle" | "running" | "ready" | "error"; prepared: number; error: string | null };

export function EduPiTaskPreparationAction({ taskId, onReady }: { taskId: string; onReady: () => void }) {
  const [status, setStatus] = useState<PreparationState | null>(null);
  const [starting, setStarting] = useState(false);
  const onReadyRef = useRef(onReady);
  const requestOwner = useRef({ taskId, sequence: 0 });
  if (requestOwner.current.taskId !== taskId) {
    requestOwner.current = { taskId, sequence: requestOwner.current.sequence + 1 };
    setStatus(null);
    setStarting(false);
  }

  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => () => { requestOwner.current.sequence++; }, []);

  useEffect(() => {
    let active = true;
    const sequence = requestOwner.current.sequence;
    void fetch(`/api/edupi/preparation?taskId=${encodeURIComponent(taskId)}`, { cache: "no-store" }).then(async response => {
      const next = await response.json() as PreparationState;
      if (active && requestOwner.current.taskId === taskId && requestOwner.current.sequence === sequence && next.taskId === taskId) setStatus(next);
    }).catch(() => {});
    return () => { active = false; };
  }, [taskId]);

  useEffect(() => {
    if (status?.state !== "running" || status.taskId !== taskId) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/edupi/preparation?taskId=${encodeURIComponent(taskId)}`, { cache: "no-store" });
        const next = await response.json() as PreparationState;
        if (!active || next.state === "running") return;
        if (next.taskId !== taskId) {
          setStatus({ taskId, state: "error", prepared: 0, error: "运行状态已切换，请重试" });
          return;
        }
        setStatus(next);
        window.dispatchEvent(new Event("edupi-preparation-updated"));
        if (next.state === "ready") onReadyRef.current();
      } catch { if (active) setStatus({ taskId, state: "error", prepared: 0, error: "状态读取失败，请重试" }); }
    };
    const timer = window.setInterval(() => void poll(), 1_000);
    void poll();
    return () => { active = false; window.clearInterval(timer); };
  }, [status?.state, status?.taskId, taskId]);
  const start = async () => {
    const sequence = ++requestOwner.current.sequence;
    const current = () => requestOwner.current.taskId === taskId && requestOwner.current.sequence === sequence;
    setStarting(true);
    try {
      const response = await fetch("/api/edupi/preparation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run", taskId }) });
      const next = await response.json() as PreparationState & { error?: string };
      if (!current()) return;
      if (!response.ok) throw new Error(next.error || "启动失败");
      if (next.taskId !== taskId) throw new Error("运行状态已切换，请重试");
      setStatus(next);
      if (next.state === "ready") { window.dispatchEvent(new Event("edupi-preparation-updated")); onReadyRef.current(); }
    } catch (error) { if (current()) setStatus({ taskId, state: "error", prepared: 0, error: error instanceof Error ? error.message : "启动失败" }); }
    finally { if (current()) setStarting(false); }
  };
  return <div className="edupi-task-preparation-action">
    <button type="button" disabled={starting || status?.state === "running"} onClick={() => void start()}>{starting ? "正在启动…" : status?.state === "running" ? "正在准备…" : status?.state === "error" ? "重新准备" : "立即准备"}</button>
    {status?.state === "running" ? <span role="status" aria-live="polite">正在生成教学产物</span> : null}
    {status?.state === "error" ? <span role="alert">{status.error}</span> : null}
  </div>;
}
