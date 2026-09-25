"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { fetchDesktopApi } from "@/lib/desktop-native";
import { isTauriDesktop } from "@/lib/desktop-updater";
import type { CatalogAction, CatalogProvider, CatalogQuery, CatalogResult } from "@/lib/openconnector-catalog-contract";

type InspectResult = Extract<CatalogResult, { kind: "inspect" }>;
const PROVIDER_PAGE_SIZE = 60;

function isAction(value: unknown): value is CatalogAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.service === "string"
    && typeof item.name === "string" && typeof item.description === "string";
}

function isProvider(value: unknown): value is CatalogProvider {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.service === "string" && typeof item.displayName === "string"
    && typeof item.scenario === "string" && Array.isArray(item.categories)
    && item.categories.every((name: unknown) => typeof name === "string")
    && Array.isArray(item.authTypes) && item.authTypes.every((name: unknown) => typeof name === "string");
}

export function isCatalogResult(value: unknown): value is CatalogResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.kind === "providers") return Array.isArray(result.providers) && result.providers.every(isProvider)
    && Number.isSafeInteger(result.total) && (result.total as number) >= result.providers.length && typeof result.limited === "boolean";
  if (result.kind === "actions") return typeof result.service === "string" && Array.isArray(result.actions)
    && result.actions.every((action: unknown) => isAction(action) && action.service === result.service)
    && Number.isSafeInteger(result.total) && (result.total as number) >= result.actions.length && typeof result.limited === "boolean";
  if (result.kind === "search") return Array.isArray(result.actions)
    && result.actions.every(isAction) && typeof result.limited === "boolean";
  if (result.kind === "inspect") return isAction(result.action)
    && Array.isArray(result.fields)
    && result.fields.every((field: unknown) => {
      if (!field || typeof field !== "object" || Array.isArray(field)) return false;
      const item = field as Record<string, unknown>;
      return typeof item.name === "string" && typeof item.type === "string"
        && typeof item.description === "string" && typeof item.required === "boolean";
    }) && typeof result.limited === "boolean";
  return false;
}

async function requestCatalog(input: CatalogQuery, signal: AbortSignal): Promise<CatalogResult> {
  if (!isTauriDesktop()) throw new Error("仅桌面应用可查询");
  for (const delay of [0, 300, 800, 1_600]) {
    if (delay) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delay);
      const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new DOMException("Aborted", "AbortError")); };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    const response = await fetchDesktopApi("/api/desktop/openconnector/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
    if (response.status === 429 && delay !== 1_600) continue;
    const body = await response.json().catch(() => null) as { ok?: unknown; data?: unknown } | null;
    if (!response.ok || body?.ok !== true || !isCatalogResult(body.data)) {
      throw new Error(response.status === 429 ? "目录正忙，请重试" : "目录暂不可用");
    }
    return body.data;
  }
  throw new Error("目录暂不可用");
}

export function OpenConnectorAdminPanel() {
  const [desktop, setDesktop] = useState(false);
  const [providers, setProviders] = useState<CatalogProvider[]>([]);
  const [providerTotal, setProviderTotal] = useState<number | null>(null);
  const [providerLimited, setProviderLimited] = useState(false);
  const [providerQuery, setProviderQuery] = useState("");
  const [visibleProviderCount, setVisibleProviderCount] = useState(PROVIDER_PAGE_SIZE);
  const [selectedProvider, setSelectedProvider] = useState<CatalogProvider | null>(null);
  const [providerActions, setProviderActions] = useState<CatalogAction[]>([]);
  const [providerActionsLimited, setProviderActionsLimited] = useState(false);
  const [actions, setActions] = useState<CatalogAction[]>([]);
  const [actionQuery, setActionQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [limited, setLimited] = useState(false);
  const [selectedAction, setSelectedAction] = useState<InspectResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const inspectHeadingRef = useRef<HTMLHeadingElement>(null);

  const loadProviders = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy("providers");
    setError("");
    try {
      const result = await requestCatalog({ op: "providers" }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.kind !== "providers") throw new Error("目录暂不可用");
      setProviders(result.providers);
      setProviderTotal(result.total);
      setProviderLimited(result.limited);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "目录暂不可用");
    } finally {
      if (controllerRef.current === controller) setBusy(null);
    }
  }, []);

  useEffect(() => {
    const available = isTauriDesktop();
    setDesktop(available);
    if (available) void loadProviders();
    return () => controllerRef.current?.abort();
  }, [loadProviders]);
  useEffect(() => { if (selectedAction) inspectHeadingRef.current?.focus(); }, [selectedAction]);

  const filteredProviders = useMemo(() => {
    const query = providerQuery.trim().toLocaleLowerCase();
    if (!query) return providers;
    return providers.filter((provider) => [provider.service, provider.displayName, provider.scenario, ...provider.categories]
      .some((text) => text.toLocaleLowerCase().includes(query)));
  }, [providers, providerQuery]);

  async function selectProvider(provider: CatalogProvider) {
    if (busy) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy("actions");
    setError("");
    setSelectedProvider(provider);
    setSelectedAction(null);
    setActionQuery("");
    setActions([]);
    setProviderActions([]);
    setSearched(false);
    setLimited(false);
    try {
      const result = await requestCatalog({ op: "actions", service: provider.service }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.kind !== "actions" || result.service !== provider.service) throw new Error("目录暂不可用");
      setProviderActions(result.actions);
      setProviderActionsLimited(result.limited);
      setActions(result.actions);
      setSearched(true);
      setLimited(result.limited);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "目录暂不可用");
    } finally {
      if (controllerRef.current === controller) setBusy(null);
    }
  }

  async function searchActions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = actionQuery.trim();
    if (!query || busy) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy("search");
    setError("");
    setSelectedAction(null);
    setSearched(false);
    try {
      const result = await requestCatalog({ op: "search", query, ...(selectedProvider ? { service: selectedProvider.service } : {}) }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.kind !== "search" || selectedProvider && result.actions.some((action) => action.service !== selectedProvider.service)) throw new Error("目录暂不可用");
      setActions(result.actions);
      setLimited(result.limited);
      setSearched(true);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "目录暂不可用");
    } finally {
      if (controllerRef.current === controller) setBusy(null);
    }
  }

  async function inspectAction(action: CatalogAction) {
    if (busy) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy("inspect");
    setError("");
    setSelectedAction(null);
    try {
      const result = await requestCatalog({ op: "inspect", actionId: action.id }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.kind !== "inspect" || result.action.id !== action.id
        || selectedProvider && result.action.service !== selectedProvider.service) throw new Error("目录暂不可用");
      setSelectedAction(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "目录暂不可用");
    } finally {
      if (controllerRef.current === controller) setBusy(null);
    }
  }

  function changeActionQuery(value: string) {
    setActionQuery(value);
    setSelectedAction(null);
    if (value.trim()) {
      setActions([]);
      setSearched(false);
      setLimited(false);
    } else {
      setActions(selectedProvider ? providerActions : []);
      setSearched(Boolean(selectedProvider));
      setLimited(selectedProvider ? providerActionsLimited : false);
    }
  }

  return <section className="openconnector-admin" aria-label="OpenConnector 管理后台">
    <header className="openconnector-admin__header"><div><h1>OpenConnector</h1><span>{providerTotal === null ? "服务目录" : `${providerTotal} 个服务`}</span></div><em>账号与执行未接入</em></header>
    {error ? <div className="native-inline-alert is-error" role="alert">{error}{desktop && providers.length === 0 && busy === null ? <button type="button" onClick={() => void loadProviders()}>重试</button> : null}</div> : null}
    <div className={`openconnector-admin__browser${selectedAction ? " has-inspect" : ""}`}>
      <section className="openconnector-admin__providers" aria-label="服务目录">
        <label>搜索服务<input type="search" value={providerQuery} disabled={!desktop || busy === "providers"} maxLength={120} autoComplete="off" onChange={(event) => { setProviderQuery(event.target.value); setVisibleProviderCount(PROVIDER_PAGE_SIZE); }} /></label>
        <div className="openconnector-admin__count" role="status">{!desktop ? "仅桌面应用可查询" : busy === "providers" ? "正在读取服务" : providerTotal === null ? "服务目录暂不可用" : `${filteredProviders.length} 个匹配服务${providerLimited ? " · 目录未完整" : ""}`}</div>
        <ul>{filteredProviders.slice(0, visibleProviderCount).map((provider) => <li key={provider.service}><button type="button" disabled={busy !== null} aria-pressed={selectedProvider?.service === provider.service} onClick={() => void selectProvider(provider)}><strong>{provider.displayName}</strong><small>{provider.service}</small></button></li>)}</ul>
        {filteredProviders.length > visibleProviderCount ? <button className="openconnector-admin__more" type="button" onClick={() => setVisibleProviderCount((count) => count + PROVIDER_PAGE_SIZE)}>显示更多</button> : null}
      </section>

      <section className="openconnector-admin__actions" aria-label="操作目录">
        <header><h2>{selectedProvider?.displayName || "操作"}</h2>{selectedProvider ? <span>{selectedProvider.authTypes.join(" · ") || "无需账户"}{selectedProvider.categories.length ? ` · ${selectedProvider.categories.join(" · ")}` : ""}</span> : null}</header>
        <form role="search" onSubmit={(event) => void searchActions(event)}><label>搜索操作<input type="search" value={actionQuery} disabled={!desktop || busy !== null} maxLength={200} autoComplete="off" onChange={(event) => changeActionQuery(event.target.value)} /></label><button type="submit" disabled={!desktop || busy !== null || !actionQuery.trim()}>查找</button></form>
        <div className="openconnector-admin__count" role="status">{busy === "actions" ? "正在读取操作" : busy === "search" ? "正在查找" : searched ? `${actions.length} 项${limited ? " · 可缩小关键词" : ""}` : selectedProvider ? "操作暂不可用" : "选择服务或搜索操作"}</div>
        {selectedProvider && !busy && !searched && error ? <button type="button" onClick={() => void selectProvider(selectedProvider)}>重试读取</button> : null}
        {searched && actions.length > 0 ? <ul>{actions.map((action) => <li key={action.id}><button type="button" disabled={busy !== null} aria-pressed={selectedAction?.action.id === action.id} onClick={() => void inspectAction(action)}><strong>{action.name}</strong><small>{action.service} · {action.description || action.id}</small></button></li>)}</ul> : null}
      </section>

      {selectedAction ? <section className="openconnector-admin__inspect" aria-label={`${selectedAction.action.name} 参数`}><h2 ref={inspectHeadingRef} tabIndex={-1}>{selectedAction.action.name}</h2><span>{selectedAction.action.id}</span><dl>{selectedAction.fields.map((field) => <div key={field.name}><dt>{field.name}{field.required ? " · 必填" : ""}</dt><dd>{field.description || field.type}</dd></div>)}</dl>{selectedAction.fields.length === 0 ? <small>无需输入参数</small> : null}{selectedAction.limited ? <small>仅显示前 30 项参数</small> : null}</section> : null}
    </div>
  </section>;
}
