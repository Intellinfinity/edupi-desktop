import { NextResponse } from "next/server";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { listEduPiPromptIntents, prepareEduPiPromptIntent, readEduPiPromptIntent,
  resolveEduPiPromptIntent, discardEduPiPromptIntent } from "@/lib/edupi-prompt-intent";
import { readEduPiPromptOutbox } from "@/lib/edupi-prompt-outbox";
import { withEduPiAmbientSessionLock } from "@/lib/edupi-ambient-session-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,255}$/u;
const REQUEST_ID = /^[0-9a-f-]{36}$/iu;

function response(status: string, code = 200) {
  return NextResponse.json({ status, externalSend: false }, { status: code, headers: { "Cache-Control": "no-store" } });
}

function identity(body: unknown): { sessionId: string; clientRequestId: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const item = body as Record<string, unknown>;
  if (Object.keys(item).length !== 2 || typeof item.sessionId !== "string" || !ID.test(item.sessionId)
    || typeof item.clientRequestId !== "string" || !REQUEST_ID.test(item.clientRequestId)) return null;
  return { sessionId: item.sessionId, clientRequestId: item.clientRequestId };
}

export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return response("rejected", 403);
  try {
    const roots = resolveEduPiBridgeRoots();
    const entries = listEduPiPromptIntents({ dataRoot: roots.dataRoot.root })
      .filter(item => item.status === "pending")
      .map(({ sessionId, clientRequestId, occurredAt, cwd }) => ({ sessionId, clientRequestId, occurredAt, cwd }));
    return NextResponse.json({ status: "ready", entries, externalSend: false }, { headers: { "Cache-Control": "no-store" } });
  } catch { return response("unavailable", 503); }
}

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return response("rejected", 403);
  try {
    const body = await parseJsonWithinLimit(request, 1_200_000) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 6
      || typeof body.sessionId !== "string" || !ID.test(body.sessionId)
      || typeof body.clientRequestId !== "string" || !REQUEST_ID.test(body.clientRequestId)
      || typeof body.occurredAt !== "string" || typeof body.message !== "string"
      || typeof body.draftValue !== "string" || typeof body.cwd !== "string") return response("invalid", 400);
    const roots = resolveEduPiBridgeRoots();
    const saved = await withEduPiAmbientSessionLock(body.sessionId, async () => prepareEduPiPromptIntent({
      sessionId: body.sessionId as string, clientRequestId: body.clientRequestId as string,
      occurredAt: body.occurredAt as string, message: body.message as string,
      draftValue: body.draftValue as string, cwd: body.cwd as string,
    }, { dataRoot: roots.dataRoot.root }));
    return response(saved.status === "pending" ? "ready" : saved.status, saved.status === "discarded" ? 409 : 200);
  } catch { return response("unavailable", 503); }
}

export async function PUT(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return response("rejected", 403);
  try {
    const id = identity(await parseJsonWithinLimit(request, 1024));
    if (!id) return response("invalid", 400);
    const roots = resolveEduPiBridgeRoots();
    const saved = readEduPiPromptIntent(id.sessionId, id.clientRequestId, { dataRoot: roots.dataRoot.root });
    if (!saved) return response("not_found", 404);
    return NextResponse.json({ status: saved.status, message: saved.message, draftValue: saved.draftValue,
      cwd: saved.cwd, externalSend: false }, { headers: { "Cache-Control": "no-store" } });
  } catch { return response("unavailable", 503); }
}

export async function PATCH(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return response("rejected", 403);
  try {
    const body = await parseJsonWithinLimit(request, 1024) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 3
      || body.confirmedPiPersistence !== true) return response("invalid", 400);
    const id = identity({ sessionId: body.sessionId, clientRequestId: body.clientRequestId });
    if (!id) return response("invalid", 400);
    const roots = resolveEduPiBridgeRoots();
    const saved = await withEduPiAmbientSessionLock(id.sessionId, async () =>
      resolveEduPiPromptIntent(id.sessionId, id.clientRequestId, { dataRoot: roots.dataRoot.root }));
    return response(saved.status, saved.status === "discarded" ? 409 : 200);
  } catch { return response("unavailable", 503); }
}

export async function DELETE(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return response("rejected", 403);
  try {
    const body = await parseJsonWithinLimit(request, 1024) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 3
      || body.confirmedManualDiscard !== true) return response("invalid", 400);
    const id = identity({ sessionId: body.sessionId, clientRequestId: body.clientRequestId });
    if (!id) return response("invalid", 400);
    const roots = resolveEduPiBridgeRoots();
    return await withEduPiAmbientSessionLock(id.sessionId, async () => {
      const options = { dataRoot: roots.dataRoot.root };
      const outbox = readEduPiPromptOutbox(id.sessionId, id.clientRequestId, options);
      if (outbox && outbox.stage !== "cancelled") return response("outbox_exists", 409);
      const saved = discardEduPiPromptIntent(id.sessionId, id.clientRequestId, options);
      return response(saved.status === "resolved" ? "resolved" : "discarded");
    });
  } catch { return response("unavailable", 503); }
}
