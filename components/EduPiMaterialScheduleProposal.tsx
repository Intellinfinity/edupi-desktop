"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EduPiMaterialScheduleProposal as UploadProposal } from "@/lib/edupi-core-process-client";
import { applyMaterialSchedule, captureMaterialScheduleApply, materialScheduleCanApply, materialScheduleErrorMessage,
  readMaterialSchedule, type MaterialScheduleApplyResult, type MaterialScheduleRead } from "@/lib/edupi-material-schedule";
import { EduPiPagination } from "./EduPiActionIcon";

type Props = {
  materialId: string;
  metadataRevision?: number;
  initialProposal?: UploadProposal;
  onApplied?: () => void;
  onPreview?: () => void;
};
const PAGE_SIZE = 10;

export function EduPiMaterialScheduleProposal({ materialId, metadataRevision, initialProposal, onApplied, onPreview }: Props) {
  const [current, setCurrent] = useState<MaterialScheduleRead | null>(null);
  const [applied, setApplied] = useState<MaterialScheduleApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const expanded = useRef(false);
  const load = useCallback(async () => {
    controller.current?.abort();
    const revision = ++sequence.current;
    const request = new AbortController();
    controller.current = request;
    setBusy(true); setCurrent(null); setError(""); setApplied(null); setApplying(false);
    try {
      const observed = await readMaterialSchedule(materialId, undefined, undefined, request.signal);
      if (sequence.current !== revision || request.signal.aborted) return;
      setCurrent(observed); setPage(0);
    } catch (error) {
      if (sequence.current === revision && !request.signal.aborted) setError(materialScheduleErrorMessage(error));
    } finally { if (sequence.current === revision) setBusy(false); }
  }, [materialId]);
  useEffect(() => {
    controller.current?.abort(); sequence.current += 1;
    setCurrent(null); setApplied(null); setError(""); setPage(0); setApplying(false);
    if (expanded.current) void load();
    return () => { controller.current?.abort(); sequence.current += 1; };
  }, [load, metadataRevision]);

  const shown = current || initialProposal?.read_result || null;
  const label = applied ? applied.status === "held" ? "待核对" : "已采用"
    : busy ? "读取中…" : current ? materialScheduleCanApply(current) ? "待确认" : "待核对"
      : initialProposal ? { proposed: "待确认", held: "待核对", unavailable: "暂不可用" }[initialProposal.status] : "未读取";
  const lines = shown ? [
    ...shown.issues.map((issue, index) => ({ id: `issue-${index}`, text: issue.message })),
    ...shown.events.map(event => ({ id: event.event_id, text: [event.date, event.end_date && event.end_date !== event.date ? `至 ${event.end_date}` : "",
      event.name, event.time_interval ? `${event.time_interval.start}—${event.time_interval.end}` : "", event.location].filter(Boolean).join(" · ") })),
  ] : [];
  const pages = Math.max(1, Math.ceil(lines.length / PAGE_SIZE));
  const visible = lines.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const adopt = async () => {
    if (!current || !materialScheduleCanApply(current) || busy || applying) return;
    if (!window.confirm(`采用这 ${current.events.length} 项安排？`)) return;
    const revision = sequence.current;
    const capture = captureMaterialScheduleApply(current);
    setApplying(true); setError("");
    try {
      const result = await applyMaterialSchedule(capture);
      onApplied?.();
      if (sequence.current === revision) setApplied(result);
    } catch (error) { if (sequence.current === revision) { setCurrent(null); setError(materialScheduleErrorMessage(error)); } }
    finally { if (sequence.current === revision) setApplying(false); }
  };

  return <details className="edupi-material-inbox" onToggle={event => {
    expanded.current = event.currentTarget.open;
    if (expanded.current) void load();
    else { controller.current?.abort(); sequence.current += 1; setCurrent(null); setBusy(false); setApplying(false); }
    }}>
    <summary>安排提案 <span>{label}</span></summary>
    <div className="edupi-material-pairing__current">
    {!current && initialProposal?.read_result ? <small>上传时提案</small> : null}
    {lines.length ? <ul>{visible.map(line => <li key={line.id}>{line.text}</li>)}</ul> : null}
    {pages > 1 ? <EduPiPagination label="安排提案分页" page={page} pages={pages} previousDisabled={page === 0} nextDisabled={page >= pages - 1}
      onPrevious={() => setPage(value => value - 1)} onNext={() => setPage(value => value + 1)}/> : null}
    {applied ? <p role="status">{applied.status === "held" ? "安排待核对" : `已采用 ${applied.applied_ids.length} 项安排`}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="edupi-material-inbox__row">
      {onPreview ? <button type="button" onClick={onPreview}>预览原材料</button> : null}
      <button type="button" disabled={busy || applying} onClick={() => void load()}>重新读取</button>
      <button type="button" disabled={!current || !materialScheduleCanApply(current) || busy || applying || Boolean(applied && applied.status !== "held")}
        onClick={() => void adopt()}>{applying ? "采用中…" : "确认采用"}</button>
    </div>
    </div>
  </details>;
}
