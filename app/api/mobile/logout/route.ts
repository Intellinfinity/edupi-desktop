import { NextResponse } from "next/server";
import { MOBILE_TOKEN_COOKIE } from "@/lib/mobile-bridge";

export async function POST(request: Request) {
  const secure = new URL(request.url).protocol === "https:";
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.headers.append("Set-Cookie", `${MOBILE_TOKEN_COOKIE}=; Max-Age=0; Path=/api/mobile; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`);
  return response;
}
