import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { readEduPiEducationSnapshot, resolveEduPiBridgeRoots, type EduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { workspaceResourcesRequest } from "@/lib/edupi-generated-artifacts";
import {
  buildProactivityGrantBinding,
  buildProactivityScopeCandidates,
  buildCapabilityGrantBinding,
  buildCapabilityScopeCandidates,
  buildStudentFollowupGrantBinding,
  buildStudentFollowupScopeCandidates,
  EDUPI_PROACTIVITY_DURATION_DAYS,
  EDUPI_PROACTIVITY_MAX_CALLS,
  EDUPI_STUDENT_FOLLOWUP_MAX_CALLS,
  EDUPI_CAPABILITY_MAX_CALLS,
  EduPiProactivityControlError,
  isCapabilityGrantBindingIdentity,
  type EduPiCapabilityDomain,
  type EduPiProactivityScopeCandidate,
} from "@/lib/edupi-proactivity-control";
import { clearEduPiProactivityStopIntent, readEduPiProactivityActivation, writeEduPiProactivityConfig,
  writeEduPiProactivityStopIntent, type EduPiProactivityActivation, type EduPiProactivityDomain, type EduPiProactivityScope } from "@/lib/edupi-proactivity-config";
import { EduPiProactivityRuntimeError, ensureProactivityGrant, inspectProactivityCatchUp, pauseProactivityGrant, proactivityRuntimeError, readProactivityGrantDomainProof, readProactivityGrantStatus, readProactivityRuntimeState } from "@/lib/edupi-proactivity-runtime";
import { G3_DOMAINS, g3AllowedBindingsForActivations, isEduPiG3ExactRuntimeSupported, clearEduPiRuntimeQuarantine, ensureEduPiRuntime,
  quarantineEduPiRuntime, restartEduPiRuntime } from "@/lib/edupi-runtime-supervisor";
import { canStartEduPiProactivity, canStartEduPiStudentFollowup } from "@/lib/safe-mode";

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

function requestedDomain(value: unknown): EduPiProactivityDomain | null {
  return value === undefined ? "teaching_preparation"
    : value === "teaching_preparation" || value === "student_followup" || value === "calendar_administration"
      || value === "lesson_reflection" || value === "parent_communication" ? value : null;
}

function pendingCapability(domain: EduPiProactivityDomain): domain is EduPiCapabilityDomain {
  return domain === "calendar_administration" || domain === "lesson_reflection" || domain === "parent_communication";
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

async function readScopeContext(roots: EduPiBridgeRoots, domain: EduPiProactivityDomain): Promise<{ workspace: RawRecord; teacherMaterials: unknown[]; scopes: EduPiProactivityScopeCandidate[] }> {
  if (domain === "student_followup") {
    const snapshot = await readEduPiEducationSnapshot({ roots });
    return { workspace: snapshot.workspace, teacherMaterials: [], scopes: buildStudentFollowupScopeCandidates(snapshot.workspace) };
  }
  if (pendingCapability(domain)) {
    const snapshot = await readEduPiEducationSnapshot({ roots });
    return { workspace: snapshot.workspace, teacherMaterials: [], scopes: buildCapabilityScopeCandidates(domain, snapshot.workspace) };
  }
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
  domain: EduPiProactivityDomain,
  context?: Awaited<ReturnType<typeof readScopeContext>>, allowDegraded = false) {
  const g3 = pendingCapability(domain);
  const g3Ready = g3 && isEduPiG3ExactRuntimeSupported(roots.runtime.coreCommit)
    && (!activation.enabled || Boolean(activation.scope && activation.grantId
      && isCapabilityGrantBindingIdentity(domain, activation.scope, activation.grantId)));
  if (g3 && !g3Ready) return { ok: true, degraded: false, activationBlocked: "activation_pending",
    activation: publicActivation(activation), scopes: [], grant: null, capabilities: null,
    limits: { durationDays: EDUPI_PROACTIVITY_DURATION_DAYS, maxModelCalls: 0, domain }, externalSend: false };
  let currentContext = context;
  let degraded = false;
  if (!currentContext) {
    try { currentContext = await readScopeContext(roots, domain); }
    catch (error) {
      if (!allowDegraded) throw error;
      currentContext = { workspace: {}, teacherMaterials: [], scopes: [] };
      degraded = true;
    }
  }
  let grant: Awaited<ReturnType<typeof readProactivityGrantStatus>> = null;
  let execution: Awaited<ReturnType<typeof readProactivityRuntimeState>>["execution"] = null;
  let capabilities: RawRecord | null = null;
  if (activation.enabled || domain === "student_followup") {
    try {
      const host = await ensureEduPiRuntime(roots);
      const health = runtimeHealth(await host.call("health", null));
      capabilities = health.capabilities;
      ({ grant, execution } = await readProactivityRuntimeState(host, health.rootRef, activation.grantId, domain));
    } catch (error) {
      if (!allowDegraded) throw error;
      degraded = true;
    }
  }
  return {
    ok: true,
    degraded,
    requiresSafeMode: domain === "teaching_preparation" && process.platform === "win32" && !canStartEduPiProactivity(),
    ...(domain === "student_followup" ? { activationBlocked: process.platform === "win32" ? "windows_unavailable"
      : !canStartEduPiStudentFollowup() ? "isolated_canary_required" : null }
      : g3 ? { activationBlocked: null } : {}),
    activation: publicActivation(activation),
    scopes: currentContext.scopes,
    grant,
    ...(domain === "student_followup" ? { execution } : {}),
    capabilities: capabilities ? {
      ambientPlanning: capabilities.ambient_planning === "active",
      ownerIntent: capabilities.owner_intent === "active",
      attentionDelivery: capabilities.attention_delivery === "active",
      teacherFeedback: capabilities.teacher_feedback === "active",
      ...(domain === "student_followup" ? { studentFollowup: capabilities.g2_processor === "active" } : {}),
      ...(g3 ? { sharedCapability: capabilities.g3_processor === "active" } : {}),
    } : null,
    limits: { durationDays: EDUPI_PROACTIVITY_DURATION_DAYS,
      maxModelCalls: domain === "student_followup" ? EDUPI_STUDENT_FOLLOWUP_MAX_CALLS
        : g3 ? EDUPI_CAPABILITY_MAX_CALLS : EDUPI_PROACTIVITY_MAX_CALLS, domain },
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

function requireActiveCapabilities(capabilities: RawRecord, domain: EduPiProactivityDomain): void {
  for (const key of [pendingCapability(domain) ? "g3_processor" : domain === "student_followup" ? "g2_processor" : "g1_processor",
    "internal_timer", "ambient_planning", "owner_authorization", "owner_conversation", "owner_intent", "attention_delivery", "teacher_feedback"]) {
    if (capabilities[key] !== "active") throw new Error("proactivity_activation_incomplete");
  }
}

async function recoverFailedEnable(roots: EduPiBridgeRoots, previous: EduPiProactivityActivation,
  target: { scope: EduPiProactivityScope; grantId: string }, domain: EduPiProactivityDomain): Promise<boolean> {
  try {
    writeEduPiProactivityStopIntent(target, { dataRoot: roots.dataRoot.root, now: mutationTime(previous.updatedAt), domain });
  } catch {
    await quarantineEduPiRuntime(roots.dataRoot.root);
    return false;
  }
  await quarantineEduPiRuntime(roots.dataRoot.root);
  clearEduPiRuntimeQuarantine(roots.dataRoot.root);
  let cleanupSafe = false;
  try {
    const host = await ensureEduPiRuntime(roots);
    const health = runtimeHealth(await host.call("health", null));
    await pauseProactivityGrant(host, health.rootRef, target.grantId);
    cleanupSafe = true;
  } catch { await quarantineEduPiRuntime(roots.dataRoot.root); }
  const fallback = cleanupSafe
    ? previous.enabled && previous.scope && previous.grantId
      ? { enabled: true, scope: previous.scope, grantId: previous.grantId }
      : { enabled: false, scope: null, grantId: null }
    : { enabled: false, scope: target.scope, grantId: target.grantId };
  try {
    writeEduPiProactivityConfig(fallback, { dataRoot: roots.dataRoot.root, now: mutationTime(previous.updatedAt), domain });
    if (cleanupSafe) clearEduPiProactivityStopIntent({ dataRoot: roots.dataRoot.root, grantId: target.grantId, domain });
    clearEduPiRuntimeQuarantine(roots.dataRoot.root);
    await restartEduPiRuntime(roots);
    return cleanupSafe;
  } catch {
    await quarantineEduPiRuntime(roots.dataRoot.root);
    return false;
  }
}

async function enableCanary(roots: EduPiBridgeRoots, activation: EduPiProactivityActivation, scope: EduPiProactivityScope, domain: EduPiProactivityDomain) {
  const context = await readScopeContext(roots, domain);
  const binding = domain === "student_followup" ? buildStudentFollowupGrantBinding(scope, context.workspace)
    : pendingCapability(domain) ? buildCapabilityGrantBinding(domain, scope, context.workspace)
      : buildProactivityGrantBinding(scope, context.workspace, context.teacherMaterials);
  if (!activation.enabled && activation.scope) throw new EduPiProactivityControlError("proactivity_scope_conflict");
  if (activation.scope && (!sameScope(activation.scope, scope) || activation.grantId !== binding.grantId)) {
    throw new EduPiProactivityControlError("proactivity_scope_conflict");
  }
  if (activation.enabled) return currentState(roots, activation, domain, context);
  if (pendingCapability(domain)) {
    try {
      const host = await ensureEduPiRuntime(roots);
      const health = runtimeHealth(await host.call("health", null));
      await ensureProactivityGrant(host, health.rootRef, binding);
      writeEduPiProactivityConfig({ enabled: true, scope, grantId: binding.grantId },
        { dataRoot: roots.dataRoot.root, now: mutationTime(activation.updatedAt), domain });
      const started = await restartEduPiRuntime(roots);
      requireActiveCapabilities(runtimeHealth(await started.call("health", null)).capabilities, domain);
      const next = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain });
      return await currentState(roots, next, domain, context);
    } catch (error) {
      if (!await recoverFailedEnable(roots, activation, { scope, grantId: binding.grantId }, domain)) {
        throw new EduPiProactivityRuntimeError("proactivity_stop_uncertain");
      }
      throw error;
    }
  }
  writeEduPiProactivityConfig({ enabled: true, scope, grantId: binding.grantId },
    { dataRoot: roots.dataRoot.root, now: mutationTime(activation.updatedAt), domain });
  try {
    const host = await restartEduPiRuntime(roots);
    const health = runtimeHealth(await host.call("health", null));
    requireActiveCapabilities(health.capabilities, domain);
    await ensureProactivityGrant(host, health.rootRef, binding);
    if (domain === "student_followup") {
      const next = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain });
      return await currentState(roots, next, domain, context);
    }
    const budget = (await readProactivityGrantStatus(host, health.rootRef, binding.grantId))?.modelBudget;
    if (!budget || budget.usageUnverified) throw new EduPiProactivityRuntimeError("proactivity_grant_denied");
    if (budget.remainingCalls === 0) throw new EduPiProactivityRuntimeError("proactivity_budget_exhausted");
    // The runtime starts before its owner grant is created. Wake the scoped
    // scan now so the teacher does not wait for the next five-minute tick.
    const catchUp = await host.call("prepare_due", null);
    if (!catchUp.ok) throw new EduPiProactivityRuntimeError("proactivity_runtime_unavailable");
    const initialScan = inspectProactivityCatchUp(catchUp);
    const next = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain });
    return { ...(await currentState(roots, next, domain, context)), initialScan };
  } catch (error) {
    if (!await recoverFailedEnable(roots, activation, { scope, grantId: binding.grantId }, domain)) {
      throw new EduPiProactivityRuntimeError("proactivity_stop_uncertain");
    }
    throw error;
  }
}

async function disableCanary(roots: EduPiBridgeRoots, activation: EduPiProactivityActivation, domain: EduPiProactivityDomain) {
  if (activation.scope && activation.grantId) {
    try {
      writeEduPiProactivityStopIntent({ scope: activation.scope, grantId: activation.grantId },
        { dataRoot: roots.dataRoot.root, now: mutationTime(activation.updatedAt), domain });
    } catch {
      await quarantineEduPiRuntime(roots.dataRoot.root);
      throw new EduPiProactivityRuntimeError("proactivity_stop_uncertain");
    }
    // Marker is durable before closing the selected executor; any later
    // read or restart now sees stop_pending, even if both following writes fail.
    await quarantineEduPiRuntime(roots.dataRoot.root);
    clearEduPiRuntimeQuarantine(roots.dataRoot.root);
  }
  let stopState: "paused" | "missing" | "revoked" | "shared" | "uncertain" = activation.grantId ? "uncertain" : "missing";
  if (activation.grantId) {
    try {
      const host = await ensureEduPiRuntime(roots);
      const health = runtimeHealth(await host.call("health", null));
      if (pendingCapability(domain)) {
        const proof = await readProactivityGrantDomainProof(host, health.rootRef, activation.grantId);
        const exactScope = Boolean(proof && activation.scope && sameScope(activation.scope, proof.scope));
        if (proof === null) stopState = "missing";
        else if (exactScope && proof.domain === domain) stopState = (await pauseProactivityGrant(host, health.rootRef, activation.grantId)).state;
        else if (exactScope && ["teaching_preparation", "student_followup", ...G3_DOMAINS].some(candidate => {
          if (candidate === domain || candidate !== proof.domain) return false;
          const other = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain: candidate });
          return other.enabled && other.source === "desktop_canary" && other.configurationStatus === "ready"
            && other.grantId === activation.grantId && sameScope(other.scope, proof.scope);
        })) stopState = "shared";
      } else stopState = (await pauseProactivityGrant(host, health.rootRef, activation.grantId)).state;
    } catch { /* Keep the old binding as a fence until a later stop retry proves it safe. */ }
  }
  const cleanupSafe = stopState !== "uncertain";
  try {
    writeEduPiProactivityConfig({ enabled: false, scope: cleanupSafe ? null : activation.scope,
      grantId: cleanupSafe ? null : activation.grantId }, { dataRoot: roots.dataRoot.root, now: mutationTime(activation.updatedAt), domain });
  } catch {
    await quarantineEduPiRuntime(roots.dataRoot.root);
    throw new EduPiProactivityRuntimeError("proactivity_stop_uncertain");
  }
  if (cleanupSafe && activation.grantId) {
    try { clearEduPiProactivityStopIntent({ dataRoot: roots.dataRoot.root, grantId: activation.grantId, domain }); }
    catch {
      await quarantineEduPiRuntime(roots.dataRoot.root);
      throw new EduPiProactivityRuntimeError("proactivity_stop_uncertain");
    }
  }
  clearEduPiRuntimeQuarantine(roots.dataRoot.root);
  try {
    const host = await restartEduPiRuntime(roots);
    const health = runtimeHealth(await host.call("health", null));
    const processor = pendingCapability(domain) ? "g3_processor" : domain === "student_followup" ? "g2_processor" : "g1_processor";
    const otherG3Active = pendingCapability(domain) && g3AllowedBindingsForActivations(
      G3_DOMAINS.filter(candidate => candidate !== domain).map(candidate => ({ domain: candidate,
        activation: readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain: candidate }) })),
      roots.runtime.coreCommit).length > 0;
    if (health.capabilities[processor] !== (otherG3Active ? "active" : "activation_pending")) {
      throw new Error("proactivity_deactivation_incomplete");
    }
  } catch {
    await quarantineEduPiRuntime(roots.dataRoot.root);
    throw new EduPiProactivityRuntimeError("proactivity_stop_uncertain");
  }
  if (!cleanupSafe) throw new EduPiProactivityRuntimeError("proactivity_stop_uncertain");
  const next = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain });
  return { ...(await currentState(roots, next, domain, undefined, true)), grantPaused: stopState === "paused" };
}

export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ ok: false, error: "主动运行设置请求被拒绝" }, { status: 403 });
  try {
    const domains = new URL(request.url).searchParams.getAll("domain");
    const domain = domains.length > 1 ? null : requestedDomain(domains[0]);
    if (!domain) return NextResponse.json({ ok: false, error: "主动运行领域无效", externalSend: false }, { status: 400 });
    const roots = resolveEduPiBridgeRoots();
    const activation = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain });
    return NextResponse.json(await currentState(roots, activation, domain, undefined, true));
  } catch {
    return NextResponse.json({ ok: false, error: "主动运行状态暂不可用", externalSend: false }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ ok: false, error: "主动运行设置请求被拒绝" }, { status: 403 });
  try {
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    const domain = requestedDomain(body?.domain);
    if (!body || !domain || !exact(body, ["enabled", "classId", "subject", "expectedUpdatedAt", ...(Object.hasOwn(body, "domain") ? ["domain"] : [])]) || typeof body.enabled !== "boolean"
      || body.classId !== null && typeof body.classId !== "string" || body.subject !== null && typeof body.subject !== "string"
      || body.expectedUpdatedAt !== null && (typeof body.expectedUpdatedAt !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(body.expectedUpdatedAt))
      || body.enabled && (typeof body.classId !== "string" || !body.classId.trim() || typeof body.subject !== "string" || !body.subject.trim())
      || !body.enabled && (body.classId !== null || body.subject !== null)) {
      return NextResponse.json({ ok: false, error: "主动运行设置无效", externalSend: false }, { status: 400 });
    }
    if (body.enabled && domain === "student_followup" && !canStartEduPiStudentFollowup()) {
      return NextResponse.json({ ok: false, code: "proactivity_isolated_canary_required",
        error: process.platform === "win32" ? "Windows 暂不支持学生跟进试用" : "学生跟进仅可在隔离数据目录试用", externalSend: false }, { status: 409 });
    }
    if (body.enabled && domain === "teaching_preparation" && !canStartEduPiProactivity()) {
      return NextResponse.json({ ok: false, code: "proactivity_safe_mode_required",
        error: "Windows 主动运行仅可在隔离安全模式试用", externalSend: false }, { status: 409 });
    }
    const roots = resolveEduPiBridgeRoots();
    if (body.enabled && pendingCapability(domain) && !isEduPiG3ExactRuntimeSupported(roots.runtime.coreCommit)) {
      return NextResponse.json({ ok: false, code: "proactivity_activation_pending",
        error: "该领域的主动执行尚未开放", externalSend: false }, { status: 409 });
    }
    return await withMutationLock(roots.dataRoot.root, async () => {
      const activation = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain });
      if (activation.source === "environment") {
        return NextResponse.json({ ok: false, error: "主动运行由当前启动环境管理", externalSend: false }, { status: 409 });
      }
      if (activation.updatedAt !== body.expectedUpdatedAt) {
        return NextResponse.json({ ok: false, code: "proactivity_configuration_stale", error: "主动运行状态已变化，请刷新后重试", externalSend: false }, { status: 409 });
      }
      try {
        const result = body.enabled
          ? await enableCanary(roots, activation, { classId: String(body.classId).trim(), subject: String(body.subject).trim() }, domain)
          : await disableCanary(roots, activation, domain);
        return NextResponse.json(result);
      } catch (error) {
        const cause = proactivityRuntimeError(error);
        const conflict = cause instanceof EduPiProactivityControlError
          && ["proactivity_scope_unavailable", "proactivity_scope_conflict"].includes(cause.code);
        const blocked = ["proactivity_budget_exhausted", "proactivity_grant_denied", "proactivity_preparation_blocked"].includes(cause.code);
        return NextResponse.json({ ok: false, code: cause.code,
          error: cause.code === "proactivity_scope_conflict" ? "请先完成当前主动运行的停止恢复"
            : cause.code === "proactivity_budget_exhausted" ? "本次模型调用额度已用完"
              : cause.code === "proactivity_grant_denied" ? domain === "student_followup" ? "学生跟进授权范围已变化，请停止后重试" : "授权或材料范围已变化，请停止后重试"
                : cause.code === "proactivity_preparation_blocked" ? "课前任务需要先核对材料或课程"
                  : cause.code === "proactivity_stop_uncertain" ? "停止未完成，请检查存储后重试"
                  : conflict ? domain === "student_followup" ? "所选班级需要数学课表和当前学生名单" : "所选班级和学科需要明确课表与材料" : "主动运行设置暂不可用", externalSend: false },
        { status: conflict || blocked ? 409 : 503 });
      }
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ ok: false, error: "主动运行设置过大", externalSend: false }, { status: 413 });
    const cause = proactivityRuntimeError(error);
    return NextResponse.json({ ok: false, code: cause.code, error: "主动运行设置暂不可用", externalSend: false }, { status: 503 });
  }
}
