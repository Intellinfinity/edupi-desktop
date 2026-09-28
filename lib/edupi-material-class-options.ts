export type MaterialClassOption = { value: string; label: string };

export function hasUnboundSameNameClass(timetable: Array<Record<string, unknown>>): boolean {
  const boundNames = new Set(timetable.flatMap(slot => typeof slot.class_id === "string" && slot.class_id.trim()
    && typeof slot.class_name === "string" && slot.class_name.trim() ? [slot.class_name.trim()] : []));
  return timetable.some(slot => !(typeof slot.class_id === "string" && slot.class_id.trim())
    && typeof slot.class_name === "string" && boundNames.has(slot.class_name.trim()));
}

export function materialClassOptions(timetable: Array<Record<string, unknown>>, teacherClasses: readonly string[]): MaterialClassOption[] {
  const canonical = new Map<string, string>();
  const boundNames = new Set<string>();
  for (const slot of timetable) {
    const id = typeof slot.class_id === "string" ? slot.class_id.trim() : "";
    if (!id) continue;
    const name = typeof slot.class_name === "string" ? slot.class_name.trim() : "";
    if (name) boundNames.add(name);
    canonical.set(id, name ? `${name} · ${id}` : id);
  }
  const options = [...canonical].map(([value, label]) => ({ value, label }));
  for (const name of teacherClasses) {
    const value = name.trim();
    if (value && !boundNames.has(value) && !canonical.has(value)) options.push({ value, label: value });
  }
  return options;
}
