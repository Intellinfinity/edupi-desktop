export const EDUCATION_MODULES = ["home", "context", "students", "calendar", "materials", "tasks"] as const;
export type EducationModule = typeof EDUCATION_MODULES[number];

export function isEducationModule(value: unknown): value is EducationModule {
  return typeof value === "string" && (EDUCATION_MODULES as readonly string[]).includes(value);
}
