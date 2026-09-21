import { NextResponse } from "next/server";
import {
  C1ReviewError,
  C1_REVIEW_DECISIONS,
  type C1ReviewDecision,
  type C1ReviewTargetKind,
} from "@/lib/edupi-c1-review";
import {
  FollowUpReviewError,
  FOLLOW_UP_REVIEW_DECISIONS,
  type FollowUpReviewDecision,
} from "@/lib/edupi-follow-up-review";
import { reviewEducationCandidate, reviewFollowUpCandidate } from "@/lib/edupi-education-server";
import { EduPiSnapshotError } from "@/lib/edupi-core-snapshot";

export const dynamic = "force-dynamic";

type RawRecord = Record<string, unknown>;

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function bodyError(reason: string): NextResponse {
  return NextResponse.json({ error: "invalid_review_request", code: "invalid_envelope", reason }, { status: 400 });
}

function errorCode(error: unknown): string {
  if (error instanceof C1ReviewError) return error.code;
  if (error instanceof FollowUpReviewError) return error.code;
  if (error instanceof EduPiSnapshotError && error.code === "stale_snapshot") return "stale_snapshot";
  return "unavailable";
}

function errorStatus(code: string): number {
  const conflictStatus = { status: 409 }.status;
  const unavailableStatus = { status: 503 }.status;
  const statusByCode: Record<string, number> = {
    invalid_envelope: 400,
    stale_snapshot: conflictStatus,
    stale_revision: conflictStatus,
    unsupported_command: unavailableStatus,
    unavailable: unavailableStatus,
  };
  return statusByCode[code] || 503;
}

function errorReason(code: string): string {
  if (code === "stale_snapshot") return "Core 教育快照已变化，请刷新后重试。";
  if (code === "stale_revision") return "该审核目标已被更新，请刷新后重试。";
  if (code === "unsupported_command") return "Core 尚未启用该审核命令。";
  if (code === "invalid_envelope") return "审核请求或 Core 回执无效。";
  return "Core 教育审核暂不可用。";
}

export async function POST(request: Request) {
  let body: RawRecord | null;
  try {
    body = record(await request.json());
  } catch {
    return bodyError("请求必须是有效的 JSON 对象。");
  }
  if (!body) return bodyError("请求必须是有效的 JSON 对象。");

  const targetKind = body.targetKind;
  if (targetKind !== "observation" && targetKind !== "memory_candidate" && targetKind !== "follow_up") {
    return bodyError("targetKind 仅支持 observation、memory_candidate 或 follow_up。");
  }
  const targetId = body.targetId;
  if (typeof targetId !== "string" || !targetId.trim() || targetId.length > 160) {
    return bodyError("targetId 无效。");
  }
  const decision = body.decision;
  const allowedDecisions = targetKind === "follow_up" ? FOLLOW_UP_REVIEW_DECISIONS : C1_REVIEW_DECISIONS;
  if (!(allowedDecisions as readonly string[]).includes(typeof decision === "string" ? decision : "")) {
    return bodyError("decision 仅支持 accept、modify、reject、hold。");
  }
  if (body.patch !== undefined && body.patch !== null && !record(body.patch)) return bodyError("patch 无效。");
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") return bodyError("note 无效。");
  const reviewer = body.reviewerId ?? body.reviewer;
  if (typeof reviewer !== "string" || !reviewer.trim() || reviewer.length > 160) return bodyError("reviewerId 无效。");
  if (body.issuedAt !== undefined && (typeof body.issuedAt !== "string" || !body.issuedAt.trim() || body.issuedAt.length > 64)) {
    return bodyError("issuedAt 无效。");
  }
  if (targetKind === "follow_up") {
    if (typeof body.expectedSnapshotId !== "string" || !body.expectedSnapshotId.trim() || body.expectedSnapshotId.length > 160) return bodyError("expectedSnapshotId 无效。");
    if (typeof body.expectedRevision !== "number" || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) return bodyError("expectedRevision 无效。");
  }

  try {
    if (targetKind === "follow_up") {
      const { receipt, data } = await reviewFollowUpCandidate({
        targetId: targetId.trim(),
        expectedSnapshotId: (body.expectedSnapshotId as string).trim(),
        expectedRevision: body.expectedRevision as number,
        decision: decision as FollowUpReviewDecision,
        patch: body.patch as Record<string, unknown> | null | undefined,
        note: body.note as string | null | undefined,
        reviewerId: reviewer.trim(),
        issuedAt: body.issuedAt as string | undefined,
      });
      return NextResponse.json({ receipt, data }, { status: 200 });
    }
    // reviewEducationCandidate is the server boundary that delegates to the
    // typed issueC1Review path; no Desktop state is written here.
    const { receipt, data } = await reviewEducationCandidate({
      targetKind: targetKind as C1ReviewTargetKind,
      targetId: targetId.trim(),
      decision: decision as C1ReviewDecision,
      patch: body.patch as Record<string, unknown> | null | undefined,
      note: body.note as string | null | undefined,
      reviewerId: reviewer.trim(),
      issuedAt: body.issuedAt as string | undefined,
    });
    return NextResponse.json({ receipt, data }, { status: 200 });
  } catch (error) {
    const code = errorCode(error);
    return NextResponse.json({ error: code, code, reason: errorReason(code) }, { status: errorStatus(code) });
  }
}
