import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { parseMaterialId, parseMaterialMetadataUpdateBody } from "@/lib/edupi-material-metadata-request";
import { materialMetadataPatchMatches, readMaterialMetadataCurrentState, verifiesMaterialMetadataReceipt } from "@/lib/edupi-material-metadata-server";
import { MaterialMetadataError, updateMaterialMetadata } from "@/lib/edupi-material-metadata";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, status: number, error: string) {
  return NextResponse.json({ code, error }, { status });
}

function mapError(error: MaterialMetadataError) {
  if (error.code === "invalid_request" || error.code === "invalid_material_metadata") return errorResponse(error.code, 400, error.message);
  if (error.code === "material_not_found" || error.code === "version_not_found") return errorResponse(error.code, 404, error.message);
  if (error.code === "material_deleted") return errorResponse(error.code, 410, error.message);
  if (["stale_material_metadata", "version_already_current", "idempotency_conflict"].includes(error.code)) return errorResponse(error.code, 409, error.message);
  if (["material_metadata_storage_capacity", "material_metadata_history_capacity"].includes(error.code)) return errorResponse(error.code, 413, error.message);
  if (error.code === "invalid_response") return errorResponse(error.code, 502, error.message);
  return errorResponse(error.code, 503, error.message);
}

export async function PUT(request: Request, { params }: { params: Promise<{ materialId: string }> }) {
  if (!isApiRequestAllowed(request)) return errorResponse("forbidden", 403, "材料信息请求被拒绝");
  if (!hasJsonContentType(request)) return errorResponse("invalid_content_type", 415, "请使用 JSON");
  const materialId = parseMaterialId((await params).materialId);
  try {
    const body = parseMaterialMetadataUpdateBody(await parseJsonWithinLimit(request, 8 * 1024));
    if (!materialId || !body) return errorResponse("invalid_request", 400, "材料信息修改字段无效");
    const receipt = await updateMaterialMetadata({ materialId, ...body, signal: request.signal });
    const state = await readMaterialMetadataCurrentState(materialId);
    if (!state || !materialMetadataPatchMatches(state.material, body.patch) || !verifiesMaterialMetadataReceipt(state, receipt, state.values)) {
      if (receipt.replayed) return errorResponse("stale_material_metadata", 409, "材料信息已更新，请刷新后重试");
      return errorResponse("invalid_response", 502, "材料信息修改结果未能与 Core 对账");
    }
    return NextResponse.json({ result: receipt, data: state.data, history: state.history });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return errorResponse("too_large", 413, "材料信息内容过大");
    return error instanceof MaterialMetadataError ? mapError(error) : errorResponse("unavailable", 503, "材料信息修改暂不可用");
  }
}
