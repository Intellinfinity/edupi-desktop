import type {
  EducationTeacherContextCandidate,
  TeacherContextReviewCapability,
} from "./edupi-education-contract";
import type { TeacherContextSnapshot } from "./edupi-onboarding-types";

export const TEACHER_CONTEXT_FIELDS = [
  { key: "name", label: "称呼" },
  { key: "role", label: "身份" },
  { key: "subject", label: "学科" },
  { key: "grade", label: "年级" },
  { key: "class_name", label: "班级" },
] as const;

export type TeacherContextField = typeof TEACHER_CONTEXT_FIELDS[number]["key"];
export type TeacherContextEditorValues = Partial<Record<TeacherContextField, string>>;
export type TeacherContextReviewDecision = "accept" | "modify" | "reject" | "hold";
export type TeacherContextReviewStatus = "accepted" | "modified" | "rejected" | "held";

export const TEACHER_CONTEXT_REVIEW_STATUS: Record<TeacherContextReviewDecision, TeacherContextReviewStatus> = {
  accept: "accepted",
  modify: "modified",
  reject: "rejected",
  hold: "held",
};

const CONTEXT_FIELD_KEYS = new Set<string>(TEACHER_CONTEXT_FIELDS.map((field) => field.key));

type RawRecord = Record<string, unknown>;
type CapabilityLike = Pick<TeacherContextReviewCapability, "enabled"> | null | undefined;

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function valueText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 120) throw new Error(`${field} 无效`);
  return value.trim();
}

function assertKnownKeys(value: RawRecord, field: string): void {
  for (const key of Object.keys(value)) {
    if (!CONTEXT_FIELD_KEYS.has(key)) throw new Error(`${field}.${key} 不受支持`);
  }
}

/** Normalize a complete projected five-field map without inventing values. */
export function normalizeTeacherContextValues(value: unknown): TeacherContextEditorValues | null {
  const source = record(value);
  if (!source) return null;
  assertKnownKeys(source, "context");
  const normalized: TeacherContextEditorValues = {};
  for (const field of TEACHER_CONTEXT_FIELDS) {
    if (!(field.key in source)) continue;
    normalized[field.key] = valueText(source[field.key], field.key);
  }
  return normalized;
}

function normalizeDraftValues(value: unknown, field: string): TeacherContextEditorValues {
  const source = record(value);
  if (!source) throw new Error(`${field} 无效`);
  assertKnownKeys(source, field);
  const normalized: TeacherContextEditorValues = {};
  for (const contextField of TEACHER_CONTEXT_FIELDS) {
    if (!(contextField.key in source)) continue;
    const raw = source[contextField.key];
    if (raw === null || raw === undefined) throw new Error(`${field}.${contextField.key} 不支持清空`);
    if (typeof raw !== "string" || raw.length > 120) throw new Error(`${field}.${contextField.key} 无效`);
    const trimmed = raw.trim();
    if (trimmed) normalized[contextField.key] = trimmed;
  }
  return normalized;
}

/** Return only nonempty fields that differ from the current proposal. */
export function buildContextPatch(
  draft: unknown,
  baseline: unknown = {},
): TeacherContextEditorValues | null {
  const normalizedDraft = normalizeDraftValues(draft, "patch");
  const normalizedBaseline = normalizeTeacherContextValues(baseline);
  if (!normalizedBaseline) throw new Error("baseline 无效");
  const patch: TeacherContextEditorValues = {};
  for (const field of TEACHER_CONTEXT_FIELDS) {
    const next = normalizedDraft[field.key];
    if (next !== undefined && next !== normalizedBaseline[field.key]) patch[field.key] = next;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

export const buildTeacherContextPatch = buildContextPatch;

const fallbackRoleLabels: Record<string, string> = {
  subject_teacher: "任课教师",
  homeroom_teacher: "班主任",
  grade_group: "年级 / 备课组",
  academic_admin: "教务协作",
};

/** Read only the conservative five-field fallback from the legacy snapshot. */
export function contextValuesFromSnapshot(snapshot: TeacherContextSnapshot | null | undefined): TeacherContextEditorValues {
  if (!snapshot) return {};
  const role = typeof (snapshot as TeacherContextSnapshot & { role?: unknown }).role === "string"
    ? (snapshot as TeacherContextSnapshot & { role: string }).role
    : Array.isArray(snapshot.roles)
      ? snapshot.roles.map((item) => fallbackRoleLabels[item] || item).join("、")
      : "";
  const className = Array.isArray(snapshot.classes) && typeof snapshot.classes[0] === "string" ? snapshot.classes[0] : "";
  const values: Record<string, unknown> = {
    name: snapshot.name,
    role,
    subject: snapshot.subject,
    grade: snapshot.grade,
    class_name: className,
  };
  const present = Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === "string" && value.trim()));
  const normalized = normalizeTeacherContextValues(present);
  return normalized || {};
}

export function currentContextValues(
  candidate: EducationTeacherContextCandidate | null | undefined,
  snapshot: TeacherContextSnapshot | null | undefined,
): TeacherContextEditorValues {
  let projected: TeacherContextEditorValues | null = null;
  try {
    projected = candidate ? normalizeTeacherContextValues(candidate.currentValues) : null;
  } catch {
    projected = null;
  }
  return candidate ? projected || {} : contextValuesFromSnapshot(snapshot);
}

export function proposedContextValues(candidate: EducationTeacherContextCandidate | null | undefined): TeacherContextEditorValues {
  if (!candidate) return {};
  try {
    return normalizeTeacherContextValues(candidate.proposedValues) || {};
  } catch {
    return {};
  }
}

export function contextStatusLabel(
  candidate: Pick<EducationTeacherContextCandidate, "status" | "teacherReview"> | null | undefined,
  capability: CapabilityLike,
  currentValues: TeacherContextEditorValues = {},
): string {
  const state = candidate?.status || candidate?.teacherReview?.state;
  const base = state === "pending_review" || state === "candidate"
    ? "待确认"
    : state === "held"
      ? "已暂缓"
      : state === "accepted" || state === "modified"
        ? "已生效"
        : state === "rejected"
          ? "已拒绝"
          : Object.keys(currentValues).length > 0
            ? "已生效"
            : "未设置";
  return capability?.enabled === true ? base : `${base} · 只读`;
}

/** Build a facts-only page reference; the teacher writes the actual request in Chat. */
export function buildTeacherContextPrompt(values: unknown): string {
  const normalized = normalizeDraftValues(values, "prompt");
  if (Object.keys(normalized).length === 0) throw new Error("教师上下文草稿至少需要一项");
  return [
    "教师上下文草稿",
    ...TEACHER_CONTEXT_FIELDS
      .filter((field) => normalized[field.key])
      .map((field) => `${field.label}：${normalized[field.key]}`),
  ].join("\n");
}

export type TeacherContextReviewExpectation = {
  targetId: string;
  expectedSnapshotId: string;
  expectedStateHash?: string;
  decision: TeacherContextReviewDecision;
};

export type TeacherContextReviewVerification =
  | { ok: true; receipt: RawRecord; data: RawRecord; candidate: EducationTeacherContextCandidate }
  | { ok: false; code: "invalid_receipt"; reason: string };

export type TeacherContextRefreshExpectation = {
  targetId: string;
  afterSnapshotId: string;
  afterStateHash: string;
};

/** Confirm that the awaited refresh still represents the trusted receipt. */
export function matchesTeacherContextRefresh(
  data: unknown,
  expectation: TeacherContextRefreshExpectation,
): boolean {
  const root = record(data);
  const candidates = Array.isArray(root?.teacherContextCandidates) ? root.teacherContextCandidates : [];
  const matches = candidates.filter((value) => {
    const candidate = record(value);
    return candidate?.contextId === expectation.targetId;
  });
  if (matches.length !== 1) return false;
  const candidate = matches[0];
  return candidate?.snapshotId === expectation.afterSnapshotId
    && candidate.stateHash === expectation.afterStateHash
    && candidate.externalSend === false;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sha256(value: unknown): value is string {
  return nonempty(value) && /^sha256:[A-Za-z0-9_-]+$/.test(value);
}

function invalid(reason: string): TeacherContextReviewVerification {
  return { ok: false, code: "invalid_receipt", reason };
}

/** Verify a normalized API response before the UI trusts any changed state. */
export function verifyTeacherContextReview(
  response: unknown,
  expectation: TeacherContextReviewExpectation,
): TeacherContextReviewVerification {
  const root = record(response);
  const receipt = record(root?.receipt);
  const data = record(root?.data);
  if (!receipt || !data) return invalid("缺少回执或刷新数据");
  if (!nonempty(receipt.receipt_id) || !nonempty(receipt.command_id) || !nonempty(receipt.request_id)) return invalid("回执身份不完整");
  if (receipt.command_type !== "review_teacher_context" || receipt.external_send !== false) return invalid("回执命令或外发边界无效");
  const target = record(receipt.target);
  if (!target || target.target_kind !== "teacher_context" || target.target_id !== expectation.targetId || target.command_type !== "review_teacher_context") return invalid("回执目标不匹配");
  if (receipt.decision !== expectation.decision || receipt.status !== TEACHER_CONTEXT_REVIEW_STATUS[expectation.decision]) return invalid("回执决策状态不匹配");
  if (receipt.before_snapshot_id !== expectation.expectedSnapshotId) return invalid("回执前快照不匹配");
  if (expectation.expectedStateHash !== undefined && receipt.before_state_hash !== expectation.expectedStateHash) return invalid("回执前状态不匹配");
  if (!sha256(receipt.before_state_hash) || !nonempty(receipt.after_snapshot_id) || !sha256(receipt.after_state_hash)) return invalid("回执快照绑定不完整");

  const candidates = Array.isArray(data.teacherContextCandidates) ? data.teacherContextCandidates : [];
  const matches = candidates.filter((value): value is EducationTeacherContextCandidate => {
    const candidate = record(value);
    return candidate?.contextId === expectation.targetId;
  });
  if (matches.length !== 1) return invalid("刷新数据中的教师上下文目标不唯一");
  const candidate = matches[0];
  if (candidate.snapshotId !== receipt.after_snapshot_id || candidate.stateHash !== receipt.after_state_hash || candidate.externalSend !== false
    || candidate.status !== TEACHER_CONTEXT_REVIEW_STATUS[expectation.decision]
    || candidate.teacherReview?.state !== TEACHER_CONTEXT_REVIEW_STATUS[expectation.decision]) return invalid("刷新数据未绑定到回执后快照");
  try {
    if (!normalizeTeacherContextValues(candidate.currentValues) || !normalizeTeacherContextValues(candidate.proposedValues)) return invalid("刷新数据中的教师上下文值无效");
  } catch {
    return invalid("刷新数据中的教师上下文值无效");
  }
  return { ok: true, receipt, data, candidate };
}

export const verifyTeacherContextReceipt = verifyTeacherContextReview;
export const matchesTeacherContextReceiptRefresh = matchesTeacherContextRefresh;
