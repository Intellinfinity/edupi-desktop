"use client";
import { useEffect, useRef, useState } from "react";
import { EduPiDocxSourceSelection } from "./EduPiDocxSourceSelection";

type Excerpt = { revision: number; status: "confirmed" | "withdrawn"; content: string; source_kind?: "docx_parsed_fragment" | "teacher_curated" };
export function EduPiMaterialExcerpt({ materialId, onPreview, canSelectDocx = false }: { materialId: string; onPreview?: () => void; canSelectDocx?: boolean }) {
  const [open, setOpen] = useState(false);
  const [excerpt, setExcerpt] = useState<Excerpt | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const initialized = useRef(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setBusy(true); setError("");
    void fetch(`/api/edupi/material-excerpt?materialId=${encodeURIComponent(materialId)}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "读取失败");
      if (controller.signal.aborted) return;
      setExcerpt(result.excerpt); setLoaded(true); setConflict(false);
      if (!initialized.current) { setContent(result.excerpt?.content || ""); initialized.current = true; }
    }).catch(reason => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "读取失败"); setLoaded(false); } }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [open, materialId, refresh]);
  const save = async (decision: "confirm" | "withdraw") => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/edupi/material-excerpt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ materialId, expectedRevision: excerpt?.revision || 0, content, decision }) });
      const result = await response.json();
      if (!response.ok) { setConflict(result.conflict === true); throw new Error(result.error || "保存未确认"); }
      setExcerpt(result.excerpt); setConflict(false);
      window.dispatchEvent(new Event("edupi-preparation-updated"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存未确认"); }
    finally { setBusy(false); }
  };
  const oversized = new TextEncoder().encode(content).length > 16384;
  return <details className="edupi-material-excerpt" onToggle={event => setOpen(event.currentTarget.open)}><summary>用于备课</summary><div className="edupi-material-excerpt__body">
    {onPreview ? <button type="button" onClick={onPreview}>预览原材料</button> : null}
    <label>核对正文<textarea aria-label="备课材料正文" rows={8} value={content} disabled={busy || !loaded} onChange={event => setContent(event.target.value)} /></label>
    {excerpt ? <p role="status">{excerpt.status === "confirmed" ? "已确认" : "已撤回"}{excerpt.source_kind === "docx_parsed_fragment" ? " · 原文片段" : ""} · 版本 {excerpt.revision}</p> : null}
    {loaded && content !== (excerpt?.content || "") ? <p role="status">当前输入未保存</p> : null}
    {canSelectDocx && loaded ? <EduPiDocxSourceSelection materialId={materialId} expectedRevision={excerpt?.revision || 0} onSettled={confirmed => {
      if (confirmed) initialized.current = false;
      setRefresh(value => value + 1); window.dispatchEvent(new Event("edupi-preparation-updated"));
    }} /> : null}
    {error ? <p role="alert">{error}</p> : null}{oversized ? <p role="alert">正文不能超过16 KB</p> : null}
    <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>刷新版本</button>
    <button type="button" disabled={busy || !loaded || conflict || oversized || !content.trim()} onClick={() => void save("confirm")}>{busy ? "处理中…" : "确认正文"}</button>
    {excerpt?.status === "confirmed" ? <button type="button" disabled={busy || !loaded || conflict} onClick={() => void save("withdraw")}>撤回确认</button> : null}
  </div></details>;
}
