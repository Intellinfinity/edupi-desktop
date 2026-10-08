import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { captureAndApplyAmbientMessage, EduPiAmbientMessageError, predictEduPiOwnerMessageRef } from "@/lib/edupi-ambient-message-runtime";
import { acknowledgeEduPiAmbientMessagePlan, armEduPiAmbientMessagePlan, cancelEduPiAmbientMessagePlan,
  confirmEduPiAmbientMessageBinding, finishEduPiAmbientPlanDomain, markEduPiAmbientMessageOutcomeUnknown,
  markEduPiAmbientMessageOutcomeVerified, markEduPiAmbientPlanDomainUnavailable,
  prepareEduPiAmbientMessageBinding, readCompletedEduPiAmbientMessages, readEduPiAmbientMessagePlan,
  readPendingEduPiAmbientMessages, readUnsettledEduPiAmbientMessages, startEduPiAmbientPlanDomain } from "@/lib/edupi-ambient-message-ledger";
import { readExactEduPiAmbientGoalBinding, readExactEduPiG2Execution } from "@/lib/edupi-ambient-message-recovery";
import { resolveEduPiBridgeRoots, type EduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { isCapabilityGrantBindingIdentity, type EduPiCapabilityDomain } from "@/lib/edupi-proactivity-control";
import { readEduPiProactivityActivation, type EduPiProactivityDomain } from "@/lib/edupi-proactivity-config";
import { readProactivityOwnerContext } from "@/lib/edupi-proactivity-runtime";
import { ensureEduPiRuntime, isEduPiG3ExactRuntimeSupported } from "@/lib/edupi-runtime-supervisor";
import { resolveSessionPath } from "@/lib/session-reader";
import { withEduPiAmbientSessionLock } from "@/lib/edupi-ambient-session-lock";
import { canStartEduPiStudentFollowup } from "@/lib/safe-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 16 * 1024;
const G3_DOMAINS: EduPiProactivityDomain[] = ["calendar_administration", "lesson_reflection", "parent_communication"];
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,255}$/u;
const MESSAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,127}$/u;

function isG3Domain(domain: EduPiProactivityDomain): domain is EduPiCapabilityDomain { return G3_DOMAINS.includes(domain); }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validIdentity(body: Record<string, unknown>): body is Record<string, unknown> & {
  sessionId: string; messageId: string; occurredAt: string } {
  let canonical = false;
  try { canonical = typeof body.occurredAt === "string" && new Date(body.occurredAt).toISOString() === body.occurredAt; }
  catch { canonical = false; }
  return typeof body.sessionId === "string" && SESSION_ID.test(body.sessionId)
    && typeof body.messageId === "string" && MESSAGE_ID.test(body.messageId)
    && typeof body.occurredAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(body.occurredAt)
    && canonical;
}

function scopeHash(scope: { classId: string; subject: string }): string {
  return `sha256:${createHash("sha256").update(JSON.stringify([scope.classId, scope.subject])).digest("hex")}`;
}

function activeBindings(roots: EduPiBridgeRoots) {
  const domains: EduPiProactivityDomain[] = ["teaching_preparation",
    ...(canStartEduPiStudentFollowup() ? ["student_followup" as const] : []),
    ...(isEduPiG3ExactRuntimeSupported(roots.runtime.coreCommit) ? G3_DOMAINS : [])];
  return domains.map(domain => ({ domain, activation: readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain }) }))
    .filter(({ domain, activation }) => activation.enabled && (!isG3Domain(domain)
      || activation.source === "desktop_canary" && activation.configurationStatus === "ready"
        && Boolean(activation.scope && activation.grantId
          && isCapabilityGrantBindingIdentity(domain, activation.scope, activation.grantId))));
}

export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ status: "rejected", externalSend: false }, { status: 403 });
  try {
    const query = new URL(request.url).searchParams;
    const sessionId = query.get("sessionId");
    if (sessionId !== null) {
      if (!SESSION_ID.test(sessionId)) {
        return NextResponse.json({ status: "invalid", externalSend: false }, { status: 400 });
      }
      const roots = resolveEduPiBridgeRoots();
      return await withEduPiAmbientSessionLock(sessionId, async () => {
        if (!await resolveSessionPath(sessionId)) return NextResponse.json({ status: "session_unavailable", externalSend: false }, { status: 409 });
        let pending = readPendingEduPiAmbientMessages(sessionId, { dataRoot: roots.dataRoot.root });
        const recovered: Array<{ messageId: string; goalId: string; workCaseId: string }
          | { messageId: string; goalId: string; followUpId: string; executionId: string }> = [];
        if (pending.length && query.get("verify") === "1") {
          try {
            const host = await ensureEduPiRuntime(roots);
            const healthResponse = record(await host.call("health", null));
            const health = healthResponse?.ok === true ? record(healthResponse.result) : null;
            const rootRef = health?.data_root_fingerprint;
            if (typeof rootRef === "string" && /^sha256:[a-f0-9]{64}$/u.test(rootRef)) {
              for (const entry of readUnsettledEduPiAmbientMessages(sessionId, { dataRoot: roots.dataRoot.root })
                .filter(item => item.status === "outcome_unknown").slice(0, 20)) {
                const plan = readEduPiAmbientMessagePlan(sessionId, entry.messageId, { dataRoot: roots.dataRoot.root });
                const domain = plan?.domains.find(item => item.grantId === entry.grantId && item.state === "unknown"
                  && predictEduPiOwnerMessageRef(rootRef, entry.ownerId, entry.messageId, item.domain) === entry.messageRef)?.domain;
                const g2 = predictEduPiOwnerMessageRef(rootRef, entry.ownerId, entry.messageId, "student_followup") === entry.messageRef;
                if (g2) {
                  const proof = await readExactEduPiG2Execution(host, rootRef, entry);
                  if (proof.status !== "applied") continue;
                  markEduPiAmbientMessageOutcomeVerified(sessionId, entry.messageRef, { dataRoot: roots.dataRoot.root });
                  if (domain) finishEduPiAmbientPlanDomain(sessionId, entry.messageId, domain, entry.messageRef,
                    { dataRoot: roots.dataRoot.root });
                  recovered.push({ messageId: entry.messageId, goalId: proof.goalId,
                    followUpId: proof.followUpId, executionId: proof.executionId });
                } else {
                  const proof = await readExactEduPiAmbientGoalBinding(host, rootRef, entry);
                  if (proof.status !== "applied") continue;
                  markEduPiAmbientMessageOutcomeVerified(sessionId, entry.messageRef, { dataRoot: roots.dataRoot.root });
                  if (domain) finishEduPiAmbientPlanDomain(sessionId, entry.messageId, domain, entry.messageRef,
                    { dataRoot: roots.dataRoot.root });
                  recovered.push({ messageId: entry.messageId, goalId: proof.goalId, workCaseId: proof.workCaseId });
                }
              }
              pending = readPendingEduPiAmbientMessages(sessionId, { dataRoot: roots.dataRoot.root });
            }
          } catch { /* Missing exact Core proof leaves the durable outcome pending. */ }
        }
        const settled = readCompletedEduPiAmbientMessages(sessionId, { dataRoot: roots.dataRoot.root });
        return NextResponse.json({ status: pending.length ? "outcome_unknown" : recovered.length ? "applied" : "clear",
          recovered, pending, settled,
          externalSend: false });
      });
    }
    const roots = resolveEduPiBridgeRoots();
    const bindings = activeBindings(roots).filter(({ activation }) => activation.grantId && activation.scope);
    if (bindings.length === 0) {
      return NextResponse.json({ status: "disabled", externalSend: false });
    }
    const host = await ensureEduPiRuntime(roots);
    const health = record((await host.call("health", null)).result);
    const capabilities = record(health?.capabilities);
    const rootRef = health?.data_root_fingerprint;
    if (typeof rootRef !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(rootRef)
      || capabilities?.ambient_planning !== "active" || capabilities?.owner_intent !== "active") throw new Error("runtime unavailable");
    for (const { domain, activation } of bindings) {
      if (domain === "student_followup" && capabilities.g2_processor !== "active") continue;
      if (isG3Domain(domain) && capabilities.g3_processor !== "active") continue;
      const context = await readProactivityOwnerContext(host, rootRef, activation.grantId!);
      if (context?.status === "active") return NextResponse.json({ status: "enabled", externalSend: false });
    }
    return NextResponse.json({ status: "disabled", externalSend: false });
  } catch {
    return NextResponse.json({ status: "unavailable", externalSend: false }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ status: "rejected", externalSend: false }, { status: 403 });
  try {
    const roots = resolveEduPiBridgeRoots();
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    if (!body || !validIdentity(body) || Object.keys(body).length !== 4
      || !(body.action === "arm" || body.action === "ack" || body.action === "cancel")
        && (typeof body.text !== "string" || !body.text.trim() || body.text.length > 4000)) {
      return NextResponse.json({ status: "invalid", externalSend: false }, { status: 400 });
    }
    const sessionId = body.sessionId;
    const messageId = body.messageId;
    const occurredAt = body.occurredAt;
    return await withEduPiAmbientSessionLock(sessionId, async () => {
      if (!await resolveSessionPath(sessionId)) {
        return NextResponse.json({ status: "session_unavailable", externalSend: false }, { status: 409 });
      }
      const ledgerOptions = { dataRoot: roots.dataRoot.root };
      if (body.action === "ack") {
        acknowledgeEduPiAmbientMessagePlan(sessionId, messageId, occurredAt, ledgerOptions);
        return NextResponse.json({ status: "acknowledged", externalSend: false });
      }
      if (body.action === "cancel") {
        cancelEduPiAmbientMessagePlan(sessionId, messageId, occurredAt, ledgerOptions);
        return NextResponse.json({ status: "cancelled", externalSend: false });
      }
      if (body.action === "arm") {
        if (readPendingEduPiAmbientMessages(sessionId, ledgerOptions).some(item => item.messageId !== messageId)) {
          return NextResponse.json({ status: "verification_pending", externalSend: false }, { status: 409 });
        }
        const activations = activeBindings(roots);
        if (activations.length === 0) return NextResponse.json({ status: "disabled", externalSend: false });
        if (activations.some(({ activation }) => !activation.grantId || !activation.scope)) {
          return NextResponse.json({ status: "unconfigured", externalSend: false }, { status: 409 });
        }
        const plan = armEduPiAmbientMessagePlan({ sessionId, messageId, occurredAt,
          domains: activations.map(({ domain, activation }) => ({ domain,
            grantId: activation.grantId!, scopeHash: scopeHash(activation.scope!) })) }, ledgerOptions);
        return NextResponse.json({ status: plan.status === "pending" ? "armed" : "outcome_unknown", externalSend: false });
      }
      const plan = readEduPiAmbientMessagePlan(sessionId, messageId, ledgerOptions);
      if (!plan) {
        if (readPendingEduPiAmbientMessages(sessionId, ledgerOptions).some(item => item.messageId !== messageId)) {
          return NextResponse.json({ status: "verification_pending", messageComplete: false, externalSend: false }, { status: 409 });
        }
        return NextResponse.json({ status: "outcome_unknown", resolutionStatus: "needs_verification",
          reason: "plan_missing", messageComplete: false, externalSend: false }, { status: 409 });
      }
      if (plan.occurredAt !== occurredAt) return NextResponse.json({ status: "identity_conflict", externalSend: false }, { status: 409 });
      if (plan.status === "complete") return NextResponse.json({ status: "captured", resolutionStatus: "settled",
        reason: null, messageComplete: true, messageId, occurredAt, externalSend: false });
      if (plan.domains.some(item => item.state !== "unattempted")) return NextResponse.json({ status: "outcome_unknown",
        resolutionStatus: "needs_verification", reason: "plan_incomplete", messageComplete: false, externalSend: false });
      const otherPending = readPendingEduPiAmbientMessages(sessionId, ledgerOptions)
        .some(item => item.messageId !== messageId);
      if (otherPending) return NextResponse.json({ status: "verification_pending", messageComplete: false,
        externalSend: false }, { status: 409 });
      const host = await ensureEduPiRuntime(roots);
      const health = record((await host.call("health", null)).result);
      const capabilities = record(health?.capabilities);
      const rootRef = health?.data_root_fingerprint;
      if (typeof rootRef !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(rootRef)
        || capabilities?.ambient_planning !== "active" || capabilities?.owner_intent !== "active") {
        throw new EduPiAmbientMessageError("proactivity_runtime_unavailable");
      }
      const results: Array<Record<string, unknown> & { status: string }> = [];
      for (const planned of plan.domains) {
        const domain = planned.domain;
        let preparedMessageRef: string | null = null;
        let applyPending = false;
        try {
          const current = activeBindings(roots).find(item => item.domain === domain
            && item.activation.grantId === planned.grantId && item.activation.scope
            && scopeHash(item.activation.scope) === planned.scopeHash);
          if (!current?.activation.scope || !current.activation.grantId) {
            markEduPiAmbientPlanDomainUnavailable(sessionId, messageId, domain, ledgerOptions);
            results.push({ status: "unavailable", domain, code: "proactivity_grant_unavailable", externalSend: false });
            continue;
          }
          if (domain === "student_followup" && capabilities.g2_processor !== "active") throw new EduPiAmbientMessageError("proactivity_runtime_unavailable");
          if (isG3Domain(domain) && capabilities.g3_processor !== "active") throw new EduPiAmbientMessageError("proactivity_runtime_unavailable");
          startEduPiAmbientPlanDomain(sessionId, messageId, domain, ledgerOptions);
          const result = await captureAndApplyAmbientMessage(host, {
            rootRef, grantId: planned.grantId, messageId, text: body.text as string, occurredAt, domain,
          }, { controlScope: current.activation.scope, capabilityActive: isG3Domain(domain) && capabilities.g3_processor === "active",
            onPrepared: async (binding) => {
              prepareEduPiAmbientMessageBinding({ sessionId, messageId, occurredAt, ...binding }, ledgerOptions);
              preparedMessageRef = binding.messageRef;
            },
            onCaptured: async (binding) => {
              confirmEduPiAmbientMessageBinding(sessionId, messageId, binding.messageRef, ledgerOptions);
            },
            onApplyPending: async (binding) => {
              if (binding.messageRef !== preparedMessageRef) throw new Error("ambient_message_identity_changed");
              markEduPiAmbientMessageOutcomeUnknown(sessionId, binding.messageRef, ledgerOptions);
              applyPending = true;
            } });
          if (result.status === "outcome_unknown" || result.status === "recorded") {
            if (!applyPending && preparedMessageRef) markEduPiAmbientMessageOutcomeUnknown(sessionId, preparedMessageRef, ledgerOptions);
          } else if (preparedMessageRef) {
            finishEduPiAmbientPlanDomain(sessionId, messageId, domain, preparedMessageRef, ledgerOptions);
          }
          results.push({ ...result, domain });
          // Core already persisted a G1 Goal. Do not start a second domain
          // while its exact work-case linkage still needs verification.
          if (result.status === "recorded" || result.status === "outcome_unknown") break;
        } catch (error) {
          if (preparedMessageRef) {
            let durable = false;
            try { markEduPiAmbientMessageOutcomeUnknown(sessionId, preparedMessageRef, ledgerOptions); durable = true; }
            catch { /* The uncertain write cannot be safely retried in this request. */ }
            results.push({ status: "outcome_unknown", resolutionStatus: "needs_verification",
              reason: "apply_outcome_unknown", domain, durable, externalSend: false });
            break;
          }
          try { markEduPiAmbientPlanDomainUnavailable(sessionId, messageId, domain, ledgerOptions); }
          catch { /* An already started domain remains unknown. */ }
          results.push({ status: "unavailable", domain, externalSend: false,
            code: error instanceof EduPiAmbientMessageError ? error.code : "proactivity_runtime_unavailable",
            stage: error instanceof EduPiAmbientMessageError ? error.stage : "runtime" });
        }
      }
      const completed = readEduPiAmbientMessagePlan(sessionId, messageId, ledgerOptions)?.status === "complete";
      const chosen = results.find(item => item.status === "outcome_unknown" || item.status === "recorded")
        ?? results.find(item => ["applied", "cancelled", "corrected", "queued", "replayed"].includes(item.status))
        ?? results.find(item => item.status !== "unavailable") ?? results[0];
      const result = completed ? chosen : { status: "outcome_unknown", resolutionStatus: "needs_verification",
        reason: "plan_incomplete", externalSend: false };
      return NextResponse.json({ ...result, messageComplete: completed, ...(completed ? { messageId, occurredAt } : {}),
        ...(results.length > 1 ? { domainResults: results } : {}) });
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ status: "too_large", externalSend: false }, { status: 413 });
    const code = error instanceof EduPiAmbientMessageError ? error.code : "proactivity_runtime_unavailable";
    return NextResponse.json({ status: "unavailable", code, stage: error instanceof EduPiAmbientMessageError ? error.stage : "runtime", externalSend: false }, { status: code === "proactivity_grant_unavailable" ? 409 : 503 });
  }
}
