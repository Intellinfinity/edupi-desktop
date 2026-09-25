"use client";

import { useEffect, useState } from "react";
import { fetchDesktopApi, showOpenConnectorConsole } from "@/lib/desktop-native";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { OpenConnectorAdminPanel } from "./OpenConnectorAdminPanel";

export function isSafeConsoleUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1"
      && /^\d+$/u.test(url.port) && Number(url.port) > 0 && Number(url.port) <= 65_535
      && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function OpenConnectorConsolePanel({ onBack }: { onBack: () => void }) {
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!isTauriDesktop()) { setError("仅桌面应用可打开"); return; }
    const controller = new AbortController();
    setError("");
    setOpened(false);
    void fetchDesktopApi("/api/desktop/openconnector/console", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { ok?: unknown; url?: unknown } | null;
        if (!response.ok || body?.ok !== true || !isSafeConsoleUrl(body.url)) throw new Error("控制台暂不可用");
        if (controller.signal.aborted) return;
        await showOpenConnectorConsole(Number(new URL(body.url).port));
        if (!controller.signal.aborted) setOpened(true);
      })
      .catch(() => { if (!controller.signal.aborted) setError("控制台暂不可用"); });
    return () => controller.abort();
  }, [retry]);

  return <section className="edupi-openconnector-console" aria-label="OpenConnector 控制台">
    <header>
      <button type="button" onClick={onBack}>← 返回管理中心</button>
      <strong>OpenConnector</strong>
      <span>只读</span>
    </header>
    {opened ? <div className="edupi-openconnector-console__loading" role="status">控制台窗口已打开 <button type="button" onClick={() => setRetry((count) => count + 1)}>显示窗口</button></div> : error ? <div className="edupi-openconnector-console__fallback">
      <div role="alert">{error} <button type="button" onClick={() => setRetry((count) => count + 1)}>重试</button></div>
      <OpenConnectorAdminPanel />
    </div> : <div className="edupi-openconnector-console__loading" role="status">正在打开控制台</div>}
  </section>;
}
