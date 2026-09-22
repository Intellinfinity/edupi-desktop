import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { hasJsonContentType } from "@/lib/request-security";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { ensureEduPiRuntime } from "@/lib/edupi-runtime-supervisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FeedbackAction = "bootstrap" | "read" | "target_read" | "record";
const ACTIONS = new Set<FeedbackAction>(["bootstrap", "read", "target_read", "record"]);
const MAX_BODY_BYTES = 32 * 1024;
const FEEDBACK_RECORD_KEYS = new Set([
  "command_id", "session_id", "evidence_level", "domain", "scope", "signal", "target", "decision",
  "usefulness", "used", "would_use_again", "baseline_minutes", "review_minutes", "issue_codes", "note",
  "evidence_ids", "occurred_at", "supersedes_feedback_id",
]);

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message, externalSend: false }, { status });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function feedbackFailure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

async function runtimeContext() {
  const roots = resolveEduPiBridgeRoots();
  const host = await ensureEduPiRuntime(roots);
  const health = await host.call("health", null);
  const result = health.result && typeof health.result === "object" && !Array.isArray(health.result) ? health.result as Record<string, unknown> : null;
  const rootRef = typeof result?.data_root_fingerprint === "string" ? result.data_root_fingerprint : null;
  if (!rootRef) throw new Error("feedback_runtime_unavailable");
  return { host, rootRef };
}

async function ownerSnapshot(host: Awaited<ReturnType<typeof runtimeContext>>["host"]) {
  const response = await host.call("owner_read", {});
  const result = response.result && typeof response.result === "object" && !Array.isArray(response.result) ? response.result as Record<string, unknown> : null;
  const owner = result?.owner && typeof result.owner === "object" && !Array.isArray(result.owner) ? result.owner as Record<string, unknown> : null;
  const ownerId = typeof owner?.id === "string" ? owner.id : null;
  const rootRef = typeof result?.root_ref === "string" ? result.root_ref : null;
  return { result, ownerId, rootRef };
}

async function bootstrap() {
  const { host, rootRef } = await runtimeContext();
  const response = await host.callOwnerControl("owner_control", {
    command_id: `desktop-owner-bootstrap-${randomUUID()}`,
    root_ref: rootRef,
    expected_owner_id: null,
    action: "bootstrap",
  });
  return response;
}

async function bindFeedbackRecord(host: Awaited<ReturnType<typeof runtimeContext>>["host"], owner: { ownerId: string; rootRef: string }, value: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (Object.keys(value).some((key) => !FEEDBACK_RECORD_KEYS.has(key))) throw feedbackFailure("invalid_feedback", "反馈记录字段无效");
  if (value.signal !== "surfaced" && value.signal !== "missed") throw feedbackFailure("invalid_feedback", "反馈信号无效");
  const target = asRecord(value.target);
  if (!target || typeof target.kind !== "string" || typeof target.target_id !== "string") throw feedbackFailure("invalid_feedback", "反馈目标无效");
  if (value.signal === "missed") {
    if (target.kind !== "missed_opportunity") throw feedbackFailure("invalid_feedback", "漏报反馈目标无效");
    return { ...value, root_ref: owner.rootRef, expected_owner_id: owner.ownerId };
  }
  if (target.kind === "missed_opportunity") throw feedbackFailure("invalid_feedback", "已出现事项不能标记为漏报");
  const resolvedResponse = await host.callOwnerControl("teacher_feedback_target_read", {
    root_ref: owner.rootRef,
    expected_owner_id: owner.ownerId,
    target: { kind: target.kind, target_id: target.target_id },
  });
  if (resolvedResponse.ok !== true) throw feedbackFailure(String(resolvedResponse.error_code || "teacher_feedback_target_missing"), "反馈目标已失效，请刷新后重试");
  const resolved = asRecord(resolvedResponse.result);
  if (!resolved || typeof resolved.kind !== "string" || typeof resolved.target_id !== "string"
    || !Number.isSafeInteger(resolved.revision) || typeof resolved.fingerprint !== "string"
    || !Array.isArray(resolved.evidence_ids) || resolved.evidence_ids.length === 0) {
    throw feedbackFailure("teacher_feedback_target_stale", "反馈目标无法重新核对");
  }
  const resolvedEvidence = resolved.evidence_ids.filter((item): item is string => typeof item === "string");
  if (resolvedEvidence.length === 0) throw feedbackFailure("teacher_feedback_target_stale", "反馈目标缺少证据");
  const suppliedEvidence = Array.isArray(value.evidence_ids) ? value.evidence_ids.filter((item): item is string => typeof item === "string") : [];
  const evidenceIds = suppliedEvidence.length > 0 ? suppliedEvidence : resolvedEvidence;
  if (!evidenceIds.some((item) => resolvedEvidence.includes(item))) throw feedbackFailure("teacher_feedback_target_stale", "反馈证据与当前目标不匹配");
  return {
    ...value,
    target: { kind: resolved.kind, target_id: resolved.target_id, expected_revision: resolved.revision, expected_fingerprint: resolved.fingerprint },
    evidence_ids: evidenceIds,
    root_ref: owner.rootRef,
    expected_owner_id: owner.ownerId,
  };
}

export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return jsonError("请求无效", 403);
  try {
    const { host } = await runtimeContext();
    const owner = await ownerSnapshot(host);
    if (!owner.ownerId || !owner.rootRef) return NextResponse.json({ ok: true, ready: false, reason: "owner_uninitialized", externalSend: false }, { status: 409 });
    const response = await host.callOwnerControl("teacher_feedback_read", { root_ref: owner.rootRef, expected_owner_id: owner.ownerId });
    return NextResponse.json({ ok: response.ok === true, ready: true, result: response.result ?? null, errorCode: response.error_code ?? null, externalSend: false });
  } catch {
    return jsonError("反馈 Runtime 暂不可用，请先开启主动运行", 503);
  }
}

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request) || !hasJsonContentType(request)) return jsonError("请求无效", 403);
  try {
    const body = asRecord(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    if (!body) return jsonError("反馈操作无效", 400);
    const action = body.action;
    if (typeof action !== "string" || !ACTIONS.has(action as FeedbackAction) || Object.keys(body).some((key) => !["action", "target", "record", "session_id", "domain"].includes(key))) return jsonError("反馈操作无效", 400);
    if (action === "bootstrap") {
      if (Object.keys(body).length !== 1) return jsonError("反馈初始化参数无效", 400);
      return NextResponse.json({ ...(await bootstrap()), external_send: false });
    }
    const { host } = await runtimeContext();
    const owner = await ownerSnapshot(host);
    if (!owner.ownerId || !owner.rootRef) return NextResponse.json({ ok: false, ready: false, errorCode: "owner_uninitialized", externalSend: false }, { status: 409 });
    const boundOwner = { ownerId: owner.ownerId, rootRef: owner.rootRef };
    if (action === "target_read") {
      if (!body.target || typeof body.target !== "object" || Array.isArray(body.target)) return jsonError("反馈目标无效", 400);
      const response = await host.callOwnerControl("teacher_feedback_target_read", { root_ref: owner.rootRef, expected_owner_id: owner.ownerId, target: body.target });
      return NextResponse.json({ ok: response.ok === true, ready: true, result: response.result ?? null, errorCode: response.error_code ?? null, externalSend: false });
    }
    if (action === "read") {
      const payload: Record<string, unknown> = { root_ref: owner.rootRef, expected_owner_id: owner.ownerId };
      if (body.session_id !== undefined) payload.session_id = body.session_id;
      if (body.domain !== undefined) payload.domain = body.domain;
      const response = await host.callOwnerControl("teacher_feedback_read", payload);
      return NextResponse.json({ ok: response.ok === true, ready: true, result: response.result ?? null, errorCode: response.error_code ?? null, externalSend: false });
    }
    if (!body.record || typeof body.record !== "object" || Array.isArray(body.record)) return jsonError("反馈记录无效", 400);
    const record = await bindFeedbackRecord(host, boundOwner, body.record as Record<string, unknown>);
    const response = await host.callOwnerControl("teacher_feedback_record", record);
    return NextResponse.json({ ok: response.ok === true, ready: true, result: response.result ?? null, errorCode: response.error_code ?? null, externalSend: false });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return jsonError("反馈内容过大", 413);
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "feedback_runtime_unavailable";
    const status = code === "invalid_feedback" ? 400 : code.includes("stale") || code.includes("missing") ? 409 : 503;
    return NextResponse.json({ ok: false, error: code === "invalid_feedback" ? "反馈记录无效" : "反馈 Runtime 暂不可用", errorCode: code, externalSend: false }, { status });
  }
}
