"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { EducationContract, EducationEntityDeleteKind, EducationTeachingPriority } from "@/lib/edupi-education-contract";
import { filterTeachingPriorityItems, TEACHING_PRIORITY_STATUS_LABELS } from "@/lib/edupi-domain-navigation";
import { appendTeacherInputSlot } from "@/lib/edupi-teacher-input-slot";
import type { TeachingPriorityVersion, TeachingPriorityVersionHistory, TeachingPriorityVersionSide, TeachingPriorityValues } from "@/lib/edupi-teaching-priorities";

type Editor = {
  mode: "create" | "edit";
  priorityId: string | null;
  expectedRevision: number;
  subject: string;
  className: string;
  topic: string;
  note: string;
};

const STATUS_LABELS = TEACHING_PRIORITY_STATUS_LABELS;
const STATUS_ORDER = { active: 0, paused: 1, completed: 2 } as const;
const SOURCE_LABELS = { teacher_edit: "手动修改", agent_update: "AI 协作", restore: "版本恢复" } as const;
const FIELD_LABELS = { subject: "学科", class_name: "班级", topic: "主题", note: "说明", status: "状态" } as const;

function values(priority: EducationTeachingPriority): TeachingPriorityValues {
  return { subject: priority.subject, className: priority.className, topic: priority.topic, note: priority.note, status: priority.status };
}

function sameValues(left: TeachingPriorityValues, right: TeachingPriorityValues): boolean {
  return left.subject === right.subject && left.className === right.className && left.topic === right.topic && left.note === right.note && left.status === right.status;
}

function valueLabel(field: keyof typeof FIELD_LABELS, value: TeachingPriorityValues): string {
  if (field === "class_name") return value.className || "全部班级";
  if (field === "note") return value.note || "未填写";
  if (field === "status") return STATUS_LABELS[value.status];
  return value[field];
}

function PriorityVersionHistory({ priority, history, loading, error, busy, restoring, onOpen, onRestore }: {
  priority: EducationTeachingPriority;
  history: TeachingPriorityVersionHistory | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  restoring: string | null;
  onOpen: () => void;
  onRestore: (version: TeachingPriorityVersion, side: TeachingPriorityVersionSide) => void;
}) {
  const current = values(priority);
  const [open, setOpen] = useState(false);
  const historyIsCurrent = history?.revision === priority.revision;

  useEffect(() => {
    if (open && !loading && !error && !historyIsCurrent) onOpen();
  }, [error, historyIsCurrent, loading, onOpen, open]);

  return <details className="edupi-priority-history" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>历史 <span>{historyIsCurrent && history ? history.historyCount : priority.historyCount}</span></summary>
    <div>{loading ? <p className="edupi-priority-history__state">正在读取…</p> : error ? <p className="edupi-priority-history__state is-error" role="alert">{error} <button type="button" onClick={onOpen}>重试</button></p> : !historyIsCurrent && priority.historyCount > 0 ? <p className="edupi-priority-history__state">正在读取…</p> : history && history.versions.length > 0 ? <>
      <p className="edupi-priority-history__notice">恢复会同时替换学科、班级、主题、说明和状态。</p>
      <ol>{history.versions.slice().reverse().map((version) => <li key={version.versionId}>
        <header><div><strong>版本 {version.revision}</strong><span>{SOURCE_LABELS[version.sourceKind]}</span></div><time>{new Date(version.changedAt).toLocaleString("zh-CN")}</time></header>
        <small>修改了 {version.changedFields.map((field) => FIELD_LABELS[field]).join("、")}</small>
        <div className="edupi-priority-history__sides">{(["before", "after"] as const).map((side) => {
          const sideValues = side === "before" ? version.beforeValues : version.afterValues;
          const label = side === "before" ? "修改前" : "修改后";
          const currentSide = sameValues(current, sideValues);
          const restoreKey = `${priority.id}:${version.versionId}:${side}`;
          return <section key={side}><header><strong>{label}</strong>{currentSide ? <span>当前重点</span> : <button type="button" disabled={busy} onClick={() => onRestore(version, side)}>{restoring === restoreKey ? "恢复中…" : `恢复${label}`}</button>}</header><dl>{(["subject", "class_name", "topic", "note", "status"] as const).map((field) => <div key={field}><dt>{FIELD_LABELS[field]}</dt><dd title={valueLabel(field, sideValues)}>{valueLabel(field, sideValues)}</dd></div>)}</dl></section>;
        })}</div>
      </li>)}</ol>
    </> : <p className="edupi-priority-history__state">暂无历史版本</p>}</div>
  </details>;
}

export function EduPiTeachingPriorities({ priorities, defaultSubject, defaultClassName, query, onEducation, onStartAgent, onDeleteEntity }: {
  priorities: EducationTeachingPriority[];
  defaultSubject: string;
  defaultClassName: string;
  query: string;
  onEducation: (data: EducationContract) => void;
  onStartAgent: (prompt: string, mode?: "insert" | "replace") => void;
  onDeleteEntity: (kind: EducationEntityDeleteKind, id: string, label: string) => Promise<boolean>;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [historyStates, setHistoryStates] = useState<Record<string, { history: TeachingPriorityVersionHistory | null; loading: boolean; error: string | null }>>({});
  const [restoring, setRestoring] = useState<string | null>(null);
  const visible = filterTeachingPriorityItems(priorities, query)
    .slice().sort((left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), message.tone === "error" ? 8000 : 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const openCreate = () => setEditor({ mode: "create", priorityId: null, expectedRevision: 0, subject: defaultSubject, className: defaultClassName, topic: "", note: "" });
  const openEdit = (priority: EducationTeachingPriority) => setEditor({ mode: "edit", priorityId: priority.id, expectedRevision: priority.revision, subject: priority.subject, className: priority.className || "", topic: priority.topic, note: priority.note || "" });

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor || busy) return;
    const key = editor.priorityId || "create";
    setBusy(key); setMessage(null);
    try {
      const body = editor.mode === "create"
        ? { subject: editor.subject.trim(), className: editor.className.trim() || null, topic: editor.topic.trim(), note: editor.note.trim() || null }
        : { priorityId: editor.priorityId, expectedRevision: editor.expectedRevision, patch: { subject: editor.subject.trim(), className: editor.className.trim() || null, topic: editor.topic.trim(), note: editor.note.trim() || null } };
      const response = await fetch("/api/edupi/teaching-priorities", { method: editor.mode === "create" ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { data?: EducationContract; error?: string };
      if (!response.ok || !result.data) throw new Error(result.error || "教学重点保存失败");
      onEducation(result.data);
      setEditor(null);
      setHistoryStates({});
      setMessage({ tone: "success", text: editor.mode === "create" ? "教学重点已创建" : "教学重点已更新" });
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "教学重点保存失败" }); }
    finally { setBusy(null); }
  };

  const updateStatus = async (priority: EducationTeachingPriority, status: EducationTeachingPriority["status"]) => {
    if (busy) return;
    setBusy(priority.id); setMessage(null);
    try {
      const response = await fetch("/api/edupi/teaching-priorities", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priorityId: priority.id, expectedRevision: priority.revision, patch: { status } }) });
      const result = await response.json() as { data?: EducationContract; error?: string };
      if (!response.ok || !result.data) throw new Error(result.error || "教学重点状态更新失败");
      onEducation(result.data);
      setHistoryStates({});
      setMessage({ tone: "success", text: `教学重点已${status === "active" ? "继续" : status === "paused" ? "暂停" : "完成"}` });
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "教学重点状态更新失败" }); }
    finally { setBusy(null); }
  };

  const loadHistory = async (priority: EducationTeachingPriority) => {
    const current = historyStates[priority.id];
    if (current && (current.loading || current.history?.revision === priority.revision)) return;
    setHistoryStates((states) => ({ ...states, [priority.id]: { history: null, loading: true, error: null } }));
    try {
      const response = await fetch(`/api/edupi/teaching-priorities/${encodeURIComponent(priority.id)}/versions`, { cache: "no-store" });
      const result = await response.json() as { history?: TeachingPriorityVersionHistory; data?: EducationContract; error?: string };
      if (!response.ok || !result.history || !result.data) throw new Error(result.error || "教学重点历史读取失败");
      onEducation(result.data);
      setHistoryStates((states) => ({ ...states, [priority.id]: { history: result.history!, loading: false, error: null } }));
    } catch (error) { setHistoryStates((states) => ({ ...states, [priority.id]: { history: null, loading: false, error: error instanceof Error ? error.message : "教学重点历史读取失败" } })); }
  };

  const restoreVersion = async (priority: EducationTeachingPriority, version: TeachingPriorityVersion, versionSide: TeachingPriorityVersionSide) => {
    if (busy) return;
    const key = `${priority.id}:${version.versionId}:${versionSide}`;
    setBusy(priority.id); setRestoring(key); setMessage(null);
    try {
      const response = await fetch(`/api/edupi/teaching-priorities/${encodeURIComponent(priority.id)}/versions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId: version.versionId, versionSide, expectedRevision: priority.revision }) });
      const result = await response.json() as { data?: EducationContract; history?: TeachingPriorityVersionHistory; error?: string };
      if (!response.ok || !result.data || !result.history) throw new Error(result.error || "教学重点恢复失败");
      onEducation(result.data);
      setHistoryStates((states) => ({ ...states, [priority.id]: { history: result.history!, loading: false, error: null } }));
      setEditor(null);
      setMessage({ tone: "success", text: `已恢复版本 ${version.revision} 的${versionSide === "before" ? "修改前" : "修改后"}重点` });
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "教学重点恢复失败" }); }
    finally { setBusy(null); setRestoring(null); }
  };

  const collaborate = (priority?: EducationTeachingPriority) => {
    const prompt = priority ? [
      `请协作修订教学重点“${priority.topic}”。`,
      `当前范围：${priority.subject} · ${priority.className || "全部班级"}`,
      `当前说明：${priority.note || "未填写"}`,
      `当前状态：${STATUS_LABELS[priority.status]}`,
      "请结合已有教学依据给出修改候选，等我确认后再保存。",
    ].join("\n") : "请根据我接下来提供的内容整理一个教学重点候选，包含学科、班级、主题和简短说明，等我确认后再保存。";
    onStartAgent(appendTeacherInputSlot(prompt, "我最近要补充或修改的教学重点（在这里输入或口述）："), "replace");
  };

  const remove = async (priority: EducationTeachingPriority) => {
    if (busy) return;
    setBusy(priority.id); setMessage(null);
    try {
      const deleted = await onDeleteEntity("teaching_priority", priority.id, priority.topic);
      if (deleted) { setEditor(null); setHistoryStates({}); }
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "教学重点删除失败" }); }
    finally { setBusy(null); }
  };

  return <section className="edupi-teaching-priorities">
    <header><div><h2>教师维护的重点</h2><span>{visible.length} 项</span></div><button type="button" onClick={openCreate} disabled={Boolean(busy)}>新增重点</button></header>
    {message ? <p className={`edupi-priority-message is-${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}
    {editor ? <form className="edupi-priority-editor" onSubmit={save}><header><h3>{editor.mode === "create" ? "新增重点" : "修改重点"}</h3><button type="button" onClick={() => setEditor(null)} disabled={Boolean(busy)}>取消</button></header><div><label><span>学科</span><input value={editor.subject} maxLength={120} required onChange={(event) => setEditor({ ...editor, subject: event.target.value })} /></label><label><span>班级</span><input value={editor.className} maxLength={120} placeholder="留空表示全部班级" onChange={(event) => setEditor({ ...editor, className: event.target.value })} /></label></div><label><span>主题</span><input value={editor.topic} maxLength={240} required autoFocus onChange={(event) => setEditor({ ...editor, topic: event.target.value })} /></label><label><span>说明</span><textarea value={editor.note} maxLength={2000} rows={3} onChange={(event) => setEditor({ ...editor, note: event.target.value })} /></label><button type="submit" disabled={Boolean(busy) || !editor.subject.trim() || !editor.topic.trim()}>{busy ? "保存中…" : "保存"}</button></form> : null}
    <div className="edupi-teaching-priorities__list">{visible.map((priority) => <details key={priority.id} className={`edupi-priority-row is-${priority.status}`}>
      <summary><span><strong>{priority.topic}</strong><small>{priority.note || "未填写说明"}</small></span><span>{priority.className || "全部班级"}</span><em>{STATUS_LABELS[priority.status]}</em><time>{new Date(priority.updatedAt).toLocaleDateString("zh-CN")}</time></summary>
      <div className="edupi-priority-row__detail"><p>{priority.subject} · {priority.className || "全部班级"} · 版本 {priority.revision}</p><div className="edupi-priority-row__actions"><button type="button" onClick={() => openEdit(priority)} disabled={Boolean(busy)}>修改</button><button type="button" onClick={() => collaborate(priority)} disabled={Boolean(busy)}>AI 协作</button>{priority.status === "active" ? <><button type="button" onClick={() => void updateStatus(priority, "paused")} disabled={Boolean(busy)}>暂停</button><button type="button" onClick={() => void updateStatus(priority, "completed")} disabled={Boolean(busy)}>完成</button></> : priority.status === "paused" ? <><button type="button" onClick={() => void updateStatus(priority, "active")} disabled={Boolean(busy)}>继续</button><button type="button" onClick={() => void updateStatus(priority, "completed")} disabled={Boolean(busy)}>完成</button></> : <button type="button" onClick={() => void updateStatus(priority, "active")} disabled={Boolean(busy)}>重新启用</button>}<button type="button" className="is-delete" onClick={() => void remove(priority)} disabled={Boolean(busy)}>{busy === priority.id ? "处理中…" : "删除"}</button></div><PriorityVersionHistory priority={priority} history={historyStates[priority.id]?.history || null} loading={historyStates[priority.id]?.loading === true} error={historyStates[priority.id]?.error || null} busy={Boolean(busy)} restoring={restoring} onOpen={() => void loadHistory(priority)} onRestore={(version, side) => void restoreVersion(priority, version, side)} /></div>
    </details>)}{visible.length === 0 ? <div className="edupi-teaching-priorities__empty"><p>{priorities.length ? "没有匹配的教学重点" : "还没有教师维护的教学重点"}</p><button type="button" onClick={() => collaborate()}>对话整理重点</button></div> : null}</div>
  </section>;
}
