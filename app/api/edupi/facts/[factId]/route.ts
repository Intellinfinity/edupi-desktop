import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { readEducationContract } from "@/lib/edupi-education-server";
import { FactLifecycleError, findDeletedEducationFact, mutateEducationFact } from "@/lib/edupi-fact-lifecycle";
import { parseFactId, parseFactMutationBody } from "@/lib/edupi-fact-lifecycle-request";
import { verifiesDeletedFact, verifiesFactMutation } from "@/lib/edupi-fact-lifecycle-server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, status: number, error: string) {
  return NextResponse.json({ code, error }, { status });
}

function mapError(error: FactLifecycleError) {
  if (error.code === "invalid_fact_request") return errorResponse(error.code, 400, error.message);
  if (error.code === "fact_not_found") return errorResponse(error.code, 404, error.message);
  if (error.code === "stale_fact" || error.code === "fact_conflict" || error.code === "invalid_review") return errorResponse(error.code, 409, error.message);
  if (error.code === "invalid_response") return errorResponse(error.code, 502, error.message);
  return errorResponse(error.code, 503, error.message);
}

export async function POST(request: Request, { params }: { params: Promise<{ factId: string }> }) {
  if (!isApiRequestAllowed(request)) return errorResponse("forbidden", 403, "事实操作请求被拒绝");
  if (!hasJsonContentType(request)) return errorResponse("invalid_content_type", 415, "请使用 JSON");
  const factId = parseFactId((await params).factId);
  try {
    const input = parseFactMutationBody(await parseJsonWithinLimit(request, 8 * 1024));
    if (!factId || !input) return errorResponse("invalid_fact_request", 400, "事实操作字段无效");
    const result = await mutateEducationFact(factId, input, request.signal);
    const data = await readEducationContract();
    if (!verifiesFactMutation(data, result, input)) return errorResponse("invalid_response", 502, "事实操作结果未能与 Core 对账");
    let deleted = null;
    if (input.action === "delete") {
      deleted = await findDeletedEducationFact(factId, result.revision, request.signal);
      if (!verifiesDeletedFact(deleted, result)) return errorResponse("invalid_response", 502, "事实删除结果未能与 Core 对账");
    }
    return NextResponse.json({ result, data, deleted });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return errorResponse("too_large", 413, "事实操作请求过大");
    return error instanceof FactLifecycleError ? mapError(error) : errorResponse("unavailable", 503, "事实操作暂不可用");
  }
}
