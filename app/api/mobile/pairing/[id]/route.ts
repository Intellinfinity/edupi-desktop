import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { approveMobilePairing, isLoopbackRequest, revokeMobilePairing } from "@/lib/mobile-bridge";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLoopbackRequest(request) || !isApiRequestAllowed(request) || !hasJsonContentType(request)) {
    return NextResponse.json({ error: "桌面授权请求被拒绝" }, { status: 403 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { action?: unknown };
  if (body.action === "approve") {
    const pairing = approveMobilePairing(id);
    return pairing ? NextResponse.json(pairing) : NextResponse.json({ error: "配对请求不存在或已过期" }, { status: 404 });
  }
  if (body.action === "revoke") {
    return NextResponse.json({ ok: revokeMobilePairing(id) });
  }
  return NextResponse.json({ error: "操作无效" }, { status: 400 });
}
