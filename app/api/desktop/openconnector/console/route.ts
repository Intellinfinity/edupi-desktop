import { NextResponse } from "next/server";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { ensureOpenConnectorConsole } from "@/lib/openconnector-console-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return reply({ ok: false, code: "desktop_authorization_required" }, 403);
  try {
    return reply({ ok: true, url: await ensureOpenConnectorConsole() }, 200);
  } catch {
    return reply({ ok: false, code: "console_unavailable" }, 503);
  }
}
