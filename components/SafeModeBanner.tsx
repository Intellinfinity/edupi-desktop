"use client";

import { useEffect, useState } from "react";
import { isTauriDesktop } from "@/lib/desktop-updater";
import {
  getDesktopRuntimeStatusNative,
  restartNormalModeNative,
} from "@/lib/desktop-native";

type Diagnostic = {
  at: string;
  stage: string;
  component: string;
  errorCode: string;
  logPath?: string;
};

export function SafeModeBanner() {
  const [safeMode, setSafeMode] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [busy, setBusy] = useState(false);
  const desktop = isTauriDesktop();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const status = desktop
          ? await getDesktopRuntimeStatusNative()
          : await fetch("/api/desktop/runtime", { cache: "no-store" }).then((response) => response.json());
        if (!cancelled) setSafeMode(Boolean(status.safeMode));
      } catch {
        if (!cancelled) setSafeMode(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [desktop]);

  if (!safeMode) return null;

  const loadDiagnostics = async () => {
    setShowDiagnostics((value) => !value);
    if (showDiagnostics) return;
    try {
      const result = await fetch("/api/desktop/runtime", { cache: "no-store" }).then((response) => response.json()) as { diagnostics?: Diagnostic[] };
      setDiagnostics(Array.isArray(result.diagnostics) ? result.diagnostics : []);
    } catch {
      setDiagnostics([]);
    }
  };

  const restart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (desktop) await restartNormalModeNative();
      else window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flexShrink: 0, padding: "8px 14px", borderBottom: "1px solid color-mix(in srgb, var(--accent) 35%, var(--border))", background: "color-mix(in srgb, var(--accent) 10%, var(--bg-panel))", color: "var(--text)", fontSize: 12, zIndex: 300 }}>
      <strong>安全模式</strong>
      <span style={{ color: "var(--text-muted)" }}>第三方扩展已暂停</span>
      <button type="button" className="native-button" onClick={() => void restart()} disabled={busy}>恢复正常启动</button>
      <button type="button" className="native-button" onClick={() => void loadDiagnostics()}>{showDiagnostics ? "收起诊断" : "查看诊断"}</button>
      {showDiagnostics ? (
        <div style={{ flexBasis: "100%", maxHeight: 120, overflow: "auto", color: "var(--text-muted)", fontSize: 11 }}>
          {diagnostics.length === 0 ? "暂无启动失败记录" : diagnostics.map((item) => <div key={`${item.at}-${item.errorCode}`}>{item.at} · {item.stage} · {item.component} · {item.errorCode}</div>)}
        </div>
      ) : null}
    </div>
  );
}
