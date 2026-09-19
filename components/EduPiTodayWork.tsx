"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import type {
  EducationContract,
  EducationWorkCandidate,
  EducationWorkCandidateDecision,
  TeacherTask,
  WorkCandidateReviewCapability,
} from "@/lib/edupi-education-contract";
import {
  getTodayWorkMutationSnapshot,
  isTodayWorkEditorCurrent,
  subscribeTodayWorkMutation,
  submitTodayWorkReview,
  todayWorkErrorMessage,
  todayWorkFailureDisposition,
  TodayWorkReviewError,
} from "@/lib/edupi-today-work";
import { summarizeL4Preparation, type L4PreparationSummaryItem } from "@/lib/edupi-l4-preparation";
import { groupWorkCandidates, workCandidateReasonLabel, type WorkCandidateGroups } from "@/lib/edupi-workbench";
import { todayActiveTasks } from "@/lib/edupi-work-case";

type Props = {
  data: EducationContract;
  onEducation: (data: EducationContract) => void;
  onTaskDetail: (task: TeacherTask) => void;
};

type EditorMode = "modify" | "snooze" | "suppress";

type EditorState = {
  candidateId: string;
  snapshotId: string;
  revision: number;
  mode: EditorMode;
  title: string;
  summary: string;
  dueAt: string;
  snoozeUntil: string;
  suppressionScope: "this_candidate" | "matching_reason" | "next_cycle";
  note: string;
};

type Feedback = { kind: "success" | "error"; text: string; action?: "refresh" } | null;
type ReviewRetry = {
  candidate: EducationWorkCandidate;
  decision: EducationWorkCandidateDecision;
  patch?: Record<string, unknown>;
  note?: string;
};
type Submission = { candidateId: string; decision: EducationWorkCandidateDecision } | null;

const STATUS_LABELS: Record<EducationWorkCandidate["status"], string> = {
  pending_review: "待判断",
  held: "已暂缓",
  snoozed: "已安排稍后",
  accepted: "已接受",
  modified: "已调整",
  rejected: "已拒绝",
  suppressed: "已停止提示",
};

const DECISION_LABELS: Record<EducationWorkCandidateDecision, string> = {
  accept: "已接受",
  modify: "已调整",
  reject: "已拒绝",
  hold: "已暂缓",
  snooze: "已安排稍后",
  suppress: "已停止提示",
};

const DECISION_EFFECTS: Record<EducationWorkCandidateDecision, string> = {
  accept: "移到“已记录”，关闭本次待判断。",
  modify: "按新内容记录，并移到“已记录”。",
  reject: "关闭这条事项，并移到“已记录”。",
  hold: "移到“稍后处理”，保留待后续判断。",
  snooze: "移到“稍后处理”，到指定日期重新进入待你决定。",
  suppress: "按选择的范围停止提示，并移到“已记录”。",
};

const ACTION_TITLES: Record<EducationWorkCandidateDecision, string> = {
  accept: "接受：关闭本次待判断，移到已记录",
  modify: "调整：修改标题、说明或截止日期后记录",
  reject: "拒绝：关闭这条事项并保留拒绝记录",
  hold: "暂缓：移到稍后处理，之后可以继续判断",
  snooze: "稍后：选择日期，到期后重新进入待你决定",
  suppress: "停止提示：选择停止范围并填写原因",
};

const GROUP_LABELS: Record<keyof WorkCandidateGroups, string> = {
  now: "待你决定",
  later: "稍后处理",
  done: "已记录",
};

const GROUP_HINTS: Record<keyof WorkCandidateGroups, string> = {
  now: "需要你现在做决定",
  later: "已暂缓或安排了日期",
  done: "决定已写入，可修改",
};

const SUPPRESSION_SCOPE_LABELS = {
  this_candidate: "只停止这条",
  matching_reason: "停止同类原因",
  next_cycle: "本轮停止",
} as const;

const NEXT_CYCLE_LABELS: Record<string, string> = {
  awaiting_teacher: "等待教师判断",
  closed_accepted: "已接受",
  closed_modified: "已调整",
  closed_rejected: "已拒绝",
  held: "已暂缓",
  snoozed: "已安排稍后",
  suppressed_this_candidate: "停止这条提示",
  suppressed_matching_reason: "停止同类提示",
  suppressed_next_cycle: "本轮停止提示",
  reopened_source_changed: "来源更新，待重审",
  reopened_snooze_expired: "稍后到期，待重审",
};

const L4_GROUP_LABELS: Array<{ key: "ready" | "running" | "attention"; title: string }> = [
  { key: "ready", title: "已准备好" },
  { key: "running", title: "自动进行" },
  { key: "attention", title: "需要判断" },
];

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function localIsoDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return localIsoDate(date);
}

function readableDate(value: string | null): string {
  if (!value) return "日期待确认";
  return value;
}

function actionSuccess(decision: EducationWorkCandidateDecision): string {
  return `✓ ${DECISION_LABELS[decision]}：${DECISION_EFFECTS[decision]}`;
}

function submittingLabel(decision: EducationWorkCandidateDecision): string {
  return decision === "accept" ? "正在接受…"
    : decision === "hold" ? "正在暂缓…"
      : decision === "reject" ? "正在拒绝…"
        : "正在提交…";
}

function candidateMeta(candidate: EducationWorkCandidate): string {
  if (candidate.status === "snoozed") return `稍后 ${readableDate(candidate.snoozeUntil)}`;
  if (candidate.status === "pending_review") return `截止 ${readableDate(candidate.dueAt)}`;
  return candidate.dueAt ? `截止 ${candidate.dueAt}` : "日期待确认";
}

function startEditor(candidate: EducationWorkCandidate, mode: EditorMode): EditorState {
  return {
    candidateId: candidate.candidateId,
    snapshotId: candidate.snapshotId,
    revision: candidate.revision,
    mode,
    title: candidate.title,
    summary: candidate.summary,
    dueAt: candidate.dueAt || "",
    snoozeUntil: tomorrow(),
    suppressionScope: "this_candidate",
    note: "",
  };
}

function capabilityCopy(capability: WorkCandidateReviewCapability): string | null {
  return capability.enabled ? null : "当前仅可查看，待办审核暂不可用。";
}

export function EduPiTodayWork({ data, onEducation, onTaskDetail }: Props) {
  const groups = groupWorkCandidates(data.workCandidates);
  const activeTasks = useMemo(() => todayActiveTasks(data), [data]);
  const taskById = useMemo(() => new Map(data.tasks.filter((task) => task.id).map((task) => [task.id!, task])), [data.tasks]);
  const capability = data.capabilities.workCandidateReview;
  const busy = useSyncExternalStore(subscribeTodayWorkMutation, getTodayWorkMutationSnapshot, getTodayWorkMutationSnapshot);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [changingDecisionId, setChangingDecisionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [retryReview, setRetryReview] = useState<ReviewRetry | null>(null);
  const [submission, setSubmission] = useState<Submission>(null);
  const editorCurrent = isTodayWorkEditorCurrent(editor, data.workCandidates, capability.enabled);
  const l4Summary = useMemo(() => summarizeL4Preparation(data.l4Preparation ?? null), [data.l4Preparation]);

  useEffect(() => {
    if (editor && !editorCurrent) {
      setEditor(null);
      setFeedback({ kind: "error", text: "内容已更新，本次没有写入；请刷新待办后重新决定。", action: "refresh" });
    }
  }, [editor, editorCurrent]);

  const review = async (
    candidate: EducationWorkCandidate,
    decision: EducationWorkCandidateDecision,
    patch?: Record<string, unknown>,
    note?: string,
  ) => {
    if (busy || !capability.enabled) return;
    setFeedback(null);
    setRetryReview(null);
    setSubmission({ candidateId: candidate.candidateId, decision });
    try {
      const result = await submitTodayWorkReview({ candidate, decision, patch, note });
      onEducation(result.data);
      setEditor(null);
      setChangingDecisionId(null);
      setFeedback({ kind: "success", text: actionSuccess(decision) });
    } catch (error) {
      if (error instanceof TodayWorkReviewError) {
        if (error.data) onEducation(error.data);
        const disposition = todayWorkFailureDisposition(error.code);
        if (disposition === "close") setEditor(null);
        setFeedback({ kind: "error", text: todayWorkErrorMessage(error.code), action: disposition === "close" ? "refresh" : undefined });
        if (disposition === "preserve") setRetryReview({ candidate, decision, patch, note });
      } else setFeedback({ kind: "error", text: todayWorkErrorMessage("malformed") });
    } finally {
      setSubmission(null);
    }
  };

  const refreshEducation = () => {
    setFeedback(null);
    setRetryReview(null);
    window.dispatchEvent(new Event("edupi-education-refresh"));
  };

  const openEditor = (candidate: EducationWorkCandidate, mode: EditorMode) => {
    setFeedback(null);
    setRetryReview(null);
    setEditor(startEditor(candidate, mode));
  };

  const cancelEditor = () => {
    setEditor(null);
    setFeedback(null);
    setRetryReview(null);
  };

  const submitModify = async (candidate: EducationWorkCandidate) => {
    if (!editor || !editorCurrent || editor.candidateId !== candidate.candidateId) return;
    const title = editor.title.trim();
    const summary = editor.summary.trim();
    if (!title || !summary) {
      setFeedback({ kind: "error", text: "标题和说明不能为空。" });
      setRetryReview(null);
      return;
    }
    const patch: Record<string, unknown> = {};
    if (title !== candidate.title) patch.title = title;
    if (summary !== candidate.summary) patch.summary = summary;
    if (editor.dueAt !== (candidate.dueAt || "")) patch.dueAt = editor.dueAt ? editor.dueAt : null;
    if (Object.keys(patch).length === 0) {
      setFeedback({ kind: "error", text: "请至少调整一项内容。" });
      setRetryReview(null);
      return;
    }
    if (Object.hasOwn(patch, "dueAt") && patch.dueAt !== null && !isDateOnly(String(patch.dueAt))) {
      setFeedback({ kind: "error", text: "截止日期格式无效。" });
      setRetryReview(null);
      return;
    }
    await review(candidate, "modify", patch);
  };

  const submitSnooze = async (candidate: EducationWorkCandidate) => {
    if (!editor || !editorCurrent || editor.candidateId !== candidate.candidateId || !isDateOnly(editor.snoozeUntil) || editor.snoozeUntil <= localIsoDate()) {
      setFeedback({ kind: "error", text: "请选择晚于今天的日期。" });
      setRetryReview(null);
      return;
    }
    await review(candidate, "snooze", { snoozeUntil: editor.snoozeUntil });
  };

  const submitSuppress = async (candidate: EducationWorkCandidate) => {
    if (!editor || !editorCurrent || editor.candidateId !== candidate.candidateId || !editor.note.trim()) {
      setFeedback({ kind: "error", text: "请填写停止提示的原因。" });
      setRetryReview(null);
      return;
    }
    await review(candidate, "suppress", { suppressionScope: editor.suppressionScope }, editor.note.trim());
  };

  const renderEditor = (candidate: EducationWorkCandidate) => {
    if (!editor || !editorCurrent || editor.candidateId !== candidate.candidateId) return null;
    if (editor.mode === "modify") {
      return <form className="edupi-today-work__editor" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void submitModify(candidate); }}>
        <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-edit-title">标题</label><input id="edupi-today-work-edit-title" value={editor.title} maxLength={240} disabled={busy} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></div>
        <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-edit-summary">说明</label><textarea id="edupi-today-work-edit-summary" value={editor.summary} maxLength={2000} rows={2} disabled={busy} onChange={(event) => setEditor({ ...editor, summary: event.target.value })} /></div>
        <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-edit-due">截止日期</label><input id="edupi-today-work-edit-due" type="date" value={editor.dueAt} disabled={busy} onChange={(event) => setEditor({ ...editor, dueAt: event.target.value })} /></div>
        <div className="edupi-today-work__editor-actions"><button type="submit" className="is-primary" disabled={busy}>{busy ? "正在调整…" : "保存调整"}</button><button type="button" disabled={busy} onClick={cancelEditor}>取消</button></div>
      </form>;
    }
    if (editor.mode === "snooze") {
      return <form className="edupi-today-work__editor" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void submitSnooze(candidate); }}>
        <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-snooze-until">稍后日期</label><input id="edupi-today-work-snooze-until" type="date" value={editor.snoozeUntil} min={tomorrow()} disabled={busy} onChange={(event) => setEditor({ ...editor, snoozeUntil: event.target.value })} /></div>
        <div className="edupi-today-work__editor-actions"><button type="submit" className="is-primary" disabled={busy}>{busy ? "正在安排…" : "安排稍后"}</button><button type="button" disabled={busy} onClick={cancelEditor}>取消</button></div>
      </form>;
    }
    return <form className="edupi-today-work__editor" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void submitSuppress(candidate); }}>
      <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-suppression-scope">停止范围</label><select id="edupi-today-work-suppression-scope" value={editor.suppressionScope} disabled={busy} onChange={(event) => setEditor({ ...editor, suppressionScope: event.target.value as EditorState["suppressionScope"] })}>{Object.entries(SUPPRESSION_SCOPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-suppression-note">原因</label><textarea id="edupi-today-work-suppression-note" value={editor.note} maxLength={1000} rows={2} disabled={busy} onChange={(event) => setEditor({ ...editor, note: event.target.value })} /></div>
      <div className="edupi-today-work__editor-actions"><button type="submit" className="is-danger" disabled={busy}>{busy ? "正在停止…" : "停止提示"}</button><button type="button" disabled={busy} onClick={cancelEditor}>取消</button></div>
    </form>;
  };

  const renderCandidate = (candidate: EducationWorkCandidate, actionable: boolean) => {
    const task = taskById.get(candidate.taskId) || null;
    const isEditing = editorCurrent && editor?.candidateId === candidate.candidateId;
    const decisionRecorded = candidate.status !== "pending_review";
    const changingDecision = changingDecisionId === candidate.candidateId;
    const showActions = actionable && (!decisionRecorded || changingDecision);
    const submittingCandidate = submission?.candidateId === candidate.candidateId;
    return <article className={`edupi-today-work__item is-${candidate.status}`} key={candidate.candidateId}>
      <header className="edupi-today-work__item-header"><div><span>{candidateMeta(candidate)}</span><h4>{task ? <button type="button" className="edupi-today-work__item-title" disabled={busy} onClick={() => onTaskDetail(task)} aria-label={`打开任务：${candidate.title}`}>{candidate.title}<span aria-hidden="true">›</span></button> : candidate.title}</h4></div><strong className={`edupi-today-work__status is-${candidate.status}`}>{STATUS_LABELS[candidate.status]}</strong></header>
      <p className="edupi-today-work__summary">{candidate.summary}</p>
      <div className="edupi-today-work__reason"><span>原因</span>{workCandidateReasonLabel(candidate.reason)}</div>
      <details className="edupi-today-work__details"><summary>来源与依据</summary><dl><div><dt>来源</dt><dd>{candidate.sourceIds.join("、")}</dd></div><div><dt>依据</dt><dd>{candidate.evidenceIds.join("、")}</dd></div><div><dt>下一步</dt><dd>{NEXT_CYCLE_LABELS[candidate.nextCycleState] || candidate.nextCycleState}</dd></div><div><dt>候选 ID</dt><dd>{candidate.candidateId}</dd></div></dl></details>
      {decisionRecorded && !changingDecision ? <div className={`edupi-today-work__decision is-${candidate.status}`} role="status"><span>{STATUS_LABELS[candidate.status]}{candidate.teacherReview.reviewedAt ? ` · ${candidate.teacherReview.reviewedAt}` : ""}</span>{capability.enabled ? <button type="button" disabled={busy} onClick={() => setChangingDecisionId(candidate.candidateId)}>修改决定</button> : null}</div> : null}
      {showActions && capability.enabled ? <div className="edupi-today-work__actions">
        <button type="button" className="is-primary" title={ACTION_TITLES.accept} disabled={busy} onClick={() => void review(candidate, "accept")}>{submittingCandidate && submission?.decision === "accept" ? submittingLabel("accept") : "接受"}</button>
        <button type="button" title={ACTION_TITLES.modify} disabled={busy} onClick={() => isEditing && editor?.mode === "modify" ? cancelEditor() : openEditor(candidate, "modify")}>{isEditing && editor?.mode === "modify" ? "收起调整" : "调整"}</button>
        <button type="button" title={ACTION_TITLES.hold} disabled={busy} onClick={() => void review(candidate, "hold")}>{submittingCandidate && submission?.decision === "hold" ? submittingLabel("hold") : "暂缓"}</button>
        <button type="button" title={ACTION_TITLES.snooze} disabled={busy} onClick={() => isEditing && editor?.mode === "snooze" ? cancelEditor() : openEditor(candidate, "snooze")}>稍后</button>
        <button type="button" title={ACTION_TITLES.suppress} disabled={busy} onClick={() => isEditing && editor?.mode === "suppress" ? cancelEditor() : openEditor(candidate, "suppress")}>停止提示</button>
        <button type="button" className="is-danger" title={ACTION_TITLES.reject} disabled={busy} onClick={() => void review(candidate, "reject")}>{submittingCandidate && submission?.decision === "reject" ? submittingLabel("reject") : "拒绝"}</button>
      </div> : null}
      {isEditing ? renderEditor(candidate) : null}
    </article>;
  };

  const renderGroup = (group: keyof WorkCandidateGroups) => {
    const candidates = groups[group];
    return <section className={`edupi-today-work__group is-${group}`} aria-labelledby={`edupi-today-work-${group}`} key={group}>
      <header><div><h3 id={`edupi-today-work-${group}`}>{GROUP_LABELS[group]}</h3><p>{GROUP_HINTS[group]}</p></div><span>{candidates.length} 项</span></header>
      <div className="edupi-today-work__items">{candidates.map((candidate) => renderCandidate(candidate, true))}</div>
      {candidates.length === 0 ? <p className="edupi-today-work__empty">这里暂时没有事项</p> : null}
    </section>;
  };

  const renderL4Group = (group: (typeof L4_GROUP_LABELS)[number], items: L4PreparationSummaryItem[]) => (
    <section className={`edupi-today-l4__group is-${group.key}`} aria-label={group.title} key={group.key}>
      <header><h4>{group.title}</h4><span>{items.length} 项</span></header>
      <div className="edupi-today-l4__items">
        {items.map(item => (
          <article className="edupi-today-l4__item" key={item.workCaseId}>
            <strong>{item.statusLabel}</strong>
            <p>{item.title}</p>
          </article>
        ))}
        {items.length === 0 ? <p className="edupi-today-l4__empty">暂无事项</p> : null}
      </div>
    </section>
  );

  const unavailableCopy = capabilityCopy(capability);
  return <section className="edupi-today-work" aria-labelledby="edupi-today-work-title" aria-busy={busy}>
    <header className="edupi-today-work__header"><div><span>教师工作</span><h2 id="edupi-today-work-title">今天要判断</h2></div><span>{data.workCandidates.length} 项 · 教师内部</span></header>
    {activeTasks.length > 0 ? <div className="edupi-today-flow" aria-label="正在进行的任务"><header><span>正在进行</span><strong>{activeTasks.length} 项</strong></header><div>{activeTasks.slice(0, 4).map(({ task, title, dueDate, state, stateLabel }) => <button type="button" key={task.id} onClick={() => onTaskDetail(task)}><i className={`edupi-flow-state is-${state}`} aria-hidden="true" /><span><strong>{title}</strong><small>{stateLabel}{dueDate ? ` · ${dueDate}` : ""}</small></span><em aria-hidden="true">›</em></button>)}</div></div> : null}
    {unavailableCopy ? <p className="edupi-today-work__notice">{unavailableCopy}</p> : null}
    {data.l4Preparation ? (
      <section className="edupi-today-l4" aria-labelledby="edupi-today-l4-title">
        <header><div><h3 id="edupi-today-l4-title">自动准备</h3></div><span>{data.l4Preparation.goals.length} 个目标</span></header>
        <div className="edupi-today-l4__groups">
          {L4_GROUP_LABELS.map(({ key, title }) => renderL4Group({ key, title }, l4Summary[key]))}
        </div>
      </section>
    ) : null}
    {feedback ? <div className={`edupi-today-work__feedback is-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"} aria-live="polite"><span>{feedback.text}</span>{feedback.kind === "error" && retryReview ? <button type="button" disabled={busy} onClick={() => void review(retryReview.candidate, retryReview.decision, retryReview.patch, retryReview.note)}>重试</button> : feedback.action === "refresh" ? <button type="button" disabled={busy} onClick={refreshEducation}>刷新待办</button> : null}</div> : null}
    <div className="edupi-today-work__groups">{(["now", "later", "done"] as const).map(renderGroup)}</div>
  </section>;
}
