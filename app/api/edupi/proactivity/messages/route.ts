import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { captureAndApplyAmbientMessage, EduPiAmbientMessageError } from "@/lib/edupi-ambient-message-runtime";
import { confirmEduPiAmbientMessageBinding, prepareEduPiAmbientMessageBinding } from "@/lib/edupi-ambient-message-ledger";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { readEduPiProactivityActivation, type EduPiProactivityDomain } from "@/lib/edupi-proactivity-config";
import { readProactivityOwnerContext } from "@/lib/edupi-proactivity-runtime";
import { ensureEduPiRuntime } from "@/lib/edupi-runtime-supervisor";
import { resolveSessionPath } from "@/lib/session-reader";
import { withEduPiAmbientSessionLock } from "@/lib/edupi-ambient-session-lock";
import { canStartEduPiStudentFollowup } from "@/lib/safe-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 16 * 1024;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function activeBindings(dataRoot: string) {
  const domains: EduPiProactivityDomain[] = canStartEduPiStudentFollowup()
    ? ["teaching_preparation", "student_followup"] : ["teaching_preparation"];
  return domains.map(domain => ({ domain, activation: readEduPiProactivityActivation({ dataRoot, domain }) }))
    .filter(binding => binding.activation.enabled);
}

export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ status: "rejected", externalSend: false }, { status: 403 });
  try {
    const roots = resolveEduPiBridgeRoots();
    const bindings = activeBindings(roots.dataRoot.root).filter(({ activation }) => activation.grantId && activation.scope);
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
    const activations = activeBindings(roots.dataRoot.root);
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
      const host = await ensureEduPiRuntime(roots);
      const health = record((await host.call("health", null)).result);
      const capabilities = record(health?.capabilities);
      const rootRef = health?.data_root_fingerprint;
      if (typeof rootRef !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(rootRef)
        || capabilities?.ambient_planning !== "active" || capabilities?.owner_intent !== "active") {
        throw new EduPiAmbientMessageError("proactivity_runtime_unavailable");
      }
      const results: Array<Record<string, unknown> & { status: string }> = [];
      for (const { domain, activation } of bindings) {
        try {
          if (domain === "student_followup" && capabilities.g2_processor !== "active") throw new EduPiAmbientMessageError("proactivity_runtime_unavailable");
          // One teacher message may have independent G1/G2 source receipts.
          // Keep both in the existing session withdrawal ledger without a migration.
          const captureId = domain === "student_followup"
            ? `g2_${createHash("sha256").update(`${sessionId}\0${messageId}`).digest("hex")}` : messageId;
          const result = await captureAndApplyAmbientMessage(host, {
            rootRef, grantId: activation.grantId!, messageId: captureId, text, occurredAt, domain,
          }, { controlScope: activation.scope!,
            onPrepared: async (binding) => {
              prepareEduPiAmbientMessageBinding({ sessionId, messageId: captureId, occurredAt, ...binding }, { dataRoot: roots.dataRoot.root });
            },
            onCaptured: async (binding) => {
              confirmEduPiAmbientMessageBinding(sessionId, captureId, binding.messageRef, { dataRoot: roots.dataRoot.root });
            } });
          results.push({ ...result, domain });
          // Core already persisted a G1 Goal. Do not start a second domain
          // while its exact work-case linkage still needs verification.
          if (result.status === "recorded") break;
        } catch (error) {
          results.push({ status: "unavailable", domain, externalSend: false,
            code: error instanceof EduPiAmbientMessageError ? error.code : "proactivity_runtime_unavailable",
            stage: error instanceof EduPiAmbientMessageError ? error.stage : "runtime" });
        }
      }
      const result = results.find(item => ["applied", "cancelled", "corrected", "queued", "replayed", "recorded"].includes(item.status))
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
