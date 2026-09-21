"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getDesktopRuntimeStatusNative,
  relaunchAppNative,
  setMobileBridgeEnabledNative,
  type DesktopRuntimeStatus,
} from "@/lib/desktop-native";

type Pairing = { id: string; status: "waiting" | "requested" | "approved" | "active"; deviceLabel: string; expiresAt: string };

export function MobileBridgeSettingsCard() {
  const [status, setStatus] = useState<DesktopRuntimeStatus | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [requests, setRequests] = useState<Pairing[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try { setStatus(await getDesktopRuntimeStatusNative()); } catch { setStatus(null); }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  useEffect(() => {
    if (!status?.mobileBridgeEnabled) return;
    let disposed = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/mobile/pairing", { cache: "no-store" });
        if (response.ok && !disposed) setRequests((await response.json() as { pairings?: Pairing[] }).pairings ?? []);
      } catch { /* bridge may be restarting */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [status?.mobileBridgeEnabled]);

  const toggle = async () => {
    if (busy || !status) return;
    setBusy(true);
    setError(null);
    try {
      await setMobileBridgeEnabledNative(!status.mobileBridgeEnabled);
      await relaunchAppNative();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const createPairing = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/mobile/pairing", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const result = await response.json() as { code?: string; expiresAt?: string; error?: string };
      if (!response.ok || !result.code) throw new Error(result.error || "配对码生成失败");
      setPairingCode(result.code);
      setPairingExpiresAt(result.expiresAt ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const approve = async (id: string) => {
    try {
      await fetch(`/api/mobile/pairing/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve" }) });
      setRequests((items) => items.map((item) => item.id === id ? { ...item, status: "approved" } : item));
    } catch { setError("手机批准失败"); }
  };

  const revoke = async (id: string) => {
    try {
      await fetch(`/api/mobile/pairing/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revoke" }) });
      setRequests((items) => items.filter((item) => item.id !== id));
    } catch { setError("手机撤销失败"); }
  };

  if (!status) return null;
  return (
    <div className="native-settings-card" style={{ padding: "13px 14px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)" }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>手机继续对话</div>
      <div style={{ marginTop: 3, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5 }}>局域网配对后，只能查看 EduPi 对话并继续发送文字。</div>
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: status.mobileBridgeEnabled ? "var(--accent)" : "var(--text-muted)", fontSize: 12 }}>{status.mobileBridgeEnabled ? "已启用 · 局域网配对" : "未启用"}</span>
        <button type="button" className="native-button" disabled={busy} onClick={() => void toggle()}>{status.mobileBridgeEnabled ? "关闭手机入口" : "启用手机入口"}</button>
      </div>
      {status.mobileBridgeEnabled ? (
        <>
          {status.mobileUrl ? <div style={{ marginTop: 9, fontSize: 12, wordBreak: "break-all" }}><span style={{ color: "var(--text-muted)" }}>手机打开：</span>{status.mobileUrl}</div> : null}
          <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <button type="button" className="native-button native-button-primary" disabled={busy} onClick={() => void createPairing()}>生成配对码</button>
            {pairingCode ? <code style={{ padding: "5px 8px", borderRadius: 5, background: "var(--bg-hover)", letterSpacing: 2, fontWeight: 700 }}>{pairingCode}</code> : null}
            {pairingExpiresAt ? <span style={{ color: "var(--text-muted)", fontSize: 11 }}>10 分钟内有效</span> : null}
          </div>
          {requests.filter((item) => item.status === "requested").map((item) => (
            <div key={item.id} style={{ marginTop: 9, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
              <span>{item.deviceLabel} 请求连接</span>
              <button type="button" className="native-button native-button-primary" onClick={() => void approve(item.id)}>批准</button>
            </div>
          ))}
          {requests.filter((item) => item.status === "active" || item.status === "approved").map((item) => (
            <div key={item.id} style={{ marginTop: 9, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
              <span>{item.deviceLabel} · 已连接</span>
              <button type="button" className="native-button" onClick={() => void revoke(item.id)}>撤销</button>
            </div>
          ))}
        </>
      ) : null}
      {error ? <div className="native-inline-alert is-error" role="alert" style={{ marginTop: 9 }}>{error}</div> : null}
    </div>
  );
}
