import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { isLoopbackRequest, createMobilePairing, listMobilePairings } from "@/lib/mobile-bridge";

export const dynamic = "force-dynamic";

function adminAllowed(request: Request): boolean {
  return isLoopbackRequest(request) && isApiRequestAllowed(request);
}
export async function GET(request: Request) {
  if (!adminAllowed(request)) return NextResponse.json({ error: "桌面授权请求被拒绝" }, { status: 403 });
  return NextResponse.json({ pairings: listMobilePairings() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!adminAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({ error: "桌面授权请求被拒绝" }, { status: 403 });
  const pairing = createMobilePairing();
  return NextResponse.json(pairing, { headers: { "Cache-Control": "no-store" } });
}
