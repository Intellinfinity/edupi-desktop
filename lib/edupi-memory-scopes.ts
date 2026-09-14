import type { EducationMemoryCategory } from "./edupi-education-contract";

export type EducationMemoryScopeBinding = {
  memory_id: string;
  category: EducationMemoryCategory;
  scope_path: {
    school_id: string;
    semester_id: string | null;
    grade_id: string | null;
    class_id: string | null;
    teacher_id: string | null;
    student_id: string | null;
  };
  inherited: boolean;
  inferred: boolean;
  binding_source: string;
};

export type EducationMemoryScopeProjection = {
  projection_kind: "scoped_education_memory";
  projection_version: 1;
  generated_at: string;
  source_state_hash: string;
  active_semester_id: string;
  contexts: Array<{ context_id: string; context_kind: "school" | "semester" | "grade" | "class" | "teacher" | "student"; label: string; parent_id: string | null }>;
  semesters: Array<{ semester_id: string; label: string; academic_year: string; term: number; memory_count: number; category_counts: Record<EducationMemoryCategory, number> }>;
  bindings: EducationMemoryScopeBinding[];
  external_send: false;
};

type MemoryScopeFetcher = (url: string, init: { cache: RequestCache; signal?: AbortSignal }) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;

export async function readEducationMemoryScopes({ fetcher = fetch as unknown as MemoryScopeFetcher, signal }: { fetcher?: MemoryScopeFetcher; signal?: AbortSignal } = {}): Promise<EducationMemoryScopeProjection> {
  const response = await fetcher("/api/edupi/memory-scopes", { cache: "no-store", signal });
  const body = await response.json() as { projection?: EducationMemoryScopeProjection; error?: string };
  if (!response.ok || body?.projection?.projection_kind !== "scoped_education_memory") throw new Error(body?.error || `记忆范围读取失败（HTTP ${response.status ?? "unknown"}）`);
  return body.projection;
}

export function scopedMemoryIds(projection: EducationMemoryScopeProjection | null, semesterId: string | null, category?: EducationMemoryCategory): Set<string> | null {
  if (!projection || !semesterId) return null;
  return new Set(projection.bindings.filter((binding) => {
    if (category && binding.category !== category) return false;
    return !binding.scope_path.semester_id || binding.scope_path.semester_id === semesterId;
  }).map((binding) => binding.memory_id));
}
