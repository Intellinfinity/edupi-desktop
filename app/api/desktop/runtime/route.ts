import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { isSafeModeEnabled } from "@/lib/safe-mode";
import { readStartupDiagnostics, startupDiagnosticsFile } from "@/lib/desktop-diagnostics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求被拒绝" }, { status: 403 });
  return NextResponse.json({
    safeMode: isSafeModeEnabled(),
    diagnostics: readStartupDiagnostics(),
    diagnosticsPath: startupDiagnosticsFile(),
  }, { headers: { "Cache-Control": "no-store" } });
}
