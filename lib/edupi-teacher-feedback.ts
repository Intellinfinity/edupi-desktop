import { desktopApiHeaders } from "@/lib/desktop-native";

export type TeacherFeedbackDomain = "teaching_preparation" | "student_followup" | "lesson_reflection" | "calendar_administration" | "parent_communication" | "safety_privacy";
export type TeacherFeedbackDecision = "accept" | "modify" | "reject" | "hold" | "withdraw";
export type TeacherFeedbackUsefulness = "very_useful" | "useful" | "partial" | "not_useful" | "incorrect" | "unsafe" | "not_observed";
export type TeacherFeedbackIssueCode = "incorrect_content" | "incomplete" | "stale_source" | "duplicate" | "wrong_identity" | "poor_timing" | "privacy" | "safety" | "too_much_work" | "other";
export type TeacherFeedbackTargetKind = "goal" | "opportunity" | "work_candidate" | "follow_up" | "capability_work" | "artifact" | "schedule_conflict";

export type TeacherFeedbackCapture = {
  commandId: string;
  sessionId: string;
  evidenceLevel?: "real_teacher" | "synthetic";
  domain: TeacherFeedbackDomain;
  scope: { classId: string; subject: string };
  target: { kind: TeacherFeedbackTargetKind; targetId: string };
  decision: TeacherFeedbackDecision;
  usefulness: TeacherFeedbackUsefulness;
  used: boolean;
  wouldUseAgain?: boolean | null;
  baselineMinutes?: number | null;
  reviewMinutes?: number | null;
  issueCodes?: TeacherFeedbackIssueCode[];
  note?: string | null;
  evidenceIds: string[];
  occurredAt: string;
  supersedesFeedbackId?: string | null;
};

export type TeacherFeedbackRecordResult = { feedbackId: string; replayed: boolean; current: boolean };
export type TeacherFeedbackFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class TeacherFeedbackError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TeacherFeedbackError";
  }
}

function id(value: unknown, field: string, maxLength = 160): string {
  if (typeof value !== "string") throw new TeacherFeedbackError("invalid_feedback", `${field} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || !/^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]*$/u.test(normalized)) throw new TeacherFeedbackError("invalid_feedback", `${field} is invalid`);
  return normalized;
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new TeacherFeedbackError("invalid_feedback", `${field} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new TeacherFeedbackError("invalid_feedback", `${field} is invalid`);
  return normalized;
}

export function buildTeacherFeedbackRecord(input: TeacherFeedbackCapture): Record<string, unknown> {
  const occurredAt = text(input.occurredAt, "occurredAt", 24);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(occurredAt)
    || Number.isNaN(Date.parse(occurredAt)) || new Date(occurredAt).toISOString() !== occurredAt) {
    throw new TeacherFeedbackError("invalid_feedback", "occurredAt is invalid");
  }
  const evidenceIds = [...new Set(input.evidenceIds.map((value) => id(value, "evidenceId", 240)))].slice(0, 50);
  if (evidenceIds.length === 0) throw new TeacherFeedbackError("invalid_feedback", "evidenceIds is required");
  const record: Record<string, unknown> = {
    command_id: id(input.commandId, "commandId"),
    session_id: id(input.sessionId, "sessionId"),
    evidence_level: input.evidenceLevel || "real_teacher",
    domain: input.domain,
    scope: { class_id: id(input.scope.classId, "scope.classId"), subject: text(input.scope.subject, "scope.subject", 128) },
    signal: "surfaced",
    target: { kind: input.target.kind, target_id: id(input.target.targetId, "target.targetId", 300) },
    decision: input.decision,
    usefulness: input.usefulness,
    used: input.used,
    would_use_again: input.wouldUseAgain ?? null,
    baseline_minutes: input.baselineMinutes ?? null,
    review_minutes: input.reviewMinutes ?? null,
    issue_codes: [...new Set(input.issueCodes || [])],
    note: input.note?.trim() || null,
    evidence_ids: evidenceIds,
    occurred_at: occurredAt,
    supersedes_feedback_id: input.supersedesFeedbackId ?? null,
  };
  return record;
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function recordTeacherFeedback(input: TeacherFeedbackCapture, fetcher: TeacherFeedbackFetcher = fetch, headersProvider: typeof desktopApiHeaders = desktopApiHeaders): Promise<TeacherFeedbackRecordResult> {
  const record = buildTeacherFeedbackRecord(input);
  const post = async (body: Record<string, unknown>) => fetcher("/api/edupi/teacher-feedback", { method: "POST", headers: await headersProvider({ "content-type": "application/json" }), body: JSON.stringify(body) });
  let response = await post({ action: "record", record });
  let value = await readResponse(response);
  if (response.status === 409 && value.errorCode === "owner_uninitialized") {
    const bootstrap = await post({ action: "bootstrap" });
    const bootstrapValue = await readResponse(bootstrap);
    if (!bootstrap.ok || bootstrapValue.ok === false) throw new TeacherFeedbackError(String(bootstrapValue.errorCode || "feedback_runtime_unavailable"), "教师反馈 Runtime 尚未就绪");
    response = await post({ action: "record", record });
    value = await readResponse(response);
  }
  if (!response.ok || value.ok !== true) throw new TeacherFeedbackError(String(value.errorCode || value.error || "feedback_runtime_unavailable"), "教师反馈未能记录");
  const result = value.result && typeof value.result === "object" && !Array.isArray(value.result) ? value.result as Record<string, unknown> : null;
  if (!result || typeof result.feedback_id !== "string" || typeof result.replayed !== "boolean" || typeof result.current !== "boolean") throw new TeacherFeedbackError("invalid_feedback_response", "教师反馈回执无法核对");
  return { feedbackId: result.feedback_id, replayed: result.replayed, current: result.current };
}
