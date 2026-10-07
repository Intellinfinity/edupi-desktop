import { NextResponse } from "next/server";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { getPendingEduPiRuntime } from "@/lib/edupi-runtime-supervisor";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { hasJsonContentType } from "@/lib/request-security";
import { decodePreparationExecution, PreparationExecutionError } from "@/lib/edupi-preparation-execution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HASH = /^sha256:[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/;
const CODES = new Set(["forbidden", "invalid_request", "invalid_response", "unsupported_operation", "runtime_unavailable", "activation_pending",
  "owner_control_disabled", "owner_control_required", "owner_identity_mismatch", "permission_denied", "stale_revision", "stale_source", "stale_binding",
  "invalid_candidate", "invalid_claim", "attempts_exhausted", "budget_exhausted", "source_unavailable", "excerpt_unconfirmed"]);
type RecordValue = Record<string, unknown>;
type RouteContext = { params: Promise<{ taskId: string }> };
const record = (value: unknown): RecordValue | null => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
function fail(code: string): never { throw new PreparationExecutionError(CODES.has(code) ? code : "unavailable"); }
const validRevision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function error(code: string, status = 503) { return NextResponse.json({ ok: false, errorCode: code, externalSend: false }, { status }); }
function caught(value: unknown) {
  const code = value instanceof PreparationExecutionError ? value.code : "unavailable";
  return error(code, ["forbidden", "owner_control_required", "owner_identity_mismatch", "permission_denied"].includes(code) ? 403
    : ["stale_revision", "stale_source", "stale_binding"].includes(code) ? 409 : code === "invalid_request" ? 400 : 503);
}
async function context(signal: AbortSignal) {
  const roots = resolveEduPiBridgeRoots(), pending = getPendingEduPiRuntime(roots.dataRoot.root);
  if (!pending) fail("runtime_unavailable");
  const host = await pending;
  const health = await host.call("health", null, signal), result = record(health.result);
  const rootRef = result?.data_root_fingerprint, operations = record(result?.capabilities)?.supported_operations;
  if (health.ok !== true || typeof rootRef !== "string" || !HASH.test(rootRef)) fail("runtime_unavailable");
  if (!Array.isArray(operations) || !operations.includes("preparation_execution_read")) fail("unsupported_operation");
  const authorization = await host.callOwnerControl("owner_read", {}, signal);
  if (authorization.ok !== true) fail(String(authorization.error_code));
  const ownerResult = record(authorization.result), owner = record(ownerResult?.owner), ownerId = owner?.id;
  if (ownerResult?.root_ref !== rootRef || typeof ownerId !== "string" || !ID.test(ownerId)) fail("owner_identity_mismatch");
  return { host, rootRef, ownerId };
}
async function read(current: Awaited<ReturnType<typeof context>>, taskId: string, revision: number, signal: AbortSignal, sourceRevision?: string) {
  const response = await current.host.callOwnerControl("preparation_execution_read", { root_ref: current.rootRef, expected_owner_id: current.ownerId,
    task_id: taskId, expected_task_revision: revision, ...(sourceRevision === undefined ? {} : { expected_source_revision: sourceRevision }) }, signal);
  if (response.ok !== true) fail(String(response.error_code));
  return decodePreparationExecution(response.result, { taskId, revision, rootRef: current.rootRef, ownerId: current.ownerId });
}
export async function GET(request: Request, route: RouteContext) {
  if (!isDesktopApiRequestAllowed(request)) return error("forbidden", 403);
  const { taskId } = await route.params, params = new URL(request.url).searchParams, rawRevision = params.get("revision");
  const revision = rawRevision && /^\d+$/.test(rawRevision) ? Number(rawRevision) : NaN;
  if (!ID.test(taskId) || !validRevision(revision) || params.getAll("revision").length !== 1 || [...params.keys()].some(key => key !== "revision")) return error("invalid_request", 400);
  try { return NextResponse.json({ ok: true, result: await read(await context(request.signal), taskId, revision, request.signal), externalSend: false }, { headers: { "Cache-Control": "no-store" } }); }
  catch (value) { return caught(value); }
}
export async function POST(request: Request, route: RouteContext) {
  if (!isDesktopApiRequestAllowed(request)) return error("forbidden", 403);
  if (!hasJsonContentType(request)) return error("invalid_request", 415);
  try {
    const { taskId } = await route.params, body = record(await parseJsonWithinLimit(request, 4096));
    const keys = ["action", "eventId", "attempt", "revision", "sourceRevision"];
    if (!ID.test(taskId) || !body || Object.keys(body).length !== keys.length || !keys.every(key => Object.hasOwn(body, key))
      || !["cancel", "retry"].includes(String(body.action)) || typeof body.eventId !== "string" || !ID.test(body.eventId)
      || !validRevision(body.revision) || !validRevision(body.attempt) || body.attempt > 3 || typeof body.sourceRevision !== "string" || !HASH.test(body.sourceRevision)) return error("invalid_request", 400);
    const current = await context(request.signal), fresh = await read(current, taskId, body.revision, request.signal, body.sourceRevision);
    const action = body.action as "cancel" | "retry";
    if (!fresh.source_current || fresh.event_id !== body.eventId || fresh.attempt !== body.attempt || !fresh.actions[action]) fail("stale_binding");
    const response = await current.host.callOwnerControl(action === "cancel" ? "cancel_preparation" : "retry_preparation",
      action === "cancel" ? { event_id: fresh.event_id } : { event_id: fresh.event_id, expected_attempt: fresh.attempt }, request.signal);
    if (response.ok !== true) fail(String(response.error_code));
    const result = record(response.result);
    if (!result || result.event_id !== fresh.event_id || result.state !== (action === "cancel" ? "cancelled" : "queued")) fail("invalid_response");
    return NextResponse.json({ ok: true, result, externalSend: false });
  } catch (value) { return caught(value); }
}
