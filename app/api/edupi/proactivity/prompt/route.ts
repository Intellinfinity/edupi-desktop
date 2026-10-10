import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { confirmEduPiAmbientMessageBinding, markEduPiAmbientMessageAbandoned,
  markEduPiAmbientMessageWithdrawn, readEduPiAmbientMessagesForSession,
  prepareEduPiAmbientMessageBinding } from "@/lib/edupi-ambient-message-ledger";
import { withEduPiAmbientSessionLock } from "@/lib/edupi-ambient-session-lock";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { readEduPiProactivityActivation, type EduPiProactivityDomain } from "@/lib/edupi-proactivity-config";
import { readProactivityOwnerContext } from "@/lib/edupi-proactivity-runtime";
import { registerAndCapturePrompt, settleRegisteredPrompt } from "@/lib/edupi-registered-prompt";
import { ensureEduPiRuntime } from "@/lib/edupi-runtime-supervisor";
import { getRpcSession } from "@/lib/rpc-manager";
import { inspectEduPiPromptSession } from "@/lib/edupi-prompt-reconciliation";
import { resolveSessionPath } from "@/lib/session-reader";
import { startHarnessSession } from "@/lib/harness/runtime";
import { canStartEduPiProactivity, canStartEduPiStudentFollowup } from "@/lib/safe-mode";
import { discardEduPiPromptIntent, listEduPiPromptIntents, readEduPiPromptIntent, resolveEduPiPromptIntent } from "@/lib/edupi-prompt-intent";
import { validateAgentImages } from "@/lib/image-attachments";
import { prepareEduPiPromptOutbox, readEduPiPromptOutbox, listEduPiPromptOutbox, markEduPiPromptOutboxCancelled,
  markEduPiPromptOutboxSourceWithdrawn,
  recordEduPiPromptOutboxRegistration,
  recordEduPiPromptOutboxCapture, markEduPiPromptOutboxPiDispatching,
  markEduPiPromptOutboxPiAccepted, markEduPiPromptOutboxPiUnknown } from "@/lib/edupi-prompt-outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 1_200_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,127}$/u;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,255}$/u;
const ROOT_REF = /^sha256:[a-f0-9]{64}$/u;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function canonicalTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function activations(dataRoot: string) {
  const domains: EduPiProactivityDomain[] = [
    ...(canStartEduPiProactivity() ? ["teaching_preparation" as const] : []),
    ...(canStartEduPiStudentFollowup() ? ["student_followup" as const] : []),
  ];
  return domains.map(domain => ({ domain, activation: readEduPiProactivityActivation({ dataRoot, domain }) }))
    .filter(({ activation }) => activation.enabled);
}

function response(status: string, code = 200) {
  return NextResponse.json({ status, externalSend: false }, { status: code });
}

function resolveIntentIfPresent(sessionId: string, clientRequestId: string, dataRoot: string): void {
  const options = { dataRoot };
  if (readEduPiPromptIntent(sessionId, clientRequestId, options)) {
    resolveEduPiPromptIntent(sessionId, clientRequestId, options);
  }
}

function discardIntentIfPresent(sessionId: string, clientRequestId: string, dataRoot: string): void {
  const options = { dataRoot };
  if (readEduPiPromptIntent(sessionId, clientRequestId, options)) {
    discardEduPiPromptIntent(sessionId, clientRequestId, options);
  }
}

export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return response("rejected", 403);
  try {
    const sessionId = new URL(request.url).searchParams.get("sessionId");
    if (sessionId !== null && !SESSION_ID.test(sessionId)) return response("invalid", 400);
    const roots = resolveEduPiBridgeRoots();
    const entries = listEduPiPromptOutbox({ dataRoot: roots.dataRoot.root })
      .filter(item => sessionId === null || item.sessionId === sessionId);
    return NextResponse.json({ status: "ready", entries, externalSend: false });
  } catch { return response("unavailable", 503); }
}

export async function PUT(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return response("rejected", 403);
  try {
    const body = record(await parseJsonWithinLimit(request, 1024));
    if (!body || Object.keys(body).length !== 2 || !SESSION_ID.test(String(body.sessionId || ""))
      || !ID.test(String(body.clientRequestId || ""))) return response("invalid", 400);
    const roots = resolveEduPiBridgeRoots();
    const saved = readEduPiPromptOutbox(String(body.sessionId), String(body.clientRequestId),
      { dataRoot: roots.dataRoot.root });
    if (!saved) return response("not_found", 404);
    if (saved.stage === "cancelled") return response("cancelled", 409);
    if (saved.stage === "pi_unverified_withdrawn") return response("source_withdrawn", 409);
    if (["pi_dispatching", "pi_unknown"].includes(saved.stage)) return response("uncertain", 202);
    if (["pi_accepted", "pi_accepted_withdrawn"].includes(saved.stage)) return response("accepted");
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    const retry = new Request(request.url, { method: "POST", headers,
      body: JSON.stringify({ sessionId: saved.sessionId, messageId: saved.messageId,
        occurredAt: saved.occurredAt, command: saved.command }) });
    return POST(retry);
  } catch (error) {
    return error instanceof RequestBodyTooLargeError ? response("too_large", 413) : response("unavailable", 503);
  }
}

export async function PATCH(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return response("rejected", 403);
  try {
    const body = record(await parseJsonWithinLimit(request, 1024));
    if (!body || Object.keys(body).length !== 2 || !SESSION_ID.test(String(body.sessionId || ""))
      || !ID.test(String(body.clientRequestId || ""))) return response("invalid", 400);
    const roots = resolveEduPiBridgeRoots();
    const sessionId = String(body.sessionId), clientRequestId = String(body.clientRequestId);
    return await withEduPiAmbientSessionLock(sessionId, async () => {
      const options = { dataRoot: roots.dataRoot.root };
      const saved = readEduPiPromptOutbox(sessionId, clientRequestId, options);
      if (!saved) return response("not_found", 404);
      if (["pi_accepted", "pi_accepted_withdrawn"].includes(saved.stage)) {
        resolveIntentIfPresent(sessionId, clientRequestId, roots.dataRoot.root);
        return response("accepted");
      }
      if (saved.stage === "cancelled") return response("cancelled", 409);
      if (!["pi_dispatching", "pi_unknown", "pi_unverified_withdrawn"].includes(saved.stage)) return response("not_dispatched", 409);
      const filePath = await resolveSessionPath(sessionId);
      const evidence = filePath ? inspectEduPiPromptSession(saved, filePath) : "unknown";
      if (evidence === "confirmed") {
        markEduPiPromptOutboxPiAccepted(sessionId, clientRequestId, options);
        resolveIntentIfPresent(sessionId, clientRequestId, roots.dataRoot.root);
        return response("accepted");
      }
      return NextResponse.json({ status: "uncertain", evidence, externalSend: false }, { status: 202 });
    });
  } catch (error) {
    return error instanceof RequestBodyTooLargeError ? response("too_large", 413) : response("unavailable", 503);
  }
}

export async function DELETE(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return response("rejected", 403);
  try {
    const body = record(await parseJsonWithinLimit(request, 1024));
    if (!body || Object.keys(body).length !== 2 || !SESSION_ID.test(String(body.sessionId || ""))
      || !ID.test(String(body.clientRequestId || ""))) return response("invalid", 400);
    const roots = resolveEduPiBridgeRoots();
    const sessionId = String(body.sessionId), clientRequestId = String(body.clientRequestId);
    return await withEduPiAmbientSessionLock(sessionId, async () => {
      const options = { dataRoot: roots.dataRoot.root };
      let saved = readEduPiPromptOutbox(sessionId, clientRequestId, options);
      if (!saved) return response("not_found", 404);
      if (saved.stage === "cancelled") {
        discardIntentIfPresent(sessionId, clientRequestId, roots.dataRoot.root);
        return response("cancelled");
      }
      if (saved.stage === "pi_unverified_withdrawn") return response("source_withdrawn");
      const piOutcomeUnknown = ["pi_dispatching", "pi_unknown"].includes(saved.stage);
      if (!["prepared", "registered", "captured", "pi_dispatching", "pi_unknown"].includes(saved.stage)) return response("cannot_cancel", 409);
      const host = await ensureEduPiRuntime(roots);
      const health = record(record(await host.call("health", null))?.result);
      const rootRef = health?.data_root_fingerprint;
      if (typeof rootRef !== "string" || !ROOT_REF.test(rootRef)) return response("core_unavailable", 503);
      const proofs: Array<{ domain: EduPiProactivityDomain; messageRef: string; status: "sealed_absent" | "withdrawn" }> = [];
      for (const binding of saved.bindings) {
        const settled = await settleRegisteredPrompt(host, { rootRef, grantId: binding.grantId,
          sessionId, messageId: binding.captureMessageId, text: saved.command.message,
          occurredAt: saved.occurredAt, domain: binding.domain, carrierId: binding.carrierId,
          planId: binding.planId, previousBinding: { ownerId: binding.ownerId,
            grantId: binding.grantId, grantVersion: binding.grantVersion },
          ...(binding.registration ? { previousRegistration: { carrier_id: binding.carrierId,
            plan_id: binding.planId, producer_epoch: binding.registration.producerEpoch,
            sequence: binding.registration.sequence } } : {}),
        }, { onRegistered: proof => {
          saved = recordEduPiPromptOutboxRegistration(sessionId, clientRequestId, binding.domain, {
            messageRef: proof.messageRef, producerEpoch: proof.registration.producer_epoch,
            sequence: proof.registration.sequence, fencingGeneration: proof.fencingGeneration,
            instanceNonce: proof.instanceNonce,
          }, options);
          prepareEduPiAmbientMessageBinding({ sessionId, messageId: binding.captureMessageId,
            messageRef: proof.messageRef, ownerId: binding.ownerId, grantId: binding.grantId,
            captureGrantVersion: binding.grantVersion, occurredAt: saved.occurredAt }, options);
        } });
        const ledger = readEduPiAmbientMessagesForSession(sessionId, options)
          .find(item => item.messageRef === settled.messageRef);
        if (piOutcomeUnknown && settled.status !== "withdrawn") throw new Error("dispatched_prompt_absence_conflict");
        if (settled.status === "withdrawn") {
          if (!ledger || !settled.recordedAt) throw new Error("owner_message_withdrawal_unrecorded");
          markEduPiAmbientMessageWithdrawn(sessionId, settled.messageRef, settled.recordedAt, options);
        } else if (ledger?.status === "pending") {
          markEduPiAmbientMessageAbandoned(sessionId, settled.messageRef, new Date().toISOString(), options);
        } else if (ledger && ledger.status !== "abandoned") throw new Error("owner_message_seal_conflict");
        proofs.push({ domain: binding.domain, messageRef: settled.messageRef, status: settled.status });
      }
      if (piOutcomeUnknown) {
        markEduPiPromptOutboxSourceWithdrawn(sessionId, clientRequestId, proofs, options);
        return response("source_withdrawn");
      }
      markEduPiPromptOutboxCancelled(sessionId, clientRequestId, proofs, options);
      discardIntentIfPresent(sessionId, clientRequestId, roots.dataRoot.root);
      return response("cancelled");
    });
  } catch (error) {
    return error instanceof RequestBodyTooLargeError ? response("too_large", 413) : response("unavailable", 503);
  }
}

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return response("rejected", 403);
  let outboxPrepared = false;
  try {
    const roots = resolveEduPiBridgeRoots();
    const enabled = activations(roots.dataRoot.root);
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    const command = record(body?.command);
    if (!body || Object.keys(body).length !== 4 || !SESSION_ID.test(String(body.sessionId || ""))
      || !ID.test(String(body.messageId || "")) || !canonicalTime(body.occurredAt)
      || !command || command.type !== "prompt" || typeof command.clientRequestId !== "string"
      || !ID.test(command.clientRequestId) || typeof command.message !== "string"
      || (enabled.length > 0 && command.message.length > 4000)
      || Object.keys(command).some(key => !["type", "message", "clientRequestId", "images"].includes(key))
      || validateAgentImages(command.images) !== null
      || (!command.message.trim() && (!Array.isArray(command.images) || command.images.length === 0))) {
      return response("invalid", 400);
    }
    const promptCommand = command as { type: "prompt"; message: string; clientRequestId: string;
      images?: Array<{ type: "image"; data: string; mimeType: string }> };
    if (promptCommand.images?.length) return response("attachment_requires_review", 422);
    const sessionId = String(body.sessionId), clientRequestId = promptCommand.clientRequestId;
    const messageId = String(body.messageId), occurredAt = body.occurredAt;
    return await withEduPiAmbientSessionLock(sessionId, async () => {
      const options = { dataRoot: roots.dataRoot.root };
      const prior = readEduPiPromptOutbox(sessionId, clientRequestId, options);
      if (!prior && listEduPiPromptOutbox(options).some(item => item.sessionId === sessionId
        && item.clientRequestId !== clientRequestId
        && !["pi_accepted", "pi_accepted_withdrawn", "cancelled"].includes(item.stage))) {
        return response("prior_unresolved", 409);
      }
      if (prior && (prior.messageId !== messageId || prior.occurredAt !== occurredAt
        || !isDeepStrictEqual(prior.command, promptCommand))) return response("conflict", 409);
      if (prior && ["pi_dispatching", "pi_unknown"].includes(prior.stage)) return response("uncertain", 202);
      if (prior && ["pi_accepted", "pi_accepted_withdrawn"].includes(prior.stage)) {
        resolveIntentIfPresent(sessionId, clientRequestId, roots.dataRoot.root);
        return response("accepted");
      }
      if (prior?.stage === "cancelled") return response("cancelled", 409);
      if (prior?.stage === "pi_unverified_withdrawn") return response("source_withdrawn", 409);
      if (enabled.length === 0) return response(prior ? "uncertain" : "disabled", 202);
      const intent = readEduPiPromptIntent(sessionId, clientRequestId, options);
      if (!prior && (!intent || intent.status === "resolved" || intent.message !== promptCommand.message
        || intent.occurredAt !== occurredAt)) return response("intent_unavailable", 409);
      if (!prior && listEduPiPromptIntents(options).some(item => item.status === "pending"
        && item.clientRequestId !== clientRequestId && (item.sessionId === sessionId
          || item.cwd === intent!.cwd && item.message === promptCommand.message))) return response("prior_unresolved", 409);
      if (enabled.some(({ activation }) => !activation.grantId || !activation.scope)) return response("unconfigured", 409);
      if (prior && (prior.bindings.length !== enabled.length || prior.bindings.some(binding =>
        !enabled.some(item => item.domain === binding.domain && item.activation.grantId === binding.grantId)))) {
        return response("uncertain", 202);
      }
      const live = getRpcSession(sessionId);
      if (live?.isAlive()) live.ensureSessionPersisted();
      // A fresh Pi session otherwise exists only in memory until its first
      // assistant message. Persist the header before Core capture so a crash
      // cannot strand a registered first prompt under an unopenable ID.
      const sessionPath = await resolveSessionPath(sessionId);
      if (!sessionPath) return response("session_unavailable", 409);
      const host = await ensureEduPiRuntime(roots);
      const healthFrame = record(await host.call("health", null));
      const health = record(healthFrame?.result), capabilities = record(health?.capabilities);
      const rootRef = health?.data_root_fingerprint;
      if (healthFrame?.ok !== true || typeof rootRef !== "string" || !ROOT_REF.test(rootRef)
        || capabilities?.ambient_planning !== "active" || capabilities?.owner_message_registration !== "active"
        || enabled.some(({ domain }) => domain === "teaching_preparation" && capabilities?.g1_processor !== "active")
        || enabled.some(({ domain }) => domain === "student_followup" && capabilities?.g2_processor !== "active")) {
        return response("core_unavailable", 503);
      }
      const text = promptCommand.message.trim();
      const bindings = prior?.bindings ?? await Promise.all(enabled.map(async ({ domain, activation }) => {
        const context = await readProactivityOwnerContext(host, rootRef, activation.grantId!);
        if (!context || context.status !== "active") throw new Error("owner_grant_unavailable");
        const captureMessageId = domain === "student_followup"
          ? `g2_${createHash("sha256").update(`${sessionId}\0${messageId}`).digest("hex")}` : messageId;
        return { domain, ownerId: context.ownerId, grantId: context.grantId, grantVersion: context.grantVersion,
          captureMessageId, carrierId: `edupi.desktop.${domain === "student_followup" ? "g2" : "g1"}`,
          planId: `prompt.${clientRequestId}.${domain}` };
      }));
      let outbox = prepareEduPiPromptOutbox({ sessionId, clientRequestId, messageId, occurredAt, command: promptCommand, bindings }, options);
      outboxPrepared = true;
      for (const binding of outbox.bindings) {
        if (binding.captured) continue;
        const proof = await registerAndCapturePrompt(host, {
          rootRef, grantId: binding.grantId, sessionId, messageId: binding.captureMessageId,
          text, occurredAt, domain: binding.domain, carrierId: binding.carrierId,
          planId: binding.planId, previousBinding: { ownerId: binding.ownerId,
            grantId: binding.grantId, grantVersion: binding.grantVersion },
        }, {
          onBound: () => { throw new Error("outbox_binding_changed"); },
          onRegistered: (proof) => {
            outbox = recordEduPiPromptOutboxRegistration(sessionId, clientRequestId, binding.domain, {
              messageRef: proof.messageRef, producerEpoch: proof.registration.producer_epoch,
              sequence: proof.registration.sequence, fencingGeneration: proof.fencingGeneration,
              instanceNonce: proof.instanceNonce,
            }, options);
            prepareEduPiAmbientMessageBinding({ sessionId, messageId: binding.captureMessageId,
              messageRef: proof.messageRef, ownerId: binding.ownerId, grantId: binding.grantId,
              captureGrantVersion: binding.grantVersion, occurredAt }, options);
          },
          onCaptured: (proof) => {
            confirmEduPiAmbientMessageBinding(sessionId, binding.captureMessageId, proof.messageRef, options);
            outbox = recordEduPiPromptOutboxCapture(sessionId, clientRequestId, binding.domain,
              { captured: true, messageRef: proof.messageRef }, options);
          },
        });
        if (proof.messageRef !== outbox.bindings.find(item => item.domain === binding.domain)?.messageRef) {
          throw new Error("outbox_capture_mismatch");
        }
      }
      if (outbox.stage !== "captured") return response("core_unavailable", 503);
      markEduPiPromptOutboxPiDispatching(sessionId, clientRequestId, options);
      try {
        let current = getRpcSession(sessionId);
        if (!current?.isAlive()) {
          const filePath = await resolveSessionPath(sessionId);
          if (!filePath) throw new Error("session_unavailable_after_capture");
          await startHarnessSession(sessionId, filePath, undefined);
          current = getRpcSession(sessionId);
        }
        if (!current?.isAlive()) throw new Error("session_unavailable_after_capture");
        const commandHash = `sha256:${createHash("sha256").update(JSON.stringify(promptCommand)).digest("hex")}`;
        let received!: (value: boolean) => void;
        const userPersisted = new Promise<boolean>(resolve => { received = resolve; });
        const unsubscribe = current.onEvent(event => {
          const item = record(event), message = record(item?.message);
          if (item?.type === "message_end" && item.clientRequestId === clientRequestId
            && message?.role === "user" && typeof item.entryId === "string") received(true);
          if (["prompt_error", "prompt_done"].includes(String(item?.type)) && item?.clientRequestId === clientRequestId) {
            queueMicrotask(() => received(false));
          }
        });
        const deadline = setTimeout(() => received(false), 20_000);
        try {
        current.recordEduPiPromptDispatch(clientRequestId, commandHash);
        await current.sendCoreCapturedPrompt(promptCommand);
        const observed = await userPersisted;
        const filePath = observed ? await resolveSessionPath(sessionId) : null;
        if (!filePath || inspectEduPiPromptSession(outbox, filePath) !== "confirmed") {
          throw new Error("pi_prompt_persistence_unconfirmed");
        }
        markEduPiPromptOutboxPiAccepted(sessionId, clientRequestId, options);
        resolveIntentIfPresent(sessionId, clientRequestId, roots.dataRoot.root);
        } finally { clearTimeout(deadline); unsubscribe(); }
      } catch {
        markEduPiPromptOutboxPiUnknown(sessionId, clientRequestId, options);
        return response("uncertain", 202);
      }
      return response("accepted");
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return response("too_large", 413);
    return outboxPrepared ? response("uncertain", 202) : response("core_unavailable", 503);
  }
}
