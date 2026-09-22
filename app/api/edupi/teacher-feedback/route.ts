import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { hasJsonContentType } from "@/lib/request-security";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { asRecord, bindFeedbackRecord } from "@/lib/edupi-teacher-feedback-binding";
import { ensureEduPiRuntime } from "@/lib/edupi-runtime-supervisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FeedbackAction = "bootstrap" | "read" | "target_read" | "record";
const ACTIONS = new Set<FeedbackAction>(["bootstrap", "read", "target_read", "record"]);
const MAX_BODY_BYTES = 32 * 1024;

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message, externalSend: false }, { status });
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
