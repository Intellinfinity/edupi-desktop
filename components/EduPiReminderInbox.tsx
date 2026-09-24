"use client";

import { useEffect, useState } from "react";
import type { Reminder } from "@/lib/edupi-reminder-store";
import type { DesktopControlInput } from "@/lib/edupi-desktop-control";
import { useSearchParams } from "next/navigation";

type ReminderFilter = "pending" | "snoozed" | "handled";

const FILTERS: Array<{ value: ReminderFilter; label: string }> = [
  { value: "pending", label: "待处理" },
  { value: "snoozed", label: "稍后提醒" },
  { value: "handled", label: "已移除" },
];

const KIND_LABELS: Record<Reminder["kind"], string> = {
  ready: "已准备",
  failed: "准备失败",
  due: "已到期",
  brief: "简报已更新",
};

function formatReminderDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function reminderSource(item: Reminder) {
  return item.kind === "brief" ? "每日简报" : "教学事项";
}

function reminderMessage(item: Reminder, filter: ReminderFilter) {
  if (item.withdrawn) return "关联事项已撤下";
  if (filter === "handled" || item.handled) return "已从提醒列表移除";
  if (filter === "snoozed" || item.snoozedUntil) return "将在稍后再次提醒";
  if (item.kind === "ready") return "产物已准备好，可以直接查看或继续聊。";
  if (item.kind === "failed") return "准备过程未完成，打开事项查看详情。";
  if (item.kind === "due") return "事项已到期，需要决定下一步。";
  return "今天的简报已更新。";
}

function isPending(item: Reminder) {
  return !item.withdrawn && !item.handled && !item.snoozedUntil;
}

function isSnoozed(item: Reminder) {
  return !item.withdrawn && !item.handled && Boolean(item.snoozedUntil);
}

function filterItems(items: Reminder[], filter: ReminderFilter) {
  const matches = items.filter((item) => filter === "pending" ? isPending(item) : filter === "snoozed" ? isSnoozed(item) : item.handled || item.withdrawn);
  return [...matches].reverse();
}

export function EduPiReminderInbox({
  onAction,
  onContinue,
  standalone = false,
  onClose,
}: {
  onAction: (action: DesktopControlInput) => boolean | Promise<boolean>;
  onContinue?: (taskId: string) => Promise<void>;
  standalone?: boolean;
  onClose?: () => void;
}) {
  const params = useSearchParams();
  const remindersRequested = params.get("reminders") === "1";
  const [open, setOpen] = useState(standalone || remindersRequested);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Reminder[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<ReminderFilter>("pending");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (remindersRequested) {
      setLoading(true);
      setOpen(true);
    }
  }, [remindersRequested]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/edupi/reminders", { signal: controller.signal });
        if (!response.ok) throw new Error();
        const result = await response.json() as { items?: Reminder[] };
        if (!controller.signal.aborted) {
          setItems(Array.isArray(result.items) ? result.items : []);
          setError("");
          setLoading(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setError("提醒暂不可用");
          setLoading(false);
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [open]);

  const pending = items.filter(isPending);
  const counts: Record<ReminderFilter, number> = {
    pending: pending.length,
    snoozed: items.filter(isSnoozed).length,
    handled: items.filter((item) => item.handled || item.withdrawn).length,
  };
  const filtered = filterItems(items, filter);
  const loadingEmpty = loading && items.length === 0;
  const pageCount = Math.max(1, Math.ceil(filtered.length / 8));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(currentPage * 8, currentPage * 8 + 8);
  const selected = pageItems.find((item) => item.id === selectedId) || pageItems[0] || null;

  const change = async (id: string, type: "read" | "dismiss" | "snooze") => {
    const blocksActions = type !== "read";
    if (blocksActions) setBusy(true);
    try {
      const response = await fetch("/api/edupi/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, type }),
      });
      if (!response.ok) throw new Error();
      const result = await response.json() as { items?: Reminder[] };
      setItems(Array.isArray(result.items) ? result.items : []);
      setError("");
    } catch {
      setError("提醒保存失败");
    } finally {
      if (blocksActions) setBusy(false);
    }
  };

  const selectItem = (item: Reminder) => {
    setSelectedId(item.id);
    if (!item.read) void change(item.id, "read");
  };

  const openRelated = async (item: Reminder) => {
    setBusy(true);
    try {
      const opened = await onAction(item.kind === "brief"
        ? { action: "open_document", documentId: item.taskId.slice("document:".length) }
        : { action: "open_task", taskId: item.taskId, stage: "artifact" });
      if (!opened) throw new Error("事项暂不可用");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "事项暂不可用");
    } finally {
      setBusy(false);
    }
  };

  const continueItem = async (item: Reminder) => {
    setBusy(true);
    try {
      if (onContinue) await onContinue(item.taskId);
      else if (!await onAction({ action: "open_task", taskId: item.taskId, stage: "run" })) throw new Error("事项暂不可用");
      setOpen(false);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "协作打开失败");
    } finally {
      setBusy(false);
    }
  };

  const filterLabel = FILTERS.find((option) => option.value === filter)?.label || "提醒";
  const emptyLabel = filter === "handled" ? "暂无已移除提醒" : filter === "snoozed" ? "暂无稍后提醒" : "暂无待处理提醒";

  return (
    <section
      className={`edupi-reminder-inbox${standalone ? " is-standalone" : " is-compact"}`}
      aria-label="提醒"
      aria-busy={loadingEmpty}
    >
      {standalone ? (
        <header className="edupi-reminder-inbox__header">
          <div>
            <h1>提醒</h1>
            {!loadingEmpty ? <span>{pending.length ? `${pending.length} 条待处理` : "没有待处理提醒"}</span> : null}
          </div>
          <button type="button" className="edupi-reminder-inbox__back" onClick={onClose}>返回对话</button>
        </header>
      ) : (
        <button type="button" className="native-button" aria-expanded={open} onClick={() => { if (!open) setLoading(true); setOpen(!open); }}>
          提醒{pending.length ? ` ${pending.length}` : ""}
        </button>
      )}

      {open ? (
        <div className="edupi-reminder-inbox__body">
          <div className="edupi-reminder-inbox__toolbar">
            <div className="edupi-reminder-inbox__tabs" role="group" aria-label="提醒状态">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  className={filter === option.value ? "is-active" : ""}
                  onClick={() => { setFilter(option.value); setPage(0); setSelectedId(null); }}
                >
                  <span>{option.label}</span>
                  {!loadingEmpty ? <b>{counts[option.value]}</b> : null}
                </button>
              ))}
            </div>
            {!loadingEmpty ? <span className="edupi-reminder-inbox__toolbar-count">{filtered.length} 条</span> : null}
          </div>

          {error ? <p className="edupi-reminder-inbox__message is-error" role="alert">{error}</p> : null}

          <div className="edupi-reminder-inbox__workbench">
            <nav className="edupi-reminder-inbox__queue" aria-label={`${filterLabel}提醒`}>
              <div className="edupi-reminder-inbox__queue-heading">
                <span>{filterLabel}</span>
              </div>
              {pageItems.length ? (
                <ul className="edupi-reminder-inbox__list">
                  {pageItems.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`edupi-reminder-inbox__row${selected?.id === item.id ? " is-selected" : ""}${item.read ? "" : " is-unread"}`}
                        aria-current={selected?.id === item.id ? "true" : undefined}
                        onClick={() => selectItem(item)}
                      >
                        <i aria-hidden="true" />
                        <span className="edupi-reminder-inbox__row-copy">
                          <small>{KIND_LABELS[item.kind]}</small>
                          <strong>{item.title}</strong>
                          <span>{item.snoozedUntil ? `再提醒 ${formatReminderDate(item.snoozedUntil)}` : formatReminderDate(item.createdAt)}</span>
                        </span>
                        <em aria-hidden="true">›</em>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="edupi-reminder-inbox__empty" role="status">{loadingEmpty ? "正在读取提醒" : emptyLabel}</div>
              )}
              {pageCount > 1 ? (
                <div className="edupi-reminder-inbox__pagination" aria-label="提醒分页">
                  <button type="button" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setSelectedId(null); }}>上一页</button>
                  <span>{currentPage + 1} / {pageCount}</span>
                  <button type="button" disabled={currentPage === pageCount - 1} onClick={() => { setPage(currentPage + 1); setSelectedId(null); }}>下一页</button>
                </div>
              ) : null}
            </nav>

            <article className="edupi-reminder-inbox__detail" aria-live="polite" aria-label="提醒详情">
              {selected ? (
                <>
                  <header className="edupi-reminder-inbox__detail-header">
                    <div>
                      <span className={`edupi-reminder-inbox__kind is-${selected.kind}`}>{KIND_LABELS[selected.kind]}</span>
                      <h2>{selected.title}</h2>
                    </div>
                    <time dateTime={selected.snoozedUntil || selected.createdAt}>{formatReminderDate(selected.snoozedUntil || selected.createdAt)}</time>
                  </header>
                  <p className="edupi-reminder-inbox__detail-message">{reminderMessage(selected, filter)}</p>
                  <dl className="edupi-reminder-inbox__meta">
                    <div><dt>状态</dt><dd>{filterLabel}</dd></div>
                    <div><dt>来源</dt><dd>{reminderSource(selected)}</dd></div>
                  </dl>
                  <div className="edupi-reminder-inbox__actions">
                    <button type="button" className="is-primary" disabled={busy} onClick={() => void continueItem(selected)}>继续聊</button>
                    <button type="button" disabled={busy} onClick={() => void openRelated(selected)}>{selected.kind === "brief" ? "查看简报" : "查看事项"}</button>
                    {filter === "pending" ? <button type="button" disabled={busy} onClick={() => void change(selected.id, "snooze")}>稍后提醒</button> : null}
                    {filter !== "handled" ? <button type="button" className="is-quiet" disabled={busy} title="只从提醒列表移除，不修改任务" onClick={() => void change(selected.id, "dismiss")}>从提醒中移除</button> : null}
                  </div>
                </>
              ) : (
                <div className="edupi-reminder-inbox__detail-empty">
                  {!loadingEmpty ? <strong>{emptyLabel}</strong> : null}
                </div>
              )}
            </article>
          </div>
        </div>
      ) : null}
    </section>
  );
}
