import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { ensureEduPiRuntime } from "@/lib/edupi-runtime-supervisor";
import { hasJsonContentType } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFLICT_ID = /^schedule_conflict_[a-f0-9]{32}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]*$/;
const DECISIONS = new Set(["keep_existing", "replace_with_candidate", "keep_both_distinct"]);
const RESOLVE_KEYS = ["action", "commandId", "conflictId", "kind", "canonicalId", "expectedRevision", "expectedContentHash", "expectedConflictHash", "decision"];

function errorResponse(code: string, status: number) {
  return NextResponse.json({ ok: false, errorCode: code, externalSend: false }, { status });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validResolution(body: Record<string, unknown>): boolean {
  return Object.keys(body).length === RESOLVE_KEYS.length && RESOLVE_KEYS.every((key) => Object.hasOwn(body, key))
    && typeof body.commandId === "string" && body.commandId.length <= 160 && ID.test(body.commandId)
    && typeof body.conflictId === "string" && CONFLICT_ID.test(body.conflictId)
    && (body.kind === "calendar" || body.kind === "timetable")
    && typeof body.canonicalId === "string" && body.canonicalId.length > 0 && body.canonicalId.length <= 160
    && Number.isSafeInteger(body.expectedRevision) && Number(body.expectedRevision) >= 1
    && typeof body.expectedContentHash === "string" && HASH.test(body.expectedContentHash)
    && typeof body.expectedConflictHash === "string" && HASH.test(body.expectedConflictHash)
    && typeof body.decision === "string" && DECISIONS.has(body.decision);
}

async function runtimeContext() {
  const host = await ensureEduPiRuntime(resolveEduPiBridgeRoots());
  const health = await host.call("health", null);
  const rootRef = record(health.result)?.data_root_fingerprint;
  if (typeof rootRef !== "string" || !HASH.test(rootRef)) throw new Error("schedule_conflict_unavailable");
  return { host, rootRef };
}

async function ownerContext(context: Awaited<ReturnType<typeof runtimeContext>>) {
  const response = await context.host.callOwnerControl("owner_read", {});
  const result = record(response.result);
  const ownerId = record(result?.owner)?.id;
  return typeof ownerId === "string" && result?.root_ref === context.rootRef ? ownerId : null;
}

function statusFor(code: string): number {
  if (code === "schedule_conflict_invalid") return 400;
  if (["schedule_conflict_stale", "schedule_conflict_source_deleted", "schedule_conflict_replay_mismatch"].includes(code)) return 409;
  if (code === "owner_identity_mismatch" || code === "owner_control_required") return 403;
  return 503;
}

function unavailableCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error && error.code === "owner_control_credential_unavailable"
    ? "owner_control_credential_unavailable" : "schedule_conflict_unavailable";
}

export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return errorResponse("forbidden", 403);
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit");
  const after = params.get("after");
  if ([...params.keys()].some((key) => key !== "limit" && key !== "after")
    || rawLimit !== null && (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)
    || after !== null && !CONFLICT_ID.test(after)) return errorResponse("schedule_conflict_invalid", 400);
  try {
    const context = await runtimeContext();
    const ownerId = await ownerContext(context);
    if (!ownerId) return errorResponse("owner_uninitialized", 409);
    const response = await context.host.callOwnerControl("schedule_conflicts_read", {
      root_ref: context.rootRef, expected_owner_id: ownerId,
      ...(rawLimit !== null ? { limit: Number(rawLimit) } : {}),
      ...(after !== null ? { after } : {}),
    });
    if (response.ok !== true) return errorResponse(String(response.error_code || "schedule_conflict_unavailable"), statusFor(String(response.error_code)));
    return NextResponse.json({ ok: true, result: response.result, externalSend: false });
  } catch (error) {
    return errorResponse(unavailableCode(error), 503);
  }
}

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return errorResponse("forbidden", 403);
  if (!hasJsonContentType(request)) return errorResponse("schedule_conflict_invalid", 415);
  try {
    const body = record(await parseJsonWithinLimit(request, 4 * 1024));
    if (!body || body.action !== "bootstrap" && (body.action !== "resolve" || !validResolution(body))
      || body.action === "bootstrap" && Object.keys(body).length !== 1) return errorResponse("schedule_conflict_invalid", 400);
    const context = await runtimeContext();
    if (body.action === "bootstrap") {
      const response = await context.host.callOwnerControl("owner_control", {
        command_id: `desktop-schedule-bootstrap-${randomUUID()}`, root_ref: context.rootRef, expected_owner_id: null, action: "bootstrap",
      });
      return response.ok === true ? NextResponse.json({ ok: true, externalSend: false })
        : errorResponse(String(response.error_code || "schedule_conflict_unavailable"), statusFor(String(response.error_code)));
    }
    const ownerId = await ownerContext(context);
    if (!ownerId) return errorResponse("owner_uninitialized", 409);
    const response = await context.host.callOwnerControl("schedule_conflict_resolve", {
      command_id: body.commandId, root_ref: context.rootRef, expected_owner_id: ownerId,
      conflict_id: body.conflictId, kind: body.kind, canonical_id: body.canonicalId,
      expected_revision: body.expectedRevision, expected_content_hash: body.expectedContentHash,
      expected_conflict_hash: body.expectedConflictHash, decision: body.decision,
    });
    if (response.ok !== true) return errorResponse(String(response.error_code || "schedule_conflict_unavailable"), statusFor(String(response.error_code)));
    return NextResponse.json({ ok: true, result: response.result, externalSend: false });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return errorResponse("schedule_conflict_invalid", 413);
    return errorResponse(unavailableCode(error), 503);
  }
}
