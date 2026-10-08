import type { EduPiAmbientMessageBinding } from "./edupi-ambient-message-ledger";
import { predictEduPiOwnerMessageRef } from "./edupi-ambient-message-runtime";
import type { EduPiProactivityDomain } from "./edupi-proactivity-config";
import type { EduPiRuntimeHandle } from "./edupi-runtime-supervisor";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/u;
const MESSAGE_REF = /^owner_message:[a-f0-9]{64}$/u;

type Recovery = { status: "outcome_unknown" } | { status: "applied"; goalId: string; goalVersion: number; workCaseId: string };
const UNKNOWN = { status: "outcome_unknown" } as const;
type G2Recovery = { status: "outcome_unknown" } | { status: "applied"; goalId: string; goalVersion: number;
  followUpId: string; executionId: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** A missing or ambiguous Core proof remains pending. This never calls a write operation. */
export async function readExactEduPiAmbientGoalBinding(host: Pick<EduPiRuntimeHandle, "callOwnerControl">,
  rootRef: string, entry: EduPiAmbientMessageBinding): Promise<Recovery> {
  if (!HASH.test(rootRef) || !ID.test(entry.ownerId) || !ID.test(entry.grantId)
    || !MESSAGE_REF.test(entry.messageRef) || !Number.isSafeInteger(entry.captureGrantVersion)
    || entry.captureGrantVersion < 1 || entry.status !== "outcome_unknown") return UNKNOWN;
  const domains: EduPiProactivityDomain[] = ["teaching_preparation", "student_followup",
    "calendar_administration", "lesson_reflection", "parent_communication"];
  try {
    if (!domains.some(domain => predictEduPiOwnerMessageRef(rootRef, entry.ownerId, entry.messageId, domain) === entry.messageRef)) return UNKNOWN;
  } catch { return UNKNOWN; }
  let response: Record<string, unknown> | null;
  try {
    response = record(await host.callOwnerControl("owner_goal_bindings_read", {
      root_ref: rootRef, expected_owner_id: entry.ownerId,
      grant_id: entry.grantId, expected_grant_version: entry.captureGrantVersion,
    }));
  } catch { return UNKNOWN; }
  const view = record(response?.result);
  const scope = record(view?.scope);
  if (response?.ok !== true || !view || view.version !== 1 || view.root_ref !== rootRef
    || view.owner_id !== entry.ownerId || view.grant_id !== entry.grantId
    || view.grant_version !== entry.captureGrantVersion || view.apply !== false
    || view.live_authority !== false || view.model_execute !== false || view.external_send !== false
    || !scope || !ID.test(String(scope.class_id || "")) || typeof scope.subject !== "string" || !scope.subject
    || !Array.isArray(view.bindings) || view.bindings.length > 200) return UNKNOWN;
  try { if (new Date(String(view.observed_at)).toISOString() !== view.observed_at) return UNKNOWN; }
  catch { return UNKNOWN; }
  const seen = new Set<string>();
  const matching: Array<{ goalId: string; goalVersion: number; workCaseId: string }> = [];
  for (const raw of view.bindings) {
    const item = record(raw);
    if (!item || !ID.test(String(item.goal_id || "")) || seen.has(String(item.goal_id))
      || !ID.test(String(item.work_case_id || "")) || !Object.hasOwn(item, "task_id")
      || item.task_id !== null && !ID.test(String(item.task_id || ""))
      || !Number.isSafeInteger(item.goal_version) || Number(item.goal_version) < 1
      || !["active", "paused", "revoked"].includes(String(item.goal_status))
      || item.message_ref !== undefined && !MESSAGE_REF.test(String(item.message_ref))) return UNKNOWN;
    seen.add(String(item.goal_id));
    if (item.message_ref === entry.messageRef && item.goal_status === "active") {
      matching.push({ goalId: String(item.goal_id), goalVersion: Number(item.goal_version),
        workCaseId: String(item.work_case_id) });
    }
  }
  return matching.length === 1 ? { status: "applied", ...matching[0] } : UNKNOWN;
}

/** G2 has no work case. Its current execution must be proved by Core's exact
 * grant/version/message read rather than a G1/G3 Goal binding projection. */
export async function readExactEduPiG2Execution(host: Pick<EduPiRuntimeHandle, "callOwnerControl">,
  rootRef: string, entry: EduPiAmbientMessageBinding): Promise<G2Recovery> {
  if (!HASH.test(rootRef) || !ID.test(entry.ownerId) || !ID.test(entry.grantId)
    || !MESSAGE_REF.test(entry.messageRef) || !Number.isSafeInteger(entry.captureGrantVersion)
    || entry.captureGrantVersion < 1 || entry.status !== "outcome_unknown") return UNKNOWN;
  try {
    if (predictEduPiOwnerMessageRef(rootRef, entry.ownerId, entry.messageId, "student_followup") !== entry.messageRef) return UNKNOWN;
  } catch { return UNKNOWN; }
  let response: Record<string, unknown> | null;
  try {
    response = record(await host.callOwnerControl("student_followup_intent_execution_read", {
      root_ref: rootRef, expected_owner_id: entry.ownerId, grant_id: entry.grantId,
      expected_grant_version: entry.captureGrantVersion, message_ref: entry.messageRef,
    }));
  } catch { return UNKNOWN; }
  const view = record(response?.result);
  if (response?.ok !== true || !view || view.version !== 1 || view.apply !== false
    || view.model_execute !== false || view.live_authority !== false || view.external_send !== false) return UNKNOWN;
  if (view.status === "unknown") return UNKNOWN;
  if (view.status !== "current" || !ID.test(String(view.follow_up_id || ""))
    || !ID.test(String(view.goal_id || "")) || !Number.isSafeInteger(view.goal_version)
    || Number(view.goal_version) < 1 || !ID.test(String(view.execution_id || ""))) return UNKNOWN;
  return { status: "applied", goalId: String(view.goal_id), goalVersion: Number(view.goal_version),
    followUpId: String(view.follow_up_id), executionId: String(view.execution_id) };
}
