import { NextResponse } from "next/server";
import { EduPiCoreProcessError } from "@/lib/edupi-core-process-client";
import { EduPiSnapshotError, readEduPiCoreHealth, readEduPiEducationSnapshot, readEduPiKernelProjection, resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { loadEduPiCompatManifest } from "@/lib/edupi-bridge-manifest";
import { describeEduPiRuntimeStartupFailure, ensureEduPiRuntime } from "@/lib/edupi-runtime-supervisor";
import { projectCoreRuntimeHealth, type ProjectedCoreRuntimeHealth } from "@/lib/edupi-runtime-health";

export const dynamic = "force-dynamic";

function failureReason(error: unknown, label: string): string {
  const runtimeReason = describeEduPiRuntimeStartupFailure(error);
  if (runtimeReason) return runtimeReason;
  if (error instanceof EduPiCoreProcessError || error instanceof EduPiSnapshotError) return `${label}（${error.code}）`;
  return label;
}

function settledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

export async function GET(request: Request) {
  const manifest = loadEduPiCompatManifest();
  const identity = { runtime: manifest.core_runtime, contract: manifest.contract_identities[0] };
  const expectedCompatibility = {
    coreCommit: identity.runtime.core_commit,
    componentManifestHash: identity.runtime.component_manifest_hash,
    runtimeComponentManifestHash: identity.runtime.runtime_component_manifest_hash,
    contractVersion: identity.contract.contract_version,
    schemaHash: identity.contract.schema_hash,
    fixtureManifestHash: identity.contract.fixture_manifest_hash,
    supportedCommands: [...identity.contract.supported_commands],
    supportedProjections: [...identity.contract.supported_projections],
    unsupportedCommandReasons: { ...manifest.unsupported_command_reasons },
    unsupportedProjectionReasons: { ...manifest.unsupported_projection_reasons },
  };
  const summaryOnly = request ? new URL(request.url).searchParams.get("summary") === "1" : false;
  let roots;
  try {
    roots = resolveEduPiBridgeRoots();
  } catch (error) {
    const reason = failureReason(error, "Core 配置不可用");
    return NextResponse.json({
      scope: "teacher_internal",
      externalSend: false,
      requiresTeacherReview: true,
      core: { status: "unavailable", reason, supportedCommands: [], supportedProjections: [] },
      compatibility: { expected: expectedCompatibility, actual: null, reason },
      projection: { status: "unavailable", reason: `${reason}；未使用本地 JSON 回退` },
      kernel: { status: "unavailable", summary: { total: 0, running: 0, failed: 0, needs_review: 0, succeeded: 0, skipped: 0 }, runs: [] },
      proactivity: { status: "unavailable", ambientPlanning: process.env.EDUPI_AMBIENT_PLANNING === "1", attentionDelivery: false, teacherFeedback: false, attentionIntents: 0, attentionDeliveries: 0, currentAttentionDeliveries: 0, externalSend: false },
    });
  }

  let runtime: ProjectedCoreRuntimeHealth | null = null;
  let runtimeReason = "Core Runtime 不可用";
  let runtimeCapabilities: Record<string, unknown> | null = null;
  const ambientPlanning = process.env.EDUPI_AMBIENT_PLANNING === "1";
  try {
    const host = await ensureEduPiRuntime(roots);
    const runtimeHealth = await host.call("health", null);
    const runtimeResult = runtimeHealth && typeof runtimeHealth.result === "object" && runtimeHealth.result && !Array.isArray(runtimeHealth.result) ? runtimeHealth.result as Record<string, unknown> : null;
    runtimeCapabilities = runtimeResult?.capabilities && typeof runtimeResult.capabilities === "object" && !Array.isArray(runtimeResult.capabilities) ? runtimeResult.capabilities as Record<string, unknown> : null;
    runtime = projectCoreRuntimeHealth(runtimeHealth, roots.runtime.coreCommit, identity.runtime.runtime_component_manifest_hash);
    runtimeReason = runtime.reason || "Core Runtime 已连接";
  } catch (error) {
    runtimeReason = failureReason(error, "Core Runtime 不可用");
  }

  const [healthResult, snapshotResult, kernelResult] = await Promise.allSettled([
    readEduPiCoreHealth({ roots, requestId: `desktop-status-health-${Date.now().toString(36)}` }),
    readEduPiEducationSnapshot({ roots, requestId: `desktop-status-snapshot-${Date.now().toString(36)}` }),
    readEduPiKernelProjection({ roots, requestId: `desktop-status-kernel-${Date.now().toString(36)}` }),
  ]);
  const healthValue = settledValue(healthResult);
  const snapshot = settledValue(snapshotResult);
  const kernel = settledValue(kernelResult);
  const health = healthValue?.health;
  const supportedCommands = Array.isArray(health?.supported_commands) ? health.supported_commands : [];
  const supportedProjections = Array.isArray(health?.supported_projections) ? health.supported_projections : [];
  const actualCompatibility = health ? {
    coreCommit: roots.runtime.coreCommit,
    componentManifestHash: roots.runtime.componentManifestHash,
    contractVersion: health.contract_version,
    schemaHash: health.schema_hash,
    fixtureManifestHash: health.fixture_manifest_hash,
    supportedCommands,
    supportedProjections,
    runtimeComponentManifestHash: runtime?.component_manifest_hash,
  } : null;
  const workspace = snapshot?.workspace;
  const counts = workspace ? {
    students: Array.isArray(workspace.students) ? workspace.students.length : 0,
    timetable: Array.isArray(workspace.timetable) ? workspace.timetable.length : 0,
    calendar: Array.isArray(workspace.calendar) ? workspace.calendar.length : 0,
    tasks: Array.isArray(workspace.tasks) ? workspace.tasks.length : 0,
  } : null;
  const projectionReason = snapshot ? null : failureReason(snapshotResult.status === "rejected" ? snapshotResult.reason : null, "Core 教育投影不可用");
  const kernelReason = kernel ? null : failureReason(kernelResult.status === "rejected" ? kernelResult.reason : null, "自动运行内核不可用");
  const preparation = workspace && typeof workspace.l4_preparation === "object" && workspace.l4_preparation && !Array.isArray(workspace.l4_preparation)
    ? workspace.l4_preparation as Record<string, unknown> : null;
  const attentionIntents = Array.isArray(preparation?.attention_intents) ? preparation.attention_intents : [];
  const attentionDeliveries = Array.isArray(preparation?.attention_deliveries) ? preparation.attention_deliveries : [];
  const kernelBody = kernel
    ? summaryOnly
      ? { status: "ready", projection_kind: kernel.projection.projection_kind, state_version: kernel.projection.state_version, updated_at: kernel.projection.updated_at, summary: kernel.projection.summary, runs: [] }
      : { status: "ready", ...kernel.projection }
    : { status: "unavailable", reason: kernelReason, summary: { total: 0, running: 0, failed: 0, needs_review: 0, succeeded: 0, skipped: 0 }, runs: [] };

  return NextResponse.json({
    scope: "teacher_internal",
    externalSend: false,
    requiresTeacherReview: true,
    core: runtime ? {
      status: runtime.status,
      reason: runtime.reason,
      lifecycle: runtime.lifecycle,
      coreCommit: roots.runtime.coreCommit,
      validationMode: roots.runtime.validationMode,
      contractVersion: health?.contract_version,
      schemaHash: health?.schema_hash,
      componentManifestHash: roots.runtime.componentManifestHash,
      runtimeComponentManifestHash: runtime.component_manifest_hash,
      fixtureManifestHash: health?.fixture_manifest_hash,
      supportedCommands,
      supportedProjections,
      queue: runtime.queue,
      capabilities: runtime.capabilities,
      scheduler: runtime.scheduler,
    } : { status: "unavailable", reason: runtimeReason, supportedCommands, supportedProjections },
    compatibility: {
      expected: expectedCompatibility,
      actual: actualCompatibility,
      ...(!actualCompatibility
        ? { reason: failureReason(healthResult.status === "rejected" ? healthResult.reason : null, "Core Bridge 不可用") }
        : !runtime
          ? { reason: runtimeReason }
          : {}),
    },
    projection: snapshot ? { status: "ready", reason: null, projection: "education_workspace", counts } : { status: "unavailable", reason: `${projectionReason}；未使用本地 JSON 回退` },
    kernel: kernelBody,
    proactivity: {
      status: !runtime ? "unavailable" : ambientPlanning ? "active" : "disabled",
      ambientPlanning,
      attentionDelivery: runtimeCapabilities?.attention_delivery === "active",
      teacherFeedback: runtimeCapabilities?.teacher_feedback === "active",
      attentionIntents: attentionIntents.length,
      attentionDeliveries: attentionDeliveries.length,
      currentAttentionDeliveries: attentionDeliveries.filter((item) => (item as Record<string, unknown>)?.intent_current === true).length,
      externalSend: false,
    },
  });
}
