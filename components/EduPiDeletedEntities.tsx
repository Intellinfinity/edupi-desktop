"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import type { EducationEntityDeleteKind } from "@/lib/edupi-education-contract";
import type { EntityDeletionHistory, EntityDeletionRestoreRecord } from "@/lib/edupi-entity-delete";

const PAGE_SIZE = 8;
const kindLabels: Record<EducationEntityDeleteKind, string> = {
  calendar: "日程",
  timetable: "课程",
  memory: "记忆",
  student: "学生档案",
  task: "任务",
  material: "材料",
};

function time(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN");
}

function historyLabel(item: EntityDeletionHistory): string {
  return item.targetLabel || item.targetId;
}

export function EduPiDeletedEntities({
  activeCount,
  historyCount,
  onLoad,
  onRestore,
}: {
  activeCount: number;
  historyCount: number;
  onLoad: () => Promise<{ deletions: EntityDeletionRestoreRecord[]; history: EntityDeletionHistory[] }>;
  onRestore: (kind: EducationEntityDeleteKind, id: string, restoreRequestId: string, label: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [ledger, setLedger] = useState<{ deletions: EntityDeletionRestoreRecord[]; history: EntityDeletionHistory[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useModalDismiss<HTMLDivElement>(() => { if (!busy) setOpen(false); }, open);
  const ordered = useMemo(() => (ledger?.deletions ?? []).slice().sort((left, right) => right.deletedAt.localeCompare(left.deletedAt)), [ledger]);
  const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const visible = ordered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const recentHistory = useMemo(() => (ledger?.history ?? []).slice().sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, 50), [ledger]);
  useEffect(() => setPage((current) => Math.min(current, pages - 1)), [pages]);

  if (activeCount === 0 && historyCount === 0) return null;

  const show = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    try { setLedger(await onLoad()); }
    catch (cause) { setLedger(null); setError(cause instanceof Error ? cause.message : "删除记录读取失败"); }
    finally { setLoading(false); }
  };

  const restore = async (item: EntityDeletionRestoreRecord) => {
    const key = `${item.kind}:${item.id}`;
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await onRestore(item.kind, item.id, item.restoreRequestId, item.label || kindLabels[item.kind]);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "恢复失败");
    } finally {
      setBusy(null);
    }
  };

  return <>
    <button type="button" onClick={() => void show()}>{activeCount > 0 ? `已删除 ${activeCount}` : "删除记录"}</button>
    {open && typeof document !== "undefined" ? createPortal(<div className="edupi-deleted-entities-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <div ref={modalRef} className="edupi-deleted-entities" role="dialog" aria-modal="true" aria-labelledby="edupi-deleted-title" tabIndex={-1}>
        <header><h2 id="edupi-deleted-title">已删除</h2><button type="button" data-autofocus disabled={Boolean(busy)} onClick={() => setOpen(false)} aria-label="关闭已删除记录">×</button></header>
        {error ? <p className="edupi-deleted-entities__message" role="alert">{error}</p> : null}
        {loading ? <p className="edupi-deleted-entities__empty" role="status">正在读取…</p> : visible.length > 0 ? <ol className="edupi-deleted-entities__list">{visible.map((item) => {
          const key = `${item.kind}:${item.id}`;
          return <li key={key}><div><strong>{item.label || kindLabels[item.kind]}</strong><span>{kindLabels[item.kind]} · {time(item.deletedAt)}</span><small>{item.id}</small>{item.note ? <p>{item.note}</p> : null}</div><button type="button" disabled={Boolean(busy)} onClick={() => void restore(item)}>{busy === key ? "恢复中…" : "恢复"}</button></li>;
        })}</ol> : !error ? <p className="edupi-deleted-entities__empty">当前没有已删除项目</p> : null}
        {pages > 1 ? <nav className="edupi-deleted-entities__pagination" aria-label="已删除项目分页"><button type="button" disabled={page === 0 || Boolean(busy)} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page + 1} / {pages}</span><button type="button" disabled={page >= pages - 1 || Boolean(busy)} onClick={() => setPage((value) => value + 1)}>下一页</button></nav> : null}
        {recentHistory.length > 0 ? <details className="edupi-deleted-entities__history"><summary>操作记录 <span>{historyCount}</span></summary><ol>{recentHistory.map((item) => <li key={item.historyId}><div><strong>{item.action === "delete" ? "删除" : "恢复"} · {historyLabel(item)}</strong><span>{kindLabels[item.kind]} · 记录版本 {item.tombstoneRevision}</span></div><time>{time(item.occurredAt)}</time>{item.note ? <p>{item.note}</p> : null}</li>)}</ol></details> : null}
      </div>
    </div>, document.body) : null}
  </>;
}
