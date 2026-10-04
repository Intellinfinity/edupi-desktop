"use client";

import { useEffect, useRef, useState } from "react";
import type { EducationFollowUp } from "@/lib/edupi-education-contract";
import { desktopApiHeaders } from "@/lib/desktop-native";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { canRetryFeedbackEligibility, prepareTeacherFeedbackCapture, recordTeacherFeedback, TeacherFeedbackError, type TeacherFeedbackCapture } from "@/lib/edupi-teacher-feedback";
import { EduPiTeacherValueForm, type TeacherValueDraft } from "./EduPiTodayWork";

const EMPTY_VALUE: TeacherValueDraft = { usefulness: "", used: false, wouldUseAgain: "", baselineMinutes: "", reviewMinutes: "", note: "" };
type FeedbackRecord = { feedback_id?: string; session_id?: string; current?: boolean; source_status?: string; target?: { kind?: string; target_id?: string; revision?: number } };

function decisionFor(followUp: EducationFollowUp): "accept" | "modify" | "reject" | "hold" | null {
  const decision = { accepted: "accept", modified: "modify", rejected: "reject", held: "hold" }[followUp.status as "accepted" | "modified" | "rejected" | "held"];
  return decision && followUp.teacherReview.state === followUp.status && followUp.teacherReview.reviewerId && followUp.teacherReview.reviewedAt
    ? decision as "accept" | "modify" | "reject" | "hold" : null;
}

async function readRecords(): Promise<FeedbackRecord[]> {
  const response = await fetch("/api/edupi/teacher-feedback", { headers: await desktopApiHeaders(), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const result = await response.json() as { ok?: boolean; result?: { feedback?: FeedbackRecord[] } };
  if (!response.ok || result.ok !== true || !Array.isArray(result.result?.feedback)) throw new TeacherFeedbackError("feedback_runtime_unavailable", "反馈暂不可读取");
  return result.result.feedback;
}

function currentRecord(records: FeedbackRecord[], followUp: EducationFollowUp): FeedbackRecord | undefined {
  return records.find(record => record.current === true && record.source_status === "current" && record.session_id === "desktop-follow-up" && record.target?.kind === "follow_up"
    && record.target.target_id === followUp.followUpId && record.target.revision === followUp.revision);
}

export function EduPiFollowUpFeedback({ followUp }: { followUp: EducationFollowUp }) {
  const [desktop, setDesktop] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TeacherValueDraft>(EMPTY_VALUE);
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [retryCapture, setRetryCapture] = useState<TeacherFeedbackCapture | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const readSequence = useRef(0);
  const submitSequence = useRef(0);
  const decision = decisionFor(followUp);
  useEffect(() => { setDesktop(isTauriDesktop()); }, []);
  useEffect(() => {
    if (!desktop || !decision) return;
    let current = true;
    const sequence = ++readSequence.current;
    void readRecords().then(records => {
      if (current && readSequence.current === sequence) setRecorded(Boolean(currentRecord(records, followUp)));
    }).catch(() => { if (current && readSequence.current === sequence) setRecorded(false); });
    return () => { current = false; };
  }, [desktop, decision, followUp]);
  if (!desktop || !decision) return null;

  const record = async (capture: TeacherFeedbackCapture, sequence: number) => {
    const result = await recordTeacherFeedback(capture);
    if (readSequence.current !== sequence) return;
    const records = await readRecords();
    if (readSequence.current !== sequence) return;
    const current = currentRecord(records, followUp);
    if (!result.current || current?.feedback_id !== result.feedbackId) {
      setRecorded(false);
      throw new TeacherFeedbackError("teacher_feedback_target_stale", "反馈回读未确认，请刷新。");
    }
    setRetryCapture(null);
    setOpen(false);
    setRecorded(true);
    setMessage(null);
  };
  const submit = async () => {
    if (busy || !draft.usefulness) return;
    const submission = ++submitSequence.current;
    const sequence = ++readSequence.current;
    setBusy(true); setMessage(null);
    try {
      if (retryCapture) { await record(retryCapture, sequence); return; }
      const records = await readRecords();
      if (readSequence.current !== sequence) return;
      if (currentRecord(records, followUp)) { setRecorded(true); setOpen(false); return; }
      const baseline = draft.baselineMinutes.trim(), review = draft.reviewMinutes.trim();
      const baselineMinutes = baseline ? Number(baseline) : null, reviewMinutes = review ? Number(review) : null;
      if ((baselineMinutes === null) !== (reviewMinutes === null)
        || baselineMinutes !== null && (!Number.isFinite(baselineMinutes) || baselineMinutes <= 0 || baselineMinutes > 1440)
        || reviewMinutes !== null && (!Number.isFinite(reviewMinutes) || reviewMinutes <= 0 || reviewMinutes > 1440)) {
        setMessage("请同时填写 1–1440 分钟的预计与实际投入。"); return;
      }
      const capture = await prepareTeacherFeedbackCapture({
        commandId: `desktop-feedback-${globalThis.crypto.randomUUID()}`, sessionId: "desktop-follow-up", domain: "student_followup", scope: null,
        target: { kind: "follow_up", targetId: followUp.followUpId }, reviewedRevision: followUp.revision, decision, usefulness: draft.usefulness,
        used: draft.used && (decision === "accept" || decision === "modify"), wouldUseAgain: draft.wouldUseAgain === "" ? null : draft.wouldUseAgain === "yes",
        baselineMinutes, reviewMinutes, note: draft.note.trim() || null, evidenceIds: followUp.evidenceIds,
        issueCodes: draft.usefulness === "unsafe" ? ["safety"] : draft.usefulness === "incorrect" ? ["incorrect_content"] : [],
        occurredAt: new Date().toISOString(),
      });
      if (readSequence.current !== sequence) return;
      setRetryCapture(capture);
      await record(capture, sequence);
    } catch (error) {
      if (readSequence.current !== sequence) return;
      if (!canRetryFeedbackEligibility(error)) setRetryCapture(null);
      setMessage(canRetryFeedbackEligibility(error) ? "评价尚未核对写入，请重试。" : "评价目标已变化，请刷新。");
    } finally { if (submitSequence.current === submission) setBusy(false); }
  };
  return <section className="edupi-task-feedback" aria-label="学生跟进评价">
    {!open && !recorded ? <button type="button" disabled={busy} onClick={() => { setOpen(true); setMessage(null); }}>评价本次跟进</button> : null}
    {recorded ? <span role="status">已评价</span> : null}
    {open && !retryCapture ? <EduPiTeacherValueForm draft={draft} allowUsed={decision === "accept" || decision === "modify"} busy={busy}
      onChange={setDraft} onSubmit={() => void submit()} onCancel={() => { setOpen(false); setDraft(EMPTY_VALUE); setMessage(null); }} /> : null}
    {retryCapture && !busy ? <div className="edupi-task-feedback__retry"><button type="button" onClick={() => void submit()}>重试记录</button><button type="button" onClick={() => { setRetryCapture(null); setOpen(false); setDraft(EMPTY_VALUE); }}>取消</button></div> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
