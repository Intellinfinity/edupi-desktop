"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Session = { id: string; name?: string; modified: string; firstMessage: string; messageCount: number };
type Message = { role: "user" | "assistant"; text: string; timestamp?: string };

export default function MobilePage() {
  const [paired, setPaired] = useState(false);
  const [code, setCode] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [pairingStatus, setPairingStatus] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState("老师的手机");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reminders, setReminders] = useState<unknown[]>([]);

  const loadSessions = useCallback(async () => {
    if (!paired) return false;
    const response = await fetch("/api/mobile/sessions", { cache: "no-store" });
    if (response.status === 401) { setPaired(false); return false; }
    if (!response.ok) throw new Error("对话列表暂不可用");
    const result = await response.json() as { sessions?: Session[] };
    setSessions(Array.isArray(result.sessions) ? result.sessions : []);
    return true;
  }, [paired]);

  const loadSession = useCallback(async (id: string) => {
    if (!paired) return;
    const response = await fetch(`/api/mobile/sessions/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("对话暂不可用");
    const result = await response.json() as { messages?: Message[] };
    setSelectedId(id);
    setMessages(Array.isArray(result.messages) ? result.messages : []);
  }, [paired]);

  useEffect(() => {
    void fetch("/api/mobile/sessions", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      setPaired(true);
      const result = await response.json() as { sessions?: Session[] };
      setSessions(Array.isArray(result.sessions) ? result.sessions : []);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!requestId || !code) return;
    let disposed = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/mobile/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, code }), cache: "no-store" });
        const result = await response.json() as { status?: string; scopes?: string[]; error?: string };
        if (disposed) return;
        if (result.status === "active") {
          setPaired(true);
          setRequestId(null);
          setPairingStatus("已连接");
          await loadSessions();
          return;
        }
        if (!response.ok) { setError(result.error || "配对失败"); setRequestId(null); return; }
        setPairingStatus(result.status || "等待教师批准");
      } catch { if (!disposed) setError("正在等待桌面响应"); }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [code, loadSessions, requestId]);

  useEffect(() => {
    if (!paired || !selectedId) return;
    const timer = window.setInterval(() => void loadSession(selectedId).catch(() => undefined), 2500);
    return () => window.clearInterval(timer);
  }, [loadSession, selectedId, paired]);

  const pair = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/mobile/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, deviceLabel }) });
      const result = await response.json() as { requestId?: string; status?: string; error?: string };
      if (!response.ok || !result.requestId) throw new Error(result.error || "配对失败");
      setRequestId(result.requestId); setPairingStatus(result.status || "等待批准");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const send = async () => {
    if (!paired || !selectedId || !draft.trim() || busy) return;
    const message = draft.trim();
    setDraft(""); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/mobile/sessions/${encodeURIComponent(selectedId)}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "发送失败");
      await loadSession(selectedId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const loadSummary = async () => {
    if (!paired) return;
    try { const response = await fetch("/api/mobile/summary", { cache: "no-store" }); const result = await response.json() as { reminders?: unknown[] }; setReminders(Array.isArray(result.reminders) ? result.reminders : []); } catch { setReminders([]); }
  };

  const selected = useMemo(() => sessions.find((item) => item.id === selectedId) ?? null, [selectedId, sessions]);

  return (
    <main style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--text)", padding: "env(safe-area-inset-top) 14px env(safe-area-inset-bottom)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 2px 14px", borderBottom: "1px solid var(--border)" }}>
          <div><strong style={{ fontSize: 18 }}>EduPi</strong><div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 3 }}>手机继续对话</div></div>
          {paired ? <button type="button" className="native-button" onClick={() => { void fetch("/api/mobile/logout", { method: "POST" }); setPaired(false); setSelectedId(null); }}>退出手机</button> : null}
        </header>

        {!paired ? (
          <section style={{ margin: "auto 0", padding: "28px 4px" }}>
            <h1 style={{ margin: 0, fontSize: 24 }}>连接桌面</h1>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>在桌面设置中生成配对码，批准后即可继续已有对话。</p>
            <label style={{ display: "block", marginTop: 20, fontSize: 12, color: "var(--text-muted)" }}>配对码<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} inputMode="text" autoComplete="one-time-code" placeholder="输入 8 位配对码" style={{ display: "block", width: "100%", marginTop: 7, padding: "12px 13px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg-panel)", color: "var(--text)", fontSize: 20, letterSpacing: 3 }} /></label>
            <label style={{ display: "block", marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>设备名称<input value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} style={{ display: "block", width: "100%", marginTop: 7, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg-panel)", color: "var(--text)" }} /></label>
            <button type="button" className="native-button native-button-primary" disabled={busy || !code.trim()} onClick={() => void pair()} style={{ width: "100%", marginTop: 16, height: 42 }}>{pairingStatus || "请求连接"}</button>
            {error ? <div role="alert" style={{ marginTop: 12, color: "var(--danger, #b42318)", fontSize: 12 }}>{error}</div> : null}
          </section>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 0.42fr) minmax(0, 1fr)", flex: 1, minHeight: 0, gap: 12, paddingTop: 12 }}>
            <aside style={{ minWidth: 0, overflowY: "auto", borderRight: "1px solid var(--border)", paddingRight: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}><strong style={{ fontSize: 13 }}>对话</strong><button type="button" className="native-button" onClick={() => void loadSummary()}>提醒</button></div>
              {sessions.map((session) => <button key={session.id} type="button" onClick={() => void loadSession(session.id)} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 8px", border: 0, borderRadius: 8, background: session.id === selectedId ? "var(--bg-selected)" : "transparent", color: "var(--text)", cursor: "pointer" }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>{session.name || session.firstMessage || "未命名对话"}</strong><span style={{ display: "block", marginTop: 3, color: "var(--text-muted)", fontSize: 10 }}>{session.messageCount} 条消息</span></button>)}
              {sessions.length === 0 ? <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 8 }}>暂无已保存对话</div> : null}
              {reminders.length > 0 ? <div style={{ marginTop: 14, padding: 8, borderTop: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 11 }}>有 {reminders.length} 条提醒</div> : null}
            </aside>
            <section style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
              <div style={{ padding: "4px 2px 10px", borderBottom: "1px solid var(--border)" }}><strong style={{ fontSize: 14 }}>{selected?.name || selected?.firstMessage || "选择一段对话"}</strong></div>
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 2px", display: "flex", flexDirection: "column", gap: 10 }}>
                {messages.map((message, index) => <div key={`${message.timestamp || "message"}-${index}`} style={{ alignSelf: message.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", padding: "9px 11px", borderRadius: 11, background: message.role === "user" ? "var(--user-bg)" : "var(--bg-panel)", whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.55 }}>{message.text}</div>)}
                {!messages.length ? <div style={{ margin: "auto", color: "var(--text-muted)", fontSize: 12 }}>从已有对话继续</div> : null}
              </div>
              {error ? <div role="alert" style={{ color: "var(--danger, #b42318)", fontSize: 12, paddingBottom: 6 }}>{error}</div> : null}
              <div style={{ display: "flex", gap: 8, padding: "8px 0 12px", borderTop: "1px solid var(--border)" }}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="继续这段对话" rows={2} style={{ flex: 1, resize: "none", padding: "9px 10px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg-panel)", color: "var(--text)", font: "inherit", fontSize: 13 }} /><button type="button" className="native-button native-button-primary" disabled={busy || !selectedId || !draft.trim()} onClick={() => void send()}>发送</button></div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
