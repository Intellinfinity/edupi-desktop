"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchDesktopApi } from "@/lib/desktop-native";
import type { CatalogAction, CatalogQuery, CatalogResult } from "@/lib/openconnector-catalog-contract";

type InspectResult = Extract<CatalogResult, { kind: "inspect" }>;

function isCatalogAction(value: unknown): value is CatalogAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  return typeof action.id === "string" && typeof action.service === "string"
    && typeof action.name === "string" && typeof action.description === "string";
}

export function isCatalogResult(value: unknown): value is CatalogResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.kind === "search") return Array.isArray(result.actions)
    && result.actions.every(isCatalogAction) && typeof result.limited === "boolean";
  if (result.kind === "inspect") return isCatalogAction(result.action)
    && Array.isArray(result.fields)
    && result.fields.every((field: unknown) => {
      if (!field || typeof field !== "object" || Array.isArray(field)) return false;
      const item = field as Record<string, unknown>;
      return typeof item.name === "string" && typeof item.type === "string"
        && typeof item.description === "string" && typeof item.required === "boolean";
    }) && typeof result.limited === "boolean";
  return false;
}

export function OpenConnectorCatalogCard() {
  const [query, setQuery] = useState("");
  const [actions, setActions] = useState<CatalogAction[]>([]);
  const [selected, setSelected] = useState<InspectResult | null>(null);
  const [searched, setSearched] = useState(false);
  const [limited, setLimited] = useState(false);
  const [busy, setBusy] = useState<"search" | string | null>(null);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const inspectHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => { if (selected) inspectHeadingRef.current?.focus(); }, [selected]);

  async function requestCatalog(input: CatalogQuery): Promise<CatalogResult> {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const response = await fetchDesktopApi("/api/desktop/openconnector/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null) as { ok?: unknown; data?: unknown } | null;
    if (!response.ok || body?.ok !== true || !isCatalogResult(body.data)) throw new Error("目录暂不可用");
    return body.data;
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value || busy) return;
    setBusy("search");
    setError("");
    setSelected(null);
    setActions([]);
    setSearched(false);
    setLimited(false);
    try {
      const result = await requestCatalog({ op: "search", query: value });
      if (result.kind !== "search" || !Array.isArray(result.actions)) throw new Error("目录暂不可用");
      setActions(result.actions);
      setLimited(result.limited);
      setSearched(true);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError("目录暂不可用");
    } finally {
      setBusy(null);
    }
  }

  async function inspect(actionId: string) {
    if (busy) return;
    setBusy(actionId);
    setError("");
    try {
      const result = await requestCatalog({ op: "inspect", actionId });
      if (result.kind !== "inspect" || result.action?.id !== actionId || !Array.isArray(result.fields)) throw new Error("目录暂不可用");
      setSelected(result);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError("目录暂不可用");
    } finally {
      setBusy(null);
    }
  }

  return <details className="native-settings-card openconnector-catalog-card">
    <summary>OpenConnector 目录</summary>
    <p>只读预览，尚不能执行外部操作。</p>
    <form onSubmit={(event) => void search(event)}>
      <label className="native-field"><span className="native-field-label">搜索 Action</span><input className="native-input" value={query} readOnly={Boolean(busy)} maxLength={200} autoComplete="off" onChange={(event) => { setQuery(event.target.value); setActions([]); setSelected(null); setSearched(false); setLimited(false); setError(""); }} /></label>
      <button className="native-button" type="submit" disabled={!query.trim()} aria-disabled={Boolean(busy) || !query.trim()}>{busy === "search" ? "查找中…" : "查找"}</button>
    </form>
    {error ? <div className="native-inline-alert is-error" role="alert">{error}</div> : null}
    {searched && !error ? <div className="openconnector-catalog-count" role="status">{actions.length ? `${actions.length} 项` : "没有匹配项"}{limited ? " · 请缩小关键词" : ""}</div> : null}
    {actions.length > 0 ? <ul className="openconnector-catalog-results">{actions.map((action) => <li key={action.id}><button type="button" aria-pressed={selected?.action.id === action.id} aria-disabled={Boolean(busy)} onClick={() => void inspect(action.id)}><strong>{action.name}</strong><small>{action.service ? `${action.service} · ` : ""}{action.description || action.id}</small></button></li>)}</ul> : null}
    {selected ? <section className="openconnector-catalog-inspect" aria-label={`${selected.action.name} 参数`}><h4 ref={inspectHeadingRef} tabIndex={-1}>{selected.action.name}</h4>{selected.fields.length ? <dl>{selected.fields.map((field) => <div key={field.name}><dt>{field.name}{field.required ? " · 必填" : ""}</dt><dd>{field.description || field.type}</dd></div>)}</dl> : <p>无需输入参数</p>}{selected.limited ? <p>仅显示前 30 项参数</p> : null}</section> : null}
  </details>;
}
