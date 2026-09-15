"use client";

import { useEffect, useRef, useState } from "react";

import type { StudentEvent } from "@/lib/edupi-student-events";
import { buildStudentGraph, STUDENT_GRAPH_PAGE_SIZE, STUDENT_GRAPH_RECORD_LIMIT } from "@/lib/edupi-student-graph";
import type { StudentSemesterRange } from "@/lib/edupi-student-semester";
import { EDUPI_STUDENT_RECORDS_UPDATED_EVENT } from "@/lib/edupi-ui-events";
import { EduPiStudentGraph } from "./EduPiStudentGraph";

type StudentEventKind = StudentEvent["kind"];
type StudentEventView = "list" | "graph";

type Props = {
  student: string | null;
  studentId?: string;
  studentClass?: string;
  semesterRange?: StudentSemesterRange | null;
  onAgent: (prompt: string, mode?: "insert" | "replace") => void;
  query?: string;
};

function eventQuery({ kind, offset, search, student, studentId, from, to }: { kind: StudentEventKind; offset: number; search: string; student: string | null; studentId?: string; from: string; to: string }): URLSearchParams {
  return new URLSearchParams({
    kind,
    offset: String(offset),
    query: search,
    ...(studentId ? { student_id: studentId } : student ? { student } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
}

async function readEvents(query: URLSearchParams, signal: AbortSignal): Promise<{ records: StudentEvent[]; total: number }> {
  const response = await fetch(`/api/edupi/student-events?${query}`, { signal, cache: "no-store" });
  const payload = await response.json() as { records?: unknown; total?: unknown; error?: unknown };
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "读取失败");
  if (!Array.isArray(payload.records) || !Number.isSafeInteger(payload.total) || Number(payload.total) < 0) throw new Error("学生记录响应无效");
  return { records: payload.records as StudentEvent[], total: Number(payload.total) };
}

export function EduPiStudentEvents({ student, studentId, studentClass, semesterRange = null, onAgent, query: search = "" }: Props) {
  const [kind, setKind] = useState<StudentEventKind>("learning");
  const [page, setPage] = useState(0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [alias, setAlias] = useState("");
  const [canonical, setCanonical] = useState("");
  const [view, setView] = useState<StudentEventView>(student ? "graph" : "list");
  const [selectedRecord, setSelectedRecord] = useState<string | null>(null);
  const [records, setRecords] = useState<StudentEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<StudentEvent | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generationRef = useRef(0);
  const loadMoreRef = useRef<AbortController | null>(null);

  useEffect(() => setPage(0), [search]);
  useEffect(() => setSelectedRecord(null), [from, kind, page, student, studentId, to, view]);
  useEffect(() => {
    const changed = () => setRefresh((value) => value + 1);
    window.addEventListener(EDUPI_STUDENT_RECORDS_UPDATED_EVENT, changed);
    return () => {
      window.removeEventListener(EDUPI_STUDENT_RECORDS_UPDATED_EVENT, changed);
      loadMoreRef.current?.abort();
    };
  }, []);
  useEffect(() => {
    const generation = ++generationRef.current;
    loadMoreRef.current?.abort();
    setLoadingMore(false);
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setRecords([]);
    setTotal(0);
    const offset = view === "graph" ? 0 : page * STUDENT_GRAPH_PAGE_SIZE;
    const params = eventQuery({ kind, offset, search, student, studentId, from, to });
    void readEvents(params, controller.signal).then((result) => {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      if (view === "list" && page > 0 && offset >= result.total) {
        setPage(Math.max(0, Math.ceil(result.total / STUDENT_GRAPH_PAGE_SIZE) - 1));
        return;
      }
      setRecords(result.records);
      setTotal(result.total);
      setSelectedRecord((current) => buildStudentGraph(result.records).records.some((record) => record.id === current) ? current : null);
    }).catch((reason) => {
      if (!controller.signal.aborted && generation === generationRef.current) setError(reason instanceof Error ? reason.message : "读取失败");
    }).finally(() => {
      if (!controller.signal.aborted && generation === generationRef.current) setLoading(false);
    });
    return () => controller.abort();
  }, [from, kind, page, refresh, search, student, studentId, to, view]);

  const loadMore = async () => {
    if (view !== "graph" || loading || loadingMore || records.length >= total || records.length >= STUDENT_GRAPH_RECORD_LIMIT) return;
    loadMoreRef.current?.abort();
    const controller = new AbortController();
    loadMoreRef.current = controller;
    const generation = generationRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      const params = eventQuery({ kind, offset: records.length, search, student, studentId, from, to });
      const result = await readEvents(params, controller.signal);
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setRecords((current) => {
        const existing = new Set(current.map((record) => record.id));
        return [...current, ...result.records.filter((record) => !existing.has(record.id))].slice(0, STUDENT_GRAPH_RECORD_LIMIT);
      });
      setTotal(result.total);
    } catch (reason) {
      if (!controller.signal.aborted && generation === generationRef.current) setError(reason instanceof Error ? reason.message : "更多记录读取失败");
    } finally {
      if (loadMoreRef.current === controller) loadMoreRef.current = null;
      if (!controller.signal.aborted && generation === generationRef.current) setLoadingMore(false);
    }
  };

  const save = async (item: StudentEvent, action: "update_event" | "delete_event") => {
    setBusy(true);
    setError(null);
    try {
      const body = { action, event_id: item.id, expected_revision: item.revision, ...(action === "update_event" ? { summary: item.summary, topic: item.topic, observed_on: item.observed_on } : {}) };
      const response = await fetch("/api/edupi/student-events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "保存失败");
      setEditing(null);
      setDeleting(null);
      if (action === "delete_event") setSelectedRecord(null);
      window.dispatchEvent(new Event(EDUPI_STUDENT_RECORDS_UPDATED_EVENT));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally { setBusy(false); }
  };

  const setDateFrom = (value: string) => {
    setFrom(value);
    if (value && to && value > to) setTo(value);
    setPage(0);
  };
  const setDateTo = (value: string) => {
    setTo(value);
    setPage(0);
  };
  const useSemester = () => {
    if (!semesterRange) return;
    setFrom(semesterRange.from);
    setTo(semesterRange.to);
    setPage(0);
  };
  const clearDates = () => {
    setFrom("");
    setTo("");
    setPage(0);
  };
  const semesterActive = Boolean(semesterRange && from === semesterRange.from && to === semesterRange.to);
  const graphCanLoadMore = records.length < total && records.length < STUDENT_GRAPH_RECORD_LIMIT;

  return <section className="edupi-student-events" aria-label="学生学习与互动记录">
    <header><div role="group" aria-label="记录类型">{[["learning", student ? "知识图谱" : "学习表现"], ["interaction", student ? "人际互动网络" : "同伴互动"]].map(([value, label]) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => { setKind(value as StudentEventKind); setPage(0); setEditing(null); }}>{label}</button>)}</div><button type="button" onClick={() => onAgent(`请帮我记录${student || "学生"}的${kind === "learning" ? "学习表现" : "同伴互动"}，使用学生记录工具保存。${studentId ? `学生 ID：${studentId}。` : ""}${studentClass ? `班级：${studentClass}。` : ""}\n\n我观察到（在这里输入或口述）：`, "replace")}>对话记录</button></header>
    {error ? <p role="alert">{error}<button type="button" onClick={() => setRefresh((value) => value + 1)}>重试</button></p> : null}
    <div className="edupi-student-event-filters"><div role="group" aria-label="时间范围">{semesterRange ? <button type="button" aria-pressed={semesterActive} onClick={useSemester}>本学期</button> : null}<button type="button" aria-pressed={!from && !to} onClick={clearDates}>全部时间</button></div><label>从 <input type="date" value={from} onChange={(event) => setDateFrom(event.target.value)} /></label><label>到 <input type="date" value={to} min={from || undefined} onChange={(event) => setDateTo(event.target.value)} /></label></div>
    <div className="edupi-student-graph-toggle" role="group" aria-label="记录视图">{[["list", "列表"], ["graph", "网络图"]].map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => { setView(value as StudentEventView); setPage(0); setSelectedRecord(null); setEditing(null); }}>{label}</button>)}</div>
    {!loading && records.length > 0 && view === "graph" ? <EduPiStudentGraph records={records} total={total} kind={kind} selectedId={selectedRecord} onSelect={setSelectedRecord} /> : null}
    {view === "graph" && kind === "learning" ? <details><summary>合并知识点名称</summary><form onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { const response = await fetch("/api/edupi/student-events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_topic_alias", alias, canonical }) }); const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error || "保存失败"); setAlias(""); setCanonical(""); window.dispatchEvent(new Event(EDUPI_STUDENT_RECORDS_UPDATED_EVENT)); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); } finally { setBusy(false); } }}><label>原名称<input required maxLength={160} value={alias} onChange={(event) => setAlias(event.target.value)} /></label><label>统一名称<input required maxLength={160} value={canonical} onChange={(event) => setCanonical(event.target.value)} /></label><button disabled={busy} type="submit">保存</button></form></details> : null}
    {!loading && !error && records.length === 0 && view === "graph" && student ? <svg viewBox="0 0 360 150" width="100%" role="img" aria-label={`${student}暂无${kind === "learning" ? "知识点" : "同伴互动"}关联记录`}><circle cx="180" cy="60" r="36" fill="var(--ep-surface-soft)" stroke="var(--ep-border)" /><text x="180" y="65" textAnchor="middle" fill="var(--ep-text)" fontSize="13">{student}</text><text x="180" y="125" textAnchor="middle" fill="var(--ep-muted)" fontSize="11">暂无关联记录</text></svg> : null}
    {loading ? <p role="status">读取中…</p> : records.length === 0 ? <p>暂无记录</p> : (view === "graph" ? records.filter((record) => record.id === selectedRecord) : records).map((item) => <article key={item.id}>
      <header><strong>{(item.student_labels || item.students).join("、")}</strong>{item.class_name ? <span>{item.class_name}</span> : null}<time>{item.observed_on || "日期未明确"}</time></header>
      {editing?.id === item.id ? <form onSubmit={(event) => { event.preventDefault(); void save(editing, "update_event"); }}><label>内容<textarea value={editing.summary} maxLength={2000} required rows={3} onChange={(event) => setEditing({ ...editing, summary: event.target.value })} /></label><label>知识点<input value={editing.topic || ""} maxLength={120} onChange={(event) => setEditing({ ...editing, topic: event.target.value })} /></label><label>日期<input type="date" value={editing.observed_on || ""} onChange={(event) => setEditing({ ...editing, observed_on: event.target.value || null })} /></label><button disabled={busy} type="submit">保存</button><button disabled={busy} type="button" onClick={() => setEditing(null)}>取消</button></form> : <><p>{item.summary}</p>{item.topic ? <small>{item.topic}</small> : null}<div className="edupi-student-events__actions"><button type="button" onClick={() => setEditing(item)}>修改</button><button type="button" onClick={() => setDeleting(item.id)}>删除</button></div></>}
      {deleting === item.id ? <div><span>删除这条记录？</span><button disabled={busy} type="button" onClick={() => void save(item, "delete_event")}>确认删除</button><button type="button" onClick={() => setDeleting(null)}>取消</button></div> : null}
      <details><summary>原始对话</summary><p>{item.source.text}</p><a href={`/?edupi=1&module=home&view=chat&inspector=0&session=${encodeURIComponent(item.source.session_id)}`}>打开对话</a></details>
      {item.history.length ? <details className="edupi-student-event-history"><summary>修改历史 <span>{item.history_count ?? item.history.length}</span></summary>{item.history.slice().reverse().map((version) => <article key={`${version.revision}:${version.updated_at}`}><div><strong>{version.summary}</strong><time>{version.updated_at ? new Date(version.updated_at).toLocaleString("zh-CN") : "时间未记录"}</time></div>{version.topic ? <small>{version.topic}</small> : null}<button type="button" disabled={busy} onClick={() => void save({ ...item, summary: version.summary, topic: version.topic, observed_on: version.observed_on }, "update_event")}>恢复此版本</button></article>)}</details> : null}
    </article>)}
    {view === "graph" ? <footer><span aria-live="polite">已加载 {records.length} / {total}</span>{graphCanLoadMore ? <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "加载中…" : "加载更多"}</button> : total > STUDENT_GRAPH_RECORD_LIMIT ? <span>当前图谱显示前 {STUDENT_GRAPH_RECORD_LIMIT} 条</span> : null}</footer> : <footer><button type="button" disabled={page === 0 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page + 1} / {Math.max(1, Math.ceil(total / STUDENT_GRAPH_PAGE_SIZE))}</span><button type="button" disabled={(page + 1) * STUDENT_GRAPH_PAGE_SIZE >= total || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></footer>}
  </section>;
}
