import { readEducationContract } from "./edupi-education-server";
import type { EducationContract, EducationTeacherMaterial } from "./edupi-education-contract";
import {
  MATERIAL_METADATA_KINDS,
  materialMetadataValues,
  readMaterialMetadataHistory,
  sameMaterialMetadataValues,
  type MaterialMetadataMutationReceipt,
  type MaterialMetadataValues,
  type MaterialMetadataVersion,
  type MaterialMetadataVersionHistory,
  type MaterialMetadataVersionSide,
} from "./edupi-material-metadata";

export type MaterialMetadataCurrentState = {
  data: EducationContract;
  material: EducationTeacherMaterial;
  values: MaterialMetadataValues;
  history: MaterialMetadataVersionHistory;
};

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function validMaterial(value: EducationTeacherMaterial | undefined, materialId: string): value is EducationTeacherMaterial {
  return Boolean(value && value.material_id === materialId && typeof value.title === "string" && value.title.trim()
    && MATERIAL_METADATA_KINDS.includes(value.kind)
    && (value.subject === null || typeof value.subject === "string" && value.subject.trim())
    && (value.class_id === null || typeof value.class_id === "string" && value.class_id.trim())
    && typeof value.relative_path === "string" && value.relative_path
    && Number.isInteger(value.metadata_revision) && value.metadata_revision >= 0
    && Number.isInteger(value.metadata_history_count) && value.metadata_history_count >= 0 && value.metadata_history_count <= 50
    && validTimestamp(value.metadata_updated_at) && value.external_send === false);
}

export function materialFromContract(data: EducationContract, materialId: string): EducationTeacherMaterial | null {
  const matches = (data.teacherMaterials || []).filter((material) => material.material_id === materialId);
  return matches.length === 1 && validMaterial(matches[0], materialId) ? matches[0] : null;
}

export async function readMaterialMetadataCurrentState(materialId: string, signal?: AbortSignal): Promise<MaterialMetadataCurrentState | null> {
  const [data, history] = await Promise.all([readEducationContract(), readMaterialMetadataHistory(materialId, signal)]);
  const material = materialFromContract(data, materialId);
  if (!material || history.materialId !== materialId || history.revision !== material.metadata_revision || history.historyCount !== material.metadata_history_count) return null;
  const values = materialMetadataValues(material);
  if (history.versions.length > 0 && !sameMaterialMetadataValues(history.versions.at(-1)!.afterValues, values)) return null;
  return { data, material, values, history };
}

export function materialMetadataPatchMatches(material: EducationTeacherMaterial, patch: Partial<MaterialMetadataValues>): boolean {
  return (!Object.hasOwn(patch, "title") || material.title === patch.title)
    && (!Object.hasOwn(patch, "kind") || material.kind === patch.kind)
    && (!Object.hasOwn(patch, "subject") || material.subject === patch.subject)
    && (!Object.hasOwn(patch, "classId") || material.class_id === patch.classId);
}

export function materialMetadataVersionFor(history: MaterialMetadataVersionHistory, versionId: string): MaterialMetadataVersion | null {
  const matches = history.versions.filter((version) => version.versionId === versionId);
  return matches.length === 1 ? matches[0] : null;
}

export function materialMetadataDesiredValues(version: MaterialMetadataVersion, side: MaterialMetadataVersionSide): MaterialMetadataValues {
  return side === "before" ? version.beforeValues : version.afterValues;
}

export function isOwnedMaterialMetadataRestore(state: MaterialMetadataCurrentState, expectedRevision: number, requestId: string, desired: MaterialMetadataValues): boolean {
  if (state.material.metadata_revision !== expectedRevision + 1 || !sameMaterialMetadataValues(state.values, desired)) return false;
  const applied = state.history.versions.find((version) => version.revision === expectedRevision + 1);
  return Boolean(applied && applied.sourceKind === "restore" && applied.requestId === requestId && sameMaterialMetadataValues(applied.afterValues, desired));
}

export function verifiesMaterialMetadataReceipt(state: MaterialMetadataCurrentState, receipt: MaterialMetadataMutationReceipt, desired: MaterialMetadataValues): boolean {
  if (state.material.metadata_revision !== receipt.revision || state.material.metadata_history_count !== receipt.historyCount || !sameMaterialMetadataValues(state.values, desired)) return false;
  if (receipt.versionId === null) return state.history.revision === receipt.revision;
  const applied = state.history.versions.find((version) => version.revision === receipt.revision);
  return Boolean(applied && applied.versionId === receipt.versionId && applied.requestId === receipt.requestId
    && (receipt.action === "restore" ? applied.sourceKind === "restore" : applied.sourceKind === "teacher_edit" || applied.sourceKind === "agent_update")
    && sameMaterialMetadataValues(applied.afterValues, desired));
}
