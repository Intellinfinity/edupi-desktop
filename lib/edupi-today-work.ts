import type {
  EducationContract,
  EducationWorkCandidate,
  EducationWorkCandidateDecision,
} from "./edupi-education-contract";

export type TodayWorkReviewInput = {
  candidate: EducationWorkCandidate;
  decision: EducationWorkCandidateDecision;
  patch?: Record<string, unknown>;
  note?: string;
};

export type TodayWorkReviewResult = {
  receiptId: string;
  data: EducationContract;
};

export type TodayWorkFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type TodayWorkErrorCode = "stale_snapshot" | "stale_revision" | "invalid_envelope" | "unsupported_command" | "unavailable" | "busy" | "malformed";

export class TodayWorkReviewError extends Error {
  readonly data?: EducationContract;

  constructor(readonly code: TodayWorkErrorCode, message: string, data?: EducationContract) {
    super(message);
    this.name = "TodayWorkReviewError";
    this.data = data;
  }
}

export class TodayWorkBusyError extends TodayWorkReviewError {
  constructor() {
    super("busy", todayWorkErrorMessage("busy"));
    this.name = "TodayWorkBusyError";
  }
}

const ERROR_MESSAGES: Record<TodayWorkErrorCode, string> = {
  stale_snapshot: "内容已更新，本次没有写入；请刷新待办后重新决定。",
  stale_revision: "内容已更新，本次没有写入；请刷新待办后重新决定。",
  invalid_envelope: "审核结果未能确认，请刷新任务后核对。",
  unsupported_command: "待办审核暂不可用。",
  unavailable: "审核结果未能确认，请刷新任务后核对。",
  busy: "正在处理上一项，请稍候。",
  malformed: "审核结果未能确认，请刷新任务后核对。",
};

export function todayWorkErrorMessage(code: string): string {
  return ERROR_MESSAGES[code as TodayWorkErrorCode] || ERROR_MESSAGES.malformed;
}

export function todayWorkFailureDisposition(code: string): "close" | "preserve" {
  return code === "stale_snapshot" || code === "stale_revision" ? "close" : "preserve";
}

let mutationBusy = false;
const mutationListeners = new Set<() => void>();

function notifyMutationListeners(): void {
  for (const listener of mutationListeners) listener();
}

export function getTodayWorkMutationSnapshot(): boolean {
  return mutationBusy;
}

export function subscribeTodayWorkMutation(listener: () => void): () => void {
  mutationListeners.add(listener);
  return () => mutationListeners.delete(listener);
}

function acquireTodayWorkMutation(): () => void {
  if (mutationBusy) throw new TodayWorkBusyError();
  mutationBusy = true;
  notifyMutationListeners();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mutationBusy = false;
    notifyMutationListeners();
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

const REQUIRED_COLLECTION_KEYS = [
  "students", "timetable", "observations", "memoryCandidates", "c1Memories", "receipts", "reviewHistory",
  "teacherContextCandidates", "teacherContextReceipts", "teacherContextReviewHistory", "workCandidates",
  "workCandidateReceipts", "workCandidateReviewHistory", "calendar", "tasks",
];
const REQUIRED_CONTINUITY_COLLECTION_KEYS = ["memories", "signals", "insights", "themes", "subjectKnowledge", "familyContacts", "documents"];
const REQUIRED_REVIEW_CAPABILITY_KEYS = ["taskReview", "c1Review", "teacherContextReview", "workCandidateReview"];

function isEducationContract(value: unknown): value is EducationContract {
  const contract = record(value);
  if (!contract
    || contract.scope !== "teacher_internal"
    || contract.externalSend !== false
    || contract.requiresTeacherReview !== true
    || typeof contract.workspace !== "string"
    || !contract.workspace.trim()
    || !REQUIRED_COLLECTION_KEYS.every((key) => Array.isArray(contract[key]))) return false;
  const taskSessions = record(contract.taskSessions);
  const continuity = record(contract.continuity);
  const dataSources = record(contract.dataSources);
  const capabilities = record(contract.capabilities);
  return Boolean(taskSessions
    && continuity
    && REQUIRED_CONTINUITY_COLLECTION_KEYS.every((key) => Array.isArray(continuity[key]))
    && dataSources
    && capabilities
    && REQUIRED_REVIEW_CAPABILITY_KEYS.every((key) => record(capabilities[key])));
}

export function buildTodayWorkReviewBody(input: TodayWorkReviewInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    commandType: "review_work_candidate",
    candidateId: input.candidate.candidateId,
    expectedSnapshotId: input.candidate.snapshotId,
    expectedRevision: input.candidate.revision,
    decision: input.decision,
  };
  if (input.patch !== undefined) body.patch = input.patch;
  if (input.note !== undefined) body.note = input.note;
  return body;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function staleReviewError(code: "stale_snapshot" | "stale_revision", fetcher: TodayWorkFetcher): Promise<TodayWorkReviewError> {
  let data: EducationContract | undefined;
  try {
    const response = await fetcher("/api/edupi/education", { method: "GET", cache: "no-store" });
    const value = await readJson(response);
    if (response.ok && isEducationContract(value)) data = value;
  } catch {
    // The stale result is still definitive even when reconciliation is unavailable.
  }
  return new TodayWorkReviewError(code, todayWorkErrorMessage(code), data);
}

export async function submitTodayWorkReview(input: TodayWorkReviewInput, fetcher: TodayWorkFetcher = fetch): Promise<TodayWorkReviewResult> {
  const release = acquireTodayWorkMutation();
  try {
    let response: Response;
    try {
      response = await fetcher("/api/edupi/education", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildTodayWorkReviewBody(input)),
      });
    } catch {
      throw new TodayWorkReviewError("unavailable", todayWorkErrorMessage("unavailable"));
    }
    const value = record(await readJson(response));
    if (!response.ok) {
      const code = value?.code;
      if (code === "stale_snapshot" || code === "stale_revision") throw await staleReviewError(code, fetcher);
      if (code === "invalid_envelope" || code === "unsupported_command" || code === "unavailable") {
        throw new TodayWorkReviewError(code, todayWorkErrorMessage(code));
      }
      throw new TodayWorkReviewError("malformed", todayWorkErrorMessage("malformed"));
    }
    const receipt = record(value?.receipt);
    const receiptId = boundedText(receipt?.receipt_id, 160);
    if (!receiptId || !isEducationContract(value?.data)) throw new TodayWorkReviewError("malformed", todayWorkErrorMessage("malformed"));
    return { receiptId, data: value.data };
  } catch (error) {
    if (error instanceof TodayWorkReviewError) throw error;
    throw new TodayWorkReviewError("unavailable", todayWorkErrorMessage("unavailable"));
  } finally {
    release();
  }
}

export type TodayWorkEditorIdentity = {
  candidateId: string;
  snapshotId: string;
  revision: number;
  mode: string;
};

export function isTodayWorkEditorCurrent(
  editor: TodayWorkEditorIdentity | null,
  candidates: EducationWorkCandidate[],
  capabilityEnabled: boolean,
): boolean {
  if (!editor || !capabilityEnabled) return false;
  const candidate = candidates.find((item) => item.candidateId === editor.candidateId);
  return Boolean(candidate
    && candidate.snapshotId === editor.snapshotId
    && candidate.revision === editor.revision
    && (candidate.status === "pending_review" || candidate.status === "held" || candidate.status === "snoozed"));
}
