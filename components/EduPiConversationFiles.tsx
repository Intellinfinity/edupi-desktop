"use client";

import { useEffect, useState } from "react";
import type { GeneratedArtifact } from "@/lib/edupi-generated-artifacts";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { revealItemInDirNative } from "@/lib/desktop-native";
import { useModalDismiss } from "@/hooks/useModalDismiss";

function ConversationFilesIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 3.5h8l3 3V20H7z" /><path d="M15 3.5V7h3M10 11h5M10 15h5" /><path d="M4 7v13h10" /></svg>;
}

function RevealFolderIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z" /><path d="m12 11 3 3m0-3v3h-3" /></svg>;
}

function SyncIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8.5A7 7 0 0 1 18.8 7L20 12M4 12l1.2 5A7 7 0 0 0 17.9 15.5" /></svg>;
}

export function EduPiConversationFiles({ sessionId, taskId, cwd, onOpen, open: controlledOpen, onOpenChange }: { sessionId: string; taskId?: string; cwd: string; onOpen?: (path: string) => void; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [internalOpen, setInternalOpen] = useState(Boolean(taskId));
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => { if (controlledOpen === undefined) setInternalOpen(next); onOpenChange?.(next); };
  const [files, setFiles] = useState<GeneratedArtifact[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const panelRef = useModalDismiss<HTMLElement>(() => setOpen(false), open);
  useEffect(() => {
    const refreshFiles = () => setRefresh(value => value + 1);
    window.addEventListener("edupi-artifacts-updated", refreshFiles);
    return () => window.removeEventListener("edupi-artifacts-updated", refreshFiles);
  }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/edupi/artifacts", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("文件索引暂不可用");
      const result = await response.json();
      setFiles((result.artifacts || []).filter((file: GeneratedArtifact) => taskId ? file.task_id === taskId : file.session_id === sessionId));
    }).catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, [open, sessionId, taskId, refresh]);
  const sync = async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/edupi/artifacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "同步失败");
      setMessage(`已同步 ${result.registered} 份文件${result.failedCount ? `，${result.failedCount} 份未能接入` : ""}`);
      setRefresh(value => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "同步失败"); }
    finally { setBusy(false); }
  };
  const toggleLabel = open ? "收起本次产物" : "查看本次产物";
  return <div className="edupi-chat-utility edupi-conversation-files">
    <button type="button" className={`edupi-chat-utility__trigger${open ? " is-open" : ""}`} aria-expanded={open} aria-label={toggleLabel} title={toggleLabel} onMouseDown={event => event.currentTarget.focus()} onClick={event => { event.currentTarget.focus(); setOpen(!open); }}><ConversationFilesIcon />{files.length > 0 ? <span aria-hidden="true">{files.length > 99 ? "99+" : files.length}</span> : null}</button>
    {open ? <section ref={panelRef} className="edupi-chat-utility__panel edupi-conversation-files__panel" role="dialog" aria-modal="false" aria-label="本次产物" tabIndex={-1}>
      <header><div><strong>本次产物</strong><span>{files.length ? `${files.length} 份文件` : "当前对话"}</span></div><button type="button" data-autofocus aria-label="关闭本次产物" title="关闭" onClick={() => setOpen(false)}>×</button></header>
      <div className="edupi-chat-utility__scroll">
      {files.map(file => {
        const fullPath = `${cwd.replace(/[\\/]$/, "")}/${file.relative_path}`;
        const revealLabel = `显示“${file.title}”所在文件夹`;
        return <div className="edupi-conversation-files__row" key={file.artifact_id}><button className="native-button" onClick={() => onOpen?.(fullPath)}>{file.title}</button>{isTauriDesktop() ? <button type="button" className="native-button edupi-conversation-files__icon-button" aria-label={revealLabel} title={revealLabel} onClick={() => void revealItemInDirNative(fullPath).catch(() => setMessage("文件夹打开失败"))}><RevealFolderIcon /></button> : null}</div>;
      })}
      {files.length === 0 ? <p>暂无已登记文件</p> : null}
      {message ? <p role="status">{message}</p> : null}
      </div>
      {sessionId ? <footer><button type="button" className={`edupi-conversation-files__icon-button${busy ? " is-busy" : ""}`} disabled={busy} aria-label={busy ? "正在同步对话文件" : "同步对话文件"} title={busy ? "正在同步" : "同步对话文件"} onClick={() => void sync()}><SyncIcon /></button></footer> : null}
    </section> : null}
  </div>;
}
