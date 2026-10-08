export function EduPiAmbientPendingBanner({ count, busy = false, onVerify }:
  { count: number; busy?: boolean; onVerify: () => void }) {
  if (count < 1) return null;
  return <div role="status" style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 12, maxWidth: 820, margin: "0 auto 8px", padding: "8px 12px", border: "1px solid var(--border)",
    borderRadius: 8, background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: 12 }}>
    <span>{count} 条请求结果待核对，请勿重复发送</span>
    <button type="button" onClick={onVerify} disabled={busy}
      style={{ flexShrink: 0, color: "var(--text)", fontSize: 12, opacity: busy ? 0.5 : 1 }}>核对</button>
  </div>;
}
