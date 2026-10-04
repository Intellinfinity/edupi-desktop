"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { readEduPiProactivity, updateEduPiProactivity, type EduPiProactivityDomain, type EduPiProactivityState } from "@/lib/edupi-proactivity-client";
import { createMissedTeacherFeedbackCapture, recordTeacherFeedback, type TeacherFeedbackCapture, type TeacherFeedbackDomain } from "@/lib/edupi-teacher-feedback";

type ViewProps = {
  state: EduPiProactivityState;
  selectedKey: string;
  busy: boolean;
  message: string | null;
  onSelect: (value: string) => void;
  onToggle: () => void;
};

const scopeKey = (scope: { classId: string; subject: string }) => JSON.stringify([scope.classId, scope.subject]);
const EXECUTION_STATUS = { queued: "已排队", claimed: "已领取", completed: "草稿已生成", failed: "生成失败", cancelled: "已取消" };
type FeedbackScope = EduPiProactivityState["scopes"][number];

const FEEDBACK_DOMAINS: Array<{ value: TeacherFeedbackDomain; label: string }> = [
  { value: "teaching_preparation", label: "教学准备" },
  { value: "student_followup", label: "学生跟进" },
  { value: "lesson_reflection", label: "课后复盘" },
  { value: "calendar_administration", label: "校历与行政" },
  { value: "parent_communication", label: "家长沟通" },
  { value: "safety_privacy", label: "安全与隐私" },
];

export function EduPiMissedOpportunityFeedbackView({ scopes, selectedKey, domain, note, busy, message, onSelect, onDomain, onNote, onSubmit }: {
  scopes: FeedbackScope[];
  selectedKey: string;
  domain: TeacherFeedbackDomain;
  note: string;
  busy: boolean;
  message: string | null;
  onSelect: (value: string) => void;
  onDomain: (value: TeacherFeedbackDomain) => void;
  onNote: (value: string) => void;
  onSubmit: () => void;
}) {
  return <details className="edupi-missed-feedback">
    <summary>报告漏掉的事项</summary>
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <label><span>班级与学科</span><select aria-label="漏报班级与学科" value={selectedKey} disabled={busy} onChange={(event) => onSelect(event.target.value)}>{scopes.map((scope) => <option key={scopeKey(scope)} value={scopeKey(scope)}>{scope.className || scope.classId} · {scope.subject}</option>)}</select></label>
      <label><span>领域</span><select aria-label="漏报领域" value={domain} disabled={busy} onChange={(event) => onDomain(event.target.value as TeacherFeedbackDomain)}>{FEEDBACK_DOMAINS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="is-wide"><span>应该提醒什么</span><textarea required rows={3} maxLength={2000} value={note} disabled={busy} onChange={(event) => onNote(event.target.value)} /></label>
      <button type="submit" disabled={busy || !selectedKey || !note.trim()}>{busy ? "记录中…" : "记录漏报"}</button>
      {message ? <p role="status" aria-live="polite">{message}</p> : null}
    </form>
  </details>;
}

function EduPiMissedOpportunityFeedback({ scopes, enabled }: { scopes: FeedbackScope[]; enabled: boolean }) {
  const available = scopes.filter((scope) => scope.classId && scope.subject);
  const [selectedKey, setSelectedKey] = useState(() => available[0] ? scopeKey(available[0]) : "");
  const [domain, setDomain] = useState<TeacherFeedbackDomain>("teaching_preparation");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [retry, setRetry] = useState<TeacherFeedbackCapture | null>(null);
  useEffect(() => {
    if (!available.some((scope) => scopeKey(scope) === selectedKey)) setSelectedKey(available[0] ? scopeKey(available[0]) : "");
  }, [available, selectedKey]);
  if (!enabled || available.length === 0) return null;
  const resetRetry = () => { setRetry(null); setMessage(null); };
  const submit = async () => {
    if (busy) return;
    const selected = available.find((scope) => scopeKey(scope) === selectedKey);
    if (!selected || !note.trim()) return;
    let capture = retry;
    try {
      capture ??= createMissedTeacherFeedbackCapture({ domain, scope: { classId: selected.classId, subject: selected.subject }, note });
    } catch {
      setMessage("漏报内容无效，请检查后重试。");
      return;
    }
    setRetry(capture);
    setBusy(true);
    setMessage(null);
    try {
      await recordTeacherFeedback(capture);
      setRetry(null);
      setNote("");
      setMessage("漏报已记录。");
    } catch {
      setMessage("漏报尚未写入，请重试。");
    } finally { setBusy(false); }
  };
  return <EduPiMissedOpportunityFeedbackView scopes={available} selectedKey={selectedKey} domain={domain} note={note} busy={busy} message={message}
    onSelect={(value) => { resetRetry(); setSelectedKey(value); }}
    onDomain={(value) => { resetRetry(); setDomain(value); }}
    onNote={(value) => { resetRetry(); setNote(value); }}
    onSubmit={() => void submit()} />;
}

export function EduPiProactivityCanaryView({ state, selectedKey, busy, message, onSelect, onToggle }: ViewProps) {
  const studentFollowup = state.limits.domain === "student_followup";
  const titleId = studentFollowup ? "edupi-student-followup-canary-title" : "edupi-proactivity-canary-title";
  const blocked = Boolean(state.requiresSafeMode || state.activationBlocked);
  const active = state.activation.enabled;
  const recoveryPending = !active && state.activation.scope !== null;
  const budget = state.grant?.modelBudget;
  const operational = active && !blocked && state.grant?.status === "active" && state.capabilities !== null
    && Object.values(state.capabilities).every(Boolean) && (!studentFollowup || state.capabilities.studentFollowup === true)
    && (studentFollowup && !budget
      || budget && !budget.usageUnverified && budget.remainingCalls > 0);
  const budgetExhausted = active && budget && !budget.usageUnverified && budget.remainingCalls === 0;
  const ready = state.scopes.filter((scope) => scope.ready);
  const current = active || recoveryPending ? state.activation.scope : ready.find((scope) => scopeKey(scope) === selectedKey) || null;
  const currentLabel = current
    ? `${"className" in current && current.className ? current.className : current.classId} · ${current.subject}`
    : "没有可用范围";
  const blockedLabel = state.activationBlocked === "windows_unavailable" ? "Windows 暂不可用" : state.activationBlocked ? "仅隔离试用" : null;
  return <section className="edupi-proactivity-canary" aria-labelledby={titleId}>
    <div>
      <span><strong id={titleId}>{studentFollowup ? "学生跟进试用" : "课前准备试用"}</strong><small>{active && state.grant
        ? budget && !budget.usageUnverified ? `${currentLabel} · 剩余 ${budget.remainingCalls} 次`
          : `${currentLabel} · 最多 ${state.limits.maxModelCalls} 次 · 剩余未知`
        : recoveryPending ? currentLabel : `${state.limits.durationDays} 天 · 最多 ${state.limits.maxModelCalls} 次模型调用`}</small></span>
      {active ? <em className={operational ? "is-ready" : undefined}>{blockedLabel || (state.requiresSafeMode ? "安全模式待启动" : budgetExhausted ? "额度已用完" : operational ? "已启用" : "需要恢复")}</em>
        : <em>{recoveryPending ? state.activation.configurationStatus === "legacy" ? "旧授权待停止" : "停止待恢复"
          : blockedLabel || (state.requiresSafeMode ? "安全模式可试用" : state.activation.configurationStatus === "legacy" ? "旧试用已关闭" : "默认关闭")}</em>}
    </div>
    {!active && !recoveryPending && ready.length > 0 ? <label><span>班级与学科</span><select aria-label={studentFollowup ? "学生跟进班级与学科" : "主动备课班级与学科"} value={selectedKey} disabled={busy} onChange={(event) => onSelect(event.target.value)}>{ready.map((scope) => <option key={scopeKey(scope)} value={scopeKey(scope)}>{scope.className || scope.classId} · {scope.subject}</option>)}</select></label> : null}
    <button className={!active && !recoveryPending ? "edupi-admin-primary" : undefined} type="button" disabled={busy || !active && !recoveryPending && (!current || blocked)} onClick={onToggle}>{busy ? "处理中…" : active ? "停止主动运行" : recoveryPending ? state.activation.configurationStatus === "legacy" ? "停止旧授权" : "重试停止" : "启用试用"}</button>
    {message ? <p role="status" aria-live="polite">{message}</p>
      : !active && state.activationBlocked === "isolated_canary_required" ? <p role="status">学生跟进需使用隔离数据目录试用。</p>
      : !active && state.requiresSafeMode ? <p role="status">Windows 试用需用隔离数据目录以安全模式启动。</p>
      : !active && !blocked && ready.length === 0 ? <p role="status">{studentFollowup ? "需要明确班级的数学课表和当前学生名单。" : "需要一条带班级 ID 的课表和同范围材料。"}</p> : null}
    {studentFollowup ? <details className="edupi-proactivity-execution">
      <summary>执行记录</summary>
      {!state.execution?.available ? <p>执行记录暂不可用</p>
        : state.execution.records.length === 0 ? <p>暂无执行记录</p>
          : <ul>{state.execution.records.map((item) => <li key={item.executionId}>
            <span>{item.followUpId}</span>
            <span>{item.sourceStatus === "current" ? EXECUTION_STATUS[item.status]
              : item.sourceStatus === "historical" ? "历史记录" : "来源待核实"}</span>
          </li>)}</ul>}
    </details> : null}
  </section>;
}

export function EduPiProactivityCanary({ onChanged, feedbackEnabled = false, domain = "teaching_preparation" }: { onChanged?: () => void; feedbackEnabled?: boolean; domain?: EduPiProactivityDomain }) {
  const [state, setState] = useState<EduPiProactivityState | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busyRef = useRef(false);
  const refreshEpoch = useRef(0);
  const refreshAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!isTauriDesktop()) return;
    let disposed = false;
    const refresh = () => {
      if (busyRef.current || document.hidden) return;
      const epoch = ++refreshEpoch.current;
      refreshAbort.current?.abort();
      const controller = new AbortController();
      refreshAbort.current = controller;
      void readEduPiProactivity(controller.signal, domain).then((next) => {
        if (disposed || epoch !== refreshEpoch.current) return;
        setState(next);
        const preferred = next.activation.scope ? scopeKey(next.activation.scope)
          : next.scopes.find((scope) => scope.ready) ? scopeKey(next.scopes.find((scope) => scope.ready)!) : "";
        setSelectedKey((current) => next.scopes.some((scope) => scopeKey(scope) === current) ? current : preferred);
        setMessage((current) => current === "主动运行状态暂不可用" ? null : current);
      }, () => {
        if (!disposed && epoch === refreshEpoch.current && !controller.signal.aborted) setMessage("主动运行状态暂不可用");
      });
    };
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      refreshAbort.current?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [domain]);
  const selected = useMemo(() => state?.scopes.find((scope) => scopeKey(scope) === selectedKey) || null, [selectedKey, state]);
  if (!isTauriDesktop()) return null;
  if (!state || state.limits.domain !== domain) return <p className="edupi-proactivity-canary__loading" role={message ? "alert" : "status"}>{message || "正在读取主动运行…"}</p>;
  const toggle = async () => {
    if (busyRef.current) return;
    const recoveryPending = !state.activation.enabled && state.activation.scope !== null;
    const enabling = !state.activation.enabled && !recoveryPending;
    if (enabling && (!selected || state.requiresSafeMode || state.activationBlocked
      || !window.confirm(`启用 ${selected.className || selected.classId} · ${selected.subject} 的${domain === "student_followup" ? "学生跟进" : "主动备课"}试用？\n${state.limits.durationDays} 天，最多 ${state.limits.maxModelCalls} 次调用已配置模型；不会自动发给学生或家长。`))) return;
    busyRef.current = true;
    ++refreshEpoch.current;
    refreshAbort.current?.abort();
    setBusy(true); setMessage(null);
    try {
      const next = await updateEduPiProactivity(enabling
        ? { enabled: true, classId: selected!.classId, subject: selected!.subject, expectedUpdatedAt: state.activation.updatedAt, domain }
        : { enabled: false, classId: null, subject: null, expectedUpdatedAt: state.activation.updatedAt, domain });
      setState(next);
      setMessage(enabling ? next.grant?.modelBudget && !next.grant.modelBudget.usageUnverified && next.grant.modelBudget.remainingCalls === 0 ? "额度已用完"
        : domain === "student_followup" ? "学生跟进已启用"
        : next.initialScan?.needsAttention ? "已启用，部分课前任务需核对" : "主动备课已启用"
        : recoveryPending && state.activation.configurationStatus === "legacy" ? "旧授权已停止" : "主动运行已停止");
      onChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "主动运行设置暂不可用");
    } finally { busyRef.current = false; setBusy(false); }
  };
  return <>
    <EduPiProactivityCanaryView state={state} selectedKey={selectedKey} busy={busy} message={message} onSelect={setSelectedKey} onToggle={() => void toggle()} />
    <EduPiMissedOpportunityFeedback scopes={state.scopes} enabled={feedbackEnabled} />
  </>;
}
