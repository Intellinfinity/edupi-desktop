import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { readEduPiEducationSnapshot, resolveEduPiBridgeRoots, type EduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { workspaceResourcesRequest } from "@/lib/edupi-generated-artifacts";
import {
  buildProactivityGrantBinding,
  buildProactivityScopeCandidates,
  EDUPI_PROACTIVITY_DURATION_DAYS,
  EDUPI_PROACTIVITY_MAX_CALLS,
  EduPiProactivityControlError,
  type EduPiProactivityScopeCandidate,
} from "@/lib/edupi-proactivity-control";
import { readEduPiProactivityActivation, writeEduPiProactivityConfig, type EduPiProactivityActivation, type EduPiProactivityScope } from "@/lib/edupi-proactivity-config";
import { ensureProactivityGrant, pauseProactivityGrant, proactivityRuntimeError, readProactivityGrantStatus } from "@/lib/edupi-proactivity-runtime";
import { ensureEduPiRuntime, restartEduPiRuntime } from "@/lib/edupi-runtime-supervisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 4096;
type RawRecord = Record<string, unknown>;

declare global {
  // One packaged server owns a data root. Preserve the lock across Next.js module reloads.
  var __edupiProactivityMutationLocks: Map<string, Promise<void>> | undefined;
}

const mutationLocks = globalThis.__edupiProactivityMutationLocks ??= new Map<string, Promise<void>>();

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function exact(value: RawRecord, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function runtimeHealth(value: RawRecord): { rootRef: string; capabilities: RawRecord } {
  const result = record(value.result);
  const capabilities = record(result?.capabilities);
  const rootRef = result?.data_root_fingerprint;
  if (value.ok !== true || typeof rootRef !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(rootRef) || !capabilities) {
    throw new Error("proactivity_runtime_unavailable");
  }
  return { rootRef, capabilities };
}

async function readScopeContext(roots: EduPiBridgeRoots): Promise<{ workspace: RawRecord; teacherMaterials: unknown[]; scopes: EduPiProactivityScopeCandidate[] }> {
  const [snapshot, resources] = await Promise.all([
    readEduPiEducationSnapshot({ roots }),
    workspaceResourcesRequest(),
  ]);
  const teacherMaterials = Array.isArray(resources.teacherMaterials) ? resources.teacherMaterials : [];
  return { workspace: snapshot.workspace, teacherMaterials, scopes: buildProactivityScopeCandidates(snapshot.workspace, teacherMaterials) };
}

function publicActivation(activation: EduPiProactivityActivation) {
  return {
    enabled: activation.enabled,
    source: activation.source,
    configurationStatus: activation.configurationStatus,
    scope: activation.scope,
    updatedAt: activation.updatedAt,
  };
}

async function currentState(roots: EduPiBridgeRoots, activation: EduPiProactivityActivation,
  context?: Awaited<ReturnType<typeof readScopeContext>>, allowDegraded = false) {
  let currentContext = context;
  let degraded = false;
  if (!currentContext) {
    try { currentContext = await readScopeContext(roots); }
    catch (error) {
      if (!allowDegraded) throw error;
      currentContext = { workspace: {}, teacherMaterials: [], scopes: [] };
      degraded = true;
    }
  }
  let grant: Awaited<ReturnType<typeof readProactivityGrantStatus>> = null;
  let capabilities: RawRecord | null = null;
  if (activation.enabled) {
    try {
      const host = await ensureEduPiRuntime(roots);
      const health = runtimeHealth(await host.call("health", null));
      capabilities = health.capabilities;
      grant = await readProactivityGrantStatus(host, health.rootRef, activation.grantId);
    } catch (error) {
      if (!allowDegraded) throw error;
      degraded = true;
    }
  }
  return {
    ok: true,
    degraded,
    activation: publicActivation(activation),
    scopes: currentContext.scopes,
    grant,
    capabilities: capabilities ? {
      ambientPlanning: capabilities.ambient_planning === "active",
      ownerIntent: capabilities.owner_intent === "active",
      attentionDelivery: capabilities.attention_delivery === "active",
      teacherFeedback: capabilities.teacher_feedback === "active",
    } : null,
    limits: { durationDays: EDUPI_PROACTIVITY_DURATION_DAYS, maxModelCalls: EDUPI_PROACTIVITY_MAX_CALLS, domain: "teaching_preparation" },
    externalSend: false,
  };
}

async function withMutationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const current = previous.catch(() => {}).then(() => gate);
  mutationLocks.set(key, current);
  await previous.catch(() => {});
  try { return await operation(); }
  finally {
    release();
    if (mutationLocks.get(key) === current) mutationLocks.delete(key);
  }
}

function mutationTime(previous: string | null): string {
  const previousTime = previous === null ? 0 : Date.parse(previous);
  return new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
}

function sameScope(left: EduPiProactivityScope | null, right: EduPiProactivityScope): boolean {
  return left?.classId === right.classId && left.subject === right.subject;
}

function requireActiveCapabilities(capabilities: RawRecord): void {
  for (const key of ["ambient_planning", "owner_authorization", "owner_conversation", "owner_intent", "attention_delivery", "teacher_feedback"]) {
    if (capabilities[key] !== "active") throw new Error("proactivity_activation_incomplete");
  }
}

async function recoverFailedEnable(roots: EduPiBridgeRoots, previous: EduPiProactivityActivation,
  target: { scope: EduPiProactivityScope; grantId: string }): Promise<void> {
  let cleanupSafe = false;
  try {
    const host = await ensureEduPiRuntime(roots);
    const health = runtimeHealth(await host.call("health", null));
    await pauseProactivityGrant(host, health.rootRef, target.grantId);
    cleanupSafe = true;
  } catch { /* Retain the target binding as a fence when cleanup is uncertain. */ }
  const fallback = cleanupSafe
    ? previous.enabled && previous.scope && previous.grantId
      ? { enabled: true, scope: previous.scope, grantId: previous.grantId }
      : { enabled: false, scope: null, grantId: null }
    : { enabled: false, scope: target.scope, grantId: target.grantId };
  try {
    writeEduPiProactivityConfig(fallback, { dataRoot: roots.dataRoot.root, now: mutationTime(previous.updatedAt) });
    await restartEduPiRuntime(roots);
  } catch { /* The original failure remains authoritative; the persisted fence is best effort. */ }
}

async function enableCanary(roots: EduPiBridgeRoots, activation: EduPiProactivityActivation, scope: EduPiProactivityScope) {
  const context = await readScopeContext(roots);
  const binding = buildProactivityGrantBinding(scope, context.workspace, context.teacherMaterials);
  if (activation.scope && (!sameScope(activation.scope, scope) || activation.grantId !== binding.grantId)) {
    throw new EduPiProactivityControlError("proactivity_scope_conflict");
  }
  if (activation.enabled) return currentState(roots, activation, context);
  writeEduPiProactivityConfig({ enabled: true, scope, grantId: binding.grantId },
    { dataRoot: roots.dataRoot.root, now: mutationTime(activation.updatedAt) });
  try {
    const host = await restartEduPiRuntime(roots);
    const health = runtimeHealth(await host.call("health", null));
    requireActiveCapabilities(health.capabilities);
    await ensureProactivityGrant(host, health.rootRef, binding);
    const next = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root });
    return await currentState(roots, next, context);
  } catch (error) {
    await recoverFailedEnable(roots, activation, { scope, grantId: binding.grantId });
    throw error;
  }
}

async function disableCanary(roots: EduPiBridgeRoots, activation: EduPiProactivityActivation) {
  let stopState: "paused" | "missing" | "revoked" | "uncertain" = activation.grantId ? "uncertain" : "missing";
  if (activation.grantId) {
    try {
      const host = await ensureEduPiRuntime(roots);
      const health = runtimeHealth(await host.call("health", null));
      stopState = (await pauseProactivityGrant(host, health.rootRef, activation.grantId)).state;
    } catch { /* Keep the old binding as a fence until a later stop retry proves it safe. */ }
  }
  const cleanupSafe = stopState !== "uncertain";
  writeEduPiProactivityConfig({ enabled: false, scope: cleanupSafe ? null : activation.scope,
    grantId: cleanupSafe ? null : activation.grantId }, { dataRoot: roots.dataRoot.root, now: mutationTime(activation.updatedAt) });
  const host = await restartEduPiRuntime(roots);
  const health = runtimeHealth(await host.call("health", null));
  if (health.capabilities.ambient_planning === "active") throw new Error("proactivity_deactivation_incomplete");
  const next = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root });
  return { ...(await currentState(roots, next, undefined, true)), grantPaused: stopState === "paused" };
}

export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ ok: false, error: "主动运行设置请求被拒绝" }, { status: 403 });
  try {
    const roots = resolveEduPiBridgeRoots();
    const activation = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root });
    return NextResponse.json(await currentState(roots, activation, undefined, true));
  } catch {
    return NextResponse.json({ ok: false, error: "主动运行状态暂不可用", externalSend: false }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ ok: false, error: "主动运行设置请求被拒绝" }, { status: 403 });
  try {
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    if (!body || !exact(body, ["enabled", "classId", "subject", "expectedUpdatedAt"]) || typeof body.enabled !== "boolean"
      || body.classId !== null && typeof body.classId !== "string" || body.subject !== null && typeof body.subject !== "string"
      || body.expectedUpdatedAt !== null && (typeof body.expectedUpdatedAt !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(body.expectedUpdatedAt))
      || body.enabled && (typeof body.classId !== "string" || !body.classId.trim() || typeof body.subject !== "string" || !body.subject.trim())
      || !body.enabled && (body.classId !== null || body.subject !== null)) {
      return NextResponse.json({ ok: false, error: "主动运行设置无效", externalSend: false }, { status: 400 });
    }
    const roots = resolveEduPiBridgeRoots();
    return await withMutationLock(roots.dataRoot.root, async () => {
      const activation = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root });
      if (activation.source === "environment") {
        return NextResponse.json({ ok: false, error: "主动运行由当前启动环境管理", externalSend: false }, { status: 409 });
      }
      if (activation.updatedAt !== body.expectedUpdatedAt) {
        return NextResponse.json({ ok: false, code: "proactivity_configuration_stale", error: "主动运行状态已变化，请刷新后重试", externalSend: false }, { status: 409 });
      }
      try {
        const result = body.enabled
          ? await enableCanary(roots, activation, { classId: String(body.classId).trim(), subject: String(body.subject).trim() })
          : await disableCanary(roots, activation);
        return NextResponse.json(result);
      } catch (error) {
        const cause = proactivityRuntimeError(error);
        const conflict = cause instanceof EduPiProactivityControlError
          && ["proactivity_scope_unavailable", "proactivity_scope_conflict"].includes(cause.code);
        return NextResponse.json({ ok: false, code: cause.code,
          error: cause.code === "proactivity_scope_conflict" ? "请先完成当前主动运行的停止恢复"
            : conflict ? "所选班级和学科需要明确课表与材料" : "主动运行设置暂不可用", externalSend: false },
        { status: conflict ? 409 : 503 });
      }
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ ok: false, error: "主动运行设置过大", externalSend: false }, { status: 413 });
    const cause = proactivityRuntimeError(error);
    return NextResponse.json({ ok: false, code: cause.code, error: "主动运行设置暂不可用", externalSend: false }, { status: 503 });
  }
}
