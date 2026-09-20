import { NextResponse } from "next/server";
import { authorizeMobileRequest } from "@/lib/mobile-bridge";
import { listMobileSessions } from "@/lib/mobile-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorizeMobileRequest(request, "mobile:read")) return NextResponse.json({ error: "手机尚未完成配对" }, { status: 401 });
  try {
    return NextResponse.json({ sessions: await listMobileSessions() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "对话暂不可用" }, { status: 503 });
  }
}
