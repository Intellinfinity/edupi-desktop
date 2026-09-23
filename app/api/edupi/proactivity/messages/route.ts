import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { captureAndApplyAmbientMessage, EduPiAmbientMessageError } from "@/lib/edupi-ambient-message-runtime";
import { confirmEduPiAmbientMessageBinding, prepareEduPiAmbientMessageBinding } from "@/lib/edupi-ambient-message-ledger";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { readEduPiProactivityActivation } from "@/lib/edupi-proactivity-config";
import { readProactivityOwnerContext } from "@/lib/edupi-proactivity-runtime";
import { ensureEduPiRuntime } from "@/lib/edupi-runtime-supervisor";
import { resolveSessionPath } from "@/lib/session-reader";
import { withEduPiAmbientSessionLock } from "@/lib/edupi-ambient-session-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 16 * 1024;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ status: "rejected", externalSend: false }, { status: 403 });
  try {
    const roots = resolveEduPiBridgeRoots();
    const activation = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root });
    if (!activation.enabled || !activation.grantId || !activation.scope) {
      return NextResponse.json({ status: "disabled", externalSend: false });
    }
    const host = await ensureEduPiRuntime(roots);
    const health = record((await host.call("health", null)).result);
    const capabilities = record(health?.capabilities);
    const rootRef = health?.data_root_fingerprint;
    if (typeof rootRef !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(rootRef)
      || capabilities?.ambient_planning !== "active" || capabilities?.owner_intent !== "active") throw new Error("runtime unavailable");
    const context = await readProactivityOwnerContext(host, rootRef, activation.grantId);
    return NextResponse.json({ status: context?.status === "active" ? "enabled" : "disabled", externalSend: false });
  } catch {
    return NextResponse.json({ status: "unavailable", externalSend: false }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ status: "rejected", externalSend: false }, { status: 403 });
  try {
    const roots = resolveEduPiBridgeRoots();
    const activation = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root });
    if (!activation.enabled) return NextResponse.json({ status: "disabled", externalSend: false }, { status: 202 });
    if (!activation.grantId || !activation.scope) return NextResponse.json({ status: "unconfigured", externalSend: false }, { status: 409 });
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    if (!body || Object.keys(body).length !== 4 || !Object.hasOwn(body, "sessionId") || !Object.hasOwn(body, "messageId") || !Object.hasOwn(body, "text") || !Object.hasOwn(body, "occurredAt")
      || typeof body.sessionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,255}$/u.test(body.sessionId)
      || typeof body.messageId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,127}$/u.test(body.messageId)
      || typeof body.text !== "string" || !body.text.trim() || body.text.length > 4000
      || typeof body.occurredAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(body.occurredAt)) {
      return NextResponse.json({ status: "invalid", externalSend: false }, { status: 400 });
    }
    const sessionId = body.sessionId;
    const messageId = body.messageId;
    const text = body.text;
    const occurredAt = body.occurredAt;
    const grantId = activation.grantId;
    const scope = activation.scope;
    return await withEduPiAmbientSessionLock(sessionId, async () => {
      if (!await resolveSessionPath(sessionId)) {
        return NextResponse.json({ status: "session_unavailable", externalSend: false }, { status: 409 });
      }
      const host = await ensureEduPiRuntime(roots);
      const health = record((await host.call("health", null)).result);
      const capabilities = record(health?.capabilities);
      const rootRef = health?.data_root_fingerprint;
      if (typeof rootRef !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(rootRef)
        || capabilities?.ambient_planning !== "active" || capabilities?.owner_intent !== "active") {
        throw new EduPiAmbientMessageError("proactivity_runtime_unavailable");
      }
      const result = await captureAndApplyAmbientMessage(host, {
        rootRef,
        grantId,
        messageId,
        text,
        occurredAt,
      }, { controlScope: { classId: scope.classId, subject: scope.subject },
        onPrepared: async (binding) => {
          prepareEduPiAmbientMessageBinding({ sessionId, messageId, occurredAt, ...binding }, { dataRoot: roots.dataRoot.root });
        },
        onCaptured: async (binding) => {
          confirmEduPiAmbientMessageBinding(sessionId, messageId, binding.messageRef, { dataRoot: roots.dataRoot.root });
        } });
      return NextResponse.json(result);
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ status: "too_large", externalSend: false }, { status: 413 });
    const code = error instanceof EduPiAmbientMessageError ? error.code : "proactivity_runtime_unavailable";
    return NextResponse.json({ status: "unavailable", code, stage: error instanceof EduPiAmbientMessageError ? error.stage : "runtime", externalSend: false }, { status: code === "proactivity_grant_unavailable" ? 409 : 503 });
  }
}
