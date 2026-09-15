"use client";
import { useEffect, useState } from "react";
import type { Reminder } from "@/lib/edupi-reminder-store";
import type { DesktopControlInput } from "@/lib/edupi-desktop-control";
import { useSearchParams } from "next/navigation";

export function EduPiReminderInbox({ onAction, onContinue, standalone = false, onClose }: { onAction: (action: DesktopControlInput) => boolean | Promise<boolean>; onContinue?: (taskId: string) => Promise<void>; standalone?: boolean; onClose?: () => void }) {
  const params = useSearchParams();
  const [open, setOpen] = useState(standalone || params.get("reminders") === "1");
  useEffect(() => { if (params.get("reminders") === "1") setOpen(true); }, [params]);
  const [items, setItems] = useState<Reminder[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("pending");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/edupi/reminders", { signal: controller.signal });
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!controller.signal.aborted) { setItems(result.items); setError(""); }
      } catch { if (!controller.signal.aborted) setError("提醒暂不可用"); }
    };
    void load(); const timer = setInterval(() => void load(), 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [open]);
  const change = async (id: string, type: "read" | "dismiss" | "snooze") => {
    try {
      const response = await fetch("/api/edupi/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, type }) });
      if (!response.ok) throw new Error();
      setItems((await response.json()).items);
      setError("");
    } catch { setError("提醒保存失败"); }
  };
  const pending = items.filter(item => !item.withdrawn && !item.handled && !item.snoozedUntil);
  const visible = items.filter(item => filter === "handled" ? item.handled || item.withdrawn : filter === "snoozed" ? !item.withdrawn && !item.handled && Boolean(item.snoozedUntil) : !item.withdrawn && !item.handled && !item.snoozedUntil).reverse();
  const pageCount = Math.max(1, Math.ceil(visible.length / 8));
  const currentPage = Math.min(page, pageCount - 1);
  return <section className={standalone ? "edupi-reminder-inbox is-standalone" : "edupi-reminder-inbox"} aria-label="提醒" style={standalone ? undefined : { padding: "8px 12px" }}>
    {standalone ? <header className="edupi-reminder-inbox__header"><div><h1>提醒</h1><span>{pending.filter(item => !item.read).length ? `${pending.filter(item => !item.read).length} 条待处理` : "没有待处理提醒"}</span></div><button type="button" className="native-button" onClick={onClose}>返回对话</button></header> : <button className="native-button" aria-expanded={open} onClick={() => setOpen(!open)}>提醒 {pending.filter(item => !item.read).length || ""}</button>}
    {open ? <div className={standalone ? "edupi-reminder-inbox__body" : undefined} style={standalone ? undefined : { maxHeight: 320, overflowY: "auto" }}>
      <select aria-label="提醒状态" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="pending">待处理</option><option value="snoozed">稍后提醒</option><option value="handled">已移除</option></select>
      {error ? <p role="alert">{error}</p> : null}
      {!visible.length && !error ? <p>{filter === "handled" ? "暂无已移除提醒" : filter === "snoozed" ? "暂无稍后提醒" : "暂无待处理提醒"}</p> : null}
      {visible.slice(currentPage * 8, currentPage * 8 + 8).map(item => <details key={item.id} onToggle={event => { if (event.currentTarget.open && !item.read) void change(item.id, "read"); }}>
        <summary>{item.title} · {item.withdrawn ? "已撤下" : item.kind === "brief" ? "简报已更新" : item.kind === "ready" ? "已准备" : item.kind === "due" ? "已到期" : "准备失败"}</summary>
        <time>{new Date(item.snoozedUntil || item.createdAt).toLocaleString("zh-CN")}</time>
        <button className="native-button" disabled={busy} onClick={async () => {
          setBusy(true);
          try { if (onContinue) await onContinue(item.taskId); else if (!await onAction({ action: "open_task", taskId: item.taskId, stage: "run" })) throw new Error("事项暂不可用"); setOpen(false); }
          catch (error) { setError(error instanceof Error ? error.message : "协作打开失败"); }
          finally { setBusy(false); }
        }}>继续聊</button>
        <button className="native-button" onClick={async () => {
          try {
            const opened = await onAction(item.kind === "brief" ? { action: "open_document", documentId: item.taskId.slice("document:".length) } : { action: "open_task", taskId: item.taskId, stage: "artifact" });
            if (!opened) throw new Error("事项暂不可用");
          } catch { setError("事项暂不可用"); }
        }}>查看事项</button>
        <button className="native-button" onClick={() => void change(item.id, "snooze")}>一小时后提醒</button>
        <button className="native-button" title="只从提醒列表移除，不修改任务" onClick={() => void change(item.id, "dismiss")}>从提醒中移除</button>
      </details>)}
      {pageCount > 1 ? <nav aria-label="提醒分页"><button className="native-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {pageCount}</span><button className="native-button" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}>下一页</button></nav> : null}
    </div> : null}
  </section>;
}
