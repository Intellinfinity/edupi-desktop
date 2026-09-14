import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { readEducationContract } from "@/lib/edupi-education-server";
import { StudentProfileUpdateError, updateStudentProfile } from "@/lib/edupi-student-roster-server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;
const BODY_KEYS = new Set(["traits", "parentNotes", "expectedUpdatedAt", "expectedRevision", "studentId", "className"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function list(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 50 || value.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 240)) return null;
  return Array.from(new Set(value.map((item) => String(item).trim())));
}

function statusFor(code: string): number {
  if (code === "invalid_request") return 400;
  if (code === "student_not_found") return 404;
  if (code === "student_deleted") return 410;
  if (code === "stale_student" || code === "ambiguous_student" || code === "idempotency_conflict") return 409;
  if (code === "invalid_response") return 502;
  return 503;
}

export async function PUT(request: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "学生档案修改请求被拒绝。", code: "forbidden" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "请使用 JSON。", code: "invalid_content_type" }, { status: 415 });
  try {
    const name = (await params).name;
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    const traits = list(body?.traits);
    const parentNotes = list(body?.parentNotes);
    if (!name?.trim() || name.length > 120 || /[\u0000-\u001f\u007f]/u.test(name)
      || !body || Object.keys(body).some((key) => !BODY_KEYS.has(key))
      || traits === null || parentNotes === null
      || typeof body.studentId !== "string" || !body.studentId.trim() || body.studentId.length > 160
      || (body.className !== undefined && body.className !== null && (typeof body.className !== "string" || !body.className.trim() || body.className.length > 120))
      || typeof body.expectedUpdatedAt !== "string" || body.expectedUpdatedAt.length > 64 || !Number.isFinite(Date.parse(body.expectedUpdatedAt))
      || !Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) {
      throw new StudentProfileUpdateError("invalid_request", "学生档案修改字段无效。");
    }
    const result = await updateStudentProfile({ name: name.trim(), studentId:body.studentId.trim(), className:body.className as string | null | undefined, traits, parentNotes, expectedUpdatedAt: body.expectedUpdatedAt, expectedRevision: Number(body.expectedRevision), signal: request.signal });
    return NextResponse.json({ result, data: await readEducationContract() });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "学生档案修改内容过大。", code: "too_large" }, { status: 413 });
    const code = error instanceof StudentProfileUpdateError ? error.code : "unavailable";
    return NextResponse.json({ error: error instanceof Error ? error.message : "学生档案修改失败。", code }, { status: statusFor(code) });
  }
}
