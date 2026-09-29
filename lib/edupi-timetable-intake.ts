import { EducationIntakeError, type EducationIntakeCommand, type TimetableImportSlot } from "./edupi-education-intake";
import { stableScheduleSourceHash, stableTimetableSlotId } from "./edupi-schedule-upload";

type RawRecord = Record<string, unknown>;
const CLASS_ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/u;
const LESSON_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function exactKeys(value: RawRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || value.length > max) throw new EducationIntakeError("invalid_envelope", "导入字段无效。");
  return value.trim() || null;
}

function requiredText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new EducationIntakeError("invalid_envelope", "导入字段无效。");
  return value.trim();
}

export function parseTimetableIntakeCommand(body: RawRecord): EducationIntakeCommand {
  if (!exactKeys(body, ["kind", "slots"]) || !Array.isArray(body.slots) || body.slots.length === 0 || body.slots.length > 200) {
    throw new EducationIntakeError("invalid_envelope", "课表导入必须包含 1—200 个时段。");
  }
  const slots: TimetableImportSlot[] = body.slots.map((value) => {
    const item = record(value);
    if (!item || !exactKeys(item, ["slotId", "dayOfWeek", "period", "subject", "classId", "className", "startTime", "timeZone", "kind", "notes"])
      || !Number.isInteger(item.dayOfWeek) || Number(item.dayOfWeek) < 1 || Number(item.dayOfWeek) > 7
      || !Number.isInteger(item.period) || Number(item.period) < 0 || Number(item.period) > 64) {
      throw new EducationIntakeError("invalid_envelope", "课表时段字段无效。");
    }
    const kind = item.kind === undefined ? "class" : requiredText(item.kind, 20);
    if (kind !== "class" && kind !== "routine") throw new EducationIntakeError("invalid_envelope", "课表类型无效。");
    const classId = optionalText(item.classId, 128);
    if (classId && !CLASS_ID.test(classId)) throw new EducationIntakeError("invalid_envelope", "班级编号仅支持英文字母、数字及 - _ 等符号。");
    const startTime = optionalText(item.startTime, 5);
    const timeZone = optionalText(item.timeZone, 100);
    if (Boolean(startTime) !== Boolean(timeZone) || startTime && !LESSON_TIME.test(startTime)) {
      throw new EducationIntakeError("invalid_envelope", "上课时间和时区须一起填写。");
    }
    if (timeZone) try { new Intl.DateTimeFormat("en-CA", { timeZone }); }
    catch { throw new EducationIntakeError("invalid_envelope", "时区无效。"); }
    return {
      slot_id: typeof item.slotId === "string" && item.slotId.trim() ? requiredText(item.slotId, 160) : stableTimetableSlotId(item),
      day_of_week: Number(item.dayOfWeek),
      period: Number(item.period),
      subject: requiredText(item.subject, 120),
      ...(classId ? { class_id: classId } : {}),
      class_name: optionalText(item.className, 120) ?? null,
      ...(startTime && timeZone ? { start_time: startTime, time_zone: timeZone } : {}),
      kind,
      notes: optionalText(item.notes, 1000) ?? null,
    };
  });
  const hash = stableScheduleSourceHash(slots as unknown as RawRecord[]);
  const token = hash.slice("sha256:".length, "sha256:".length + 24);
  return { command_type: "import_timetable", source: {
    source_id: `desktop-timetable-${token}`, source_kind: "teacher_message", source_hash: hash,
    evidence_ids: [`timetable-evidence-${token}`],
  }, slots };
}
