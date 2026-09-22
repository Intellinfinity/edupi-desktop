"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJsonWithDeadline, fetchWithDeadline } from "@/lib/fetch-timeout";

type Session = { id: string; name?: string; modified: string; firstMessage: string; messageCount: number };
type Message = { role: "user" | "assistant"; text: string; timestamp?: string };
type PendingSend = { sessionId: string; message: string };

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
  const connectionGeneration = useRef(0);
  const operationInFlight = useRef(false);
  const desiredSessionId = useRef<string | null>(null);
  const sessionRequestSequence = useRef(0);
  const pairingAttempt = useRef<{ code: string; key: string } | null>(null);
  const pendingSendRef = useRef<PendingSend | null>(null);
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);

  const disconnect = useCallback(() => {
    connectionGeneration.current += 1;
    sessionRequestSequence.current += 1;
    desiredSessionId.current = null;
    operationInFlight.current = false;
    pairingAttempt.current = null;
    pendingSendRef.current = null;
    setPendingSend(null);
    setBusy(false);
    setError("");
    setPaired(false);
    setCode("");
    setRequestId(null);
    setPairingStatus(null);
    setSessions([]);
    setSelectedId(null);
    setMessages([]);
    setReminders([]);
    setDraft("");
  }, []);

  const loadSessions = useCallback(async (disconnectOnUnauthorized = true) => {
    const generation = connectionGeneration.current;
    const { response, body: result } = await fetchJsonWithDeadline<{ sessions?: Session[] }>("/api/mobile/sessions", 12_000, { cache: "no-store" });
    if (generation !== connectionGeneration.current) return false;
    if (response.status === 401) {
      if (disconnectOnUnauthorized) disconnect();
      return false;
    }
    if (!response.ok) throw new Error("对话列表暂不可用");
    if (generation !== connectionGeneration.current) return false;
    setPaired(true);
    setSessions(Array.isArray(result.sessions) ? result.sessions : []);
    return true;
  }, [disconnect]);

  const loadSession = useCallback(async (id: string) => {
    if (!paired || desiredSessionId.current !== id) return;
    const generation = connectionGeneration.current;
    const sequence = ++sessionRequestSequence.current;
    const { response, body: result } = await fetchJsonWithDeadline<{ messages?: Message[] }>(`/api/mobile/sessions/${encodeURIComponent(id)}`, 12_000, { cache: "no-store" });
    if (generation !== connectionGeneration.current || sequence !== sessionRequestSequence.current || desiredSessionId.current !== id) return;
    if (response.status === 401) { disconnect(); return; }
    if (!response.ok) throw new Error("对话暂不可用");
    if (generation !== connectionGeneration.current || sequence !== sessionRequestSequence.current || desiredSessionId.current !== id) return;
    setMessages(Array.isArray(result.messages) ? result.messages : []);
  }, [paired, disconnect]);

  useEffect(() => {
    void loadSessions(false).catch(() => undefined);
  }, [loadSessions]);

  useEffect(() => {
    if (!paired) return;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try { await loadSessions(); } catch { /* Retry the next scheduled read. */ }
      finally { inFlight = false; }
    };
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [paired, loadSessions]);

  useEffect(() => {
    if (!requestId || !code) return;
    let disposed = false;
    let inFlight = false;
    const poll = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      const generation = connectionGeneration.current;
      try {
        const { response, body: result } = await fetchJsonWithDeadline<{ status?: string; scopes?: string[]; error?: string }>("/api/mobile/pair", 15_000, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, code, requestKey: pairingAttempt.current?.key }), cache: "no-store" });
        if (disposed || generation !== connectionGeneration.current) return;
        if (!response.ok) { setError(result.error || "配对失败"); setRequestId(null); return; }
        if (result.status === "active") {
          try {
            if (await loadSessions() && !disposed && generation === connectionGeneration.current) {
              setRequestId(null);
              setPairingStatus("已连接");
            }
          } catch { if (!disposed && generation === connectionGeneration.current) setError("对话列表暂不可用"); }
          return;
        }
        setPairingStatus("等待桌面批准");
      } catch { if (!disposed && generation === connectionGeneration.current) setError("正在等待桌面响应"); }
      finally { inFlight = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [code, loadSessions, requestId]);

  useEffect(() => {
    if (!paired || !selectedId) return;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try { await loadSession(selectedId); } catch { /* Retry the next scheduled read. */ }
      finally { inFlight = false; }
    };
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [loadSession, selectedId, paired]);

  const pair = async () => {
    if (operationInFlight.current || requestId) return;
    operationInFlight.current = true;
    const generation = ++connectionGeneration.current;
    const normalizedCode = code.trim().toUpperCase();
    if (pairingAttempt.current?.code !== normalizedCode) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      pairingAttempt.current = { code: normalizedCode, key: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("") };
    }
    setBusy(true); setError("");
    try {
      const { response, body: result } = await fetchJsonWithDeadline<{ requestId?: string; status?: string; error?: string }>("/api/mobile/pair", 12_000, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: normalizedCode, deviceLabel, requestKey: pairingAttempt.current.key }) });
      if (generation !== connectionGeneration.current) return;
      if (!response.ok) { setError(result.error || "配对失败"); return; }
      if (!result.requestId) throw new Error("配对响应不完整");
      setRequestId(result.requestId); setPairingStatus("等待桌面批准");
    } catch { if (generation === connectionGeneration.current) setError("配对结果待确认，请用同一配对码重试"); }
    finally { if (generation === connectionGeneration.current) { operationInFlight.current = false; setBusy(false); } }
  };

  const send = async () => {
    if (!paired || !selectedId || desiredSessionId.current !== selectedId || !draft.trim() || operationInFlight.current || pendingSendRef.current) return;
    operationInFlight.current = true;
    const generation = connectionGeneration.current;
    const sessionId = selectedId;
    const message = draft.trim();
    const pending: PendingSend = { sessionId, message };
    pendingSendRef.current = pending;
    setDraft(""); setBusy(true); setError("");
    try {
      const { response, body: result } = await fetchJsonWithDeadline<{ error?: string }>(`/api/mobile/sessions/${encodeURIComponent(sessionId)}/messages`, 12_000, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
      if (generation !== connectionGeneration.current) return;
      if (response.status === 401) { disconnect(); return; }
      if (!response.ok) {
        if (response.status === 400 || response.status === 404 || response.status === 409 || response.status === 413) {
          if (pendingSendRef.current === pending) { pendingSendRef.current = null; setPendingSend(null); setDraft(current => current || message); }
          setError(result.error || "发送被拒绝");
          return;
        }
        throw new Error(result.error || "发送结果待确认");
      }
      if (pendingSendRef.current === pending) { pendingSendRef.current = null; setPendingSend(null); }
      await loadSession(sessionId);
    } catch {
      if (generation === connectionGeneration.current) {
        if (pendingSendRef.current === pending) {
          setPendingSend(pending);
          setError("发送结果待确认，请先核对对话再继续");
        } else if (desiredSessionId.current === sessionId) setError("对话刷新失败，请稍后重试");
      }
    } finally { if (generation === connectionGeneration.current) { operationInFlight.current = false; setBusy(false); } }
  };

  const logout = async () => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    const generation = connectionGeneration.current;
    setBusy(true);
    setError("");
    try {
      const response = await fetchWithDeadline("/api/mobile/logout", 10_000, { method: "POST" });
      if (generation !== connectionGeneration.current) return;
      if (!response.ok) throw new Error("退出失败");
      disconnect();
    } catch { if (generation === connectionGeneration.current) setError("退出失败，请重试"); }
    finally { if (generation === connectionGeneration.current) { operationInFlight.current = false; setBusy(false); } }
  };

  const selectSession = (id: string) => {
    desiredSessionId.current = id;
    sessionRequestSequence.current += 1;
    setSelectedId(id);
    setMessages([]);
    setError("");
    const generation = connectionGeneration.current;
    void loadSession(id).catch(() => {
      if (generation === connectionGeneration.current && desiredSessionId.current === id) setError("对话暂不可用");
    });
  };

  const loadSummary = async () => {
    if (!paired) return;
    const generation = connectionGeneration.current;
    try {
      const { response, body: result } = await fetchJsonWithDeadline<{ reminders?: unknown[] }>("/api/mobile/summary", 12_000, { cache: "no-store" });
      if (generation !== connectionGeneration.current) return;
      if (response.status === 401) { disconnect(); return; }
      if (generation === connectionGeneration.current) setReminders(Array.isArray(result.reminders) ? result.reminders : []);
    } catch { if (generation === connectionGeneration.current) setReminders([]); }
  };

  const selected = useMemo(() => sessions.find((item) => item.id === selectedId) ?? null, [selectedId, sessions]);

  return (
    <main style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--text)", padding: "env(safe-area-inset-top) 14px env(safe-area-inset-bottom)" }}>
      <style>{`@media (max-width: 560px) { .edupi-mobile-workspace { display: flex !important; flex-direction: column !important; } .edupi-mobile-sidebar { max-height: 180px; border-right: 0 !important; border-bottom: 1px solid var(--border); padding: 0 0 8px !important; } }`}</style>
      <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 2px 14px", borderBottom: "1px solid var(--border)" }}>
          <div><strong style={{ fontSize: 18 }}>EduPi</strong><div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 3 }}>手机继续对话</div></div>
          {paired ? <button type="button" className="native-button" disabled={busy} onClick={() => void logout()}>退出手机</button> : null}
        </header>

        {!paired ? (
          <section style={{ margin: "auto 0", padding: "28px 4px" }}>
            <h1 style={{ margin: 0, fontSize: 24 }}>连接桌面</h1>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>在桌面设置中生成配对码，批准后即可继续已有对话。</p>
            <label style={{ display: "block", marginTop: 20, fontSize: 12, color: "var(--text-muted)" }}>配对码<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} disabled={Boolean(requestId) || busy} inputMode="text" autoComplete="one-time-code" placeholder="输入 8 位配对码" style={{ display: "block", width: "100%", marginTop: 7, padding: "12px 13px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg-panel)", color: "var(--text)", fontSize: 20, letterSpacing: 3 }} /></label>
            <label style={{ display: "block", marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>设备名称<input value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} style={{ display: "block", width: "100%", marginTop: 7, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg-panel)", color: "var(--text)" }} /></label>
            <button type="button" className="native-button native-button-primary" disabled={busy || !code.trim() || Boolean(requestId)} onClick={() => void pair()} style={{ width: "100%", marginTop: 16, height: 42 }}>{pairingStatus || "请求连接"}</button>
            {error ? <div role="alert" style={{ marginTop: 12, color: "var(--danger, #b42318)", fontSize: 12 }}>{error}</div> : null}
          </section>
        ) : (
          <div className="edupi-mobile-workspace" style={{ display: "grid", gridTemplateColumns: "minmax(150px, 0.42fr) minmax(0, 1fr)", flex: 1, minHeight: 0, gap: 12, paddingTop: 12 }}>
            <aside className="edupi-mobile-sidebar" style={{ minWidth: 0, overflowY: "auto", borderRight: "1px solid var(--border)", paddingRight: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}><strong style={{ fontSize: 13 }}>对话</strong><button type="button" className="native-button" onClick={() => void loadSummary()}>提醒</button></div>
              {sessions.map((session) => <button key={session.id} type="button" onClick={() => selectSession(session.id)} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 8px", border: 0, borderRadius: 8, background: session.id === selectedId ? "var(--bg-selected)" : "transparent", color: "var(--text)", cursor: "pointer" }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>{session.name || session.firstMessage || "未命名对话"}</strong><span style={{ display: "block", marginTop: 3, color: "var(--text-muted)", fontSize: 10 }}>{session.messageCount} 条消息</span></button>)}
              {sessions.length === 0 ? <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 8 }}>暂无已保存对话</div> : null}
              {reminders.length > 0 ? <div style={{ marginTop: 14, padding: 8, borderTop: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 11 }}>有 {reminders.length} 条提醒</div> : null}
            </aside>
            <section style={{ display: "flex", flex: 1, flexDirection: "column", minWidth: 0, minHeight: 0 }}>
              <div style={{ padding: "4px 2px 10px", borderBottom: "1px solid var(--border)" }}><strong style={{ fontSize: 14 }}>{selected?.name || selected?.firstMessage || "选择一段对话"}</strong></div>
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 2px", display: "flex", flexDirection: "column", gap: 10 }}>
                {messages.map((message, index) => <div key={`${message.timestamp || "message"}-${index}`} style={{ alignSelf: message.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", padding: "9px 11px", borderRadius: 11, background: message.role === "user" ? "var(--user-bg)" : "var(--bg-panel)", whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.55 }}>{message.text}</div>)}
                {!messages.length ? <div style={{ margin: "auto", color: "var(--text-muted)", fontSize: 12 }}>从已有对话继续</div> : null}
              </div>
              {pendingSend ? <div role="status" style={{ fontSize: 12, padding: "8px 0", borderTop: "1px solid var(--border)" }}><span>发送状态待核对：{pendingSend.message.slice(0, 40)}</span><button type="button" className="native-button" onClick={() => selectSession(pendingSend.sessionId)}>查看对话</button><button type="button" className="native-button" onClick={() => { pendingSendRef.current = null; setPendingSend(null); setError(""); }}>已核对</button></div> : null}
              {error ? <div role="alert" style={{ color: "var(--danger, #b42318)", fontSize: 12, paddingBottom: 6 }}>{error}</div> : null}
              <div style={{ display: "flex", gap: 8, padding: "8px 0 12px", borderTop: "1px solid var(--border)" }}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="继续这段对话" rows={2} style={{ flex: 1, resize: "none", padding: "9px 10px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg-panel)", color: "var(--text)", font: "inherit", fontSize: 13 }} /><button type="button" className="native-button native-button-primary" disabled={busy || Boolean(pendingSend) || !selectedId || !draft.trim()} onClick={() => void send()}>发送</button></div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
