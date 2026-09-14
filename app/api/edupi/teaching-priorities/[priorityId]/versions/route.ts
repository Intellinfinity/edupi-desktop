import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { readEducationContract } from "@/lib/edupi-education-server";
import type { EducationContract, EducationTeachingPriority } from "@/lib/edupi-education-contract";
import {
  parseTeachingPriorityId,
  parseTeachingPriorityRestoreBody,
  type TeachingPriorityRestoreBody,
} from "@/lib/edupi-teaching-priority-request";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  TeachingPriorityError,
  readTeachingPriorityHistory,
  restoreTeachingPriorityVersion,
  sameTeachingPriorityValues,
  teachingPriorityRestoreRequestId,
  teachingPriorityValues,
  type TeachingPriorityMutationReceipt,
  type TeachingPriorityVersion,
  type TeachingPriorityVersionHistory,
  type TeachingPriorityVersionSide,
  type TeachingPriorityValues,
} from "@/lib/edupi-teaching-priorities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CurrentState = { data: EducationContract; priority: EducationTeachingPriority; values: TeachingPriorityValues; history: TeachingPriorityVersionHistory };

function errorResponse(code: string, status: number, error: string) {
  return NextResponse.json({ code, error }, { status });
}

function mapError(error: TeachingPriorityError) {
  if (error.code === "invalid_request" || error.code === "invalid_priority") return errorResponse(error.code, 400, error.message);
  if (error.code === "priority_not_found" || error.code === "version_not_found") return errorResponse(error.code, 404, error.message);
  if (error.code === "priority_deleted") return errorResponse(error.code, 410, error.message);
  if (["priority_conflict", "stale_priority", "version_already_current", "idempotency_conflict"].includes(error.code)) return errorResponse(error.code, 409, error.message);
  if (error.code === "invalid_response") return errorResponse(error.code, 502, error.message);
  return errorResponse(error.code, 503, error.message);
}

function priorityFor(data: EducationContract, priorityId: string): EducationTeachingPriority | null {
  const matches = data.continuity.teachingPriorities.filter((priority) => priority.id === priorityId);
  return matches.length === 1 ? matches[0] : null;
}

function versionFor(history: TeachingPriorityVersionHistory, versionId: string): TeachingPriorityVersion | null {
  const matches = history.versions.filter((version) => version.versionId === versionId);
  return matches.length === 1 ? matches[0] : null;
}

function desiredValues(version: TeachingPriorityVersion, side: TeachingPriorityVersionSide): TeachingPriorityValues {
  return side === "before" ? version.beforeValues : version.afterValues;
}

async function currentState(priorityId: string, signal?: AbortSignal): Promise<CurrentState | null> {
  const [data, history] = await Promise.all([readEducationContract(), readTeachingPriorityHistory(priorityId, signal)]);
  const priority = priorityFor(data, priorityId);
  if (!priority || history.priorityId !== priorityId || priority.revision !== history.revision || priority.historyCount !== history.historyCount) return null;
  const values = teachingPriorityValues(priority);
  if (history.versions.length > 0 && !sameTeachingPriorityValues(history.versions.at(-1)!.afterValues, values)) return null;
  return { data, priority, values, history };
}

function ownedRestore(state: CurrentState, body: TeachingPriorityRestoreBody, requestId: string, desired: TeachingPriorityValues): boolean {
  if (state.priority.revision !== body.expectedRevision + 1 || !sameTeachingPriorityValues(state.values, desired)) return false;
  const applied = state.history.versions.find((version) => version.revision === body.expectedRevision + 1);
  return Boolean(applied && applied.sourceKind === "restore" && applied.requestId === requestId && sameTeachingPriorityValues(applied.afterValues, desired));
}

function verifiesReceipt(state: CurrentState, receipt: TeachingPriorityMutationReceipt, desired: TeachingPriorityValues): boolean {
  if (state.priority.revision !== receipt.revision || state.priority.historyCount !== receipt.historyCount || !sameTeachingPriorityValues(state.values, desired)) return false;
  if (state.history.historyCount === 0) return true;
  const applied = state.history.versions.at(-1);
  return Boolean(applied && applied.revision === receipt.revision && applied.versionId === receipt.versionId
    && applied.sourceKind === "restore" && applied.requestId === receipt.requestId && sameTeachingPriorityValues(applied.afterValues, desired));
}

export async function GET(request: Request, { params }: { params: Promise<{ priorityId: string }> }) {
  if (!isApiRequestAllowed(request)) return errorResponse("forbidden", 403, "教学重点历史请求被拒绝");
  const priorityId = parseTeachingPriorityId((await params).priorityId);
  if (!priorityId) return errorResponse("invalid_request", 400, "教学重点身份无效");
  try {
    const state = await currentState(priorityId, request.signal);
    return state
      ? NextResponse.json({ history: state.history, data: state.data })
      : errorResponse("stale_priority", 409, "教学重点已更新，请重试");
  }
  catch (error) { return error instanceof TeachingPriorityError ? mapError(error) : errorResponse("unavailable", 503, "教学重点历史暂不可用"); }
}

export async function POST(request: Request, { params }: { params: Promise<{ priorityId: string }> }) {
  if (!isApiRequestAllowed(request)) return errorResponse("forbidden", 403, "教学重点恢复请求被拒绝");
  if (!hasJsonContentType(request)) return errorResponse("invalid_content_type", 415, "请使用 JSON");
  const priorityId = parseTeachingPriorityId((await params).priorityId);
  let body: TeachingPriorityRestoreBody | null = null;
  try { body = parseTeachingPriorityRestoreBody(await parseJsonWithinLimit(request, 4000)); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) return errorResponse("too_large", 413, "教学重点恢复请求过大"); }
  if (!priorityId || !body) return errorResponse("invalid_request", 400, "教学重点恢复请求无效");

  try {
    const initial = await currentState(priorityId);
    if (!initial) return errorResponse("stale_priority", 409, "教学重点已更新，请刷新后重试");
    const version = versionFor(initial.history, body.versionId);
    if (!version) return errorResponse("version_not_found", 404, "这个教学重点版本已不存在");
    const desired = desiredValues(version, body.versionSide);
    const requestId = teachingPriorityRestoreRequestId({ priorityId, ...body });
    if (ownedRestore(initial, body, requestId, desired)) return NextResponse.json({ result: null, data: initial.data, history: initial.history, reconciled: true });
    if (initial.priority.revision !== body.expectedRevision) return errorResponse("stale_priority", 409, "教学重点已更新，请刷新后重试");
    if (sameTeachingPriorityValues(initial.values, desired)) return errorResponse("version_already_current", 409, "当前教学重点已经是这个版本");

    let receipt: TeachingPriorityMutationReceipt;
    try { receipt = await restoreTeachingPriorityVersion({ priorityId, ...body, signal: request.signal }); }
    catch (error) {
      const reconciled = await currentState(priorityId).catch(() => null);
      if (reconciled && ownedRestore(reconciled, body, requestId, desired)) return NextResponse.json({ result: null, data: reconciled.data, history: reconciled.history, reconciled: true });
      throw error;
    }
    const verified = await currentState(priorityId);
    if (!verified || !verifiesReceipt(verified, receipt, desired)) return errorResponse("invalid_response", 502, "教学重点恢复结果未能与 Core 对账");
    return NextResponse.json({ result: receipt, data: verified.data, history: verified.history, reconciled: false });
  } catch (error) {
    return error instanceof TeachingPriorityError ? mapError(error) : errorResponse("unavailable", 503, "教学重点恢复暂不可用");
  }
}
