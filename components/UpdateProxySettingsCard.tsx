"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getUpdateProxyNative, setUpdateProxyNative } from "@/lib/update-proxy-native";
import { parseUpdateProxyInput } from "@/lib/update-proxy-url";

export { parseUpdateProxyInput } from "@/lib/update-proxy-url";

export function UpdateProxySettingsCard({ onSaved }: { onSaved?: () => void }) {
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function retryRead() {
    setLoaded(false);
    setReadFailed(false);
    setError("");
    try {
      const proxy = await getUpdateProxyNative();
      setSaved(proxy);
      setDraft(proxy || "");
    } catch {
      setReadFailed(true);
      setError("更新代理设置不可读取");
    } finally {
      setLoaded(true);
    }
  }

  async function restoreSystemNetwork() {
    setBusy(true);
    setError("");
    try {
      await setUpdateProxyNative("");
      setSaved(null);
      setDraft("");
      setReadFailed(false);
      setMessage("已使用系统网络");
      onSaved?.();
    } catch {
      setError("更新代理设置不可清除");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void getUpdateProxyNative().then((proxy) => {
      if (cancelled) return;
      setSaved(proxy);
      setDraft(proxy || "");
      setLoaded(true);
    }).catch(() => {
      if (cancelled) return;
      setReadFailed(true);
      setLoaded(true);
      setError("更新代理设置不可读取");
    });
    return () => { cancelled = true; };
  }, []);

  let normalized: string | null = null;
  let valid = true;
  try {
    normalized = parseUpdateProxyInput(draft);
  } catch {
    valid = false;
  }
  const dirty = valid && normalized !== saved;
  const invalid = !valid && Boolean(draft.trim());
  const visibleError = error || (invalid ? "只支持不含凭据的本机 HTTP 代理" : "");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded || readFailed || busy) return;
    let proxy: string | null;
    try {
      proxy = parseUpdateProxyInput(draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "代理地址无效");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const stored = await setUpdateProxyNative(proxy || "");
      setSaved(stored);
      setDraft(stored || "");
      setMessage(stored ? "已保存" : "已使用系统网络");
      onSaved?.();
    } catch {
      setError("更新代理保存失败");
    } finally {
      setBusy(false);
    }
  }

  return <details className="native-settings-card update-proxy-card">
    <summary>更新代理{readFailed ? <span className="update-proxy-card__status">读取失败</span> : null}</summary>
    <form onSubmit={(event) => void save(event)}>
      <label className="native-field"><span className="native-field-label">本机 HTTP 代理</span><input className="native-input" type="text" inputMode="url" value={draft} disabled={!loaded || readFailed || busy} aria-invalid={!valid && Boolean(draft.trim())} aria-describedby={visibleError ? "update-proxy-error" : "update-proxy-hint"} autoComplete="off" spellCheck={false} placeholder="http://127.0.0.1:7897" onChange={(event) => { setDraft(event.target.value); setError(""); setMessage(""); }} /></label>
      <button className="native-button" type="submit" disabled={!loaded || readFailed || busy || !dirty}>保存</button>
    </form>
    <p id="update-proxy-hint">留空使用系统网络。</p>
    {visibleError ? <div id="update-proxy-error" className="native-inline-alert is-error" role="alert">{visibleError}</div> : null}
    {readFailed ? <div className="update-proxy-card__recovery"><button className="native-button" type="button" disabled={!loaded || busy} onClick={() => void retryRead()}>重试读取</button><button className="native-button" type="button" disabled={!loaded || busy} onClick={() => void restoreSystemNetwork()}>恢复系统网络</button></div> : null}
    {message ? <div className="native-inline-alert" role="status">{message}</div> : null}
  </details>;
}
