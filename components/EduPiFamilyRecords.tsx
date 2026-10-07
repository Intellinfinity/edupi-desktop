"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { EducationContract } from "@/lib/edupi-education-contract";
import { buildFamilyGraph } from "@/lib/edupi-family-graph";
import { familyQualityLabel, type FamilyCaptureInput, type FamilyPerson, type FamilyQuality, type FamilyRecord, type FamilyRecordDetails, type FamilyRecordPage } from "@/lib/edupi-family-record-model";
import { EDUPI_STUDENT_RECORDS_UPDATED_EVENT } from "@/lib/edupi-ui-events";
import { EduPiStudentGraph } from "./EduPiStudentGraph";

const styles = { panel: "edupi-family-panel", toolbar: "edupi-family-toolbar", record: "edupi-family-record", identity: "edupi-family-identity",
  actions: "edupi-family-actions", editor: "edupi-family-editor", history: "edupi-family-history", error: "edupi-family-error" };

const statusLabels: Record<FamilyRecord["status"], string> = { candidate: "待确认", pending_review: "待确认", held: "已暂缓", accepted: "已确认", rejected: "已拒绝", stale: "来源已更新", superseded: "已有修订", deleted: "已删除" };
const actionLabels = { accept: "接受", reject: "拒绝", hold: "暂缓", modify: "修改", delete: "删除", restore: "恢复" };
const emptyDetails: FamilyRecordDetails = { recorded_relationship: null, teacher_explicit_quality: "unknown", observed_on: null, note: "" };
type Editor = { id: string; at: string; contactId: string; name: string; details: FamilyRecordDetails; row: FamilyRecord | null };

async function readPage(studentId: string, offset: number, signal: AbortSignal): Promise<FamilyRecordPage> {
  const response = await fetch(`/api/edupi/family-records?${new URLSearchParams({ student_id: studentId, offset: String(offset), limit: "10" })}`, { signal, cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "家校记录读取失败");
  if (payload.studentId !== studentId || payload.offset !== offset || payload.limit !== 10 || !Array.isArray(payload.records) || !Array.isArray(payload.parents)
    || !Number.isSafeInteger(payload.total) || payload.total < 0 || payload.externalSend !== false) throw new Error("家校记录响应无效");
  return payload as FamilyRecordPage;
}
function normalizedDetails(details: FamilyRecordDetails): FamilyRecordDetails {
  return { recorded_relationship: details.recorded_relationship?.normalize("NFKC").trim() || null, teacher_explicit_quality: details.teacher_explicit_quality,
    observed_on: details.observed_on || null, note: details.note.normalize("NFKC").trim() };
}

export function EduPiFamilyRecords({ studentId, studentName, reviewer, onEducation }: { studentId: string; studentName: string; reviewer: string; onEducation: (data: EducationContract) => void }) {
  const [page, setPage] = useState<FamilyRecordPage | null>(null);
  const [view, setView] = useState<"graph" | "list">("graph");
  const [offset, setOffset] = useState(0);
  const [previousOffsets, setPreviousOffsets] = useState<number[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    requestRef.current?.abort(); requestRef.current = controller;
    setLoading(true); setError(null);
    void readPage(studentId, offset, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setPage(result); setSelected((id) => result.records.some((row) => row.fact_id === id) ? id : null); }
    }).catch((reason) => { if (!controller.signal.aborted) { setPage(null); setError(reason instanceof Error ? reason.message : "读取失败"); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [studentId, offset, refresh]);
  useEffect(() => {
    const changed = () => setRefresh((value) => value + 1);
    window.addEventListener(EDUPI_STUDENT_RECORDS_UPDATED_EVENT, changed);
    return () => window.removeEventListener(EDUPI_STUDENT_RECORDS_UPDATED_EVENT, changed);
  }, []);
  const visible = page?.studentId === studentId ? page : null;
  const parents = useMemo(() => new Map((visible?.parents || []).map((parent) => [parent.entity_id, parent])), [visible?.parents]);
  const graph = useMemo(() => buildFamilyGraph({ id: visible?.studentEntity?.entity_id || "", label: studentName }, visible?.parents || [], visible?.records || []), [studentName, visible]);
  const reload = () => { setRefresh((value) => value + 1); window.dispatchEvent(new Event("edupi-education-refresh")); };

  async function mutate(row: FamilyRecord, action: "accept" | "hold" | "reject" | "modify" | "delete" | "restore", details?: FamilyRecordDetails, replace = false) {
    if (busy || loading || error || !row.mutation_allowed) return;
    setBusy(true); setError(null);
    const base = { expectedRevision: row.revision, reviewer: row.source.actor_ref };
    const conflict = replace && row.review_conflict_count === 1 ? row.review_conflicts[0] : null;
    if (replace && !conflict) { setBusy(false); setError("旧记录已变化，请刷新后核对"); return; }
    const body = action === "modify" ? { ...base, action, replacementValue: JSON.stringify({ ...row.record, ...normalizedDetails(details!) }), note: null }
      : action === "delete" ? { ...base, action }
        : action === "restore" ? { ...base, action, supersedesFactId: conflict?.fact_id || null, supersedesFactRevision: conflict?.revision ?? null }
          : { ...base, action: "review", decision: action, note: null, supersedesFactId: conflict?.fact_id || null, supersedesFactRevision: conflict?.revision ?? null };
    try {
      const response = await fetch(`/api/edupi/facts/${encodeURIComponent(row.fact_id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "记录操作失败");
      onEducation(payload.data); setEditor(null); setDeleting(null); setOffset(0); setPreviousOffsets([]);
      setSelected(action === "delete" ? null : payload.result?.resultFactId || null); reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败"); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || busy) return;
    if (editor.row) { await mutate(editor.row, "modify", editor.details); return; }
    setBusy(true); setError(null);
    const details = normalizedDetails(editor.details);
    const input: FamilyCaptureInput = { studentId, parentEntityId: editor.contactId || null,
      parent: editor.contactId ? null : { external_id: `family-${editor.id}`, label: editor.name.normalize("NFKC").trim() }, record: details,
      source: { source_id: `desktop-family-${editor.id}`, source_revision: "1", raw_text: [`联系人：${editor.contactId || editor.name}`, `记录称谓：${editor.details.recorded_relationship || "未记录"}`,
        `沟通状态：${familyQualityLabel(editor.details.teacher_explicit_quality)}`, `沟通日期：${editor.details.observed_on || "未记录"}`, editor.details.note].join("\n"), observed_at: editor.at, actor_ref: reviewer.normalize("NFKC").trim() } };
    try {
      const response = await fetch("/api/edupi/family-records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "记录未写入");
      setEditor(null); setOffset(0); setPreviousOffsets([]); reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "记录未写入"); }
    finally { setBusy(false); }
  }
  const form = editor ? <form className={styles.editor} onSubmit={save} aria-label={editor.row ? "修改家校记录" : "添加家校记录"}><fieldset disabled={busy}>
    {!editor.row ? <><label>联系人<select value={editor.contactId} onChange={(event) => setEditor({ ...editor, contactId: event.target.value })}><option value="">新联系人</option>{[...parents.values()].filter((parent) => parent.status === "active").map((parent) => <option key={parent.entity_id} value={parent.entity_id}>{parent.canonical_name}</option>)}</select></label>{!editor.contactId ? <label>联系人名称<input required maxLength={240} value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label> : null}</> : null}
    <label>记录称谓<input maxLength={120} value={editor.details.recorded_relationship || ""} onChange={(event) => setEditor({ ...editor, details: { ...editor.details, recorded_relationship: event.target.value || null } })} /></label>
    <label>沟通状态<select value={editor.details.teacher_explicit_quality} onChange={(event) => setEditor({ ...editor, details: { ...editor.details, teacher_explicit_quality: event.target.value as FamilyQuality } })}><option value="unknown">未判断</option><option value="supportive">配合</option><option value="tense">紧张</option></select></label>
    <label>沟通日期<input type="date" value={editor.details.observed_on || ""} onChange={(event) => setEditor({ ...editor, details: { ...editor.details, observed_on: event.target.value || null } })} /></label>
    <label>教师记录<textarea required maxLength={2000} rows={4} value={editor.details.note} onChange={(event) => setEditor({ ...editor, details: { ...editor.details, note: event.target.value } })} /></label>
    <div className={styles.actions}><button type="submit" className="native-button" disabled={busy || loading || !visible || visible.sourceStatus !== "current" || !editor.details.note.trim()}>{busy ? "保存中…" : "保存"}</button><button type="button" className="native-button" disabled={busy} onClick={() => setEditor(null)}>取消</button></div>
  </fieldset></form> : null;
  function recordView(row: FamilyRecord) {
    const parent: FamilyPerson | undefined = parents.get(row.parent_entity_id);
    const blocked = busy || loading || Boolean(error) || editor !== null;
    return <article className={styles.record} key={row.fact_id}>
      <header><strong>{parent?.canonical_name || "联系人"}</strong><span>{statusLabels[row.status]}</span><time>{row.record.observed_on || "日期未记录"}</time></header>
      <div className={styles.identity}>{row.record.recorded_relationship ? `记录称谓：${row.record.recorded_relationship} · ` : ""}监护身份待核实</div>
      <p>{row.record.note}</p><span>{familyQualityLabel(row.display_quality)}</span>
      {!row.mutation_allowed ? <p role="status">来源已失效，保留历史记录</p> : null}
      {row.review_conflicts.length ? <details open><summary>需要核对的旧记录</summary>{row.review_conflicts.map((conflict) => <div key={conflict.fact_id}><time>{conflict.record.observed_on || "日期未记录"}</time><p>{conflict.record.note}</p><span>旧记录：{familyQualityLabel(conflict.record.teacher_explicit_quality)}</span></div>)}</details> : null}
      <div className={styles.actions}>{row.mutation_allowed && ["candidate", "pending_review", "held"].includes(row.status) ? <>{row.review_mode !== "blocked" ? <button type="button" className="native-button" disabled={blocked} onClick={() => void mutate(row, "accept", undefined, row.review_mode === "replace")}>{row.review_mode === "replace" ? "替换旧记录" : "接受"}</button> : <span>旧记录存在多项冲突，暂不能采用</span>}{(["hold", "reject"] as const).map((action) => <button type="button" className="native-button" disabled={blocked} key={action} onClick={() => void mutate(row, action)}>{actionLabels[action]}</button>)}</> : null}
        {row.mutation_allowed && row.status === "accepted" ? <button type="button" className="native-button" disabled={blocked} onClick={() => setEditor({ id: crypto.randomUUID(), at: new Date().toISOString(), contactId: row.parent_entity_id, name: parent?.canonical_name || "", details: { ...row.record }, row })}>修改</button> : null}
        {row.mutation_allowed && row.status === "deleted" ? row.restore_mode === "blocked" ? <span>旧记录存在多项冲突，暂不能恢复</span> : <button type="button" className="native-button" disabled={blocked} onClick={() => void mutate(row, "restore", undefined, row.restore_mode === "replace")}>{row.restore_mode === "replace" ? "替换并恢复" : row.restore_mode === "pending_review" ? "恢复为待确认" : "恢复"}</button> : row.mutation_allowed && row.status !== "superseded" ? <button type="button" className="native-button" disabled={blocked} onClick={() => setDeleting(row.fact_id)}>删除</button> : null}
      </div>
      {deleting === row.fact_id ? <div className={styles.actions}><span>删除这条记录？</span><button type="button" className="native-button" disabled={busy} onClick={() => void mutate(row, "delete")}>确认删除</button><button type="button" className="native-button" disabled={busy} onClick={() => setDeleting(null)}>取消</button></div> : null}
      {editor?.row?.fact_id === row.fact_id ? form : null}
      <details><summary>来源</summary><p>{row.source.raw_text}</p><dl><dt>记录者</dt><dd>{row.source.actor_ref}</dd><dt>来源时间</dt><dd>{new Date(row.source.observed_at).toLocaleString("zh-CN")}</dd><dt>来源版本</dt><dd>{row.source.source_revision}</dd><dt>入库时间</dt><dd>{new Date(row.logged_at).toLocaleString("zh-CN")}</dd></dl></details>
      {row.history.length ? <details><summary>修订记录</summary><ol className={styles.history}>{row.history.map((item, index) => <li key={index}>{actionLabels[item.action]} · {new Date(item.reviewed_at).toLocaleString("zh-CN")}{item.note ? <p>{item.note}</p> : null}</li>)}</ol></details> : null}
    </article>;
  }
  const selectedRow = visible?.records.find((row) => row.fact_id === selected);
  const alert = error ? <p className={styles.error} role="alert">{error}<button type="button" className="native-button" onClick={reload}>刷新记录</button></p> : null;
  return <section className={styles.panel} aria-label="家校人物与记录">
    <div className={styles.toolbar}>{(["graph", "list"] as const).map((mode) => <button type="button" key={mode} disabled={busy || editor !== null} aria-pressed={view === mode} onClick={() => setView(mode)}>{mode === "graph" ? "人物图" : "记录"}</button>)}<button type="button" disabled={busy || loading || editor !== null || !visible || visible.sourceStatus !== "current"} onClick={() => setEditor({ id: crypto.randomUUID(), at: new Date().toISOString(), name: "", contactId: "", details: { ...emptyDetails }, row: null })}>添加记录</button></div>
    {view === "list" ? alert : null}{visible?.sourceStatus === "unavailable" ? <p role="status">学生来源不可用，保留历史记录</p> : null}{editor?.row === null ? form : null}
    {view === "graph" ? <EduPiStudentGraph projection={graph} total={graph.records.length} kind="family" selectedId={selected} onSelect={(id) => { if (!editor) setSelected(id); }} student={studentName} scope="本页记录" loading={loading} alert={alert} details={selectedRow ? recordView(selectedRow) : null} /> : loading ? <p role="status">读取中…</p> : visible?.records.length ? visible.records.map(recordView) : !error ? <p>暂无家校记录</p> : null}
    {view === "graph" && selectedRow ? recordView(selectedRow) : null}
    {visible ? <div className={styles.actions}><button type="button" className="native-button" disabled={busy || loading || editor !== null || previousOffsets.length === 0} onClick={() => { setSelected(null); setOffset(previousOffsets.at(-1)!); setPreviousOffsets((values) => values.slice(0, -1)); }}>上一页</button><span>{visible.total} 条记录</span><button type="button" className="native-button" disabled={busy || loading || editor !== null || visible.nextOffset === null} onClick={() => { setSelected(null); setPreviousOffsets((values) => [...values, offset]); setOffset(visible.nextOffset!); }}>下一页</button></div> : null}
  </section>;
}
