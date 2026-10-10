import type { EduPiRuntimeHandle } from "./edupi-runtime-supervisor";
import { EDUPI_PROACTIVITY_CONVERSATION_ID, EDUPI_STUDENT_FOLLOWUP_CONVERSATION_ID } from "./edupi-proactivity-control";
import type { EduPiProactivityDomain } from "./edupi-proactivity-config";
import { predictEduPiOwnerMessageRef } from "./edupi-ambient-message-runtime";
import { readProactivityOwnerContext } from "./edupi-proactivity-runtime";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_REF = /^conversation:[a-f0-9]{64}$/u;
const EPOCH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/u;
const PRODUCER_ID = /^[A-Za-z0-9_.:-]{1,128}$/u;

export type RegisteredPromptBinding = { ownerId: string; grantId: string; grantVersion: number };
export type RegisteredPromptCredential = { carrier_id: string; plan_id: string; producer_epoch: string; sequence: number };
export type RegisteredPromptProof = { messageRef: string; binding: RegisteredPromptBinding; registration: RegisteredPromptCredential;
  fencingGeneration: number; instanceNonce: string };
export type RegisteredPromptInput = { rootRef: string; grantId: string; sessionId: string; messageId: string;
  text: string; occurredAt: string; domain: EduPiProactivityDomain; carrierId: string; planId: string;
  previousBinding?: RegisteredPromptBinding };

function result(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || (value as Record<string, unknown>).ok !== true) {
    throw new Error("owner_message_unavailable");
  }
  const body = (value as Record<string, unknown>).result;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("owner_message_response_invalid");
  return body as Record<string, unknown>;
}

function canonicalTime(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function conversation(domain: EduPiProactivityDomain): string {
  if (domain === "teaching_preparation") return EDUPI_PROACTIVITY_CONVERSATION_ID;
  if (domain === "student_followup") return EDUPI_STUDENT_FOLLOWUP_CONVERSATION_ID;
  throw new Error("owner_message_domain_invalid");
}

export async function registerPrompt(
  host: Pick<EduPiRuntimeHandle, "call" | "callOwnerControl">,
  input: RegisteredPromptInput,
  hooks: {
    onBound: (binding: RegisteredPromptBinding) => void;
    onRegistered: (proof: RegisteredPromptProof) => void;
  },
): Promise<RegisteredPromptProof> {
  if (!HASH.test(input.rootRef) || !ID.test(input.grantId) || !ID.test(input.sessionId) || !ID.test(input.messageId)
    || !PRODUCER_ID.test(input.carrierId) || !PRODUCER_ID.test(input.planId)
    || typeof input.text !== "string" || !input.text.trim() || input.text.length > 4000
    || !canonicalTime(input.occurredAt)) throw new Error("owner_message_input_invalid");
  let binding = input.previousBinding;
  if (!binding) {
    const context = await readProactivityOwnerContext(host, input.rootRef, input.grantId);
    if (!context || context.status !== "active") throw new Error("owner_grant_unavailable");
    binding = { ownerId: context.ownerId, grantId: context.grantId, grantVersion: context.grantVersion };
    hooks.onBound(binding);
  }
  if (!ID.test(binding.ownerId) || binding.grantId !== input.grantId
    || !Number.isSafeInteger(binding.grantVersion) || binding.grantVersion < 1) throw new Error("owner_message_binding_invalid");
  const conversationId = conversation(input.domain);
  const expectedMessageRef = predictEduPiOwnerMessageRef(input.rootRef, binding.ownerId, input.messageId, input.domain);
  const registered = result(await host.callOwnerControl("owner_message_register", {
    root_ref: input.rootRef, expected_owner_id: binding.ownerId, grant_id: binding.grantId,
    expected_grant_version: binding.grantVersion, conversation_id: conversationId,
    message_id: input.messageId, occurred_at: input.occurredAt, text: input.text,
    carrier_id: input.carrierId, plan_id: input.planId,
  }));
  if (registered.version !== 1 || registered.status !== "registered" || registered.root_ref !== input.rootRef
    || registered.owner_id !== binding.ownerId || registered.grant_id !== binding.grantId
    || registered.grant_version !== binding.grantVersion || registered.message_ref !== expectedMessageRef
    || !SOURCE_REF.test(String(registered.source_ref || ""))
    || registered.occurred_at !== input.occurredAt || registered.carrier_id !== input.carrierId
    || registered.plan_id !== input.planId || !EPOCH.test(String(registered.producer_epoch || ""))
    || !Number.isSafeInteger(registered.sequence) || Number(registered.sequence) < 1
    || !Number.isSafeInteger(registered.fencing_generation) || Number(registered.fencing_generation) < 1
    || typeof registered.instance_nonce !== "string" || !ID.test(registered.instance_nonce)
    || typeof registered.replayed !== "boolean" || registered.apply !== false || registered.live_authority !== false
    || registered.model_execute !== false || registered.external_send !== false) throw new Error("owner_message_registration_invalid");
  const registration: RegisteredPromptCredential = { carrier_id: input.carrierId, plan_id: input.planId,
    producer_epoch: String(registered.producer_epoch), sequence: Number(registered.sequence) };
  const proof = { messageRef: expectedMessageRef, binding, registration,
    fencingGeneration: Number(registered.fencing_generation), instanceNonce: String(registered.instance_nonce) };
  hooks.onRegistered(proof);
  return proof;
}

export async function registerAndCapturePrompt(
  host: Pick<EduPiRuntimeHandle, "call" | "callOwnerControl">,
  input: RegisteredPromptInput,
  hooks: {
    onBound: (binding: RegisteredPromptBinding) => void;
    onRegistered: (proof: RegisteredPromptProof) => void;
    onCaptured: (proof: RegisteredPromptProof) => void;
  },
): Promise<RegisteredPromptProof> {
  const proof = await registerPrompt(host, input, hooks);
  const { binding, registration } = proof;
  const conversationId = conversation(input.domain);
  const captured = result(await host.callOwnerControl("owner_message", {
    action: "capture", root_ref: input.rootRef, expected_owner_id: binding.ownerId,
    grant_id: binding.grantId, expected_grant_version: binding.grantVersion,
    conversation_id: conversationId, message_id: input.messageId, occurred_at: input.occurredAt,
    text: input.text, registration,
  }));
  const receipt = captured.receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("owner_message_capture_invalid");
  const item = receipt as Record<string, unknown>;
  if (item.action !== "capture" || item.message_ref !== proof.messageRef || item.revision !== 1
    || item.owner_id !== binding.ownerId || item.root_ref !== input.rootRef
    || item.capture_grant_version !== binding.grantVersion || item.sender_kind !== "local_owner_authenticated"
    || !SOURCE_REF.test(String(item.source_ref || "")) || !canonicalTime(item.received_at)
    || !canonicalTime(item.recorded_at)
    || item.apply !== false || item.live_authority !== false || item.external_send !== false
    || typeof captured.replayed !== "boolean") throw new Error("owner_message_capture_invalid");
  hooks.onCaptured(proof);
  return proof;
}

export async function settleRegisteredPrompt(
  host: Pick<EduPiRuntimeHandle, "call" | "callOwnerControl">,
  input: RegisteredPromptInput & { previousRegistration?: RegisteredPromptCredential },
  hooks: { onRegistered: (proof: RegisteredPromptProof) => void },
): Promise<{ status: "sealed_absent" | "withdrawn"; messageRef: string; recordedAt: string | null }> {
  const binding = input.previousBinding;
  if (!binding) throw new Error("owner_message_binding_invalid");
  let proof: RegisteredPromptProof;
  if (input.previousRegistration) {
    const health = result(await host.call("health", null));
    if (!Number.isSafeInteger(health.fencing_generation) || Number(health.fencing_generation) < 1
      || typeof health.instance_nonce !== "string" || !ID.test(health.instance_nonce)
      || health.data_root_fingerprint !== input.rootRef) throw new Error("owner_message_health_invalid");
    proof = { messageRef: predictEduPiOwnerMessageRef(input.rootRef, binding.ownerId, input.messageId, input.domain),
      binding, registration: input.previousRegistration,
      fencingGeneration: Number(health.fencing_generation), instanceNonce: health.instance_nonce };
  } else {
    proof = await registerPrompt(host, input, { onBound: () => { throw new Error("owner_message_binding_changed"); },
      onRegistered: hooks.onRegistered });
  }
  const common = { root_ref: input.rootRef, expected_owner_id: binding.ownerId,
    grant_id: binding.grantId, expected_grant_version: binding.grantVersion,
    conversation_id: conversation(input.domain), message_id: input.messageId,
    occurred_at: input.occurredAt, expected_message_ref: proof.messageRef,
    registration: proof.registration, expected_fencing_generation: proof.fencingGeneration,
    expected_instance_nonce: proof.instanceNonce };
  const settled = result(await host.callOwnerControl("owner_message_settle", common));
  if (settled.version !== 1 || settled.root_ref !== input.rootRef || settled.owner_id !== binding.ownerId
    || settled.grant_id !== binding.grantId || settled.grant_version !== binding.grantVersion
    || settled.message_ref !== proof.messageRef || settled.occurred_at !== input.occurredAt
    || settled.fencing_generation !== proof.fencingGeneration || settled.instance_nonce !== proof.instanceNonce
    || settled.apply !== false || settled.live_authority !== false
    || settled.model_execute !== false || settled.external_send !== false) throw new Error("owner_message_settlement_invalid");
  if (settled.status === "sealed_absent" && settled.receipt === null) {
    return { status: "sealed_absent", messageRef: proof.messageRef, recordedAt: null };
  }
  if (settled.status === "captured") {
    const withdrawal = result(await host.callOwnerControl("owner_message", {
      action: "withdraw", root_ref: input.rootRef, expected_owner_id: binding.ownerId,
      message_ref: proof.messageRef, expected_revision: 1,
    }));
    const receipt = withdrawal.receipt as Record<string, unknown> | null;
    if (!receipt || receipt.action !== "withdraw" || receipt.message_ref !== proof.messageRef
      || receipt.root_ref !== input.rootRef || receipt.owner_id !== binding.ownerId
      || receipt.revision !== 2 || receipt.apply !== false || receipt.live_authority !== false
      || receipt.external_send !== false || !canonicalTime(receipt.recorded_at)) {
      throw new Error("owner_message_withdrawal_invalid");
    }
    return { status: "withdrawn", messageRef: proof.messageRef, recordedAt: receipt.recorded_at as string };
  }
  if (settled.status === "withdrawn") {
    const receipt = settled.receipt as Record<string, unknown> | null;
    if (!receipt || receipt.action !== "withdraw" || receipt.message_ref !== proof.messageRef
      || receipt.revision !== 2 || !canonicalTime(receipt.recorded_at)) throw new Error("owner_message_settlement_invalid");
    return { status: "withdrawn", messageRef: proof.messageRef, recordedAt: receipt.recorded_at as string };
  }
  throw new Error("owner_message_settlement_unknown");
}
