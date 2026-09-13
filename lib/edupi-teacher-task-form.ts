export const MAX_PREPARATION_MATERIALS = 20;
export const MAX_PREPARATION_DELIVERABLES = 20;
export const MAX_PREPARATION_DELIVERABLE_LENGTH = 240;

function rawText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function timetableSlotId(slot: Record<string, unknown>): string {
  return rawText(slot.slot_id ?? slot.id);
}

export function timetableDayOfWeek(slot: Record<string, unknown> | null): number | null {
  const value = Number(slot?.day_of_week ?? slot?.dayOfWeek);
  return Number.isInteger(value) && value >= 1 && value <= 7 ? value : null;
}

export function dateDayOfWeek(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) return null;
  return date.getUTCDay() || 7;
}

export function lessonDateMatchesSlot(value: string, slot: Record<string, unknown> | null): boolean {
  const lessonDay = dateDayOfWeek(value);
  const slotDay = timetableDayOfWeek(slot);
  return lessonDay !== null && slotDay !== null && lessonDay === slotDay;
}

export function dateBefore(value: string): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) return "";
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function preparationDeliverables(value: string): { items: string[]; error: string | null } {
  const items = value.split("\n").map((item) => item.trim()).filter(Boolean);
  if (items.length > MAX_PREPARATION_DELIVERABLES) return { items, error: `产物最多 ${MAX_PREPARATION_DELIVERABLES} 项。` };
  if (items.some((item) => item.length > MAX_PREPARATION_DELIVERABLE_LENGTH)) return { items, error: `每项产物最多 ${MAX_PREPARATION_DELIVERABLE_LENGTH} 个字。` };
  if (new Set(items).size !== items.length) return { items, error: "产物名称不能重复。" };
  return { items, error: null };
}
