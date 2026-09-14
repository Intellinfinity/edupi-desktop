"use client";

import { useCallback, useEffect, useState } from "react";
import type { EducationContract } from "@/lib/edupi-education-contract";
import { FACT_KIND_LABELS, factStatusLabel, type DeletedEducationFact, type DeletedEducationFactPage, type FactMutationInput } from "@/lib/edupi-fact-lifecycle-model";
import { EDUPI_FACTS_UPDATED_EVENT } from "@/lib/edupi-ui-events";
import { runSerializedFactMutation } from "@/lib/edupi-fact-mutation-client";

const PAGE_SIZE = 20;

function restoreConflict(fact: DeletedEducationFact) {
  return fact.restoreMode === "replace" && fact.restoreConflictCount === 1 && fact.restoreConflicts.length === 1 ? fact.restoreConflicts[0] : null;
}

export function EduPiDeletedFacts({ data, reviewer, onEducation }: { data: EducationContract; reviewer: string; onEducation: (data: EducationContract) => void }) {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<DeletedEducationFactPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/edupi/facts/deleted?offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`, { cache: "no-store", signal });
      const value = await response.json() as DeletedEducationFactPage & { error?: string };
      if (!response.ok || !Array.isArray(value.facts)) throw new Error(value.error || "删除事实读取失败");
      setResult(value);
      if (page > 0 && value.total <= page * PAGE_SIZE) setPage(Math.max(0, Math.ceil(value.total / PAGE_SIZE) - 1));
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(caught instanceof Error ? caught.message : "删除事实读取失败");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [page]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refresh]);

  useEffect(() => {
    const reload = () => setRefresh((value) => value + 1);
    window.addEventListener(EDUPI_FACTS_UPDATED_EVENT, reload);
    return () => window.removeEventListener(EDUPI_FACTS_UPDATED_EVENT, reload);
  }, []);

  const restore = async (fact: DeletedEducationFact) => {
    if (busy) return;
    const conflict = restoreConflict(fact);
    const input: FactMutationInput = { action: "restore", expectedRevision: fact.revision, reviewer: reviewer.trim() || "teacher", supersedesFactId: conflict?.factId || null, supersedesFactRevision: conflict?.revision ?? null };
    setBusy(fact.factId); setError(null);
    try {
      await runSerializedFactMutation(async () => {
        const response = await fetch(`/api/edupi/facts/${encodeURIComponent(fact.factId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
        const value = await response.json() as { data?: EducationContract; error?: string };
        if (!response.ok || !value.data) throw new Error(value.error || "事实恢复失败");
        onEducation(value.data);
        window.dispatchEvent(new Event(EDUPI_FACTS_UPDATED_EVENT));
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "事实恢复失败"); }
    finally { setBusy(null); }
  };

  const total = result?.total || 0;
  return <details className="edupi-deleted-facts">
    <summary>已删除事实 <span>{loading && !result ? "…" : total}</span></summary>
    <div>{error ? <p role="alert">{error} <button type="button" onClick={() => setRefresh((value) => value + 1)}>重试</button></p> : null}{result?.facts.map((fact) => {
      const conflict = restoreConflict(fact);
      const conflictValue = conflict ? data.factSpine?.acceptedFacts.find((item) => item.id === conflict.factId)?.value : null;
      const blocked = fact.restoreMode === "blocked";
      const pending = fact.restoreMode === "pending_review";
      return <article key={fact.factId}><div><strong>{fact.value}</strong><span>{FACT_KIND_LABELS[fact.kind]} · 删除前{factStatusLabel(fact.deletedPreviousStatus)}{blocked ? " · 存在多条冲突" : pending ? " · 将恢复为待确认" : ""}</span></div><button type="button" disabled={Boolean(busy) || blocked} onClick={() => void restore(fact)} title={conflict ? `恢复后将替换：${conflictValue || conflict.factId}` : blocked ? "请先处理当前冲突事实" : pending ? "保留当前事实，并把此记录恢复为待确认" : undefined}>{busy === fact.factId ? "恢复中…" : conflict ? "恢复并替换" : pending ? "恢复为待确认" : "恢复"}</button></article>;
    })}{!loading && !error && total === 0 ? <p>暂无删除记录</p> : null}{total > PAGE_SIZE ? <nav aria-label="已删除事实分页"><button type="button" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>上一页</button><span>{page + 1} / {Math.ceil(total / PAGE_SIZE)}</span><button type="button" disabled={result?.nextOffset === null || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></nav> : null}</div>
  </details>;
}
