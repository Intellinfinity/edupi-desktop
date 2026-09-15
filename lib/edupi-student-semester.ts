import type { CalendarFact } from "./edupi-education-contract";

export type StudentSemesterRange = { from: string; to: string };

function dateOnly(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function addDays(value: string, days: number): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function studentSemesterRange(calendar: readonly CalendarFact[]): StudentSemesterRange | null {
  const weeks = calendar.flatMap((event) => {
    const from = dateOnly(event.date);
    if (!from || !/^第\s*\d+\s*周/u.test(event.name.trim())) return [];
    const to = dateOnly(event.endDate) || addDays(from, 6);
    return [{ from, to }];
  });
  if (!weeks.length) return null;
  return {
    from: weeks.map((week) => week.from).sort()[0],
    to: weeks.map((week) => week.to).sort().at(-1) as string,
  };
}
