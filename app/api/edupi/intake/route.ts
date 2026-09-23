import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import {
  EducationIntakeError,
  issueEducationIntake,
  type EducationIntakeCommand,
  type TimetableImportSlot,
} from "@/lib/edupi-education-intake";
import { listStagedMaterials, settleStagedMaterial, type MaterialStagingDescriptor } from "@/lib/edupi-material-staging";
import { intakeRecognizedMaterial } from "@/lib/edupi-material-intake-flow";
import { MaterialRecognitionError } from "@/lib/edupi-material-recognition";
import { MaterialRecognitionAdmissionError, withMaterialRecognitionLock } from "@/lib/edupi-material-recognition-lock";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { stableScheduleSourceHash, stableTimetableSlotId } from "@/lib/edupi-schedule-upload";
import { parseCalendarIntakeCommand } from "@/lib/edupi-calendar-intake-request";
import { syncCalendarFile } from "@/lib/edupi-calendar-file-sync";
import { CalendarSourceError } from "@/lib/edupi-calendar-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const MATERIAL_KINDS = new Set(["worksheet", "lesson_note", "assessment", "classroom_record", "other"]);

type RawRecord = Record<string, unknown>;

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

function sourceFor(kind: "calendar" | "timetable", raw: readonly RawRecord[], stableSourceId?: string) {
  const hash = stableScheduleSourceHash(raw);
  const token = hash.slice("sha256:".length, "sha256:".length + 24);
  return { source_id: stableSourceId || `desktop-${kind}-${token}`, source_kind: "teacher_message" as const, source_hash: hash, evidence_ids: [`${kind}-evidence-${token}`] };
}

function timetableCommand(body: RawRecord): EducationIntakeCommand {
  if (!exactKeys(body, ["kind", "slots"]) || !Array.isArray(body.slots) || body.slots.length === 0 || body.slots.length > 200) {
    throw new EducationIntakeError("invalid_envelope", "课表导入必须包含 1—200 个时段。");
  }
  const slots: TimetableImportSlot[] = body.slots.map((value) => {
    const item = record(value);
    if (!item || !exactKeys(item, ["slotId", "dayOfWeek", "period", "subject", "className", "kind", "notes"])
      || !Number.isInteger(item.dayOfWeek) || Number(item.dayOfWeek) < 1 || Number(item.dayOfWeek) > 7
      || !Number.isInteger(item.period) || Number(item.period) < 0 || Number(item.period) > 64) {
      throw new EducationIntakeError("invalid_envelope", "课表时段字段无效。");
    }
    const kind = item.kind === undefined ? "class" : requiredText(item.kind, 20);
    if (kind !== "class" && kind !== "routine") throw new EducationIntakeError("invalid_envelope", "课表类型无效。");
    return {
      slot_id: typeof item.slotId === "string" && item.slotId.trim() ? requiredText(item.slotId, 160) : stableTimetableSlotId(item),
      day_of_week: Number(item.dayOfWeek),
      period: Number(item.period),
      subject: requiredText(item.subject, 120),
      class_name: optionalText(item.className, 120) ?? null,
      kind,
      notes: optionalText(item.notes, 1000) ?? null,
    };
  });
  return { command_type: "import_timetable", source: sourceFor("timetable", slots as unknown as RawRecord[]), slots };
}

function materialInput(body: RawRecord): { descriptor: MaterialStagingDescriptor; title: string; materialKind: "worksheet" | "lesson_note" | "assessment" | "classroom_record" | "other"; subject: string | null; classId: string | null; recognize: boolean; calendarSourceId: string | null; calendarSourceFingerprint: string | null } {
  if (!exactKeys(body, ["kind", "stagingId", "title", "materialKind", "subject", "classId", "recognize", "calendarSourceId", "calendarSourceFingerprint"])) throw new EducationIntakeError("invalid_envelope", "材料接入字段无效。");
  const stagingId = requiredText(body.stagingId, 160);
  const descriptor = listStagedMaterials().find((item) => item.staging_id === stagingId);
  if (!descriptor) throw new EducationIntakeError("staging_missing", "暂存材料不存在或已经处理。");
  const requestedKind = body.materialKind === undefined ? "other" : requiredText(body.materialKind, 40);
  if (!MATERIAL_KINDS.has(requestedKind)) throw new EducationIntakeError("invalid_envelope", "材料类型无效。");
  const title = optionalText(body.title, 240) || descriptor.original_name;
  if (body.recognize !== undefined && typeof body.recognize !== "boolean") throw new EducationIntakeError("invalid_envelope", "材料识别选项无效。");
  const calendarSourceId = optionalText(body.calendarSourceId, 160) ?? null;
  const calendarSourceFingerprint = optionalText(body.calendarSourceFingerprint, 160) ?? null;
  if (descriptor.kind === "calendar") {
    if (body.recognize === false || calendarSourceId !== null && !/^calendar-source-[a-f0-9]{32}$/u.test(calendarSourceId)
      || calendarSourceFingerprint !== null && !/^sha256:[a-f0-9]{64}$/u.test(calendarSourceFingerprint)
      || (calendarSourceId === null) !== (calendarSourceFingerprint === null)) {
      throw new EducationIntakeError("invalid_envelope", "日历来源字段无效。");
    }
  } else if (calendarSourceId !== null || calendarSourceFingerprint !== null) {
    throw new EducationIntakeError("invalid_envelope", "普通材料不能指定日历来源。");
  }
  return {
    descriptor,
    title,
    materialKind: requestedKind as "worksheet" | "lesson_note" | "assessment" | "classroom_record" | "other",
    subject: optionalText(body.subject, 120) ?? null,
    classId: optionalText(body.classId, 160) ?? null,
    recognize: body.recognize !== false,
    calendarSourceId,
    calendarSourceFingerprint,
  };
}

function statusFor(error: EducationIntakeError): number {
  if (error.code === "invalid_envelope" || error.code.startsWith("invalid_occurrence_")) return 400;
  if (error.code === "stale_snapshot" || error.code === "staging_missing" || error.code.includes("integrity") || error.code.includes("conflict")) return 409;
  return 503;
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Education intake request rejected" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Use application/json" }, { status: 415 });
  try {
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    if (!body || typeof body.kind !== "string") throw new EducationIntakeError("invalid_envelope", "教育导入请求无效。");
    if (body.kind === "material") {
      const material = materialInput(body);
      if (material.descriptor.kind === "calendar") {
        const result = await withMaterialRecognitionLock(material.descriptor.staging_id, () => syncCalendarFile({
          descriptor: material.descriptor,
          requestedSourceId: material.calendarSourceId,
          expectedSourceFingerprint: material.calendarSourceFingerprint,
          signal: request.signal,
        }));
        const receipt = result.receipts[0] ?? null;
        if (result.committed) settleStagedMaterial(material.descriptor.staging_id, "accepted_receipt");
        return NextResponse.json({ receipt, receipts: result.receipts, recognition: result.recognition,
          scheduleNeedsReview: result.scheduleNeedsReview, calendarSourceId: result.sourceId,
          calendarCommitted: result.committed, removedEventCount: result.removedEventIds.length, staged: listStagedMaterials() });
      }
      const result = await withMaterialRecognitionLock(material.descriptor.staging_id, () => intakeRecognizedMaterial(material));
      const receipt = result.receipts[0];
      if (receipt?.status === "accepted") settleStagedMaterial(material.descriptor.staging_id, "accepted_receipt");
      return NextResponse.json({ receipt: receipt ?? null, receipts: result.receipts, recognition: result.recognition,
        scheduleNeedsReview: result.scheduleNeedsReview, staged: listStagedMaterials() });
    }
    const command = body.kind === "calendar"
      ? parseCalendarIntakeCommand(body)
      : body.kind === "timetable"
        ? timetableCommand(body)
        : (() => { throw new EducationIntakeError("invalid_envelope", "不支持的教育导入类型。"); })();
    const result = await issueEducationIntake(command);
    return NextResponse.json({ receipt: result.receipt });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Education intake request is too large" }, { status: 413 });
    if (error instanceof EducationIntakeError) return NextResponse.json({ error: error.message, code: error.code }, { status: statusFor(error) });
    if (error instanceof MaterialRecognitionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "too_large" ? 413 : error.code === "ambiguous_schedule" ? 409 : error.code === "invalid_output" ? 400 : 503 });
    if (error instanceof CalendarSourceError) return NextResponse.json({ error: error.message, code: error.code }, {
      status: error.code === "invalid_calendar_source_projection" ? 503 : 409,
    });
    if (error instanceof MaterialRecognitionAdmissionError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    return NextResponse.json({ error: "教育导入暂不可用", code: "unavailable" }, { status: 503 });
  }
}
