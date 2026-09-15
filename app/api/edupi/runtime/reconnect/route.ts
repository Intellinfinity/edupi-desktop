import { NextResponse } from "next/server";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { activeBridgeIdentity } from "@/lib/edupi-bridge-manifest";
import { describeEduPiRuntimeStartupFailure, restartEduPiRuntime } from "@/lib/edupi-runtime-supervisor";
import { projectCoreRuntimeHealth } from "@/lib/edupi-runtime-health";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ ok: false, error: "Core 重新连接请求被拒绝" }, { status: 403 });
  }

  try {
    const roots = resolveEduPiBridgeRoots();
    const identity = activeBridgeIdentity();
    const host = await restartEduPiRuntime(roots);
    const health = projectCoreRuntimeHealth(
      await host.call("health", null),
      roots.runtime.coreCommit,
      identity.runtime.runtime_component_manifest_hash,
    );
    if (health.status !== "ready") {
      return NextResponse.json({ ok: false, error: health.reason || "Core 重新连接后仍未就绪" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, status: health.status, reason: health.reason });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: describeEduPiRuntimeStartupFailure(error) || "Core 重新连接失败",
    }, { status: 503 });
  }
}
