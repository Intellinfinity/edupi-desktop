"use client";
import { useEffect, useState } from "react";
import type { EducationContract, EducationMemory } from "@/lib/edupi-education-contract";
import { EduPiMemoryHistory } from "./EduPiMemoryHistory";
import { EduPiIconButton } from "./EduPiActionIcon";

export function EduPiStudentMemoryActions({ memory, onEducation, onAgent, onDelete }: { memory: EducationMemory; onEducation: (data: EducationContract) => void; onAgent: () => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(memory.content), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => { if (message !== "已保存") return; const timer = setTimeout(() => setMessage(""), 3000); return () => clearTimeout(timer); }, [message]);
  const save = async (content: string) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/edupi/memories/${encodeURIComponent(memory.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, expectedRevision: memory.revision }) });
      const result = await response.json(); if (!response.ok || !result.data) throw new Error(result.error || "保存失败");
      onEducation(result.data); setEditing(false); setMessage("已保存");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  };
  return <div style={{ padding: "8px 0" }}>
    {editing ? <form onSubmit={event => { event.preventDefault(); void save(draft); }}><textarea rows={3} maxLength={4000} value={draft} onChange={event => setDraft(event.target.value)} aria-label="修改学生记忆" /><button disabled={busy || !draft.trim()} type="submit">保存</button><button type="button" onClick={() => setEditing(false)}>取消</button></form> : <div className="edupi-student-memory-actions"><EduPiIconButton type="button" icon="edit" label="手动修改记忆" onClick={() => { setDraft(memory.content); setEditing(true); }}/><EduPiIconButton type="button" icon="agent" label="AI 协作" onClick={onAgent}/><EduPiIconButton type="button" icon="delete" label="删除记忆" className="is-delete" onClick={onDelete}/></div>}
    {message ? <small role="status">{message}</small> : null}
    <EduPiMemoryHistory id={memory.id} revision={memory.revision} onRestore={save} />
  </div>;
}
