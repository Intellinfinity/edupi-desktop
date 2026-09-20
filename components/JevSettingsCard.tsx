"use client";

import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { ConfirmDangerButton } from "./ConfirmDangerButton";

type JevSettingsStatus = {
  enabled: boolean;
  active: boolean;
  endpoint: string;
  model: string;
  timeoutMs: number;
  minConfidence: number;
  maxConsecutiveFailures: number;
  keyConfigured: boolean;
  environmentManaged: boolean;
};

const cardStyle: CSSProperties = {
  padding: "13px 14px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "7px 9px",
  border: "1px solid var(--border)",
  borderRadius: 5,
  background: "var(--bg-panel)",
  color: "var(--text)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
};

function fieldsFromStatus(status: JevSettingsStatus) {
  return {
    enabled: status.enabled,
    endpoint: status.endpoint,
    model: status.model,
    timeoutMs: String(status.timeoutMs),
    minConfidence: String(status.minConfidence),
    maxConsecutiveFailures: String(status.maxConsecutiveFailures),
  };
}

export function JevSettingsCard() {
  const [status, setStatus] = useState<JevSettingsStatus | null>(null);
  const [fields, setFields] = useState({
    enabled: false,
    endpoint: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
    timeoutMs: "3000",
    minConfidence: "0.6",
    maxConsecutiveFailures: "3",
  });
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/integrations/jev", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as JevSettingsStatus & { error?: string };
        if (!response.ok) throw new Error(body.error || "JEV 设置不可用");
        setStatus(body);
        setFields(fieldsFromStatus(body));
      })
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(cause instanceof Error ? cause.message : "JEV 设置不可用");
        }
      });
    return () => controller.abort();
  }, []);

  const applyStatus = (next: JevSettingsStatus) => {
    setStatus(next);
    setFields(fieldsFromStatus(next));
    setApiKey("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("save");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/integrations/jev", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: fields.enabled,
          endpoint: fields.endpoint,
          model: fields.model,
          timeoutMs: Number(fields.timeoutMs),
          minConfidence: Number(fields.minConfidence),
          maxConsecutiveFailures: Number(fields.maxConsecutiveFailures),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      const body = await response.json() as JevSettingsStatus & { error?: string };
      if (!response.ok) throw new Error(body.error || "保存失败");
      applyStatus(body);
      setMessage("已保存");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(null);
    }
  };

  const testConnection = async () => {
    setBusy("test");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/integrations/jev", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = await response.json() as { ok?: boolean; latencyMs?: number; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || "连接失败");
      setMessage(`连接成功 · ${body.latencyMs ?? 0}ms`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接失败");
    } finally {
      setBusy(null);
    }
  };

  const removeKey = async () => {
    setBusy("remove");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/integrations/jev", { method: "DELETE" });
      const body = await response.json() as JevSettingsStatus & { error?: string };
      if (!response.ok) throw new Error(body.error || "移除失败");
      applyStatus(body);
      setMessage("密钥已移除");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移除失败");
    } finally {
      setBusy(null);
    }
  };

  const locked = status?.environmentManaged === true;
  const disabled = Boolean(busy) || locked || status === null;
  const dirty = status !== null && (
    fields.enabled !== status.enabled
    || fields.endpoint !== status.endpoint
    || fields.model !== status.model
    || Number(fields.timeoutMs) !== status.timeoutMs
    || Number(fields.minConfidence) !== status.minConfidence
    || Number(fields.maxConsecutiveFailures) !== status.maxConsecutiveFailures
    || Boolean(apiKey.trim())
  );
  const stateLabel = !status
    ? "正在读取"
    : status.active ? "已配置" : status.keyConfigured ? "已关闭" : "缺少密钥";

  return (
    <form className="native-settings-card" style={cardStyle} onSubmit={(event) => void submit(event)}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>快速浏览器决策</div>
        <span className={status?.active ? "is-ready" : "is-off"} style={{ fontSize: 11 }}>{stateLabel}</span>
      </div>
      <div style={{ marginTop: 3, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5 }}>
        只用于浏览器下一步判断，不参与对话；受管理浏览器接入后生效。
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={fields.enabled}
            disabled={disabled}
            onChange={(event) => setFields((current) => ({ ...current, enabled: event.target.checked }))}
          />
          启用 JEV 决策
        </label>
        <label className="native-field">
          <span className="native-field-label">JEV URL</span>
          <input
            className="native-input"
            type="url"
            value={fields.endpoint}
            disabled={disabled}
            maxLength={2048}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setFields((current) => ({ ...current, endpoint: event.target.value }))}
            style={inputStyle}
          />
        </label>
        <label className="native-field">
          <span className="native-field-label">API Key</span>
          <input
            className="native-input"
            type="password"
            value={apiKey}
            disabled={disabled}
            maxLength={1024}
            spellCheck={false}
            autoComplete="off"
            placeholder={status?.keyConfigured ? "已保存，留空保持不变" : "输入 JEV API Key"}
            onChange={(event) => setApiKey(event.target.value)}
            style={inputStyle}
          />
        </label>
        <details>
          <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: 11 }}>高级</summary>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 9, marginTop: 9 }}>
            <label className="native-field" style={{ gridColumn: "1 / -1" }}><span className="native-field-label">模型</span><input className="native-input" value={fields.model} disabled={disabled} maxLength={128} autoComplete="off" onChange={(event) => setFields((current) => ({ ...current, model: event.target.value }))} style={inputStyle} /></label>
            <label className="native-field"><span className="native-field-label">最低置信度</span><input className="native-input" type="number" min="0.01" max="1" step="0.01" value={fields.minConfidence} disabled={disabled} onChange={(event) => setFields((current) => ({ ...current, minConfidence: event.target.value }))} style={inputStyle} /></label>
            <label className="native-field"><span className="native-field-label">超时 ms</span><input className="native-input" type="number" min="100" max="30000" step="100" value={fields.timeoutMs} disabled={disabled} onChange={(event) => setFields((current) => ({ ...current, timeoutMs: event.target.value }))} style={inputStyle} /></label>
          </div>
        </details>
        {locked ? <div className="native-inline-alert" role="status">当前由环境变量管理</div> : null}
        {error ? <div className="native-inline-alert is-error" role="alert">{error}</div> : null}
        {message ? <div className="native-inline-alert" role="status">{message}</div> : null}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button className="native-button native-button-primary" type="submit" disabled={disabled}>
            {busy === "save" ? "保存中…" : "保存设置"}
          </button>
          <button className="native-button" type="button" disabled={Boolean(busy) || !status?.keyConfigured || dirty} onClick={() => void testConnection()}>
            {busy === "test" ? "测试中…" : "测试连接"}
          </button>
          {status?.keyConfigured && !locked ? (
            <ConfirmDangerButton label="移除密钥" busy={Boolean(busy)} onConfirm={() => void removeKey()} />
          ) : null}
        </div>
      </div>
    </form>
  );
}
