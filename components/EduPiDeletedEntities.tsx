"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  teaching_priority: "教学重点",
};

function time(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN");
}

function historyLabel(item: EntityDeletionHistory): string {
  return item.targetLabel || item.targetId;
}

function RefreshIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8.5A7 7 0 0 1 18.8 7L20 12M4 12l1.2 5A7 7 0 0 0 17.9 15.5" /></svg>;
}

export function deletedHistoryBadgeCount(summaryCount: number, loadedCount: number): number {
  return Math.max(summaryCount, loadedCount);
}

export function EduPiDeletedEntities({
  activeCount,
  historyCount,
  countUnavailable = false,
  onLoad,
  onRestore,
}: {
  activeCount: number;
  historyCount: number;
  countUnavailable?: boolean;
  onLoad: () => Promise<{ deletions: EntityDeletionRestoreRecord[]; history: EntityDeletionHistory[] }>;
  onRestore: (kind: EducationEntityDeleteKind, id: string, restoreRequestId: string, label: string) => Promise<void>;
}) {
  const [ledger, setLedger] = useState<{ deletions: EntityDeletionRestoreRecord[]; history: EntityDeletionHistory[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ordered = useMemo(() => (ledger?.deletions ?? []).slice().sort((left, right) => right.deletedAt.localeCompare(left.deletedAt)), [ledger]);
  const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const visible = ordered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const recentHistory = useMemo(() => (ledger?.history ?? []).slice().sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, 50), [ledger]);
  const visibleHistoryCount = deletedHistoryBadgeCount(historyCount, ledger?.history.length ?? 0);
  const visibleActiveCount = Math.max(activeCount, ledger?.deletions.length ?? 0);
  useEffect(() => setPage((current) => Math.min(current, pages - 1)), [pages]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setLedger(await onLoad()); }
    catch (cause) { setLedger(null); setError(cause instanceof Error ? cause.message : "删除记录读取失败"); }
    finally { setLoading(false); }
  }, [onLoad]);

  useEffect(() => { void load(); }, [load]);

  const restore = async (item: EntityDeletionRestoreRecord) => {
    const key = `${item.kind}:${item.id}`;
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await onRestore(item.kind, item.id, item.restoreRequestId, item.label || kindLabels[item.kind]);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "恢复失败");
    } finally {
      setBusy(null);
    }
  };

  return <section className="edupi-admin-recycle" aria-label="回收站">
    <div className="edupi-admin-recycle__toolbar">
      <span>{countUnavailable && !ledger ? "数量暂不可用" : `${visibleActiveCount} 项可恢复`}</span>
      <button type="button" disabled={loading || Boolean(busy)} onClick={() => void load()} aria-label="刷新回收站" title="刷新回收站"><RefreshIcon /></button>
    </div>
    {error ? <p className="edupi-admin-recycle__message" role="alert">{error}</p> : null}
    {loading ? <div className="edupi-admin-recycle__empty" role="status">正在读取…</div> : visible.length > 0 ? <ol className="edupi-admin-recycle__list">{visible.map((item) => {
      const key = `${item.kind}:${item.id}`;
      return <li key={key}><div><strong>{item.label || kindLabels[item.kind]}</strong><span>{kindLabels[item.kind]} · {time(item.deletedAt)}</span>{item.note ? <p>{item.note}</p> : null}<details><summary>技术详情</summary><code>{item.id}</code></details></div><button type="button" disabled={Boolean(busy)} onClick={() => void restore(item)}>{busy === key ? "恢复中…" : "恢复"}</button></li>;
    })}</ol> : !error ? <div className="edupi-admin-recycle__empty">当前没有可恢复项目</div> : null}
    {pages > 1 ? <nav className="edupi-admin-recycle__pagination" aria-label="回收站分页"><button type="button" aria-label="上一页" disabled={page === 0 || Boolean(busy)} onClick={() => setPage((value) => value - 1)}>‹</button><span>{page + 1} / {pages}</span><button type="button" aria-label="下一页" disabled={page >= pages - 1 || Boolean(busy)} onClick={() => setPage((value) => value + 1)}>›</button></nav> : null}
    {recentHistory.length > 0 ? <details className="edupi-admin-recycle__history"><summary>操作记录 <span>{visibleHistoryCount}</span></summary><ol>{recentHistory.map((item) => <li key={item.historyId}><div><strong>{item.action === "delete" ? "删除" : "恢复"} · {historyLabel(item)}</strong><span>{kindLabels[item.kind]} · 记录版本 {item.tombstoneRevision}</span></div><time>{time(item.occurredAt)}</time>{item.note ? <p>{item.note}</p> : null}</li>)}</ol></details> : null}
  </section>;
}
