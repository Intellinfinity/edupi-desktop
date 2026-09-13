import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { issueTaskBoardCommand, taskBoardContentHash, TaskBoardCommandError, type TeacherCreatedPreparationSource } from "@/lib/edupi-task-board-command";
import { readEducationContract } from "@/lib/edupi-education-server";
import { startPreparation } from "@/lib/edupi-preparation-runtime";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;
const BODY_KEYS = new Set(["clientRequestId", "title", "dueDate", "note", "preparationSource"]);
const PREPARATION_KEYS = new Set(["kind", "timetableSlotId", "lessonDate", "materialIds", "deliverables"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function dateOnly(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TaskBoardCommandError("invalid_envelope", "截止日期无效。");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new TaskBoardCommandError("invalid_envelope", "截止日期无效。");
  return value;
}

function note(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 1000) throw new TaskBoardCommandError("invalid_envelope", "任务备注无效。");
  return value.trim() || null;
}

function boundedUniqueStrings(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) return null;
  const rows = value.map((item) => typeof item === "string" ? item.trim() : "");
  if (rows.some((item) => !item || item.length > maxLength) || new Set(rows).size !== rows.length) return null;
  return rows;
}

function preparationSource(value: unknown): TeacherCreatedPreparationSource | null {
  if (value === undefined || value === null) return null;
  const source = record(value);
  const materialIds = boundedUniqueStrings(source?.materialIds, 20, 160);
  const deliverables = boundedUniqueStrings(source?.deliverables, 20, 240);
  if (!source || Object.keys(source).some((key) => !PREPARATION_KEYS.has(key)) || Object.keys(source).length !== PREPARATION_KEYS.size
    || source.kind !== "teaching_before_class" || typeof source.timetableSlotId !== "string" || !source.timetableSlotId || source.timetableSlotId.length > 160
    || !materialIds || !deliverables) throw new TaskBoardCommandError("invalid_envelope", "教学准备来源无效。");
  const lessonDate = dateOnly(source.lessonDate);
  if (!lessonDate) throw new TaskBoardCommandError("invalid_envelope", "上课日期无效。");
  return { kind: "teaching_before_class", timetable_slot_id: source.timetableSlotId, lesson_date: lessonDate, material_ids: materialIds, deliverables };
}

function statusFor(code: string): number {
  if (code === "invalid_envelope") return 400;
  if (["stale_snapshot", "stale_revision", "task_conflict", "idempotency_conflict", "invalid_preparation_context", "invalid_transition", "stage_unchanged"].includes(code)) return 409;
  return 503;
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Task creation request rejected", code: "forbidden" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Use application/json", code: "invalid_content_type" }, { status: 415 });
  try {
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    if (!body || Object.keys(body).some((key) => !BODY_KEYS.has(key)) || typeof body.clientRequestId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.clientRequestId)
      || typeof body.title !== "string" || !body.title.trim() || body.title.length > 240) {
      throw new TaskBoardCommandError("invalid_envelope", "任务字段无效。");
    }
    const taskId = `teacher-task-${body.clientRequestId.toLowerCase()}`;
    const task = { task_id: taskId, title: body.title.trim(), due_date: dateOnly(body.dueDate), note: note(body.note), preparation_source: preparationSource(body.preparationSource) };
    const sourceId = `desktop-task-create-${taskId.slice("teacher-task-".length)}`;
    const commandResult = await issueTaskBoardCommand({
      command_type: "create_task",
      source: { source_id: sourceId, source_kind: "teacher_message", source_hash: taskBoardContentHash(task), evidence_ids: [`evidence-${sourceId}`] },
      task,
    }, { envelopeOptions: { idempotencyKey: `create-${body.clientRequestId.toLowerCase()}` } });
    const receipt = commandResult.receipt;
    const replayed = commandResult.replayed;
    const preparation = task.preparation_source ? await startPreparation({ taskId }) : null;
    let refreshed = null;
    try { refreshed = await readEducationContract(); } catch { /* The task and preparation result are already durable. */ }
    return NextResponse.json({ taskId, replayed, receipt, preparation, data: refreshed, refreshPending: refreshed === null }, { status: refreshed ? 200 : 202 });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Task request is too large", code: "too_large" }, { status: 413 });
    const code = error instanceof TaskBoardCommandError ? error.code : "unavailable";
    return NextResponse.json({ error: error instanceof TaskBoardCommandError ? error.message : "任务创建暂不可用", code }, { status: statusFor(code) });
  }
}
