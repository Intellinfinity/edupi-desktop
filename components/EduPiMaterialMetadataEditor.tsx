"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { EducationContract, EducationTeacherMaterial } from "@/lib/edupi-education-contract";
import { appendTeacherInputSlot } from "@/lib/edupi-teacher-input-slot";
import {
  MATERIAL_METADATA_FIELDS,
  materialMetadataPatch,
  materialMetadataValues,
  sameMaterialMetadataValues,
  type MaterialMetadataKind,
  type MaterialMetadataValues,
  type MaterialMetadataVersion,
  type MaterialMetadataVersionHistory,
  type MaterialMetadataVersionSide,
} from "@/lib/edupi-material-metadata-model";
import { EduPiIconButton } from "./EduPiActionIcon";

const KIND_LABELS: Record<MaterialMetadataKind, string> = {
  worksheet: "学案 / 练习",
  lesson_note: "教案 / 备课",
  assessment: "测验 / 作业",
  classroom_record: "课堂记录",
  other: "其他",
};
const FIELD_LABELS = { title: "名称", kind: "类型", subject: "学科", class_id: "班级" } as const;
const SOURCE_LABELS = { teacher_edit: "手动修改", agent_update: "AI 协作", restore: "版本恢复" } as const;
type MaterialMetadataDraft = { baseRevision: number; baseValues: MaterialMetadataValues; values: MaterialMetadataValues };

function normalizedDraftValues(values: MaterialMetadataValues): MaterialMetadataValues {
  return { title: values.title.trim(), kind: values.kind, subject: values.subject?.trim() || null, classId: values.classId?.trim() || null };
}

function valueLabel(field: keyof typeof FIELD_LABELS, values: MaterialMetadataValues): string {
  if (field === "kind") return KIND_LABELS[values.kind];
  if (field === "class_id") return values.classId || "未设置";
  if (field === "subject") return values.subject || "未设置";
  return values.title;
}

function History({ material, history, loading, error, open, busy, restoring, onToggle, onRetry, onRestore }: {
  material: EducationTeacherMaterial;
  history: MaterialMetadataVersionHistory | null;
  loading: boolean;
  error: string | null;
  open: boolean;
  busy: boolean;
  restoring: string | null;
  onToggle: (open: boolean) => void;
  onRetry: () => void;
  onRestore: (version: MaterialMetadataVersion, side: MaterialMetadataVersionSide) => void;
}) {
  const current = materialMetadataValues(material);
  const historyIsCurrent = history?.revision === material.metadata_revision;
  return <details className="edupi-material-metadata-history" open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
    <summary>信息历史 <span>{historyIsCurrent && history ? history.historyCount : material.metadata_history_count}</span></summary>
    <div>{loading ? <p>正在读取…</p> : error ? <p className="is-error" role="alert">{error} <button type="button" onClick={onRetry}>重试</button></p> : !historyIsCurrent && material.metadata_history_count > 0 ? <p>正在读取…</p> : history && history.versions.length > 0 ? <>
      <p className="edupi-material-metadata-history__notice">恢复会同时替换名称、类型、学科和班级。</p>
      <ol>{history.versions.slice().reverse().map((version) => <li key={version.versionId}>
        <header><div><strong>版本 {version.revision}</strong><span>{SOURCE_LABELS[version.sourceKind]}</span></div><time>{new Date(version.changedAt).toLocaleString("zh-CN")}</time></header>
        <small>修改了 {version.changedFields.map((field) => FIELD_LABELS[field]).join("、")}</small>
        <div className="edupi-material-metadata-history__sides">{(["before", "after"] as const).map((side) => {
          const sideValues = side === "before" ? version.beforeValues : version.afterValues;
          const label = side === "before" ? "修改前" : "修改后";
          const currentSide = sameMaterialMetadataValues(current, sideValues);
          const key = `${version.versionId}:${side}`;
          return <section key={side}><header><strong>{label}</strong>{currentSide ? <span>当前信息</span> : <button type="button" disabled={busy} onClick={() => onRestore(version, side)}>{restoring === key ? "恢复中…" : `恢复${label}`}</button>}</header><dl>{MATERIAL_METADATA_FIELDS.map((field) => <div key={field}><dt>{FIELD_LABELS[field]}</dt><dd title={valueLabel(field, sideValues)}>{valueLabel(field, sideValues)}</dd></div>)}</dl></section>;
        })}</div>
      </li>)}</ol>
    </> : <p>暂无信息历史</p>}</div>
  </details>;
}

export function EduPiMaterialMetadataEditor({ material, classes, onEducation, onStartAgent }: {
  material: EducationTeacherMaterial;
  classes: string[];
  onEducation: (data: EducationContract) => void;
  onStartAgent: (prompt: string, mode?: "insert" | "replace") => void;
}) {
  const [editor, setEditor] = useState<MaterialMetadataDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<MaterialMetadataVersionHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const activeMaterialId = useRef(material.material_id);
  const historyAbort = useRef<AbortController | null>(null);
  const mutationAbort = useRef<AbortController | null>(null);
  const classOptions = [...new Set([material.class_id, ...classes].filter((value): value is string => typeof value === "string" && Boolean(value.trim())))];
  const editorBaseRevision = editor?.baseRevision;
  const normalizedEditor = editor ? normalizedDraftValues(editor.values) : null;
  const editorPatch = editor && normalizedEditor ? materialMetadataPatch(editor.baseValues, normalizedEditor) : {};

  useEffect(() => {
    activeMaterialId.current = material.material_id;
    historyAbort.current?.abort(); mutationAbort.current?.abort();
    historyAbort.current = null; mutationAbort.current = null;
    setEditor(null); setBusy(false); setMessage(null); setHistoryOpen(false); setHistory(null); setHistoryLoading(false); setHistoryError(null); setRestoring(null);
    return () => {
      if (activeMaterialId.current === material.material_id) activeMaterialId.current = "";
      historyAbort.current?.abort(); mutationAbort.current?.abort();
    };
  }, [material.material_id]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), message.tone === "error" ? 8000 : 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (editorBaseRevision === undefined || editorBaseRevision === material.metadata_revision) return;
    setEditor(null);
    setMessage({ tone: "error", text: "材料信息已在其他入口更新，请重新打开后修改" });
  }, [editorBaseRevision, material.metadata_revision]);

  const loadHistory = useCallback(async () => {
    if (historyAbort.current) return;
    const requestedMaterialId = material.material_id;
    const controller = new AbortController();
    historyAbort.current = controller;
    setHistoryLoading(true); setHistoryError(null);
    try {
      const response = await fetch(`/api/edupi/materials/${encodeURIComponent(requestedMaterialId)}/metadata/versions`, { cache: "no-store", signal: controller.signal });
      const result = await response.json() as { data?: EducationContract; history?: MaterialMetadataVersionHistory; error?: string };
      if (!response.ok || !result.data || !result.history) throw new Error(result.error || "材料信息历史读取失败");
      if (activeMaterialId.current !== requestedMaterialId) return;
      onEducation(result.data);
      setHistory(result.history);
    } catch (error) {
      if (!controller.signal.aborted && activeMaterialId.current === requestedMaterialId) setHistoryError(error instanceof Error ? error.message : "材料信息历史读取失败");
    } finally {
      if (historyAbort.current === controller) historyAbort.current = null;
      if (activeMaterialId.current === requestedMaterialId) setHistoryLoading(false);
    }
  }, [material.material_id, onEducation]);

  useEffect(() => {
    if (historyOpen && !historyLoading && !historyError && history?.revision !== material.metadata_revision) void loadHistory();
  }, [history?.revision, historyError, historyLoading, historyOpen, loadHistory, material.metadata_revision]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor || !normalizedEditor || busy) return;
    if (editor.baseRevision !== material.metadata_revision) {
      setEditor(null);
      setMessage({ tone: "error", text: "材料信息已在其他入口更新，请重新打开后修改" });
      return;
    }
    if (Object.keys(editorPatch).length === 0) { setEditor(null); return; }
    const requestedMaterialId = material.material_id;
    const controller = new AbortController();
    mutationAbort.current = controller;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/edupi/materials/${encodeURIComponent(requestedMaterialId)}/metadata`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: editor.baseRevision, patch: editorPatch }), signal: controller.signal });
      const result = await response.json() as { data?: EducationContract; history?: MaterialMetadataVersionHistory; error?: string };
      if (!response.ok || !result.data || !result.history) throw new Error(result.error || "材料信息保存失败");
      if (activeMaterialId.current !== requestedMaterialId) return;
      onEducation(result.data); setHistory(result.history); setEditor(null);
      setMessage({ tone: "success", text: "材料信息已更新" });
    } catch (error) { if (!controller.signal.aborted && activeMaterialId.current === requestedMaterialId) setMessage({ tone: "error", text: error instanceof Error ? error.message : "材料信息保存失败" }); }
    finally {
      if (mutationAbort.current === controller) mutationAbort.current = null;
      if (activeMaterialId.current === requestedMaterialId) setBusy(false);
    }
  };

  const restore = async (version: MaterialMetadataVersion, side: MaterialMetadataVersionSide) => {
    if (busy) return;
    const key = `${version.versionId}:${side}`;
    const requestedMaterialId = material.material_id;
    const controller = new AbortController();
    mutationAbort.current = controller;
    setBusy(true); setRestoring(key); setMessage(null);
    try {
      const response = await fetch(`/api/edupi/materials/${encodeURIComponent(requestedMaterialId)}/metadata/versions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId: version.versionId, versionSide: side, expectedRevision: material.metadata_revision }), signal: controller.signal });
      const result = await response.json() as { data?: EducationContract; history?: MaterialMetadataVersionHistory; error?: string };
      if (!response.ok || !result.data || !result.history) throw new Error(result.error || "材料信息恢复失败");
      if (activeMaterialId.current !== requestedMaterialId) return;
      onEducation(result.data); setHistory(result.history); setEditor(null);
      setMessage({ tone: "success", text: `已恢复版本 ${version.revision} 的${side === "before" ? "修改前" : "修改后"}信息` });
    } catch (error) { if (!controller.signal.aborted && activeMaterialId.current === requestedMaterialId) setMessage({ tone: "error", text: error instanceof Error ? error.message : "材料信息恢复失败" }); }
    finally {
      if (mutationAbort.current === controller) mutationAbort.current = null;
      if (activeMaterialId.current === requestedMaterialId) { setBusy(false); setRestoring(null); }
    }
  };

  const collaborate = () => {
    onStartAgent(appendTeacherInputSlot([
      `请协作修订材料“${material.title}”的信息。`,
      `当前类型：${KIND_LABELS[material.kind]}`,
      `当前学科：${material.subject || "未设置"}`,
      `当前班级：${material.class_id || "未设置"}`,
      "请给出修改候选，等我确认后再保存。",
    ].join("\n"), "我要补充或修改的材料信息（在这里输入或口述）："), "replace");
  };

  return <section className="edupi-material-metadata-editor">
    <header><h3>材料信息</h3><div><EduPiIconButton type="button" icon="edit" label="修改材料信息" className="is-primary" onClick={() => { const values = materialMetadataValues(material); setEditor({ baseRevision: material.metadata_revision, baseValues: values, values }); }} disabled={busy}/><EduPiIconButton type="button" icon="agent" label="AI 协作" onClick={collaborate} disabled={busy}/></div></header>
    {message ? <p className={`edupi-material-metadata-message is-${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}
    {editor ? <form onSubmit={save}><label><span>名称</span><input required maxLength={240} value={editor.values.title} onChange={(event) => setEditor({ ...editor, values: { ...editor.values, title: event.target.value } })} /></label><label><span>类型</span><select value={editor.values.kind} onChange={(event) => setEditor({ ...editor, values: { ...editor.values, kind: event.target.value as MaterialMetadataKind } })}>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>学科</span><input maxLength={120} value={editor.values.subject || ""} placeholder="可留空" onChange={(event) => setEditor({ ...editor, values: { ...editor.values, subject: event.target.value } })} /></label><label><span>班级</span>{classOptions.length > 0 ? <select value={editor.values.classId || ""} onChange={(event) => setEditor({ ...editor, values: { ...editor.values, classId: event.target.value } })}><option value="">未设置</option>{classOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select> : <input maxLength={160} value={editor.values.classId || ""} placeholder="可留空" onChange={(event) => setEditor({ ...editor, values: { ...editor.values, classId: event.target.value } })} />}</label><div><button type="button" onClick={() => setEditor(null)} disabled={busy}>取消</button><button type="submit" className="is-primary" disabled={busy || !normalizedEditor?.title || Object.keys(editorPatch).length === 0}>{busy ? "保存中…" : "保存"}</button></div></form> : null}
    <History material={material} history={history} loading={historyLoading} error={historyError} open={historyOpen} busy={busy} restoring={restoring} onToggle={setHistoryOpen} onRetry={() => void loadHistory()} onRestore={(version, side) => void restore(version, side)} />
  </section>;
}
