"use client";
import { useEffect, useRef, useState } from "react";
import { readPreparationExecution, controlPreparationExecution } from "@/lib/edupi-preparation-execution-client";
import { PreparationExecutionError, preparationPhaseLabel, preparationStateLabel, preparationExecutionErrorMessage, type PreparationExecution } from "@/lib/edupi-preparation-execution";
import { preparationIssueDetail } from "@/lib/edupi-preparation-issues";

type Props = { taskId: string; revision: number; onUpdated?: () => void };
export function EduPiPreparationExecution({ taskId, revision, onUpdated }: Props) {
  const [view, setView] = useState<PreparationExecution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"cancel" | "retry" | null>(null);
  const [reload, setReload] = useState(0);
  const owner = useRef({ identity: `${taskId}:${revision}`, epoch: 0, read: null as AbortController | null, action: null as AbortController | null });
  const updated = useRef(onUpdated);
  updated.current = onUpdated;
  if (owner.current.identity !== `${taskId}:${revision}`) {
    owner.current.read?.abort(); owner.current.action?.abort();
    owner.current = { identity: `${taskId}:${revision}`, epoch: owner.current.epoch + 1, read: null, action: null };
    setView(null); setLoading(true); setError(""); setBusy(null);
  }
  useEffect(() => () => { owner.current.epoch++; owner.current.read?.abort(); owner.current.action?.abort(); }, []);
  useEffect(() => {
    const epoch = owner.current.epoch, controller = new AbortController(); owner.current.read = controller;
    let active = true, inFlight = false, unavailable = false;
    const current = () => active && !controller.signal.aborted && owner.current.epoch === epoch;
    const load = async () => {
      if (inFlight || unavailable || !current()) return;
      inFlight = true;
      try {
        const next = await readPreparationExecution(taskId, revision, controller.signal);
        if (!current()) return;
        if (next.task_id !== taskId || next.task_revision !== revision) throw new PreparationExecutionError("invalid_response");
        setView(next); setError("");
      } catch (cause) {
        if (!current()) return;
        setView(null); setError(preparationExecutionErrorMessage(cause));
        unavailable = cause instanceof PreparationExecutionError && ["forbidden", "unsupported_operation", "runtime_unavailable"].includes(cause.code);
      } finally { inFlight = false; if (current()) setLoading(false); }
    };
    setLoading(true); void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 2000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, [taskId, revision, reload]);
  const control = async (action: "cancel" | "retry") => {
    if (!view?.actions[action] || owner.current.action) return;
    const captured = view, epoch = owner.current.epoch, controller = new AbortController(); owner.current.action = controller;
    const current = () => owner.current.epoch === epoch && !controller.signal.aborted;
    setBusy(action); setError("");
    try {
      await controlPreparationExecution(captured, action, controller.signal);
      if (!current()) return;
      setView(null); setReload(value => value + 1); updated.current?.();
    } catch (cause) { if (current()) { setView(null); setError(preparationExecutionErrorMessage(cause)); } }
    finally { if (current()) { owner.current.action = null; setBusy(null); } }
  };
  return <section className="edupi-task-detail-section edupi-task-flow" aria-label="Core 执行" data-core-task-id={taskId}>
    <div className="edupi-stage-toolbar"><span>准备执行</span><button type="button" disabled={loading || busy !== null} onClick={() => setReload(value => value + 1)}>重新读取</button></div>
    {loading && !view ? <p role="status">正在读取…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {view ? <>
      <p role="status"><strong>{preparationPhaseLabel(view.phase) || preparationStateLabel(view.state)}</strong>
        {view.attempt !== null ? <span> · {view.attempt === 0 ? "尚未尝试" : `第 ${view.attempt} 次执行`}</span> : null}
        {view.active && view.phase === null ? <span> · 阶段未知</span> : null}</p>
      {view.failure_code && ["failed", "stale", "held", "cancelled"].includes(view.state) ? <p>{preparationIssueDetail(view.failure_code) || "执行未确认"}</p> : null}
      {view.actions.cancel || view.actions.retry ? <div className="edupi-review-actions">
        {view.actions.cancel ? <button type="button" className="edupi-teacher-body__icon-button" disabled={busy !== null} aria-label="停止准备" title="停止准备" aria-busy={busy === "cancel"} onClick={() => void control("cancel")}><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="0.8" fill="currentColor" /></svg></button> : null}
        {view.actions.retry ? <button type="button" disabled={busy !== null} onClick={() => void control("retry")}>{busy === "retry" ? "正在提交" : "重试"}</button> : null}
      </div> : null}
      {view.history.length ? <details><summary>执行记录</summary><ol>{view.history.map(entry => <li className={`is-${entry.state}`} key={`${entry.execution_id}:${entry.sequence}`}>
        <div><strong>{preparationStateLabel(entry.state)}</strong><small>第 {entry.attempt} 次执行</small>{entry.failure_code ? <p>{preparationIssueDetail(entry.failure_code) || "执行未确认"}</p> : null}</div><time>{new Date(entry.occurred_at).toLocaleString("zh-CN")}</time>
      </li>)}</ol>{view.history_truncated ? <p>最近 50 条记录</p> : null}{view.history_inferred ? <p>含旧版兼容记录</p> : null}</details> : null}
      {view.artifact_ids.length ? <details><summary>诊断</summary><span>产物 ID</span><ul>{view.artifact_ids.map(id => <li key={id}><code>{id}</code></li>)}</ul></details> : null}
    </> : null}
  </section>;
}
