import { NextResponse } from "next/server";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { runCoreProcess } from "@/lib/edupi-core-process-client";
import { EduPiTeachingMethodMutationError, parseTeachingMethodMutation, teachingMethodCoreFields, teachingMethodMutationRequestId, validateTeachingMethodMutationResponse } from "@/lib/edupi-teaching-methods.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "教学方法请求被拒绝", code: "forbidden" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "请使用 JSON", code: "invalid_content_type" }, { status: 415 });
  try {
    const input = parseTeachingMethodMutation(await parseJsonWithinLimit(request, 20000));
    const requestId = teachingMethodMutationRequestId(input);
    const roots = resolveEduPiBridgeRoots();
    const result = await runCoreProcess<Record<string, unknown>>({ ...roots, timeoutMs: 15000, request: { ...teachingMethodCoreFields(input), protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", request_id: requestId, operation: "teaching-skills" } });
    const validated = validateTeachingMethodMutationResponse(result, requestId, input);
    return NextResponse.json({ teachingSkills: validated.projection });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "教学方法内容过大", code: "too_large" }, { status: 413 });
    if (error instanceof EduPiTeachingMethodMutationError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "教学方法操作失败，请刷新后重试" }, { status: 503 });
  }
}
