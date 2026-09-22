import { NextResponse } from "next/server";
import { allowMobilePairAttempt, requestMobilePairing, completeMobilePairing, MOBILE_TOKEN_COOKIE, MOBILE_TOKEN_TTL_MS } from "@/lib/mobile-bridge";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 4_096) return NextResponse.json({ error: "请求过大" }, { status: 413 });
  if (!allowMobilePairAttempt(request.headers.get("host") || "unknown")) return NextResponse.json({ error: "尝试次数过多，请稍后重试" }, { status: 429 });
  const body = await request.json().catch(() => ({})) as { code?: unknown; deviceLabel?: unknown; requestId?: unknown; requestKey?: unknown };
  if (typeof body.code !== "string" || body.code.length > 32) return NextResponse.json({ error: "配对码无效" }, { status: 400 });
  if (body.requestKey !== undefined && (typeof body.requestKey !== "string" || !/^[a-f0-9]{32}$/i.test(body.requestKey))) {
    return NextResponse.json({ error: "配对请求无效" }, { status: 400 });
  }
  if (typeof body.requestId === "string") {
    const result = completeMobilePairing(body.requestId, body.code);
    if (!result) return NextResponse.json({ error: "配对请求不存在或已过期" }, { status: 404 });
    if (!result.token) return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    const response = NextResponse.json({ status: result.status, scopes: result.scopes }, { headers: { "Cache-Control": "no-store" } });
    const secure = new URL(request.url).protocol === "https:";
    response.headers.append("Set-Cookie", `${MOBILE_TOKEN_COOKIE}=${result.token}; Max-Age=${Math.floor(MOBILE_TOKEN_TTL_MS / 1000)}; Path=/api/mobile; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`);
    return response;
  }
  const pairing = requestMobilePairing(body.code, body.deviceLabel, body.requestKey as string | undefined);
  return pairing
    ? NextResponse.json({ requestId: pairing.id, status: pairing.status, expiresAt: pairing.expiresAt })
    : NextResponse.json({ error: "配对码不存在或已过期" }, { status: 404 });
}
