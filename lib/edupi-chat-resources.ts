import type { SkillInfo } from "./api-types";
import type { EducationContract } from "./edupi-education-contract";
import type { EduPiComposerResource } from "./edupi-composer-context";
import type { CatalogProvider } from "./openconnector-catalog-contract";

export type ChatResourceKind = EduPiComposerResource["kind"];
export type ChatResource = EduPiComposerResource & { status: string; disabled?: boolean };
export const CHAT_RESOURCE_KINDS: ReadonlyArray<{ id: ChatResourceKind; label: string }> = [
  { id: "material", label: "材料" }, { id: "knowledge", label: "知识" },
  { id: "skill", label: "Skills" }, { id: "connector", label: "连接器" },
];

export function workspaceChatResources(data: EducationContract, kind: "material" | "knowledge"): ChatResource[] {
  if (kind === "material") {
    if (data.workspaceResourcesUnavailable) return [];
    return [
      ...(data.teacherMaterials ?? []).map(item => ({
        id: `material:${item.material_id}`, kind, title: item.title.slice(0, 120), disabled: item.available === false,
        status: item.available === false ? "不可用" : "材料",
        reference: `材料：${item.title}\nmaterial_id：${item.material_id}\n版本：${item.metadata_revision}\n文件：${item.relative_path}`,
      })),
      ...(data.generatedArtifactsUnavailable ? [] : data.generatedArtifacts ?? []).map(item => ({
        id: `artifact:${item.artifact_id}`, kind, title: item.title.slice(0, 120), disabled: item.available === false,
        status: item.available === false ? "不可用" : item.access === "read_only" ? "只读草稿" : "草稿",
        reference: `产物：${item.title}\nartifact_id：${item.artifact_id}\n文件：${item.relative_path}\n权限：${item.access === "read_only" ? "只读" : "依Core当前资格"}`,
      })),
    ];
  }
  return [
    ...(data.continuity?.memories ?? []).filter(item => item.state === "active").map(item => ({
      id: `memory:${item.id}`, kind, title: item.content.slice(0, 60), status: "教育记忆",
      reference: `知识引用\nmemory_id：${item.id}\n版本：${item.revision}\n${item.content}`,
    })),
    ...(data.c1Memories ?? []).filter(item => item.state === "active").map(item => ({
      id: `c1-memory:${item.memoryId}`, kind, title: item.content.slice(0, 60), status: "已审核记忆",
      reference: `知识引用\nmemory_id：${item.memoryId}\n审核时间：${item.acceptedAt}\n依据：${item.evidenceIds.join("、")}\n${item.content}`,
    })),
  ];
}

export function skillChatResources(skills: SkillInfo[]): ChatResource[] {
  return skills.map(item => ({
    id: `skill:${item.filePath}`, kind: "skill", title: item.name.slice(0, 120), disabled: item.disableModelInvocation,
    status: item.disableModelInvocation ? "已暂停" : "可引用",
    reference: `技能：${item.name}\n文件：${item.filePath}\n${item.description}\n引用不代表调用授权，仍遵守当前访问模式和教师确认。`,
  }));
}

type Connector = { connector_id?: string; label?: string; status?: string; capabilities?: string[] };
export function connectorChatResources(registry: { connectors?: Connector[] } | null | undefined): ChatResource[] {
  const labels: Record<string, string> = { connected: "已连接", conversation_verified: "已验证会话", not_configured: "未配置", disabled: "已关闭" };
  return (registry?.connectors ?? []).filter(item => item.connector_id).map(item => ({
    id: `connector:${item.connector_id}`, kind: "connector", title: (item.label || item.connector_id!).slice(0, 120),
    status: labels[item.status ?? ""] || "未核实",
    reference: `连接器：${item.label || item.connector_id}\nconnector_id：${item.connector_id}\n登记状态：${labels[item.status ?? ""] || "未核实"}\n引用不代表调用授权，账号、动作许可和教师确认仍须单独核对。`,
  }));
}

export function catalogChatResources(providers: CatalogProvider[]): ChatResource[] {
  return providers.map(item => ({
    id: `openconnector:${item.service}`, kind: "connector", title: item.displayName.slice(0, 120), status: "仅目录",
    reference: `OpenConnector：${item.displayName}\nservice：${item.service}\n${item.scenario}\n账号与执行未接入；目录引用不代表调用授权。`,
  }));
}
