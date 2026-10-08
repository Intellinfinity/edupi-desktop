import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { captureAndApplyAmbientMessage, EduPiAmbientMessageError, predictEduPiOwnerMessageRef } from "@/lib/edupi-ambient-message-runtime";
import { confirmEduPiAmbientMessageBinding, markEduPiAmbientMessageOutcomeSettled, markEduPiAmbientMessageOutcomeUnknown,
  markEduPiAmbientMessageOutcomeVerified, prepareEduPiAmbientMessageBinding, readSettledEduPiAmbientMessages,
  readUnsettledEduPiAmbientMessages } from "@/lib/edupi-ambient-message-ledger";
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

function isG3Domain(domain: EduPiProactivityDomain): domain is EduPiCapabilityDomain { return G3_DOMAINS.includes(domain); }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
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
      if (!/^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,255}$/u.test(sessionId)) {
        return NextResponse.json({ status: "invalid", externalSend: false }, { status: 400 });
      }
      const roots = resolveEduPiBridgeRoots();
      return await withEduPiAmbientSessionLock(sessionId, async () => {
        if (!await resolveSessionPath(sessionId)) return NextResponse.json({ status: "session_unavailable", externalSend: false }, { status: 409 });
        let pending = readUnsettledEduPiAmbientMessages(sessionId, { dataRoot: roots.dataRoot.root });
        const recovered: Array<{ messageId: string; goalId: string; workCaseId: string }
          | { messageId: string; goalId: string; followUpId: string; executionId: string }> = [];
        if (pending.length && query.get("verify") === "1") {
          try {
            const host = await ensureEduPiRuntime(roots);
            const healthResponse = record(await host.call("health", null));
            const health = healthResponse?.ok === true ? record(healthResponse.result) : null;
            const rootRef = health?.data_root_fingerprint;
            if (typeof rootRef === "string" && /^sha256:[a-f0-9]{64}$/u.test(rootRef)) {
              for (const entry of pending.filter(item => item.status === "outcome_unknown").slice(0, 20)) {
                const g2 = predictEduPiOwnerMessageRef(rootRef, entry.ownerId, entry.messageId, "student_followup") === entry.messageRef;
                if (g2) {
                  const proof = await readExactEduPiG2Execution(host, rootRef, entry);
                  if (proof.status !== "applied") continue;
                  markEduPiAmbientMessageOutcomeVerified(sessionId, entry.messageRef, { dataRoot: roots.dataRoot.root });
                  recovered.push({ messageId: entry.messageId, goalId: proof.goalId,
                    followUpId: proof.followUpId, executionId: proof.executionId });
                } else {
                  const proof = await readExactEduPiAmbientGoalBinding(host, rootRef, entry);
                  if (proof.status !== "applied") continue;
                  markEduPiAmbientMessageOutcomeVerified(sessionId, entry.messageRef, { dataRoot: roots.dataRoot.root });
                  recovered.push({ messageId: entry.messageId, goalId: proof.goalId, workCaseId: proof.workCaseId });
                }
              }
              pending = readUnsettledEduPiAmbientMessages(sessionId, { dataRoot: roots.dataRoot.root });
            }
          } catch { /* Missing exact Core proof leaves the durable outcome pending. */ }
        }
        const settled = readSettledEduPiAmbientMessages(sessionId, { dataRoot: roots.dataRoot.root });
        return NextResponse.json({ status: pending.length ? "outcome_unknown" : recovered.length ? "applied" : "clear",
          recovered, pending: [...new Map(pending.map(item => [item.messageId,
            { messageId: item.messageId, occurredAt: item.occurredAt }])).values()],
          settled: [...new Map(settled.map(item => [item.messageId,
            { messageId: item.messageId, occurredAt: item.occurredAt }])).values()],
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
    const activations = activeBindings(roots);
    if (activations.length === 0) return NextResponse.json({ status: "disabled", externalSend: false }, { status: 202 });
    const bindings = activations.filter(({ activation }) => activation.grantId && activation.scope);
    if (bindings.length === 0) return NextResponse.json({ status: "unconfigured", externalSend: false }, { status: 409 });
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    if (!body || Object.keys(body).length !== 4 || !Object.hasOwn(body, "sessionId") || !Object.hasOwn(body, "messageId") || !Object.hasOwn(body, "text") || !Object.hasOwn(body, "occurredAt")
      || typeof body.sessionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,255}$/u.test(body.sessionId)
      || typeof body.messageId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,127}$/u.test(body.messageId)
      || typeof body.text !== "string" || !body.text.trim() || body.text.length > 4000
      || typeof body.occurredAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(body.occurredAt)) {
      return NextResponse.json({ status: "invalid", externalSend: false }, { status: 400 });
    }
    const sessionId = body.sessionId;
    const messageId = body.messageId;
    const text = body.text;
    const occurredAt = body.occurredAt;
    return await withEduPiAmbientSessionLock(sessionId, async () => {
      if (!await resolveSessionPath(sessionId)) {
        return NextResponse.json({ status: "session_unavailable", externalSend: false }, { status: 409 });
      }
      const g2CaptureId = `g2_${createHash("sha256").update(`${sessionId}\0${messageId}`).digest("hex")}`;
      const uncertain = readUnsettledEduPiAmbientMessages(sessionId, { dataRoot: roots.dataRoot.root });
      const priorUnknown = uncertain
        .find(item => item.messageId === messageId || item.messageId === g2CaptureId);
      if (priorUnknown) return NextResponse.json(priorUnknown.occurredAt === occurredAt
        ? { status: "outcome_unknown", resolutionStatus: "needs_verification", reason: "apply_outcome_unknown", externalSend: false }
        : { status: "identity_conflict", externalSend: false }, { status: priorUnknown.occurredAt === occurredAt ? 200 : 409 });
      if (uncertain.length) return NextResponse.json({ status: "verification_pending", externalSend: false }, { status: 409 });
      const priorSettled = readSettledEduPiAmbientMessages(sessionId, { dataRoot: roots.dataRoot.root })
        .find(item => item.messageId === messageId || item.messageId === g2CaptureId);
      if (priorSettled) return NextResponse.json(priorSettled.occurredAt === occurredAt
        ? { status: "captured", resolutionStatus: "settled", reason: null, externalSend: false }
        : { status: "identity_conflict", externalSend: false }, { status: priorSettled.occurredAt === occurredAt ? 200 : 409 });
      const host = await ensureEduPiRuntime(roots);
      const health = record((await host.call("health", null)).result);
      const capabilities = record(health?.capabilities);
      const rootRef = health?.data_root_fingerprint;
      if (typeof rootRef !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(rootRef)
        || capabilities?.ambient_planning !== "active" || capabilities?.owner_intent !== "active") {
        throw new EduPiAmbientMessageError("proactivity_runtime_unavailable");
      }
      const results: Array<Record<string, unknown> & { status: string }> = [];
      const settleAtEnd: string[] = [];
      for (const { domain, activation } of bindings) {
        let preparedMessageRef: string | null = null;
        let applyPending = false;
        try {
          if (domain === "student_followup" && capabilities.g2_processor !== "active") throw new EduPiAmbientMessageError("proactivity_runtime_unavailable");
          if (isG3Domain(domain) && capabilities.g3_processor !== "active") throw new EduPiAmbientMessageError("proactivity_runtime_unavailable");
          // Core distinguishes the domain conversations. The private ledger
          // retains each distinct message_ref under the original Pi message
          // ID so a cold-start outbox can reconcile any domain receipt.
          const captureId = messageId;
          const result = await captureAndApplyAmbientMessage(host, {
            rootRef, grantId: activation.grantId!, messageId: captureId, text, occurredAt, domain,
          }, { controlScope: activation.scope!, capabilityActive: isG3Domain(domain) && capabilities.g3_processor === "active",
            onPrepared: async (binding) => {
              prepareEduPiAmbientMessageBinding({ sessionId, messageId: captureId, occurredAt, ...binding }, { dataRoot: roots.dataRoot.root });
              preparedMessageRef = binding.messageRef;
            },
            onCaptured: async (binding) => {
              confirmEduPiAmbientMessageBinding(sessionId, captureId, binding.messageRef, { dataRoot: roots.dataRoot.root });
            },
            onApplyPending: async (binding) => {
              if (binding.messageRef !== preparedMessageRef) throw new Error("ambient_message_identity_changed");
              markEduPiAmbientMessageOutcomeUnknown(sessionId, binding.messageRef, { dataRoot: roots.dataRoot.root });
              applyPending = true;
            } });
          if (result.status === "outcome_unknown" || result.status === "recorded") {
            if (!applyPending) markEduPiAmbientMessageOutcomeUnknown(sessionId, preparedMessageRef!, { dataRoot: roots.dataRoot.root });
          } else if (preparedMessageRef) {
            settleAtEnd.push(preparedMessageRef);
          }
          results.push({ ...result, domain });
          // Core already persisted a G1 Goal. Do not start a second domain
          // while its exact work-case linkage still needs verification.
          if (result.status === "recorded" || result.status === "outcome_unknown") break;
        } catch (error) {
          if (preparedMessageRef) {
            let durable = false;
            try { markEduPiAmbientMessageOutcomeUnknown(sessionId, preparedMessageRef, { dataRoot: roots.dataRoot.root }); durable = true; }
            catch { /* The uncertain write cannot be safely retried in this request. */ }
            results.push({ status: "outcome_unknown", resolutionStatus: "needs_verification",
              reason: "apply_outcome_unknown", domain, durable, externalSend: false });
            break;
          }
          results.push({ status: "unavailable", domain, externalSend: false,
            code: error instanceof EduPiAmbientMessageError ? error.code : "proactivity_runtime_unavailable",
            stage: error instanceof EduPiAmbientMessageError ? error.stage : "runtime" });
        }
      }
      // A completed first domain is not a completed Pi message. Persist the
      // final receipt only after every enabled domain has been considered; a
      // crash between domains leaves captured rows visibly unsettled.
      for (const messageRef of settleAtEnd) {
        markEduPiAmbientMessageOutcomeSettled(sessionId, messageRef, { dataRoot: roots.dataRoot.root });
      }
      const result = results.find(item => item.status === "outcome_unknown" || item.status === "recorded")
        ?? results.find(item => ["applied", "cancelled", "corrected", "queued", "replayed"].includes(item.status))
        ?? results.find(item => item.status !== "unavailable") ?? results[0];
      return NextResponse.json({ ...result, ...(results.length > 1 ? { domainResults: results } : {}) },
        { status: result.status !== "unavailable" ? 200 : result.code === "proactivity_grant_unavailable" ? 409 : 503 });
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ status: "too_large", externalSend: false }, { status: 413 });
    const code = error instanceof EduPiAmbientMessageError ? error.code : "proactivity_runtime_unavailable";
    return NextResponse.json({ status: "unavailable", code, stage: error instanceof EduPiAmbientMessageError ? error.stage : "runtime", externalSend: false }, { status: code === "proactivity_grant_unavailable" ? 409 : 503 });
  }
}
