import type { EducationContract, EducationEntityDeleteKind } from "./edupi-education-contract";
import type { EntityDeletionHistory, EntityDeletionRecord } from "./edupi-entity-delete";

export async function readEducationEntityDeletions(): Promise<{ deletions: EntityDeletionRecord[]; history: EntityDeletionHistory[] }> {
  const response = await fetch("/api/edupi/entities", { cache: "no-store" });
  const result = await response.json() as { error?: string; deletions?: EntityDeletionRecord[]; history?: EntityDeletionHistory[] };
  if (!response.ok || !Array.isArray(result.deletions) || !Array.isArray(result.history)) throw new Error(result.error || `删除记录读取失败（HTTP ${response.status}）`);
  return { deletions: result.deletions, history: result.history };
}

export async function deleteEducationEntity(kind: EducationEntityDeleteKind, id: string, note: string | null = null): Promise<{ target: { kind: EducationEntityDeleteKind; id: string }; deletedAt: string | null; data: EducationContract }> {
  const response = await fetch(`/api/edupi/entities/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  const result = await response.json() as { error?: string; code?: string; target?: { kind: EducationEntityDeleteKind; id: string }; deletedAt?: string | null; data?: EducationContract };
  if (!response.ok || !result.target || !result.data) throw new Error(result.error || `删除失败（HTTP ${response.status}）`);
  return { target: result.target, deletedAt: result.deletedAt ?? null, data: result.data };
}

export async function restoreEducationEntity(kind: EducationEntityDeleteKind, id: string, note: string | null = null): Promise<{ target: { kind: EducationEntityDeleteKind; id: string }; restoredAt: string | null; data: EducationContract }> {
  const response = await fetch(`/api/edupi/entities/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  const result = await response.json() as { error?: string; code?: string; target?: { kind: EducationEntityDeleteKind; id: string }; restoredAt?: string | null; data?: EducationContract };
  if (!response.ok || !result.target || !result.data) throw new Error(result.error || `恢复失败（HTTP ${response.status}）`);
  return { target: result.target, restoredAt: result.restoredAt ?? null, data: result.data };
}
