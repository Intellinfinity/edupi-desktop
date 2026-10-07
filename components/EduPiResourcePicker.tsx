"use client";

import { useEffect, useState } from "react";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import { readEduPiWorkspace } from "@/lib/edupi-education-client";
import { catalogChatResources, CHAT_RESOURCE_KINDS, connectorChatResources, skillChatResources, workspaceChatResources, type ChatResource, type ChatResourceKind } from "@/lib/edupi-chat-resources";
import { fetchDesktopApi, isTauriDesktop } from "@/lib/desktop-native";
import type { SkillsResponse } from "@/lib/api-types";
import type { CatalogResult } from "@/lib/openconnector-catalog-contract";
import { paginateForeground } from "@/lib/edupi-foreground";

export function EduPiResourcePicker({ kind, cwd, onKind, onSelect, onClose }: {
  kind: ChatResourceKind; cwd?: string | null; onKind: (kind: ChatResourceKind) => void;
  onSelect: (resource: ChatResource) => void; onClose: () => void;
}) {
  const panelRef = useModalDismiss(onClose);
  const [items, setItems] = useState<ChatResource[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    setBusy(true); setError(null); setItems([]); setQuery(""); setPage(0);
    void (async () => {
      if (kind === "material" || kind === "knowledge") {
        const { data } = await readEduPiWorkspace({ signal });
        if (kind === "material" && data.workspaceResourcesUnavailable) throw new Error("材料暂不可用");
        if (kind === "material" && data.generatedArtifactsUnavailable) setError("部分草稿暂不可用，已显示可读材料");
        return workspaceChatResources(data, kind);
      }
      if (kind === "skill") {
        if (!cwd) throw new Error("请先选择工作区");
        const response = await fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store", signal });
        if (!response.ok) throw new Error(response.status === 403 ? "当前工作区不可访问" : "Skills 暂不可用");
        return skillChatResources((await response.json() as SkillsResponse).skills);
      }
      const response = await fetch("/api/edupi/platform", { cache: "no-store", signal });
      const data = response.ok ? await response.json() : null;
      const registryUnavailable = !data?.connectors || data.projections?.connectors === "unavailable";
      const registry = connectorChatResources(data?.connectors);
      if (!isTauriDesktop()) {
        if (registryUnavailable) throw new Error("连接器状态暂不可用");
        return registry;
      }
      try {
        const catalog = await fetchDesktopApi("/api/desktop/openconnector/catalog", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "providers" }), signal,
        });
        const body = await catalog.json() as { ok: boolean; data?: CatalogResult };
        if (!catalog.ok || !body.ok || body.data?.kind !== "providers") throw new Error("OpenConnector 目录暂不可用");
        if (registryUnavailable && !signal.aborted) setError("连接器状态暂不可用，已显示服务目录");
        return [...registry, ...catalogChatResources(body.data.providers)];
      } catch (failure) {
        if (!registry.length) throw failure;
        if (!signal.aborted) setError("OpenConnector 目录暂不可用，已显示登记的连接器");
        return registry;
      }
    })().then(result => { if (!signal.aborted) setItems(result); })
      .catch(failure => { if (!signal.aborted) setError(failure instanceof Error ? failure.message : "引用读取失败"); })
      .finally(() => { if (!signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [kind, cwd, retry]);

  const filtered = items.filter(item => `${item.title} ${item.status}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const projection = paginateForeground(filtered, page);
  return <div className="edupi-resource-backdrop" onClick={onClose}>
    <section ref={panelRef} className="edupi-resource-picker" role="dialog" aria-modal="true" aria-labelledby="edupi-resource-title" onClick={event => event.stopPropagation()}>
      <header><h2 id="edupi-resource-title">添加引用</h2><button type="button" aria-label="关闭引用选择" onClick={onClose}>×</button></header>
      <nav aria-label="引用类型">{CHAT_RESOURCE_KINDS.map(item => <button type="button" key={item.id} aria-pressed={kind === item.id} onClick={() => onKind(item.id)}>{item.label}</button>)}</nav>
      <input data-autofocus value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="搜索" aria-label="搜索引用" />
      {error ? <div role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></div> : null}
      <div className="edupi-resource-list" aria-busy={busy}>
        {busy ? <span role="status">正在读取</span> : projection.rows.length ? projection.rows.map(item => <button type="button" key={item.id} disabled={item.disabled} onClick={() => onSelect(item)}><strong>{item.title}</strong><span>{item.status}</span></button>) : !error ? <span>暂无可引用内容</span> : null}
      </div>
      {!busy && projection.pages > 1 ? <nav aria-label="引用分页"><button type="button" disabled={projection.page === 0} onClick={() => setPage(projection.page - 1)}>上一页</button><span>{projection.page + 1} / {projection.pages}</span><button type="button" disabled={projection.page === projection.pages - 1} onClick={() => setPage(projection.page + 1)}>查看更多</button></nav> : null}
    </section>
  </div>;
}
