"use client";

import { useEffect, useState } from "react";
import type { EducationContract, EducationFact, EducationFactSpine } from "@/lib/edupi-education-contract";
import { conflictingAcceptedFacts, type FactMutationInput } from "@/lib/edupi-fact-lifecycle-model";
import { EDUPI_FACTS_UPDATED_EVENT } from "@/lib/edupi-ui-events";
import { runSerializedFactMutation } from "@/lib/edupi-fact-mutation-client";
import { EduPiDeleteConfirmation } from "./EduPiDeleteConfirmation";

type Result = { data?: EducationContract; error?: string };

export function EduPiFactActions({ fact, spine, reviewer, onEducation }: { fact: EducationFact; spine: EducationFactSpine; reviewer: string; onEducation: (data: EducationContract) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ revision: number; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const conflicts = conflictingAcceptedFacts(fact, spine);
  const conflicting = conflicts.length === 1 ? conflicts[0] : null;
  const multipleConflicts = conflicts.length > 1;
  const replacementBlocked = multipleConflicts || Boolean(conflicting && fact.hasPredecessor);
  let replacementMessage: string | null = null;
  if (multipleConflicts) replacementMessage = `存在 ${conflicts.length} 条冲突事实，请先逐条处理。`;
  else if (conflicting && fact.hasPredecessor) replacementMessage = `请先处理“${conflicting.value}”，再接受这条恢复事实。`;
  else if (conflicting) replacementMessage = `接受后将替换“${conflicting.value}”`;

  useEffect(() => {
    if (editing && editing.revision !== fact.revision) {
      setEditing(null);
      setError("事实已在其他入口更新，请重新打开后修改");
    }
  }, [editing, fact.revision]);

  const submit = async (input: FactMutationInput) => {
    if (busy) return;
    setBusy(input.action === "review" ? input.decision : input.action);
    setError(null);
    try {
      await runSerializedFactMutation(async () => {
        const response = await fetch(`/api/edupi/facts/${encodeURIComponent(fact.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
        const result = await response.json() as Result;
        if (!response.ok || !result.data) throw new Error(result.error || "事实操作失败");
        setEditing(null);
        onEducation(result.data);
        window.dispatchEvent(new Event(EDUPI_FACTS_UPDATED_EVENT));
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "事实操作失败");
    } finally {
      setBusy(null);
    }
  };

  const review = (decision: "accept" | "reject" | "hold") => void submit({
    action: "review",
    expectedRevision: fact.revision,
    decision,
    reviewer: reviewer.trim() || "teacher",
    note: null,
    supersedesFactId: decision === "accept" ? conflicting?.id || null : null,
    supersedesFactRevision: decision === "accept" ? conflicting?.revision ?? null : null,
  });

  const save = () => {
    const value = editing?.value.trim();
    if (!editing || editing.revision !== fact.revision || !value || value === fact.value) return;
    void submit({ action: "modify", expectedRevision: editing.revision, replacementValue: value, reviewer: reviewer.trim() || "teacher", note: null });
  };

  const reviewable = fact.status === "candidate" || fact.status === "pending_review" || fact.status === "held";
  let acceptLabel = "接受";
  if (busy === "accept") acceptLabel = "处理中…";
  else if (replacementBlocked) acceptLabel = "先处理冲突事实";
  else if (conflicting) acceptLabel = "接受并替换";
  return <div className="edupi-fact-actions">
    {editing ? <div className="edupi-fact-actions__editor"><textarea value={editing.value} maxLength={4000} rows={3} onChange={(event) => setEditing({ ...editing, value: event.target.value })} autoFocus /><div><button type="button" onClick={() => setEditing(null)} disabled={Boolean(busy)}>取消</button><button type="button" className="is-primary" onClick={save} disabled={Boolean(busy) || editing.revision !== fact.revision || !editing.value.trim() || editing.value.trim() === fact.value}>{busy === "modify" ? "保存中…" : "保存修改"}</button></div></div> : <div className="edupi-fact-actions__buttons">
      {reviewable ? <><button type="button" className="is-primary" disabled={Boolean(busy) || replacementBlocked} onClick={() => review("accept")} title={replacementBlocked ? "请先处理当前已确认事实" : conflicting ? `将替换：${conflicting.value}` : undefined}>{acceptLabel}</button>{fact.status !== "held" ? <button type="button" disabled={Boolean(busy)} onClick={() => review("hold")}>{busy === "hold" ? "处理中…" : "暂缓"}</button> : null}<button type="button" className="is-danger" disabled={Boolean(busy)} onClick={() => review("reject")}>{busy === "reject" ? "处理中…" : "拒绝"}</button></> : null}
      {fact.status === "accepted" ? <><button type="button" className="is-primary" disabled={Boolean(busy)} onClick={() => setEditing({ revision: fact.revision, value: fact.value })}>修改</button><button type="button" className="is-danger" disabled={Boolean(busy)} onClick={() => setConfirmDelete(true)}>删除</button></> : null}
    </div>}
    {reviewable && replacementMessage ? <small>{replacementMessage}</small> : null}
    {error ? <p role="alert">{error}</p> : null}
    {confirmDelete ? <EduPiDeleteConfirmation label={fact.value} onResolve={(confirmed) => { setConfirmDelete(false); if (confirmed) void submit({ action: "delete", expectedRevision: fact.revision, reviewer: reviewer.trim() || "teacher" }); }} /> : null}
  </div>;
}
