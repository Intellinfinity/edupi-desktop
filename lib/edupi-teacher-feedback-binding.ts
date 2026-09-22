import type { EduPiRuntimeHandle } from "./edupi-runtime-supervisor";

const FEEDBACK_RECORD_KEYS = new Set([
  "command_id", "session_id", "evidence_level", "domain", "scope", "signal", "target", "decision",
  "usefulness", "used", "would_use_again", "baseline_minutes", "review_minutes", "issue_codes", "note",
  "evidence_ids", "occurred_at", "supersedes_feedback_id",
]);

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function feedbackFailure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export async function bindFeedbackRecord(host: EduPiRuntimeHandle, owner: { ownerId: string; rootRef: string }, value: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (Object.keys(value).some((key) => !FEEDBACK_RECORD_KEYS.has(key))) throw feedbackFailure("invalid_feedback", "反馈记录字段无效");
  if (value.signal !== "surfaced" && value.signal !== "missed") throw feedbackFailure("invalid_feedback", "反馈信号无效");
  const target = asRecord(value.target);
  if (!target || typeof target.kind !== "string" || typeof target.target_id !== "string") throw feedbackFailure("invalid_feedback", "反馈目标无效");
  if (value.signal === "missed") {
    if (target.kind !== "missed_opportunity") throw feedbackFailure("invalid_feedback", "漏报反馈目标无效");
    return { ...value, root_ref: owner.rootRef, expected_owner_id: owner.ownerId };
  }
  if (target.kind === "missed_opportunity") throw feedbackFailure("invalid_feedback", "已出现事项不能标记为漏报");
  const bound = Object.hasOwn(target, "expected_revision") || Object.hasOwn(target, "expected_fingerprint");
  if (bound) {
    if (Object.keys(target).some((key) => !["kind", "target_id", "expected_revision", "expected_fingerprint"].includes(key))
      || !Number.isSafeInteger(target.expected_revision) || Number(target.expected_revision) < 0
      || typeof target.expected_fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/.test(target.expected_fingerprint)) {
      throw feedbackFailure("invalid_feedback", "反馈目标绑定无效");
    }
    return { ...value, root_ref: owner.rootRef, expected_owner_id: owner.ownerId };
  }
  const resolvedResponse = await host.callOwnerControl("teacher_feedback_target_read", {
    root_ref: owner.rootRef,
    expected_owner_id: owner.ownerId,
    target: { kind: target.kind, target_id: target.target_id },
  });
  if (resolvedResponse.ok !== true) throw feedbackFailure(String(resolvedResponse.error_code || "teacher_feedback_target_missing"), "反馈目标已失效，请刷新后重试");
  const resolved = asRecord(resolvedResponse.result);
  if (!resolved || typeof resolved.kind !== "string" || typeof resolved.target_id !== "string"
    || !Number.isSafeInteger(resolved.revision) || typeof resolved.fingerprint !== "string"
    || !Array.isArray(resolved.evidence_ids) || resolved.evidence_ids.length === 0) {
    throw feedbackFailure("teacher_feedback_target_stale", "反馈目标无法重新核对");
  }
  const resolvedEvidence = resolved.evidence_ids.filter((item): item is string => typeof item === "string");
  if (resolvedEvidence.length === 0) throw feedbackFailure("teacher_feedback_target_stale", "反馈目标缺少证据");
  const suppliedEvidence = Array.isArray(value.evidence_ids) ? value.evidence_ids.filter((item): item is string => typeof item === "string") : [];
  const evidenceIds = suppliedEvidence.length > 0 ? suppliedEvidence : resolvedEvidence;
  if (!evidenceIds.some((item) => resolvedEvidence.includes(item))) throw feedbackFailure("teacher_feedback_target_stale", "反馈证据与当前目标不匹配");
  return {
    ...value,
    target: { kind: resolved.kind, target_id: resolved.target_id, expected_revision: resolved.revision, expected_fingerprint: resolved.fingerprint },
    evidence_ids: evidenceIds,
    root_ref: owner.rootRef,
    expected_owner_id: owner.ownerId,
  };
}
