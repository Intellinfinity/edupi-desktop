import { NextResponse } from "next/server";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { readEducationContract, reviewTeacherContextCandidate } from "@/lib/edupi-education-server";
import type { EducationContract, EducationTeacherContextCandidate } from "@/lib/edupi-education-contract";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  TEACHER_CONTEXT_VERSION_FIELDS,
  TeacherContextVersionError,
  captureTeacherContextFieldRestore,
  confirmsTeacherContextFieldRestore,
  readTeacherContextVersions,
  teacherContextRestoreRequestId,
  type TeacherContextVersion,
  type TeacherContextVersionField,
  type TeacherContextVersionSide,
  type TeacherContextVersionValues,
} from "@/lib/edupi-teacher-context-versions";

export const dynamic = "force-dynamic";

type RestoreBody = {
  targetId: string;
  versionId: string;
  versionSide: TeacherContextVersionSide;
  fieldKey: TeacherContextVersionField;
  expectedSnapshotId: string;
  expectedRevision: number;
  expectedSourceId: string;
};

const BODY_KEYS = new Set(["targetId", "versionId", "versionSide", "fieldKey", "expectedSnapshotId", "expectedRevision", "expectedSourceId"]);
const FIELD_LABELS: Record<TeacherContextVersionField, string> = { name: "称呼", role: "身份", subject: "学科", grade: "年级", class_name: "班级" };

function text(value: unknown, maxLength = 160): string | null {
  return typeof value === "string" && value.trim() && value.length <= maxLength ? value.trim() : null;
}

function parseBody(value: unknown): RestoreBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length !== BODY_KEYS.size || Object.keys(source).some((key) => !BODY_KEYS.has(key))) return null;
  const targetId = text(source.targetId);
  const versionId = text(source.versionId);
  const expectedSnapshotId = text(source.expectedSnapshotId);
  const expectedSourceId = text(source.expectedSourceId);
  if (!targetId || !versionId || !expectedSnapshotId || !expectedSourceId || !["before", "after"].includes(String(source.versionSide))
    || !TEACHER_CONTEXT_VERSION_FIELDS.includes(source.fieldKey as TeacherContextVersionField)
    || !Number.isInteger(source.expectedRevision) || Number(source.expectedRevision) < 0) return null;
  return {
    targetId,
    versionId,
    versionSide: source.versionSide as TeacherContextVersionSide,
    fieldKey: source.fieldKey as TeacherContextVersionField,
    expectedSnapshotId,
    expectedRevision: Number(source.expectedRevision),
    expectedSourceId,
  };
}

function candidateFor(data: EducationContract, targetId: string): EducationTeacherContextCandidate | null {
  const matches = data.teacherContextCandidates.filter((candidate) => candidate.contextId === targetId);
  return matches.length === 1 ? matches[0] : null;
}

function versionFor(versions: TeacherContextVersion[], body: RestoreBody): TeacherContextVersion | null {
  const matches = versions.filter((version) => version.versionId === body.versionId && version.contextId === body.targetId);
  return matches.length === 1 ? matches[0] : null;
}

function valueAt(values: TeacherContextVersionValues, field: TeacherContextVersionField): string | null {
  return Object.hasOwn(values, field) ? values[field] ?? null : null;
}

function sameField(values: TeacherContextVersionValues, field: TeacherContextVersionField, expected: string | null): boolean {
  return valueAt(values, field) === expected;
}

function sameOtherFields(left: TeacherContextVersionValues, right: TeacherContextVersionValues, restoredField: TeacherContextVersionField): boolean {
  return TEACHER_CONTEXT_VERSION_FIELDS.every((field) => field === restoredField || valueAt(left, field) === valueAt(right, field));
}

function errorResponse(code: string, status: number, error: string) {
  return NextResponse.json({ error, code }, { status });
}

function mapVersionError(error: TeacherContextVersionError) {
  if (error.code === "version_not_found") return errorResponse(error.code, 404, error.message);
  if (["version_already_current", "stale_revision", "stale_context_source", "idempotency_conflict"].includes(error.code)) return errorResponse(error.code, 409, error.message);
  if (error.code === "invalid_response") return errorResponse(error.code, 502, error.message);
  return errorResponse(error.code, 503, error.message);
}

function isRestoredCandidate(candidate: EducationTeacherContextCandidate | null, body: RestoreBody, restoreSourceId: string, desiredValue: string | null): candidate is EducationTeacherContextCandidate {
  return Boolean(candidate && candidate.revision === body.expectedRevision + 1 && candidate.sourceIds.length === 1 && candidate.sourceIds[0] === restoreSourceId
    && sameField(candidate.currentValues, body.fieldKey, desiredValue));
}

async function readRestoredData(body: RestoreBody, restoreSourceId: string, desiredValue: string | null): Promise<EducationContract | null> {
  const [data, versions] = await Promise.all([readEducationContract(), readTeacherContextVersions()]);
  if (!isRestoredCandidate(candidateFor(data, body.targetId), body, restoreSourceId, desiredValue)) return null;
  if (!confirmsTeacherContextFieldRestore(versions, { contextId: body.targetId, revision: body.expectedRevision + 1, fieldKey: body.fieldKey, desiredValue })) return null;
  return data;
}

export async function GET() {
  try {
    return NextResponse.json({ versions: await readTeacherContextVersions() });
  } catch (error) {
    return error instanceof TeacherContextVersionError ? mapVersionError(error) : errorResponse("unavailable", 503, "教师资料版本暂不可用");
  }
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return errorResponse("invalid_request", 403, "请求无效");
  let body: RestoreBody | null = null;
  try { body = parseBody(await parseJsonWithinLimit(request, 4000)); }
  catch { /* handled below */ }
  if (!body) return errorResponse("invalid_request", 400, "恢复请求无效");

  try {
    const [data, versions] = await Promise.all([readEducationContract(), readTeacherContextVersions()]);
    const candidate = candidateFor(data, body.targetId);
    const version = versionFor(versions, body);
    if (!candidate || !version) return errorResponse("version_not_found", 404, "这个教师资料版本已不存在");
    const desiredValues = body.versionSide === "before" ? version.beforeValues : version.afterValues;
    const desiredValue = valueAt(desiredValues, body.fieldKey);
    const requestId = teacherContextRestoreRequestId({
      versionId: body.versionId,
      versionSide: body.versionSide,
      fieldKey: body.fieldKey,
      expectedRevision: body.expectedRevision,
      expectedSourceId: body.expectedSourceId,
    });
    const restoreSourceId = `desktop-version:${requestId}`;
    const initialState = candidate.revision === body.expectedRevision && candidate.snapshotId === body.expectedSnapshotId
      && candidate.sourceIds.length === 1 && candidate.sourceIds[0] === body.expectedSourceId;
    const ownedReplay = candidate.sourceIds.length === 1 && candidate.sourceIds[0] === restoreSourceId && candidate.revision >= body.expectedRevision;
    if (!initialState && !ownedReplay) return errorResponse("stale_revision", 409, "教师资料已更新，请刷新后重试");
    if (initialState && sameField(candidate.currentValues, body.fieldKey, desiredValue)) return errorResponse("version_already_current", 409, "这个字段已经是该历史值");

    const capture = await captureTeacherContextFieldRestore({
      versionId: body.versionId,
      versionSide: body.versionSide,
      fieldKey: body.fieldKey,
      expectedRevision: body.expectedRevision,
      expectedSourceId: body.expectedSourceId,
    });
    if (capture.requestId !== requestId || capture.contextId !== body.targetId) return errorResponse("invalid_response", 502, "Core 教师资料恢复响应无效");
    if (capture.alreadyApplied) {
      const restored = await readRestoredData(body, restoreSourceId, desiredValue);
      return restored ? NextResponse.json({ receipt: null, data: restored, reconciled: true }) : errorResponse("invalid_response", 502, "恢复结果未能与 Core 对账");
    }

    const capturedData = await readEducationContract();
    const capturedCandidate = candidateFor(capturedData, body.targetId);
    if (isRestoredCandidate(capturedCandidate, body, restoreSourceId, desiredValue)
      && sameOtherFields(capturedCandidate.currentValues, candidate.currentValues, body.fieldKey)) {
      const restored = await readRestoredData(body, restoreSourceId, desiredValue);
      return restored ? NextResponse.json({ receipt: null, data: restored, reconciled: true }) : errorResponse("invalid_response", 502, "恢复结果未能与 Core 对账");
    }
    if (!capturedCandidate || capturedCandidate.revision !== body.expectedRevision || capturedCandidate.sourceIds.length !== 1 || capturedCandidate.sourceIds[0] !== restoreSourceId
      || !sameField(capturedCandidate.proposedValues, body.fieldKey, desiredValue)
      || !sameOtherFields(capturedCandidate.proposedValues, candidate.currentValues, body.fieldKey)) {
      return errorResponse("stale_context_source", 409, "教师资料来源已更新，请刷新后重试");
    }

    try {
      const result = await reviewTeacherContextCandidate({
        targetId: body.targetId,
        expectedSnapshotId: capturedCandidate.snapshotId,
        expectedRevision: body.expectedRevision,
        decision: "accept",
        patch: null,
        note: `恢复${FIELD_LABELS[body.fieldKey]}至版本 ${version.revision} 的${body.versionSide === "before" ? "旧值" : "新值"}`,
        reviewerId: "teacher",
      });
      const restoredCandidate = candidateFor(result.data, body.targetId);
      if (!restoredCandidate || restoredCandidate.revision !== body.expectedRevision + 1 || restoredCandidate.sourceIds.length !== 1 || restoredCandidate.sourceIds[0] !== restoreSourceId
        || !sameField(restoredCandidate.currentValues, body.fieldKey, desiredValue)
        || !sameOtherFields(restoredCandidate.currentValues, candidate.currentValues, body.fieldKey)) {
        return errorResponse("invalid_response", 502, "恢复结果未能与 Core 对账");
      }
      const verified = await readRestoredData(body, restoreSourceId, desiredValue);
      return verified ? NextResponse.json({ receipt: result.receipt, data: verified, reconciled: false }) : errorResponse("invalid_response", 502, "恢复结果未能与 Core 对账");
    } catch {
      const replay = await captureTeacherContextFieldRestore({
        versionId: body.versionId,
        versionSide: body.versionSide,
        fieldKey: body.fieldKey,
        expectedRevision: body.expectedRevision,
        expectedSourceId: body.expectedSourceId,
      });
      if (!replay.alreadyApplied) return errorResponse("unavailable", 503, "教师资料恢复暂不可用");
      const restored = await readRestoredData(body, restoreSourceId, desiredValue);
      return restored ? NextResponse.json({ receipt: null, data: restored, reconciled: true }) : errorResponse("invalid_response", 502, "恢复结果未能与 Core 对账");
    }
  } catch (error) {
    return error instanceof TeacherContextVersionError ? mapVersionError(error) : errorResponse("unavailable", 503, "教师资料恢复暂不可用");
  }
}
