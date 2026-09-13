import { validateCoreEnvelopeSchema, validateCoreEnvelopeSchemaWithFactIsolation, validateReceiptSemantics, validateSnapshotSemantics, type BridgeErrorCode } from "./edupi-bridge-contract";
import { activeBridgeIdentity } from "./edupi-bridge-manifest";

type ConsumeError = { ok: false; code: BridgeErrorCode; recovery: "refresh" | "update" | "unavailable" };
type ConsumeSnapshot = { ok: true; kind: "snapshot"; value: Record<string, unknown> };
type ConsumeReceipt = { ok: true; kind: "receipt"; value: Record<string, unknown> };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function consumeCoreEnvelope(value: unknown, options: { currentSnapshotId?: string; allowInvalidFactSpine?: boolean } = {}): ConsumeError | ConsumeSnapshot | ConsumeReceipt {
  const envelope = record(value);
  const identity = activeBridgeIdentity();
  if (envelope?.contract_version !== identity.contract.contract_version) return { ok: false, code: "unknown_version", recovery: "update" };
  if (envelope.schema_hash !== identity.contract.schema_hash) return { ok: false, code: "unknown_schema_hash", recovery: "update" };
  if (!validateCoreEnvelopeSchema(envelope) && !(options.allowInvalidFactSpine && validateCoreEnvelopeSchemaWithFactIsolation(envelope))) return { ok: false, code: "invalid_envelope", recovery: "refresh" };
  if (envelope.producer !== "edupi-core" || envelope.external_send !== false || typeof envelope.message_id !== "string" || typeof envelope.request_id !== "string" || typeof envelope.snapshot_id !== "string") return { ok: false, code: "invalid_envelope", recovery: "refresh" };
  if (!Array.isArray(envelope.provenance) || envelope.provenance.length === 0 || !record(envelope.teacher_review)) return { ok: false, code: "invalid_envelope", recovery: "refresh" };
  const payload = record(envelope.payload);
  if (!payload) return { ok: false, code: "invalid_envelope", recovery: "refresh" };
  if (typeof payload.receipt_id === "string") {
    const validation = validateReceiptSemantics(payload);
    if (!validation.ok) return { ok: false, code: validation.code, recovery: "refresh" };
    const commandType = payload.command_type;
    if (!identity.contract.supported_commands.includes(commandType as typeof identity.contract.supported_commands[number])) {
      return { ok: false, code: "unsupported_command", recovery: "unavailable" };
    }
    const isStale = payload.status === "stale_snapshot" || payload.reason_code === "stale_snapshot";
    const bindingSnapshotId = isStale ? payload.before_snapshot_id : payload.after_snapshot_id;
    if (options.currentSnapshotId && payload.before_snapshot_id !== options.currentSnapshotId) return { ok: false, code: "stale_snapshot", recovery: "refresh" };
    // Receipt payloads intentionally do not carry snapshot_id.  The outer
    // envelope binds to the post-mutation snapshot, or to before_snapshot_id
    // for a stale result that did not produce a new state.
    if (typeof bindingSnapshotId !== "string" || envelope.snapshot_id !== bindingSnapshotId) return { ok: false, code: "invalid_envelope", recovery: "refresh" };
    return { ok: true, kind: "receipt", value: payload };
  }
  if (typeof payload.snapshot_id === "string") {
    if (payload.snapshot_id !== envelope.snapshot_id) return { ok: false, code: "invalid_envelope", recovery: "refresh" };
    const validation = validateSnapshotSemantics(payload, {
      supportedCommands: identity.contract.supported_commands,
      supportedProjections: identity.contract.supported_projections,
    });
    return validation.ok ? { ok: true, kind: "snapshot", value: payload } : { ok: false, code: validation.code, recovery: "refresh" };
  }
  return { ok: false, code: "invalid_envelope", recovery: "unavailable" };
}
