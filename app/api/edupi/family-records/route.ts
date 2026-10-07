import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { parseFamilyCaptureInput } from "@/lib/edupi-family-record-model";
import { captureFamilyRecord, FamilyRecordError, readFamilyRecords } from "@/lib/edupi-family-records";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function error(code: string, status: number, message: string) { return NextResponse.json({ code, error: message }, { status }); }
function unavailable(reason: unknown) {
  if (!(reason instanceof FamilyRecordError)) return error("unavailable", 503, "家校记录暂不可用");
  return error(reason.code, reason.code === "invalid_response" ? 502 : ["unknown_student_binding", "family_source_unavailable", "source_conflict", "invalid_family_identity", "invalid_family_reviewer"].includes(reason.code) ? 409 : 503, reason.message);
}
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return error("forbidden", 403, "家校记录请求被拒绝");
  const params = new URL(request.url).searchParams;
  const studentId = params.get("student_id"), offset = Number(params.get("offset") || "0"), limit = Number(params.get("limit") || "20");
  if ([...params.keys()].some((key) => !["student_id", "offset", "limit"].includes(key) || params.getAll(key).length !== 1)
    || !studentId || studentId.length > 160 || /[\u0000-\u001f\u007f]/u.test(studentId)
    || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000 || !Number.isInteger(limit) || limit < 1 || limit > 100) return error("invalid_family_request", 400, "记录查询无效");
  try { return NextResponse.json(await readFamilyRecords(studentId, offset, limit, request.signal)); }
  catch (reason) { return unavailable(reason); }
}
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return error("forbidden", 403, "家校记录请求被拒绝");
  if (!hasJsonContentType(request)) return error("invalid_content_type", 415, "请使用 JSON");
  try {
    const input = parseFamilyCaptureInput(await parseJsonWithinLimit(request, 32 * 1024));
    if (!input) return error("invalid_family_request", 400, "记录字段无效");
    return NextResponse.json({ record: await captureFamilyRecord(input, request.signal) });
  } catch (reason) {
    if (reason instanceof RequestBodyTooLargeError) return error("too_large", 413, "记录请求过大");
    return unavailable(reason);
  }
}
