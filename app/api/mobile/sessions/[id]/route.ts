import { NextResponse } from "next/server";
import { authorizeMobileRequest } from "@/lib/mobile-bridge";
import { readMobileSession } from "@/lib/mobile-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorizeMobileRequest(request, "mobile:read")) return NextResponse.json({ error: "手机尚未完成配对" }, { status: 401 });
  const { id } = await params;
  try {
    const session = await readMobileSession(id);
    return session ? NextResponse.json(session, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "对话不存在" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "对话暂不可用" }, { status: 503 });
  }
}
