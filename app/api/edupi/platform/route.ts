import { NextResponse } from "next/server";
import { callEduPiCore } from "@/lib/edupi-core-process-client";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { EDUPI_PLATFORM_PROJECTIONS, projectPlatformResults } from "@/lib/edupi-platform-projection";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const roots = resolveEduPiBridgeRoots();
    const responses = await Promise.allSettled(EDUPI_PLATFORM_PROJECTIONS.map(({ operation }) => callEduPiCore<Record<string, unknown>>({ operation, requestId: `desktop-${operation}-${Date.now().toString(36)}`, runtime: roots.runtime, dataRoot: roots.dataRoot })));
    return NextResponse.json(projectPlatformResults(responses));
  } catch {
    return NextResponse.json({ error: "EduPi 平台状态不可用" }, { status: 503 });
  }
}
