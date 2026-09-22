"use client";

import { useEffect, useState } from "react";
import { isTauriDesktop } from "@/lib/desktop-updater";
import {
  bootstrapScheduleConflictReview,
  captureScheduleDecision,
  readScheduleConflicts,
  resolveScheduleConflict,
  ScheduleConflictError,
  type ScheduleConflict,
  type ScheduleConflictDecision,
  type ScheduleResolution,
} from "@/lib/edupi-schedule-conflicts";

const DECISIONS: Array<{ value: ScheduleConflictDecision; label: string }> = [
  { value: "keep_existing", label: "保留原安排" },
  { value: "replace_with_candidate", label: "采用新安排" },
  { value: "keep_both_distinct", label: "两项分别保留" },
];

function value(item: Record<string, unknown>, key: string): string {
  const raw = item[key];
  if (key === "confidence") return ({ confirmed: "已确认", teacher_confirmed: "教师确认", inferred: "识别待确认" } as Record<string, string>)[String(raw)] || "未设置";
  return typeof raw === "string" && raw.trim() ? raw : typeof raw === "number" ? String(raw) : "未设置";
}

function scheduleLabel(conflict: ScheduleConflict, item: Record<string, unknown>): string {
  if (conflict.kind === "calendar") {
    return [value(item, "date"), value(item, "name")].filter((part) => part !== "未设置").join(" · ");
  }
  return [`周${value(item, "day_of_week")}`, `第${value(item, "period")}节`, value(item, "subject"), value(item, "class_name")]
    .filter((part) => part !== "未设置").join(" · ");
}

function ScheduleDetails({ conflict, item, title }: { conflict: ScheduleConflict; item: Record<string, unknown>; title: string }) {
  const fields = conflict.kind === "calendar"
    ? [["日期", "date"], ["结束日期", "end_date"], ["原文日期", "raw_date"], ["事项", "name"], ["类型", "type"], ["来源状态", "confidence"], ["备注", "notes"]]
    : [["星期", "day_of_week"], ["节次", "period"], ["科目", "subject"], ["班级", "class_name"], ["班级 ID", "class_id"], ["类型", "kind"], ["开始时间", "start_time"], ["时区", "time_zone"], ["备注", "notes"]];
  return <div className="edupi-schedule-review__source">
    <strong>{title}</strong>
    <dl>{fields.map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{value(item, key)}</dd></div>)}</dl>
    <small>来源：{(item.source_ids as string[]).join("、") || "未设置"}</small>
  </div>;
}

export function EduPiScheduleConflictReview({ enabled }: { enabled: boolean }) {
  const [native, setNative] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ScheduleConflict[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decision, setDecision] = useState<ScheduleConflictDecision | "">("");
  const [pending, setPending] = useState<ScheduleResolution | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setNative(isTauriDesktop()); }, []);

  if (!native || !enabled) return null;

  const load = async (after?: string) => {
    const result = await readScheduleConflicts(fetch, undefined, after);
    setItems((current) => after ? [...current, ...result.conflicts.filter((item) => !current.some((row) => row.conflictId === item.conflictId))] : result.conflicts);
    setCursor(result.nextCursor);
  };

  const openReview = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      try { await load(); }
      catch (cause) {
        if (!(cause instanceof ScheduleConflictError) || cause.code !== "owner_uninitialized") throw cause;
        await bootstrapScheduleConflictReview();
        await load();
      }
      setOpen(true);
    } catch {
      setError("待核对安排暂不可用，请重试。");
    } finally { setBusy(false); }
  };

  const decide = async (capture: ScheduleResolution) => {
    if (busy) return;
    setBusy(true);
    setPending(capture);
    setError(null);
    try {
      await resolveScheduleConflict(capture);
    } catch (cause) {
      if (cause instanceof ScheduleConflictError && ["schedule_conflict_stale", "schedule_conflict_source_deleted", "schedule_conflict_replay_mismatch"].includes(cause.code)) {
        setPending(null);
        setSelectedId(null);
        setItems([]);
        setCursor(null);
        setError("来源或决定已变化，请刷新待核对安排。");
      } else setError("处理结果尚未确认，请用原决定重试。");
      setBusy(false);
      return;
    }
    setPending(null);
    setSelectedId(null);
    setDecision("");
    setItems([]);
    setCursor(null);
    window.dispatchEvent(new Event("edupi-education-refresh"));
    try {
      await load();
    } catch {
      setError("决定已记录，待核对列表更新失败，请刷新。");
    } finally { setBusy(false); }
  };

  const selected = items.find((item) => item.conflictId === selectedId);
  return <section className="edupi-schedule-review" aria-label="待核对安排" aria-busy={busy}>
    <header>
      <strong>待核对安排{open && !error ? ` · ${items.length}` : ""}</strong>
      <button type="button" disabled={busy} onClick={() => open ? setOpen(false) : void openReview()}>{open ? "收起" : "核对安排"}</button>
    </header>
    {error ? <p role="alert">{error}{!pending ? <button type="button" disabled={busy} onClick={() => void openReview()}>刷新</button> : null}</p> : null}
    {open ? <>
      {items.length === 0 ? error ? null : <p>没有待核对安排</p> : <div className="edupi-schedule-review__list">{items.map((item) => <button type="button" key={item.conflictId} className={selectedId === item.conflictId ? "is-selected" : ""} disabled={busy || Boolean(pending)} onClick={() => { setSelectedId(item.conflictId); setDecision(""); setError(null); }} aria-expanded={selectedId === item.conflictId}>
        <span>{item.kind === "calendar" ? "校历" : "课表"}</span><strong>{scheduleLabel(item, item.canonical)}</strong><small>来源有变更，需判断</small>
      </button>)}</div>}
      {selected && !pending ? <div className="edupi-schedule-review__detail">
        <ScheduleDetails conflict={selected} item={selected.canonical} title="原安排" />
        <ScheduleDetails conflict={selected} item={selected.candidate} title="新来源" />
        <div className="edupi-schedule-review__actions"><select aria-label="处理方式" value={decision} disabled={busy} onChange={(event) => setDecision(event.target.value as ScheduleConflictDecision | "")}><option value="">选择处理方式</option>{DECISIONS.filter((option) => option.value !== "keep_both_distinct" || selected.canonicalId !== selected.candidate.source_item_id).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button type="button" className="is-primary" disabled={!decision || busy} onClick={() => { if (decision) void decide(captureScheduleDecision(selected, decision)); }}>确认处理</button></div>
      </div> : null}
      {pending ? <div className="edupi-schedule-review__actions"><span>处理结果待核对</span><button type="button" disabled={busy} onClick={() => void decide(pending)}>重试原决定</button></div> : null}
      {cursor ? <button type="button" disabled={busy} onClick={() => { setBusy(true); void load(cursor).catch(() => setError("更多安排暂不可用，请重试。")).finally(() => setBusy(false)); }}>更多</button> : null}
    </> : null}
  </section>;
}
