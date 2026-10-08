export function EduPiAmbientPendingBanner({ count, unconfirmedCount = 0, partialCount = 0,
  unprocessedCount = 0, busy = false, onVerify, onReview }:
  { count: number; unconfirmedCount?: number; partialCount?: number; unprocessedCount?: number; busy?: boolean;
    onVerify: () => void; onReview?: () => void }) {
  if (count < 1) return null;
  return <div role="status" style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 12, maxWidth: 820, margin: "0 auto 8px", padding: "8px 12px", border: "1px solid var(--border)",
    borderRadius: 8, background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: 12 }}>
    <span>{unconfirmedCount > 0 ? `${count} 条请求未证实已捕获，请勿重复发送`
      : partialCount === count ? `${partialCount} 条消息部分处理，仍有领域未完成`
        : partialCount > 0 ? `${partialCount} 条消息部分处理，${count - partialCount} 条待核对`
          : unprocessedCount === count ? `${unprocessedCount} 条请求未处理，待核对`
          : `${count} 条请求结果待核对，请勿重复发送`}</span>
    {partialCount > 0 && unconfirmedCount === 0 && <button type="button" onClick={onReview ?? onVerify}
      style={{ flexShrink: 0, color: "var(--text)", fontSize: 12 }}>查看</button>}
    {(partialCount < count || unconfirmedCount > 0) && <button type="button" onClick={onVerify} disabled={busy}
      style={{ flexShrink: 0, color: "var(--text)", fontSize: 12, opacity: busy ? 0.5 : 1 }}>核对</button>}
  </div>;
}
