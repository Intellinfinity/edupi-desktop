export type PreparationArtifact = { artifact_id: string; task_id: string; title: string; content: string; revision: number; current_revision: number; relative_path: string; access: "editable" | "read_only"; history: Array<{ revision: number; updated_at: string; actor: string }> };
export function normalizePreparationArtifact(value: unknown): PreparationArtifact {
  const item = value as PreparationArtifact | null;
  if (item?.access !== "editable" && item?.access !== "read_only") throw new Error("产物读取权限无效");
  if (!item || ![item.artifact_id, item.task_id, item.title, item.content, item.relative_path].every(value => typeof value === "string") || !Number.isSafeInteger(item.revision) || item.revision < 1 || !Number.isSafeInteger(item.current_revision) || item.current_revision < item.revision || !item.relative_path.startsWith(".edupi/output/") || item.relative_path.includes("\\") || item.relative_path.split("/").includes("..") || !Array.isArray(item.history) || item.history.some(row => !row || !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.updated_at !== "string" || typeof row.actor !== "string")) throw new Error("产物响应无效");
  return item;
}
export async function readPreparationArtifact(artifactId: string, revision?: number, signal?: AbortSignal): Promise<PreparationArtifact> {
  const query = new URLSearchParams({ artifactId }); if (revision !== undefined) query.set("revision", String(revision));
  const response = await fetch(`/api/edupi/preparation-artifact?${query}`, { cache: "no-store", signal });
  const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error || "读取失败"), { code: result.code });
  const artifact = normalizePreparationArtifact(result.artifact); if (artifact.artifact_id !== artifactId) throw new Error("产物身份不匹配"); return artifact;
}
export async function revisePreparationArtifact(artifactId: string, expectedRevision: number, content: string): Promise<PreparationArtifact> {
  const submittedContent = content.endsWith("\n") ? content : content + "\n";
  const response = await fetch("/api/edupi/preparation-artifact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ artifactId, expectedRevision, content: submittedContent }) });
  const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error || "保存失败"), { code: result.code });
  const artifact = normalizePreparationArtifact(result.artifact); if (artifact.artifact_id !== artifactId || artifact.content !== submittedContent || artifact.access !== "editable") throw new Error("保存内容未确认"); return artifact;
}
