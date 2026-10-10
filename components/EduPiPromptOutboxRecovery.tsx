"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchDesktopApi } from "@/lib/desktop-native";
import { isTauriDesktop } from "@/lib/desktop-updater";

type Entry = { sessionId: string; clientRequestId: string; occurredAt: string;
  stage: "prepared" | "registered" | "captured" | "pi_dispatching" | "pi_unknown" | "pi_accepted"
    | "cancelled" | "pi_unverified_withdrawn" | "pi_accepted_withdrawn" | "intent_saved" };
const RECOVERABLE = new Set(["prepared", "registered", "captured"]);

export function EduPiPromptOutboxRecoveryView({ pending, total, busy, message, detail, onShow, onAction, onCancel, onMore, onRefresh }: {
  pending: Entry[]; total: number; busy: string | null; message: string;
  detail?: { key: string; text: string } | null; onShow?: (item: Entry) => void;
  onAction: (item: Entry) => void; onCancel: (item: Entry) => void; onMore: () => void; onRefresh: () => void;
}) {
  if (total === 0 && !message) return null;
  return <details className="edupi-admin-runtime edupi-prompt-outbox">
    <summary>待核对消息 {total}</summary>
    <button className="edupi-prompt-outbox__refresh" type="button" onClick={onRefresh}>刷新</button>
    {message ? <p role="status">{message}</p> : null}
    <ul>{pending.map(item => <li key={`${item.sessionId}:${item.clientRequestId}`}>
      <span>{new Date(item.occurredAt).toLocaleString("zh-CN")}</span>
      <span>{item.stage === "intent_saved" ? "发送前已保存" : RECOVERABLE.has(item.stage) ? "未发送" : item.stage === "pi_unverified_withdrawn"
        ? "主动处理已撤回，Pi 结果未核实" : "发送结果待核对"}</span>
      <div className="edupi-prompt-outbox__actions"><button type="button" disabled={busy !== null}
        onClick={() => onAction(item)}>{busy === item.clientRequestId ? "处理中…"
          : item.stage === "intent_saved" ? "确认会话已收到"
            : RECOVERABLE.has(item.stage) ? "继续发送" : "核对会话"}</button>
        {item.stage !== "pi_unverified_withdrawn" ? <button type="button" disabled={busy !== null}
          onClick={() => onCancel(item)}>{item.stage === "intent_saved" ? "确认放弃"
            : RECOVERABLE.has(item.stage) ? "取消" : "撤回主动处理"}</button> : null}
        {onShow ? <button type="button" disabled={busy !== null} onClick={() => onShow(item)}>查看原文</button> : null}</div>
      {detail?.key === `${item.sessionId}:${item.clientRequestId}` ? <div className="edupi-prompt-outbox__detail">
        <pre>{detail.text}</pre><button type="button" onClick={() => { void import("@/lib/clipboard")
          .then(({ copyText }) => copyText(detail.text)).catch(() => {}); }}>复制原文</button>
      </div> : null}
    </li>)}</ul>
    {pending.length < total ? <button className="edupi-prompt-outbox__more" type="button" onClick={onMore}>查看更多</button> : null}
  </details>;
}

export function EduPiPromptOutboxRecovery() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [visibleCount, setVisibleCount] = useState(20);
  const [detail, setDetail] = useState<{ key: string; text: string } | null>(null);
  const refresh = useCallback(async () => {
    if (!isTauriDesktop()) return;
    const read = async (path: string) => {
      try {
        const response = await fetchDesktopApi(path, { cache: "no-store" });
        const data = await response.json().catch(() => null) as { status?: unknown; entries?: unknown } | null;
        return response.ok && data?.status === "ready" && Array.isArray(data.entries) ? data.entries : null;
      } catch { return null; }
    };
    const [rawOutbox, rawIntents] = await Promise.all([
      read("/api/edupi/proactivity/prompt"), read("/api/edupi/proactivity/prompt/intent"),
    ]);
    if (!rawOutbox && !rawIntents) {
      setMessage("消息状态暂不可用");
      throw new Error("消息状态暂不可用");
    }
    const outbox = (rawOutbox ?? []).filter((item): item is Entry => item !== null && typeof item === "object"
      && typeof item.sessionId === "string" && typeof item.clientRequestId === "string"
      && typeof item.occurredAt === "string" && typeof item.stage === "string");
    const intents = (rawIntents ?? []).filter((item): item is { sessionId: string; clientRequestId: string; occurredAt: string } =>
      item !== null && typeof item === "object" && typeof item.sessionId === "string"
      && typeof item.clientRequestId === "string" && typeof item.occurredAt === "string")
      .map(item => ({ ...item, stage: "intent_saved" as const }));
    setEntries(previous => {
      const currentOutbox = rawOutbox ? outbox : previous.filter(item => item.stage !== "intent_saved");
      const currentIntents = rawIntents ? intents : previous.filter(item => item.stage === "intent_saved");
      const unresolved = new Set(currentOutbox.filter(item => !["pi_accepted", "pi_accepted_withdrawn", "cancelled"].includes(item.stage))
        .map(item => `${item.sessionId}:${item.clientRequestId}`));
      return [...currentOutbox, ...currentIntents.filter(item => !unresolved.has(`${item.sessionId}:${item.clientRequestId}`))]
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    });
    if (!rawOutbox || !rawIntents) setMessage("部分消息状态暂不可用，已保留可读取的记录");
  }, []);
  useEffect(() => {
    void refresh().catch(() => {});
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);
  const allPending = entries.filter(item => !["pi_accepted", "pi_accepted_withdrawn", "cancelled"].includes(item.stage)).reverse();
  const pending = allPending.slice(0, visibleCount);
  if (!isTauriDesktop()) return null;
  const retry = async (item: Entry) => {
    if (item.stage === "intent_saved" && !window.confirm("请先在会话中核对这条原文确实已送达 Pi。确认后将结束待恢复记录。")) return;
    setBusy(item.clientRequestId); setMessage("");
    try {
      const response = await fetchDesktopApi(item.stage === "intent_saved"
        ? "/api/edupi/proactivity/prompt/intent" : "/api/edupi/proactivity/prompt", {
        method: item.stage === "intent_saved" ? "PATCH" : RECOVERABLE.has(item.stage) ? "PUT" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: item.sessionId, clientRequestId: item.clientRequestId,
          ...(item.stage === "intent_saved" ? { confirmedPiPersistence: true } : {}) }) });
      const result = await response.json().catch(() => null) as { status?: unknown } | null;
      setMessage(result?.status === "resolved" ? "已确认收到" : result?.status === "accepted" ? RECOVERABLE.has(item.stage) ? "Pi 已接收" : "会话已确认"
        : result?.status === "uncertain" ? "结果仍待核对" : "未能继续，请核对会话与授权");
      await refresh();
    } catch { setMessage("状态暂不可用，未自动重发"); }
    finally { setBusy(null); }
  };
  const cancel = async (item: Entry) => {
    if (item.stage === "intent_saved" && !window.confirm("请先查看原文和会话。放弃这条恢复记录后，原消息可能已经送达；再次发送可能重复。")) return;
    setBusy(item.clientRequestId); setMessage("");
    try {
      const response = await fetchDesktopApi(item.stage === "intent_saved"
        ? "/api/edupi/proactivity/prompt/intent" : "/api/edupi/proactivity/prompt", { method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: item.sessionId, clientRequestId: item.clientRequestId,
          ...(item.stage === "intent_saved" ? { confirmedManualDiscard: true } : {}) }) });
      const result = await response.json().catch(() => null) as { status?: unknown } | null;
      setMessage(result?.status === "cancelled" ? "已取消" : result?.status === "source_withdrawn"
        ? "主动处理已撤回，Pi 结果仍待核对" : result?.status === "discarded"
          ? "恢复记录已放弃" : "未能安全取消，记录已保留");
      await refresh();
    } catch { setMessage("未能安全取消，记录已保留"); }
    finally { setBusy(null); }
  };
  const show = async (item: Entry) => {
    setBusy(item.clientRequestId); setMessage("");
    try {
      const response = await fetchDesktopApi(item.stage === "intent_saved"
        ? "/api/edupi/proactivity/prompt/intent" : "/api/edupi/proactivity/prompt/detail", {
        method: item.stage === "intent_saved" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: item.sessionId, clientRequestId: item.clientRequestId }) });
      const result = await response.json().catch(() => null) as { message?: unknown } | null;
      if (!response.ok || typeof result?.message !== "string") throw new Error("readback_failed");
      setDetail({ key: `${item.sessionId}:${item.clientRequestId}`, text: result.message });
    } catch { setMessage("原文暂不可读，记录已保留"); }
    finally { setBusy(null); }
  };
  return <EduPiPromptOutboxRecoveryView pending={pending} total={allPending.length} busy={busy} message={message}
    detail={detail} onShow={item => { void show(item); }}
    onAction={item => { void retry(item); }} onCancel={item => { void cancel(item); }}
    onMore={() => setVisibleCount(count => count + 20)} onRefresh={() => { void refresh().catch(() => setMessage("消息状态暂不可用")); }} />;
}
