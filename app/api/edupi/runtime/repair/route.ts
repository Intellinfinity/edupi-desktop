import { NextResponse } from "next/server";
import path from "node:path";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { activeBridgeIdentity } from "@/lib/edupi-bridge-manifest";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { coreRuntimeFingerprint, inspectEduPiRuntimeRecovery, repairEduPiRuntimeState, type RuntimeRecoveryResult } from "@/lib/edupi-runtime-recovery";
import { describeEduPiRuntimeStartupFailure, ensureEduPiRuntime, restartEduPiRuntime } from "@/lib/edupi-runtime-supervisor";
import { projectCoreRuntimeHealth } from "@/lib/edupi-runtime-health";

export const dynamic = "force-dynamic";

function publicRecovery(value: RuntimeRecoveryResult) {
  return {
    status: value.status,
    repaired: value.repaired,
    reason: value.reason,
    files: value.files,
    backups: value.backups.map((file) => path.basename(file)),
  };
}

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ ok: false, error: "Core Runtime 修复请求被拒绝" }, { status: 403 });
  try {
    const roots = resolveEduPiBridgeRoots();
    const fingerprint = await coreRuntimeFingerprint(roots.runtime, roots.dataRoot);
    const before = inspectEduPiRuntimeRecovery(roots.dataRoot, fingerprint);
    const repaired = await repairEduPiRuntimeState(roots.dataRoot, fingerprint);
    const identity = activeBridgeIdentity();
    const host = repaired.repaired ? await restartEduPiRuntime(roots) : await ensureEduPiRuntime(roots);
    const health = projectCoreRuntimeHealth(await host.call("health", null), roots.runtime.coreCommit, identity.runtime.runtime_component_manifest_hash);
    if (health.status !== "ready") return NextResponse.json({ ok: false, error: health.reason || "Core Runtime 修复后仍未就绪", code: "runtime_not_ready", before: { status: before.status }, repaired: publicRecovery(repaired) }, { status: 503 });
    return NextResponse.json({ ok: true, status: health.status, before: { status: before.status }, repaired: publicRecovery(repaired) });
  } catch (error) {
    return NextResponse.json({ ok: false, code: "runtime_repair_failed", error: describeEduPiRuntimeStartupFailure(error) || "Core Runtime 状态修复失败" }, { status: 503 });
  }
}
