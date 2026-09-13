"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EducationContract,
  EducationTeacherContextCandidate,
  EducationTeacherContextReviewHistory,
  TeacherContextReviewCapability,
} from "@/lib/edupi-education-contract";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import {
  TEACHER_CONTEXT_FIELDS,
  buildContextPatch,
  buildTeacherContextPrompt,
  contextStatusLabel,
  currentContextValues,
  matchesTeacherContextRefresh,
  proposedContextValues,
  verifyTeacherContextReview,
  type TeacherContextEditorValues,
  type TeacherContextField,
  type TeacherContextReviewDecision,
} from "@/lib/edupi-context-editor-model";

type ReviewResult = {
  receipt: Record<string, unknown>;
  data: EducationContract;
};

type Props = {
  initial?: TeacherContextSnapshot | null;
  candidate?: EducationTeacherContextCandidate | null;
  capability?: TeacherContextReviewCapability | null;
  history?: EducationTeacherContextReviewHistory[];
  reviewer?: string;
  onReviewed?: (result: ReviewResult) => Promise<EducationContract>;
  onAgentRequest?: (prompt: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onClose?: () => void;
};

type ReviewFailureCode = "stale" | "invalid_receipt" | "refresh" | "generic";
type TrustedAfterSnapshot = {
  targetId: string;
  snapshotId: string;
  stateHash: string;
  awaiting: boolean;
};

class ReviewFailure extends Error {
  constructor(public readonly code: ReviewFailureCode, message: string) {
    super(message);
  }
}

const ACTION_LABELS: Record<TeacherContextReviewDecision, string> = {
  accept: "接受",
  modify: "修改",
  reject: "拒绝",
  hold: "暂缓",
};

const BUSY_LABELS: Record<TeacherContextReviewDecision, string> = {
  accept: "正在接受…",
  modify: "正在修改…",
  reject: "正在拒绝…",
  hold: "正在暂缓…",
};
const REVIEW_STATUS_LABELS: Record<string, string> = { accepted: "已接受", modified: "已修改", rejected: "已拒绝", held: "已暂缓", failed: "失败" };

function reviewFailureCode(value: unknown): ReviewFailureCode {
  if (value instanceof ReviewFailure) return value.code;
  if (value instanceof Error && /stale|快照|版本|更新/.test(value.message)) return "stale";
  return "generic";
}

function responseError(value: unknown): ReviewFailure {
  const result = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const code = result.code;
  if (code === "stale_snapshot" || code === "stale_revision") return new ReviewFailure("stale", "内容已更新，请刷新。");
  return new ReviewFailure("generic", "提交失败，请重试。");
}

function isActionable(candidate: EducationTeacherContextCandidate | null | undefined): boolean {
  const state = candidate?.status || candidate?.teacherReview.state;
  return state === "pending_review" || state === "held";
}

function changed(current: string | undefined, proposal: string | undefined): boolean {
  return Boolean(proposal && proposal !== current);
}

export function EduPiContextEditor({ initial, candidate = null, capability = null, history = [], reviewer = "teacher", onReviewed, onAgentRequest, onBusyChange, onClose }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const trustedAfterSnapshotRef = useRef<TrustedAfterSnapshot | null>(null);
  const currentValues = useMemo(() => currentContextValues(candidate, initial), [candidate, initial]);
  const proposalValues = useMemo(() => proposedContextValues(candidate), [candidate]);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [chatDraftOpen, setChatDraftOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [draft, setDraft] = useState<TeacherContextEditorValues>(proposalValues);
  const [busy, setBusy] = useState(false);
  const [busyDecision, setBusyDecision] = useState<TeacherContextReviewDecision | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    setModifyOpen(false);
    setChatDraftOpen(false);
    setDraft(proposalValues);
    const marker = trustedAfterSnapshotRef.current;
    const matchesMarker = Boolean(marker
      && candidate?.contextId === marker.targetId
      && candidate.snapshotId === marker.snapshotId
      && candidate.stateHash === marker.stateHash);
    if (marker && !matchesMarker) {
      trustedAfterSnapshotRef.current = null;
      setFeedback(null);
    } else if (!marker) setFeedback(null);
    setError(null);
  }, [candidate?.contextId, candidate?.snapshotId, candidate?.stateHash, candidate?.revision, candidate?.status, candidate?.teacherReview.state, proposalValues]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (!modifyOpen && !chatDraftOpen && !manualOpen) return;
    const cancelDraft = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      event.stopPropagation();
      setModifyOpen(false);
      setChatDraftOpen(false);
      setManualOpen(false);
      setError(null);
    };
    window.addEventListener("keydown", cancelDraft, true);
    return () => window.removeEventListener("keydown", cancelDraft, true);
  }, [busy, chatDraftOpen, modifyOpen, manualOpen]);

  function updateDraft(field: TeacherContextField, value: string) {
    if (busy) return;
    setDraft((previous) => ({ ...previous, [field]: value }));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (busy) return;
      if (modifyOpen || chatDraftOpen || manualOpen) {
        setModifyOpen(false);
        setChatDraftOpen(false);
        setManualOpen(false);
        setError(null);
        return;
      }
      onClose?.();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      if (busy) return;
      if (manualOpen) {
        event.preventDefault();
        void saveManual();
      } else if (modifyOpen) {
        event.preventDefault();
        submitModify();
      } else if (chatDraftOpen) {
        event.preventDefault();
        submitDraft();
      }
    }
  }

  async function submit(decision: TeacherContextReviewDecision, patch: TeacherContextEditorValues | null) {
    if (busy || !candidate || !capability?.enabled) return;
    setBusy(true);
    setBusyDecision(decision);
    setFeedback(null);
    setError(null);
    try {
      const response = await fetch("/api/edupi/onboarding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId: candidate.contextId,
          expectedSnapshotId: candidate.snapshotId,
          expectedRevision: candidate.revision,
          decision,
          patch,
          note: `教师在 EduPi 中执行：${ACTION_LABELS[decision]}`,
          reviewerId: reviewer,
        }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) throw responseError(result);
      const verified = verifyTeacherContextReview(result, {
        targetId: candidate.contextId,
        expectedSnapshotId: candidate.snapshotId,
        expectedStateHash: candidate.stateHash,
        decision,
      });
      if (!verified.ok) throw new ReviewFailure("invalid_receipt", "未收到可信回执，结果未确认。");
      const marker: TrustedAfterSnapshot = {
        targetId: candidate.contextId,
        snapshotId: String(verified.receipt.after_snapshot_id),
        stateHash: String(verified.receipt.after_state_hash),
        awaiting: true,
      };
      trustedAfterSnapshotRef.current = marker;
      let refreshed: EducationContract;
      try {
        refreshed = onReviewed
          ? await onReviewed({ receipt: verified.receipt, data: verified.data as unknown as EducationContract })
          : verified.data as unknown as EducationContract;
      } catch {
        trustedAfterSnapshotRef.current = null;
        throw new ReviewFailure("refresh", "已收到回执，刷新失败。");
      }
      if (trustedAfterSnapshotRef.current !== marker
        || !matchesTeacherContextRefresh(refreshed, {
          targetId: marker.targetId,
          afterSnapshotId: marker.snapshotId,
          afterStateHash: marker.stateHash,
        })) {
        trustedAfterSnapshotRef.current = null;
        throw new ReviewFailure("refresh", "已收到回执，刷新失败。");
      }
      marker.awaiting = false;
      setModifyOpen(false);
      setFeedback(`✓ ${decision === "accept" ? "已接受" : decision === "modify" ? "已修改" : decision === "reject" ? "已拒绝" : "已暂缓"} · 回执 ${String(verified.receipt.receipt_id)}`);
    } catch (reason) {
      const code = reviewFailureCode(reason);
      setError(code === "stale"
        ? "内容已更新，请刷新。"
        : code === "invalid_receipt"
          ? "未收到可信回执，结果未确认。"
          : code === "refresh"
            ? "已收到回执，刷新失败。"
            : "提交失败，请重试。");
    } finally {
      setBusy(false);
      setBusyDecision(null);
    }
  }

  function submitModify() {
    try {
      const patch = buildContextPatch(draft, proposalValues);
      if (!patch) {
        setError("请至少修改一项。");
        return;
      }
      void submit("modify", patch);
    } catch {
      setError("提交失败，请重试。");
    }
  }

  function startDraft() {
    if (busy || !onAgentRequest) return;
    setDraft(currentValues);
    setModifyOpen(false);
    setChatDraftOpen(true);
    setFeedback(null);
    setError(null);
  }

  function submitDraft() {
    if (busy || !onAgentRequest) return;
    try {
      const prompt = buildTeacherContextPrompt(draft);
      onAgentRequest(prompt);
    } catch {
      setError("请至少填写一项。");
    }
  }

  async function saveManual() {
    if (busy) return;
    const values = buildContextPatch(draft, {});
    if (!values) { setError("请至少填写一项。"); return; }
    setBusy(true); setError(null); setFeedback(null);
    try {
      const response = await fetch("/api/edupi/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const before = result.candidate as EducationTeacherContextCandidate;
      const verified = verifyTeacherContextReview(result, { targetId: before.contextId, expectedSnapshotId: before.snapshotId, expectedStateHash: before.stateHash, decision: "accept" });
      if (!verified.ok) throw new Error("未收到可信回执，保存未确认。");
      const data = verified.data as unknown as EducationContract;
      const refreshed = onReviewed ? await onReviewed({ receipt: verified.receipt, data }) : data;
      if (!matchesTeacherContextRefresh(refreshed, { targetId: before.contextId, afterSnapshotId: String(verified.receipt.after_snapshot_id), afterStateHash: String(verified.receipt.after_state_hash) })) throw new Error("已收到回执，刷新失败。");
      setManualOpen(false);
      setFeedback("已保存");
      window.dispatchEvent(new Event("edupi-preparation-updated"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存未确认，请重试。");
      window.dispatchEvent(new Event("edupi-preparation-updated"));
    } finally { setBusy(false); }
  }

  const status = contextStatusLabel(candidate, capability, currentValues);
  const actionable = isActionable(candidate);
  const canReview = Boolean(candidate && capability?.enabled && actionable);
  const contextReady = Object.keys(currentValues).length > 0;

  return (
    <section className="edupi-context-editor" aria-label="教师上下文属性" aria-busy={busy || undefined} onKeyDown={handleKeyDown}>
      <header className="edupi-context-editor__header">
        <div>
          <h2 id="edupi-context-editor-title" ref={headingRef} tabIndex={-1}>教师上下文</h2>
          {candidate ? <div className="edupi-context-editor__meta">教师资料 · {candidate.evidenceIds.length} 条证据 · 不外发</div> : null}
        </div>
        <span className={`edupi-context-editor__status is-${candidate?.status || candidate?.teacherReview.state || (contextReady ? "accepted" : "unconfigured")}`}>{status}</span>
      </header>

      <div className="edupi-context-editor__table-wrap">
        <table className="edupi-context-editor__table">
          <caption className="edupi-visually-hidden">教师上下文当前生效值与待确认更新</caption>
          <thead><tr><th scope="col">字段</th><th scope="col">当前生效</th><th scope="col">待确认更新</th></tr></thead>
          <tbody>{TEACHER_CONTEXT_FIELDS.map((field) => {
            const current = currentValues[field.key];
            const proposal = proposalValues[field.key];
            const isChanged = changed(current, proposal);
            return <tr key={field.key}>
              <th scope="row">{field.label}</th>
              <td>{current || <span className="edupi-context-editor__empty">未设置</span>}</td>
              <td>{proposal ? <span className={isChanged ? "edupi-context-editor__proposal is-changed" : "edupi-context-editor__proposal"}>{proposal}{isChanged ? <small>已变更</small> : null}</span> : <span className="edupi-context-editor__empty">—</span>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>

      {history.length ? <details className="edupi-context-history"><summary>操作历史 <span>{history.length}</span></summary><ol>{history.slice(-10).reverse().map((item) => <li key={item.reviewId}><div><strong>{ACTION_LABELS[item.decision as TeacherContextReviewDecision] || item.decision}</strong><span>{REVIEW_STATUS_LABELS[item.status] || item.status}</span></div><time>{item.reviewedAt ? new Date(item.reviewedAt).toLocaleString("zh-CN") : "时间未记录"}</time>{item.teacherReview.note ? <p>{item.teacherReview.note}</p> : null}</li>)}</ol></details> : null}

      {modifyOpen && canReview ? <div className="edupi-context-editor__modify" aria-label="修改待确认更新">
        <div className="edupi-context-editor__modify-heading"><strong>修改待确认更新</strong><span>只提交非空且有变化的字段</span></div>
        <div className="edupi-context-editor__fields">{TEACHER_CONTEXT_FIELDS.map((field) => <label key={field.key}>{field.label}<input maxLength={120} disabled={busy} value={draft[field.key] || ""} onChange={(event) => updateDraft(field.key, event.target.value)} /></label>)}</div>
        <div className="edupi-context-editor__modify-actions"><button type="button" className="edupi-entry-secondary" disabled={busy} onClick={() => setModifyOpen(false)}>取消</button><button type="button" className="edupi-entry-primary" disabled={busy} onClick={submitModify}>{busy && busyDecision === "modify" ? BUSY_LABELS.modify : "提交修改"}</button></div>
      </div> : null}

      {chatDraftOpen ? <div className="edupi-context-editor__modify" aria-label="起草教师上下文更新">
        <div className="edupi-context-editor__modify-heading"><strong>起草更新</strong><span>放入对话后由 EduPi 生成待确认提案</span></div>
        <div className="edupi-context-editor__fields">{TEACHER_CONTEXT_FIELDS.map((field) => <label key={field.key}>{field.label}<input maxLength={120} disabled={busy} value={draft[field.key] || ""} onChange={(event) => updateDraft(field.key, event.target.value)} /></label>)}</div>
        <div className="edupi-context-editor__modify-actions"><button type="button" className="edupi-entry-secondary" disabled={busy} onClick={() => setChatDraftOpen(false)}>取消</button><button type="button" className="edupi-entry-primary" disabled={busy || !onAgentRequest} onClick={submitDraft}>放入对话</button></div>
      </div> : null}

      {manualOpen ? <div className="edupi-context-editor__modify" aria-label="手动填写教师资料">
        <div className="edupi-context-editor__fields">{TEACHER_CONTEXT_FIELDS.map((field) => <label key={field.key}>{field.label}<input maxLength={120} disabled={busy} value={draft[field.key] || ""} onChange={(event) => updateDraft(field.key, event.target.value)} /></label>)}</div>
        <div className="edupi-context-editor__modify-actions"><button type="button" className="edupi-entry-secondary" disabled={busy} onClick={() => setManualOpen(false)}>取消</button><button type="button" className="edupi-entry-primary" disabled={busy} onClick={() => void saveManual()}>{busy ? "保存中…" : "保存"}</button></div>
      </div> : null}

      {feedback ? <div className="edupi-context-editor__feedback" role="status" aria-live="polite">{feedback}</div> : null}
      {error ? <div className="edupi-context-editor__error" role="alert">{error}</div> : null}

      <footer className="edupi-context-editor__actions">
        {!manualOpen && !modifyOpen && !chatDraftOpen ? <button type="button" className="edupi-entry-secondary" disabled={busy} onClick={() => { setDraft(currentValues); setManualOpen(true); setError(null); }}>手动填写</button> : null}
        {!manualOpen && canReview && !modifyOpen && !chatDraftOpen ? <>
          <button type="button" className="edupi-entry-primary" disabled={busy} onClick={() => void submit("accept", null)}>{busy && busyDecision === "accept" ? BUSY_LABELS.accept : ACTION_LABELS.accept}</button>
          <button type="button" className="edupi-entry-secondary" disabled={busy} onClick={() => { setChatDraftOpen(false); setDraft(proposalValues); setModifyOpen(true); }}>{ACTION_LABELS.modify}</button>
          <button type="button" className="edupi-entry-secondary" disabled={busy} onClick={() => void submit("hold", null)}>{busy && busyDecision === "hold" ? BUSY_LABELS.hold : ACTION_LABELS.hold}</button>
          <button type="button" className="edupi-entry-danger" disabled={busy} onClick={() => void submit("reject", null)}>{busy && busyDecision === "reject" ? BUSY_LABELS.reject : ACTION_LABELS.reject}</button>
        </> : !manualOpen && !modifyOpen && !chatDraftOpen && onAgentRequest ? <button type="button" className="edupi-entry-secondary" disabled={busy} onClick={startDraft}>起草更新</button> : null}
      </footer>
      {!contextReady && !candidate ? <span className="edupi-visually-hidden">尚未配置教师上下文</span> : null}
    </section>
  );
}
