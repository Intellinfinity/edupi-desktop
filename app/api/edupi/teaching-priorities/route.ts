import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { readEducationContract } from "@/lib/edupi-education-server";
import type { EducationTeachingPriority } from "@/lib/edupi-education-contract";
import { parseTeachingPriorityCreateBody, parseTeachingPriorityUpdateBody } from "@/lib/edupi-teaching-priority-request";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  TeachingPriorityError,
  createTeachingPriority,
  updateTeachingPriority,
  type TeachingPriorityMutationReceipt,
  type TeachingPriorityValues,
} from "@/lib/edupi-teaching-priorities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, status: number, error: string) {
  return NextResponse.json({ code, error }, { status });
}

function mapError(error: TeachingPriorityError) {
  if (error.code === "invalid_request" || error.code === "invalid_priority") return errorResponse(error.code, 400, error.message);
  if (error.code === "priority_not_found" || error.code === "version_not_found") return errorResponse(error.code, 404, error.message);
  if (error.code === "priority_deleted") return errorResponse(error.code, 410, error.message);
  if (["priority_conflict", "stale_priority", "version_already_current", "idempotency_conflict"].includes(error.code)) return errorResponse(error.code, 409, error.message);
  if (["priority_capacity", "priority_storage_capacity", "priority_history_capacity"].includes(error.code)) return errorResponse(error.code, 413, error.message);
  if (error.code === "invalid_response") return errorResponse(error.code, 502, error.message);
  return errorResponse(error.code, 503, error.message);
}

function priorityFor(priorities: EducationTeachingPriority[], priorityId: string): EducationTeachingPriority | null {
  const matches = priorities.filter((priority) => priority.id === priorityId);
  return matches.length === 1 ? matches[0] : null;
}

function patchMatches(priority: EducationTeachingPriority, patch: Partial<TeachingPriorityValues>): boolean {
  return (!Object.hasOwn(patch, "subject") || priority.subject === patch.subject)
    && (!Object.hasOwn(patch, "className") || priority.className === patch.className)
    && (!Object.hasOwn(patch, "topic") || priority.topic === patch.topic)
    && (!Object.hasOwn(patch, "note") || priority.note === patch.note)
    && (!Object.hasOwn(patch, "status") || priority.status === patch.status);
}

function verifyCurrent(priority: EducationTeachingPriority | null, receipt: TeachingPriorityMutationReceipt, patch?: Partial<TeachingPriorityValues>): priority is EducationTeachingPriority {
  return Boolean(priority && priority.revision === receipt.revision && priority.historyCount === receipt.historyCount && (!patch || patchMatches(priority, patch)));
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return errorResponse("forbidden", 403, "教学重点请求被拒绝");
  if (!hasJsonContentType(request)) return errorResponse("invalid_content_type", 415, "请使用 JSON");
  try {
    const body = parseTeachingPriorityCreateBody(await parseJsonWithinLimit(request, 8 * 1024));
    if (!body) return errorResponse("invalid_request", 400, "教学重点字段无效");
    const receipt = await createTeachingPriority({ ...body, signal: request.signal });
    const data = await readEducationContract();
    const current = priorityFor(data.continuity.teachingPriorities, receipt.priorityId);
    if (!verifyCurrent(current, receipt, { ...body, status: "active" })) {
      if (receipt.replayed) return errorResponse("priority_conflict", 409, "同一教学重点已存在或状态已变化，请查看现有重点或删除记录");
      return errorResponse("invalid_response", 502, "教学重点结果未能与 Core 对账");
    }
    return NextResponse.json({ result: receipt, data });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return errorResponse("too_large", 413, "教学重点内容过大");
    return error instanceof TeachingPriorityError ? mapError(error) : errorResponse("unavailable", 503, "教学重点暂不可用");
  }
}

export async function PUT(request: Request) {
  if (!isApiRequestAllowed(request)) return errorResponse("forbidden", 403, "教学重点请求被拒绝");
  if (!hasJsonContentType(request)) return errorResponse("invalid_content_type", 415, "请使用 JSON");
  try {
    const body = parseTeachingPriorityUpdateBody(await parseJsonWithinLimit(request, 8 * 1024));
    if (!body) return errorResponse("invalid_request", 400, "教学重点修改字段无效");
    const receipt = await updateTeachingPriority({ ...body, signal: request.signal });
    const data = await readEducationContract();
    const current = priorityFor(data.continuity.teachingPriorities, receipt.priorityId);
    if (!verifyCurrent(current, receipt, body.patch)) return errorResponse("invalid_response", 502, "教学重点修改结果未能与 Core 对账");
    return NextResponse.json({ result: receipt, data });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return errorResponse("too_large", 413, "教学重点内容过大");
    return error instanceof TeachingPriorityError ? mapError(error) : errorResponse("unavailable", 503, "教学重点修改暂不可用");
  }
}
