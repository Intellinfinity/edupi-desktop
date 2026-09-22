import { desktopApiHeaders } from "@/lib/desktop-native";
import { DEFAULT_FETCH_RETRY_TIMEOUT_MS } from "@/lib/fetch-timeout";

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
  scope: { classId: string; subject: string } | null;
  target: { kind: TeacherFeedbackTargetKind; targetId: string; expectedRevision?: number; expectedFingerprint?: string };
  reviewedRevision?: number;
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

export function canRetryFeedbackEligibility(error: unknown): boolean {
  return !(error instanceof TeacherFeedbackError) || error.code === "feedback_runtime_unavailable";
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
  if (!Number.isSafeInteger(input.target.expectedRevision) || (input.target.expectedRevision ?? -1) < 0
    || typeof input.target.expectedFingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/.test(input.target.expectedFingerprint)) {
    throw new TeacherFeedbackError("invalid_feedback", "target binding is required");
  }
  if (!input.scope) throw new TeacherFeedbackError("invalid_feedback", "verified scope is required");
  const record: Record<string, unknown> = {
    command_id: id(input.commandId, "commandId"),
    session_id: id(input.sessionId, "sessionId"),
    evidence_level: input.evidenceLevel || "real_teacher",
    domain: input.domain,
    scope: { class_id: id(input.scope.classId, "scope.classId"), subject: text(input.scope.subject, "scope.subject", 128) },
    signal: "surfaced",
    target: { kind: input.target.kind, target_id: id(input.target.targetId, "target.targetId", 300), expected_revision: input.target.expectedRevision, expected_fingerprint: input.target.expectedFingerprint },
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

async function postFeedback(fetcher: TeacherFeedbackFetcher, headersProvider: typeof desktopApiHeaders, body: Record<string, unknown>, timeoutMs: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DOMException("Teacher feedback request timed out", "AbortError"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([(async () => {
      const response = await fetcher("/api/edupi/teacher-feedback", {
        method: "POST", headers: await headersProvider({ "content-type": "application/json" }),
        body: JSON.stringify(body), signal: controller.signal,
      });
      return { response, value: await readResponse(response) };
    })(), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function prepareTeacherFeedbackCapture(input: TeacherFeedbackCapture, fetcher: TeacherFeedbackFetcher = fetch, headersProvider: typeof desktopApiHeaders = desktopApiHeaders, timeoutMs = DEFAULT_FETCH_RETRY_TIMEOUT_MS): Promise<TeacherFeedbackCapture> {
  const post = (body: Record<string, unknown>) => postFeedback(fetcher, headersProvider, body, timeoutMs);
  const readTarget = () => post({ action: "target_read", target: { kind: input.target.kind, target_id: input.target.targetId } });
  let { response, value } = await readTarget();
  if (response.status === 409 && value.errorCode === "owner_uninitialized") {
    const { response: bootstrap, value: bootstrapValue } = await post({ action: "bootstrap" });
    if (!bootstrap.ok || bootstrapValue.ok === false) throw new TeacherFeedbackError(String(bootstrapValue.errorCode || "feedback_runtime_unavailable"), "教师反馈 Runtime 尚未就绪");
    ({ response, value } = await readTarget());
  }
  if (!response.ok || value.ok !== true) throw new TeacherFeedbackError(String(response.status >= 500 ? "feedback_runtime_unavailable" : value.errorCode || "teacher_feedback_target_stale"), "反馈目标已失效");
  const target = value.result && typeof value.result === "object" && !Array.isArray(value.result) ? value.result as Record<string, unknown> : null;
  const targetEvidence = Array.isArray(target?.evidence_ids) ? target.evidence_ids : [];
  const scope = target?.scope && typeof target.scope === "object" && !Array.isArray(target.scope) ? target.scope as Record<string, unknown> : null;
  if (!target || target.kind !== input.target.kind || target.target_id !== input.target.targetId
    || !Number.isSafeInteger(target.revision) || Number(target.revision) < 0
    || input.reviewedRevision !== undefined && target.revision !== input.reviewedRevision
    || typeof target.fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/.test(target.fingerprint)
    || target.domain !== input.domain || !scope || typeof scope.class_id !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/.test(scope.class_id)
    || typeof scope.subject !== "string" || !scope.subject || scope.subject.length > 128
    || input.scope && (input.scope.classId !== scope.class_id || input.scope.subject !== scope.subject)
    || !input.evidenceIds.some((item) => targetEvidence.includes(item))) {
    throw new TeacherFeedbackError("teacher_feedback_target_stale", "反馈依据与当前目标不一致");
  }
  return { ...input, scope: { classId: scope.class_id as string, subject: scope.subject as string },
    target: { ...input.target, expectedRevision: target.revision as number, expectedFingerprint: target.fingerprint } };
}

export async function recordTeacherFeedback(input: TeacherFeedbackCapture, fetcher: TeacherFeedbackFetcher = fetch, headersProvider: typeof desktopApiHeaders = desktopApiHeaders, timeoutMs = DEFAULT_FETCH_RETRY_TIMEOUT_MS): Promise<TeacherFeedbackRecordResult> {
  const record = buildTeacherFeedbackRecord(input);
  const post = (body: Record<string, unknown>) => postFeedback(fetcher, headersProvider, body, timeoutMs);
  let { response, value } = await post({ action: "record", record });
  if (response.status === 409 && value.errorCode === "owner_uninitialized") {
    const { response: bootstrap, value: bootstrapValue } = await post({ action: "bootstrap" });
    if (!bootstrap.ok || bootstrapValue.ok === false) throw new TeacherFeedbackError(String(bootstrapValue.errorCode || "feedback_runtime_unavailable"), "教师反馈 Runtime 尚未就绪");
    ({ response, value } = await post({ action: "record", record }));
  }
  if (!response.ok || value.ok !== true) throw new TeacherFeedbackError(String(value.errorCode || value.error || "feedback_runtime_unavailable"), "教师反馈未能记录");
  const result = value.result && typeof value.result === "object" && !Array.isArray(value.result) ? value.result as Record<string, unknown> : null;
  if (!result || typeof result.feedback_id !== "string" || typeof result.replayed !== "boolean" || typeof result.current !== "boolean") throw new TeacherFeedbackError("invalid_feedback_response", "教师反馈回执无法核对");
  return { feedbackId: result.feedback_id, replayed: result.replayed, current: result.current };
}
