import type { EducationTeacherMaterial } from "./edupi-education-contract";

export const MATERIAL_METADATA_FIELDS = ["title", "kind", "subject", "class_id"] as const;
export const MATERIAL_METADATA_KINDS = ["worksheet", "lesson_note", "assessment", "classroom_record", "other"] as const;
export type MaterialMetadataField = typeof MATERIAL_METADATA_FIELDS[number];
export type MaterialMetadataKind = typeof MATERIAL_METADATA_KINDS[number];
export type MaterialMetadataVersionSide = "before" | "after";

export type MaterialMetadataValues = {
  title: string;
  kind: MaterialMetadataKind;
  subject: string | null;
  classId: string | null;
};

export type MaterialMetadataVersion = {
  versionId: string;
  materialId: string;
  revision: number;
  beforeValues: MaterialMetadataValues;
  afterValues: MaterialMetadataValues;
  changedFields: MaterialMetadataField[];
  changedAt: string;
  sourceKind: "teacher_edit" | "agent_update" | "restore";
  requestId: string;
};

export type MaterialMetadataVersionHistory = {
  materialId: string;
  revision: number;
  historyCount: number;
  versions: MaterialMetadataVersion[];
  externalSend: false;
};

function wireValues(value: MaterialMetadataValues) {
  return { title: value.title, kind: value.kind, subject: value.subject, class_id: value.classId };
}

export function sameMaterialMetadataValues(left: MaterialMetadataValues, right: MaterialMetadataValues): boolean {
  return JSON.stringify(wireValues(left)) === JSON.stringify(wireValues(right));
}

export function materialMetadataValues(material: EducationTeacherMaterial): MaterialMetadataValues {
  return { title: material.title, kind: material.kind, subject: material.subject, classId: material.class_id };
}
