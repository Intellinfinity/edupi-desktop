"use client";
import { useState } from "react";

export type DocxSourcePreview = { version: 1; format: "docx"; status: "ready" | "held"; basis_hash: string;
  blocks: Array<{ path: string; text: string; cells?: Array<{ path: string; text: string }> }>;
  issues: Array<{ code: string; path?: string }> };
type Span = { path: string; start: number; end: number };

export function selectableDocxSource(preview: DocxSourcePreview) {
  return preview.blocks.flatMap(block => block.cells?.length ? block.cells : [block]).filter(item => item.text.trim());
}

export function selectedDocxSpans(preview: DocxSourcePreview, selected: ReadonlySet<string>): Span[] {
  return selectableDocxSource(preview).filter(item => selected.has(item.path)).map(item => ({ path: item.path, start: 0, end: item.text.length }));
}

export function EduPiDocxSourceSelection({ materialId, expectedRevision, onSettled }: {
  materialId: string; expectedRevision: number; onSettled: (confirmed: boolean) => void;
}) {
  const [preview, setPreview] = useState<DocxSourcePreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [visibleCount, setVisibleCount] = useState(40);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const candidates = preview ? selectableDocxSource(preview) : [];
  const spans = preview ? selectedDocxSpans(preview, selected) : [];
  const selectedText = candidates.filter(item => selected.has(item.path)).map(item => item.text).join("\n");
  const tooLarge = spans.length > 20 || new TextEncoder().encode(selectedText).length > 16_384;
  const read = async () => {
    setBusy(true); setError(""); setPreview(null); setSelected(new Set()); setVisibleCount(40);
    try {
      const response = await fetch(`/api/edupi/material-excerpt/source?materialId=${encodeURIComponent(materialId)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "原文读取失败");
      setPreview(result.preview);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "原文读取失败"); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!preview || preview.status !== "ready" || !spans.length || tooLarge) return;
    setBusy(true); setError("");
    let confirmed = false;
    try {
      const response = await fetch("/api/edupi/material-excerpt/source", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId, expectedRevision, expectedBasisHash: preview.basis_hash, sourceSpans: spans }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "确认未完成");
      confirmed = true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "确认未完成"); }
    finally { setPreview(null); setSelected(new Set()); setBusy(false); onSettled(confirmed); }
  };
  return <div className="edupi-docx-source">
    <button type="button" className="native-button" disabled={busy} onClick={() => void read()}>{busy ? "处理中…" : "从 DOCX 原文选取"}</button>
    {error ? <p role="alert">{error}</p> : null}
    {preview?.status === "held" ? <p role="status">原文包含待核对内容，请使用手动核对正文。</p> : null}
    {preview?.status === "ready" ? <>
      <div role="group" aria-label="选择原文片段" className="edupi-docx-source__list">{candidates.slice(0, visibleCount).map(item => <label key={item.path}>
        <input type="checkbox" checked={selected.has(item.path)} disabled={busy} onChange={event => setSelected(current => {
          const next = new Set(current); if (event.target.checked) next.add(item.path); else next.delete(item.path); return next;
        })} /><span>{item.text}</span>
      </label>)}</div>
      {candidates.length > visibleCount ? <button type="button" className="native-button" onClick={() => setVisibleCount(value => value + 40)}>查看更多</button> : null}
      {tooLarge ? <p role="alert">最多选20处，合计不超过16 KB</p> : null}
      <button type="button" className="native-button" disabled={busy || !spans.length || tooLarge} onClick={() => void confirm()}>确认选中内容</button>
    </> : null}
  </div>;
}
