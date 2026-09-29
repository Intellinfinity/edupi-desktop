"use client";

import { useEffect, useState } from "react";
import type { EducationWorkCandidate, EducationWorkCandidateDecision, TeacherTask } from "@/lib/edupi-education-contract";
import { desktopApiHeaders } from "@/lib/desktop-native";
import { isTauriDesktop } from "@/lib/desktop-updater";
import {
  canRetryFeedbackEligibility,
  prepareTeacherFeedbackCapture,
  recordTeacherFeedback,
  TeacherFeedbackError,
  type TeacherFeedbackCapture,
} from "@/lib/edupi-teacher-feedback";
import { EduPiTeacherValueForm, feedbackCaptureFor, type TeacherValueDraft } from "./EduPiTodayWork";

const EMPTY_VALUE: TeacherValueDraft = { usefulness: "", used: false, wouldUseAgain: "", baselineMinutes: "", reviewMinutes: "", note: "" };
type FeedbackRecord = { feedback_id?: string; session_id?: string; current?: boolean; target?: { kind?: string; target_id?: string; revision?: number } };

export function taskFeedbackDecision(candidate: EducationWorkCandidate): EducationWorkCandidateDecision | null {
  const decisions: Record<EducationWorkCandidate["status"], { action: EducationWorkCandidateDecision; reviewState: EducationWorkCandidate["teacherReview"]["state"] } | null> = {
    pending_review: null,
    accepted: { action: "accept", reviewState: "accepted" },
    modified: { action: "modify", reviewState: "modified" },
    rejected: { action: "reject", reviewState: "rejected" },
    held: { action: "hold", reviewState: "held" },
    snoozed: { action: "snooze", reviewState: "held" },
    suppressed: { action: "suppress", reviewState: "rejected" },
  };
  const decision = decisions[candidate.status];
  return decision && candidate.teacherReview.state === decision.reviewState
    && candidate.teacherReview.reviewerId && candidate.teacherReview.reviewedAt
    ? decision.action : null;
}

export function currentTaskFeedback(records: FeedbackRecord[], candidate: EducationWorkCandidate): FeedbackRecord | null {
  return records.find((item) => item.current === true && item.session_id === "desktop-today"
    && item.target?.kind === "work_candidate" && item.target.target_id === candidate.candidateId
    && item.target.revision === candidate.revision) ?? null;
}

async function readFeedbackRecords(): Promise<FeedbackRecord[]> {
  const response = await fetch("/api/edupi/teacher-feedback", {
    headers: await desktopApiHeaders(), cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json() as { ok?: boolean; result?: { feedback?: FeedbackRecord[] } };
  if (!response.ok || body.ok !== true || !Array.isArray(body.result?.feedback)) throw new TeacherFeedbackError("feedback_runtime_unavailable", "反馈暂不可读取");
  return body.result.feedback;
}

export function EduPiTaskFeedback({ task, candidate }: { task: TeacherTask; candidate: EducationWorkCandidate | null }) {
  const [desktop, setDesktop] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TeacherValueDraft>(EMPTY_VALUE);
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [retryCapture, setRetryCapture] = useState<TeacherFeedbackCapture | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setDesktop(isTauriDesktop()), []);
  useEffect(() => {
    setOpen(false);
    setDraft(EMPTY_VALUE);
    setRetryCapture(null);
    setRecorded(false);
    setMessage(null);
  }, [candidate?.candidateId, candidate?.revision]);

  const decision = candidate ? taskFeedbackDecision(candidate) : null;
  useEffect(() => {
    if (!desktop || !candidate || !decision) return;
    let current = true;
    readFeedbackRecords().then((records) => {
      if (current) setRecorded(currentTaskFeedback(records, candidate) !== null);
    }).catch(() => {});
    return () => { current = false; };
  }, [desktop, candidate, decision]);
  if (!desktop || !candidate || !decision || task.trigger !== "teaching_before_class"
    || candidate.evidenceIds.length === 0 && candidate.sourceIds.length === 0) return null;

  const record = async (capture: TeacherFeedbackCapture) => {
    const result = await recordTeacherFeedback(capture);
    if (!result.current) {
      setRetryCapture(null);
      setOpen(false);
      setMessage("原评价已被后续记录取代，请刷新任务。");
      return;
    }
    const records = await readFeedbackRecords();
    if (!records.some((item) => item.feedback_id === result.feedbackId)) throw new Error("feedback_readback_unavailable");
    setRetryCapture(null);
    setOpen(false);
    setDraft(EMPTY_VALUE);
    setRecorded(true);
    setMessage("评价已记录。");
  };

  const openForm = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (currentTaskFeedback(await readFeedbackRecords(), candidate)) {
        setRecorded(true);
        setMessage("评价已记录。");
      } else setOpen(true);
    } catch {
      setMessage("评价暂不可用，请重试。");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busy || !draft.usefulness) return;
    setBusy(true);
    setMessage(null);
    try {
      if (retryCapture) {
        await record(retryCapture);
        return;
      }
      if (currentTaskFeedback(await readFeedbackRecords(), candidate)) {
        setRecorded(true);
        setOpen(false);
        setMessage("评价已记录。");
        return;
      }
      const baseline = draft.baselineMinutes.trim();
      const review = draft.reviewMinutes.trim();
      const baselineMinutes = baseline ? Number(baseline) : null;
      const reviewMinutes = review ? Number(review) : null;
      if ((baselineMinutes === null) !== (reviewMinutes === null)
        || baselineMinutes !== null && (!Number.isFinite(baselineMinutes) || baselineMinutes <= 0 || baselineMinutes > 1440)
        || reviewMinutes !== null && (!Number.isFinite(reviewMinutes) || reviewMinutes <= 0 || reviewMinutes > 1440)) {
        setMessage("请同时填写 1–1440 分钟的预计与实际投入。");
        return;
      }
      const capture = feedbackCaptureFor(candidate, task, decision, draft.usefulness, candidate.teacherReview.note || undefined,
        new Date().toISOString(), {
          used: draft.used,
          wouldUseAgain: draft.wouldUseAgain === "" ? null : draft.wouldUseAgain === "yes",
          baselineMinutes,
          reviewMinutes,
          note: draft.note.trim() || null,
        });
      if (!capture) throw new Error("feedback_target_unavailable");
      const bound = await prepareTeacherFeedbackCapture(capture);
      setRetryCapture(bound);
      await record(bound);
    } catch (error) {
      if (error instanceof TeacherFeedbackError && error.code === "teacher_feedback_supersession_invalid") {
        setRetryCapture(null);
        setOpen(false);
        setRecorded(true);
        setMessage("评价已记录。");
        return;
      }
      if (!canRetryFeedbackEligibility(error)) setRetryCapture(null);
      setMessage(!canRetryFeedbackEligibility(error) ? "评价目标已变化，请刷新任务。" : "评价尚未核对写入，请重试。");
    } finally {
      setBusy(false);
    }
  };

  return <section className="edupi-task-feedback" aria-label="教师评价">
    {!open && !recorded ? <button type="button" disabled={busy} onClick={() => void openForm()}>评价本次准备</button> : null}
    {recorded ? <span role="status">已评价</span> : null}
    {open && !retryCapture ? <EduPiTeacherValueForm draft={draft} allowUsed={decision === "accept" || decision === "modify"}
      busy={busy} onChange={setDraft} onSubmit={() => void submit()}
      onCancel={() => { if (!busy) { setOpen(false); setRetryCapture(null); setDraft(EMPTY_VALUE); } }} /> : null}
    {retryCapture && !busy ? <div className="edupi-task-feedback__retry"><button type="button" onClick={() => void submit()}>重试记录</button><button type="button" onClick={() => { setRetryCapture(null); setOpen(false); setDraft(EMPTY_VALUE); }}>取消</button></div> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
