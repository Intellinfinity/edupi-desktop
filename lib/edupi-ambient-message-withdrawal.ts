import path from "node:path";
import { resolveEduPiBridgeRoots, type EduPiBridgeRoots } from "./edupi-core-snapshot";
import { markEduPiAmbientMessageAbandoned, markEduPiAmbientMessageWithdrawn, readWithdrawableEduPiAmbientMessages,
  type EduPiAmbientMessageBinding } from "./edupi-ambient-message-ledger";
import { ensureEduPiRuntime, type EduPiRuntimeHandle } from "./edupi-runtime-supervisor";

const HASH = /^sha256:[a-f0-9]{64}$/u;

export class EduPiAmbientMessageWithdrawalError extends Error {
  readonly code = "ambient_message_withdrawal_unavailable";
  constructor() { super("EduPi ambient message withdrawal unavailable."); this.name = "EduPiAmbientMessageWithdrawalError"; }
}

function fail(): never { throw new EduPiAmbientMessageWithdrawalError(); }

type Dependencies = {
  roots?: EduPiBridgeRoots;
  host?: EduPiRuntimeHandle;
  stateDir?: string;
  read?: (sessionId: string) => EduPiAmbientMessageBinding[];
  mark?: (sessionId: string, messageRef: string, at: string, outcome: "withdrawn" | "abandoned") => void;
  now?: () => string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function withdrawEduPiAmbientMessagesForSession(sessionId: string, dependencies: Dependencies = {}): Promise<{ withdrawn: number; abandoned: number }> {
  const stateDir = dependencies.stateDir ?? process.env.PI_DESKTOP_STATE_DIR;
  if (!dependencies.read && (!stateDir || !path.isAbsolute(stateDir))) return { withdrawn: 0, abandoned: 0 };
  const roots = dependencies.roots ?? resolveEduPiBridgeRoots();
  const read = dependencies.read ?? ((id: string) => readWithdrawableEduPiAmbientMessages(id,
    { stateDir, dataRoot: roots.dataRoot.root }));
  const entries = read(sessionId);
  if (entries.length === 0) return { withdrawn: 0, abandoned: 0 };
  const host = dependencies.host ?? await ensureEduPiRuntime(roots);
  const health = record(await host.call("health", null));
  const healthResult = record(health?.result);
  const rootRef = healthResult?.data_root_fingerprint;
  if (health?.ok !== true || typeof rootRef !== "string" || !HASH.test(rootRef)) fail();
  const mark = dependencies.mark ?? ((id: string, messageRef: string, at: string, outcome: "withdrawn" | "abandoned") => {
    if (outcome === "withdrawn") markEduPiAmbientMessageWithdrawn(id, messageRef, at, { stateDir, dataRoot: roots.dataRoot.root });
    else markEduPiAmbientMessageAbandoned(id, messageRef, at, { stateDir, dataRoot: roots.dataRoot.root });
  });
  let withdrawn = 0, abandoned = 0;
  for (const entry of entries) {
    const response = record(await host.callOwnerControl("owner_message", {
      action: "withdraw",
      root_ref: rootRef,
      expected_owner_id: entry.ownerId,
      message_ref: entry.messageRef,
      expected_revision: 1,
    }));
    if (response?.ok !== true && entry.status === "pending" && response?.error_code === "owner_identity_mismatch") {
      const at = dependencies.now?.() ?? new Date().toISOString();
      let canonicalAt: string;
      try { canonicalAt = new Date(at).toISOString(); } catch { fail(); }
      if (canonicalAt !== at) fail();
      mark(sessionId, entry.messageRef, canonicalAt, "abandoned");
      abandoned += 1;
      continue;
    }
    const result = record(response?.result);
    const receipt = record(result?.receipt);
    if (response?.ok !== true || !receipt || receipt.action !== "withdraw" || receipt.message_ref !== entry.messageRef
      || receipt.owner_id !== entry.ownerId || receipt.root_ref !== rootRef || receipt.revision !== 2
      || receipt.apply !== false || receipt.live_authority !== false || receipt.external_send !== false
      || typeof receipt.recorded_at !== "string") fail();
    let recordedAt: string;
    try { recordedAt = new Date(receipt.recorded_at).toISOString(); } catch { fail(); }
    if (recordedAt !== receipt.recorded_at) fail();
    mark(sessionId, entry.messageRef, recordedAt, "withdrawn");
    withdrawn += 1;
  }
  return { withdrawn, abandoned };
}
