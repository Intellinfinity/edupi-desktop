import { NextResponse } from "next/server";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { readEduPiPromptOutbox } from "@/lib/edupi-prompt-outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,255}$/u;

/** Explicit teacher readback; summaries never expose the private prompt text. */
export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ status: "rejected" }, { status: 403 });
  try {
    const body = await parseJsonWithinLimit(request, 1024) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 2 || typeof body.sessionId !== "string" || !ID.test(body.sessionId)
      || typeof body.clientRequestId !== "string" || !ID.test(body.clientRequestId)) {
      return NextResponse.json({ status: "invalid" }, { status: 400 });
    }
    const roots = resolveEduPiBridgeRoots();
    const saved = readEduPiPromptOutbox(body.sessionId, body.clientRequestId, { dataRoot: roots.dataRoot.root });
    if (!saved) return NextResponse.json({ status: "not_found" }, { status: 404 });
    return NextResponse.json({ status: saved.stage, message: saved.command.message, externalSend: false },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
