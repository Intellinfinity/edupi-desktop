"use client";

import { useMemo, useState } from "react";

import type { TeacherTask } from "@/lib/edupi-education-contract";
import { mutateEduPiTeachingMethod, type EduPiTeachingMethodAction, type EduPiTeachingMethodOutcome, type EduPiTeachingSkill, type EduPiTeachingSkillLifecycle } from "@/lib/edupi-platform-client";
import { taskDisplayTitle } from "@/lib/edupi-workbench";

type EditorMode = Extract<EduPiTeachingMethodAction, "create" | "update" | "record_trial" | "validate" | "publish" | "retire">;

type Props = {
  mode: EditorMode;
  method?: EduPiTeachingSkill;
  tasks?: TeacherTask[];
  mutationEnabled?: boolean;
  onSaved: (lifecycle: EduPiTeachingSkillLifecycle) => void;
  onCancel?: () => void;
};

const OUTCOME_OPTIONS: Array<{ value: EduPiTeachingMethodOutcome; label: string }> = [
  { value: "helpful", label: "有效" },
  { value: "mixed", label: "部分有效" },
  { value: "not_helpful", label: "未达到预期" },
];

function submitLabel(mode: EditorMode, busy: boolean): string {
  if (busy) return "保存中…";
  if (mode === "create") return "保存方法";
  if (mode === "update") return "保存修订";
  if (mode === "record_trial") return "保存反馈";
  if (mode === "validate") return "验证通过";
  return "停用";
}

export function EduPiTeachingMethodEditor({ mode, method, tasks = [], mutationEnabled = false, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(method?.title || "");
  const [content, setContent] = useState(method?.details?.content || "");
  const eligibleTasks = useMemo(() => tasks.filter((task) => Boolean(task.id)
    && task.status !== "rejected" && task.status !== "hold"
    && (task.trigger === "teacher_created" || task.status === "accepted" || task.status === "modified")), [tasks]);
  const [taskId, setTaskId] = useState(eligibleTasks[0]?.id || "");
  const [outcome, setOutcome] = useState<EduPiTeachingMethodOutcome>("helpful");
  const [feedback, setFeedback] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = method?.revision;

  const save = async (decision: "accepted" | "rejected" = "accepted") => {
    if (!mutationEnabled) return;
    setBusy(true);
    setError("");
    try {
      let next: EduPiTeachingSkillLifecycle;
      if (mode === "create") next = await mutateEduPiTeachingMethod({ action: mode, title, content });
      else {
        if (!method || revision === null || revision === undefined) throw new Error("此方法来自旧版本，只能查看");
        if (mode === "update") next = await mutateEduPiTeachingMethod({ action: mode, methodId: method.skillId, expectedRevision: revision, title, content });
        else if (mode === "record_trial") next = await mutateEduPiTeachingMethod({ action: mode, methodId: method.skillId, expectedRevision: revision, taskId, outcome, feedback });
        else if (mode === "validate") next = await mutateEduPiTeachingMethod({ action: mode, methodId: method.skillId, expectedRevision: revision, decision, feedback });
        else if (mode === "publish") next = await mutateEduPiTeachingMethod({ action: mode, methodId: method.skillId, expectedRevision: revision });
        else next = await mutateEduPiTeachingMethod({ action: mode, methodId: method.skillId, expectedRevision: revision, reason });
      }
      window.dispatchEvent(new Event("edupi-preparation-updated"));
      onSaved(next);
    } catch (error) {
      setError(error instanceof Error ? error.message : "教学方法操作失败");
    } finally { setBusy(false); }
  };

  if (!mutationEnabled) return <p>当前教学方法不可编辑。</p>;
  if (mode !== "create" && (!method || revision === null || revision === undefined)) return <p>旧方法保留为历史记录。</p>;

  if (mode === "publish") return <div className="edupi-method-editor is-compact"><p>发布后，匹配的后续备课会采用这个方法。</p>{error ? <p role="alert">{error}</p> : null}<div className="edupi-method-editor__actions">{onCancel ? <button type="button" onClick={onCancel}>取消</button> : null}<button type="button" className="is-primary" disabled={busy} onClick={() => void save()}>{busy ? "发布中…" : "发布"}</button></div></div>;

  return <form className="edupi-method-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    {mode === "create" || mode === "update" ? <>
      <label>方法名称<input value={title} maxLength={240} required onChange={(event) => setTitle(event.target.value)} /></label>
      <label>具体做法<textarea value={content} required maxLength={12000} rows={5} onChange={(event) => setContent(event.target.value)} /></label>
      {mode === "update" && content !== method?.details?.content ? <p>保存后需要重新试用和验证。</p> : null}
    </> : null}
    {mode === "record_trial" ? <>
      <label>教学任务<select value={taskId} required onChange={(event) => setTaskId(event.target.value)}><option value="" disabled>选择实际教学任务</option>{eligibleTasks.map((task) => <option key={task.id} value={task.id || ""}>{taskDisplayTitle(task)}</option>)}</select></label>
      <label>实际效果<select value={outcome} onChange={(event) => setOutcome(event.target.value as EduPiTeachingMethodOutcome)}>{OUTCOME_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label>课堂反馈<textarea value={feedback} required maxLength={4000} rows={4} onChange={(event) => setFeedback(event.target.value)} /></label>
      {eligibleTasks.length === 0 ? <p role="alert">暂无可关联的教学任务</p> : null}
    </> : null}
    {mode === "validate" ? <label>验证意见<textarea value={feedback} required maxLength={4000} rows={4} onChange={(event) => setFeedback(event.target.value)} /></label> : null}
    {mode === "retire" ? <label>停用原因<textarea value={reason} required maxLength={1000} rows={3} onChange={(event) => setReason(event.target.value)} /></label> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="edupi-method-editor__actions">
      {onCancel ? <button type="button" disabled={busy} onClick={onCancel}>取消</button> : null}
      {mode === "validate" ? <button type="button" disabled={busy || !feedback.trim()} onClick={() => void save("rejected")}>不再使用</button> : null}
      <button type="submit" className="is-primary" disabled={busy || mode === "record_trial" && (!taskId || !feedback.trim()) || mode === "validate" && !feedback.trim() || mode === "retire" && !reason.trim() || (mode === "create" || mode === "update") && (!title.trim() || !content.trim())}>
        {submitLabel(mode, busy)}
      </button>
    </div>
  </form>;
}
