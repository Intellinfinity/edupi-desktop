import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { parseMaterialId, parseMaterialMetadataRestoreBody } from "@/lib/edupi-material-metadata-request";
import {
  isOwnedMaterialMetadataRestore,
  materialMetadataDesiredValues,
  materialMetadataVersionFor,
  readMaterialMetadataCurrentState,
  verifiesMaterialMetadataReceipt,
} from "@/lib/edupi-material-metadata-server";
import {
  MaterialMetadataError,
  materialMetadataRestoreRequestId,
  restoreMaterialMetadataVersion,
  sameMaterialMetadataValues,
  type MaterialMetadataMutationReceipt,
} from "@/lib/edupi-material-metadata";
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
  if (error.code === "invalid_response") return errorResponse(error.code, 502, error.message);
  return errorResponse(error.code, 503, error.message);
}

export async function GET(request: Request, { params }: { params: Promise<{ materialId: string }> }) {
  if (!isApiRequestAllowed(request)) return errorResponse("forbidden", 403, "材料信息历史请求被拒绝");
  const materialId = parseMaterialId((await params).materialId);
  if (!materialId) return errorResponse("invalid_request", 400, "材料身份无效");
  try {
    const state = await readMaterialMetadataCurrentState(materialId, request.signal);
    return state
      ? NextResponse.json({ history: state.history, data: state.data })
      : errorResponse("stale_material_metadata", 409, "材料信息已更新，请重试");
  } catch (error) {
    return error instanceof MaterialMetadataError ? mapError(error) : errorResponse("unavailable", 503, "材料信息历史暂不可用");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ materialId: string }> }) {
  if (!isApiRequestAllowed(request)) return errorResponse("forbidden", 403, "材料信息恢复请求被拒绝");
  if (!hasJsonContentType(request)) return errorResponse("invalid_content_type", 415, "请使用 JSON");
  const materialId = parseMaterialId((await params).materialId);
  let body = null;
  try { body = parseMaterialMetadataRestoreBody(await parseJsonWithinLimit(request, 4000)); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) return errorResponse("too_large", 413, "材料信息恢复请求过大"); }
  if (!materialId || !body) return errorResponse("invalid_request", 400, "材料信息恢复请求无效");

  try {
    const initial = await readMaterialMetadataCurrentState(materialId);
    if (!initial) return errorResponse("stale_material_metadata", 409, "材料信息已更新，请刷新后重试");
    const version = materialMetadataVersionFor(initial.history, body.versionId);
    if (!version) return errorResponse("version_not_found", 404, "这个材料信息版本已不存在");
    const desired = materialMetadataDesiredValues(version, body.versionSide);
    const requestId = materialMetadataRestoreRequestId({ materialId, ...body });
    if (isOwnedMaterialMetadataRestore(initial, body.expectedRevision, requestId, desired)) return NextResponse.json({ result: null, data: initial.data, history: initial.history, reconciled: true });
    if (initial.material.metadata_revision !== body.expectedRevision) return errorResponse("stale_material_metadata", 409, "材料信息已更新，请刷新后重试");
    if (sameMaterialMetadataValues(initial.values, desired)) return errorResponse("version_already_current", 409, "当前材料信息已经是这个版本");

    let receipt: MaterialMetadataMutationReceipt;
    try { receipt = await restoreMaterialMetadataVersion({ materialId, ...body, signal: request.signal }); }
    catch (error) {
      const reconciled = await readMaterialMetadataCurrentState(materialId).catch(() => null);
      if (reconciled && isOwnedMaterialMetadataRestore(reconciled, body.expectedRevision, requestId, desired)) return NextResponse.json({ result: null, data: reconciled.data, history: reconciled.history, reconciled: true });
      throw error;
    }
    const verified = await readMaterialMetadataCurrentState(materialId);
    if (!verified || !verifiesMaterialMetadataReceipt(verified, receipt, desired)) return errorResponse("invalid_response", 502, "材料信息恢复结果未能与 Core 对账");
    return NextResponse.json({ result: receipt, data: verified.data, history: verified.history, reconciled: false });
  } catch (error) {
    return error instanceof MaterialMetadataError ? mapError(error) : errorResponse("unavailable", 503, "材料信息恢复暂不可用");
  }
}
