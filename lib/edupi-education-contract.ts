import type { TaskSessionBinding } from "./edupi-task-sessions";

export type CalendarConfidence = "confirmed" | "teacher_confirmed" | "inferred" | "unknown";
export type CalendarDateStatus = "explicit" | "missing" | "invalid";
export type CalendarPreparationStatus = "read_only" | "hold";
export type TaskReviewAction = "accept" | "modify" | "reject" | "hold" | "rollback";
export type TeacherTaskStatus = "planned" | "accepted" | "modified" | "rejected" | "hold";
export type EducationEntityDeleteKind = "calendar" | "timetable" | "memory" | "student" | "task" | "material";

export type CalendarFact = {
  id: string | null;
  date: string | null;
  endDate: string | null;
  dateStatus: CalendarDateStatus;
  name: string;
  type: string | null;
  source: string | null;
  confidence: CalendarConfidence;
  notes: string | null;
  preparationStatus: CalendarPreparationStatus;
};

export type TeacherTask = {
  id: string | null;
  title: string;
  trigger: string | null;
  status: TeacherTaskStatus;
  contentStatus: string | null;
  deliveryStatus: string | null;
  sourceEventId: string | null;
  sourceEventName: string | null;
  sourceEventDate: string | null;
  triggerDate: string | null;
  dueDate: string | null;
  deliverables: string[];
  audience: string[];
  requiresTeacherReview: boolean;
  externalSend: boolean;
  scope: string | null;
  student: string | null;
  studentEventType: string | null;
  materialId: string | null;
  materialKind: string | null;
  topic: string | null;
  revision: number;
  reviewedAt: string | null;
  reviewer: string | null;
  reviewNote: string | null;
  reviewHistory: Array<Record<string, unknown>>;
  evidence: Record<string, unknown>;
  boardStage: "todo" | "progress" | "review" | "done" | null;
  boardRevision: number;
  boardUpdatedAt: string | null;
};

export type EducationWorkCaseState = "planned" | "accepted" | "modified" | "rejected" | "held" | "queued" | "running" | "draft_ready" | "failed" | "completed";
export type EducationWorkTransitionState = "planned" | "accepted" | "modified" | "rejected" | "held" | "queued" | "running" | "draft_ready" | "failed" | "stale";

export type EducationWorkTransition = {
  id: string;
  sequence: number;
  state: EducationWorkTransitionState;
  occurredAt: string;
  sourceKind: "execution" | "teacher_review";
  sourceId: string;
  artifactIds: string[];
  externalSend: false;
};

export type EducationWorkCase = {
  id: string;
  kind: "calendar_preparation" | "teaching_before_class" | "capability_package";
  triggerId: string;
  taskId: string;
  title: string;
  currentState: EducationWorkCaseState;
  dueDate: string | null;
  executionRevision: number;
  artifactRevision: number;
  transitionRevision: number;
  sourceIds: string[];
  artifactIds: string[];
  artifacts: Array<{
    id: string;
    key: string;
    title: string;
    type: "markdown";
    relativePath: string;
    sha256: string;
    revision: number;
    evidenceIds: string[];
    externalSend: false;
  }>;
  transitions: EducationWorkTransition[];
  externalSend: false;
};

export type EducationMemoryCategory = "semester" | "class" | "teaching" | "preferences" | "school";

export type EducationMemory = {
  id: string;
  category: EducationMemoryCategory;
  content: string;
  student: string | null;
  tags: string[];
  count: number;
  createdAt: string | null;
  updatedAt: string | null;
  state: "active" | "superseded";
  revision: number;
};

export type EducationReviewProvenance = {
  sourceKind: string;
  sourceId: string;
  sourcePath: string | null;
  sourceHash: string | null;
  observedAt: string;
  actor: string;
  evidenceIds: string[];
  parentIds: string[];
};

export type EducationTeacherReview = {
  state: "not_required" | "pending_review" | "accepted" | "modified" | "rejected" | "held";
  reviewerId: string | null;
  reviewedAt: string | null;
  note: string | null;
  revision: number;
};

export type EducationObservation = {
  observationId: string;
  text: string;
  subject: string | null;
  classId: string | null;
  studentIds: string[];
  observedAt: string;
  provenance: EducationReviewProvenance[];
  evidenceIds: string[];
  inferenceStatus: "observed" | "candidate_only" | "confirmed";
  teacherReview: EducationTeacherReview;
};

export type EducationMemoryCandidate = {
  candidateId: string;
  category: EducationMemoryCategory;
  proposedContent: string;
  tags: string[];
  basedOnObservationIds: string[];
  conflictsWithMemoryIds: string[];
  evidenceIds: string[];
  inferenceStatus: "candidate_only";
  teacherReview: EducationTeacherReview;
  externalSend: false;
};

export type EducationC1Memory = {
  memoryId: string;
  category: EducationMemoryCategory;
  content: string;
  state: "active" | "superseded";
  provenance: EducationReviewProvenance[];
  evidenceIds: string[];
  acceptedFromCandidateId: string;
  acceptedAt: string;
};

export type EducationReviewTarget = {
  targetKind: string;
  targetId: string;
  commandType: string;
} | null;

export type EducationC1Receipt = {
  receiptId: string;
  commandId: string;
  requestId: string;
  commandType: string;
  target: EducationReviewTarget;
  receiptPhase: string;
  decision: string | null;
  status: string;
  appliedIds: string[];
  rejectedIds: string[];
  reasonCode: string | null;
  evidenceIds: string[];
  beforeSnapshotId: string;
  afterSnapshotId: string | null;
  beforeStateHash: string;
  afterStateHash: string | null;
  teacherReview: EducationTeacherReview;
  rollback: { available: boolean; rollbackId: string | null; expiresAt: string | null };
  externalSend: false;
  createdAt: string;
};

export type EducationTeacherContextReceipt = EducationC1Receipt;

export type EducationReviewHistory = {
  reviewId: string;
  commandId: string | null;
  commandType: string;
  target: EducationReviewTarget;
  decision: string;
  revision: number;
  status: string;
  evidenceIds: string[];
  receiptId: string | null;
  beforeSnapshotId: string;
  afterSnapshotId: string | null;
  beforeStateHash: string;
  afterStateHash: string | null;
  teacherReview: EducationTeacherReview;
  rollback: { available: boolean; rollbackId: string | null; expiresAt: string | null };
  externalSend: false;
  reviewedAt: string;
};

export type EducationTeacherContextReviewHistory = EducationReviewHistory;

export type EducationTeacherContextValues = Partial<Record<"name" | "role" | "subject" | "grade" | "class_name", string>>;

export type EducationTeacherContextCandidate = {
  contextId: string;
  snapshotId: string;
  stateHash: string;
  revision: number;
  title: string;
  canonicalSummary: string;
  proposalSummary: string;
  currentValues: EducationTeacherContextValues;
  proposedValues: EducationTeacherContextValues;
  fieldKeys: string[];
  sourceIds: string[];
  evidenceIds: string[];
  conflictIds: string[];
  status: string;
  teacherReview: EducationTeacherReview;
  externalSend: false;
};

export type EducationWorkCandidateStatus = "pending_review" | "accepted" | "modified" | "rejected" | "held" | "snoozed" | "suppressed";
export type EducationWorkCandidateDecision = "accept" | "modify" | "reject" | "hold" | "snooze" | "suppress";
export type EducationWorkCandidate = {
  candidateId: string;
  taskId: string;
  snapshotId: string;
  stateHash: string;
  revision: number;
  title: string;
  summary: string;
  dueAt: string | null;
  reason: string;
  sourceIds: string[];
  evidenceIds: string[];
  status: EducationWorkCandidateStatus;
  snoozeUntil: string | null;
  suppressionScope: "this_candidate" | "matching_reason" | "next_cycle" | null;
  nextCycleState: string;
  teacherReview: EducationTeacherReview;
  externalSend: false;
};

export type EducationWorkCandidateReceipt = Omit<EducationC1Receipt, "commandType" | "decision"> & {
  commandType: "review_work_candidate";
  decision: EducationWorkCandidateDecision;
};

export type EducationWorkCandidateReviewHistory = Omit<EducationReviewHistory, "commandType" | "decision"> & {
  commandType: "review_work_candidate";
  decision: EducationWorkCandidateDecision;
};

export type EducationIntakeTarget = {
  projectionKind: "calendar_import" | "timetable_import" | "material_intake";
  targetId: string;
  commandType: "import_calendar" | "import_timetable" | "intake_material";
  title: string;
  summary: string;
  status: string;
  reviewedAt: string | null;
};

export type C1ReviewCapability = {
  enabled: boolean;
  commands: ["review_observation", "review_memory_candidate"];
  actions: ["accept", "modify", "reject", "hold"];
  reason: string;
};

export type TeacherContextReviewCapability = {
  enabled: boolean;
  commands: ["review_teacher_context"];
  actions: ["accept", "modify", "reject", "hold"];
  reason: string;
};

export type WorkCandidateReviewCapability = {
  enabled: boolean;
  commands: ["review_work_candidate"];
  actions: EducationWorkCandidateDecision[];
  reason: string;
};

export type EducationSignal = {
  id: string;
  content: string;
  related: string[];
  strength: number;
  createdAt: string | null;
  lastSeenAt: string | null;
};

export type EducationInsight = {
  id: string;
  content: string;
  evidenceIds: string[];
  confidence: number;
  status: "brewing" | "surfaced" | "dismissed";
  createdAt: string | null;
  surfacedAt: string | null;
};

export type EducationTheme = {
  topic: string;
  occurrences: number;
  reviewState: string | null;
  skillCandidate: boolean;
  evidenceIds: string[];
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

export type SubjectKnowledgeNode = {
  id: string;
  subject: string;
  topic: string;
  mastery: number | null;
  commonErrors: Array<{ description: string; count: number; students: string[] }>;
  strugglingStudents: string[];
  masteredStudents: string[];
  prerequisites: string[];
  lastTaughtAt: string | null;
  lastAssessedAt: string | null;
  updatedAt: string | null;
};

export type FamilyContact = {
  id: string;
  student: string;
  name: string;
  relationship: string | null;
  communicationStyle: string[];
  concerns: string[];
  historyCount: number;
  lastContactAt: string | null;
  lastTopic: string | null;
  lastOutcome: string | null;
};

export type EducationDocument = {
  id: string;
  kind: "daily" | "weekly" | "insight" | "dream";
  title: string;
  date: string | null;
  path: string;
  excerpt: string;
};

export type EducationDataSourceStatus = "ready" | "empty" | "unavailable";

export type EducationDataSource = {
  path: string;
  present: boolean;
  count: number;
  observedAt: string | null;
  status: EducationDataSourceStatus;
};

export type EducationContract = {
  teacherMaterials?: Array<{ material_id: string; title: string; kind: string; subject: string | null; class_id: string | null; relative_path: string; available?: boolean }>;
  generatedArtifactsUnavailable?: boolean;
  generatedArtifacts?: Array<{ artifact_id: string; title: string; relative_path: string; available?: boolean; session_id: string; task_id: string | null; updated_at: string; size_bytes: number; origin?: "preparation" }>;
  scope: "teacher_internal";
  externalSend: false;
  requiresTeacherReview: true;
  workspace: string;
  students: Array<Record<string, unknown>>;
  studentNameCounts?: Record<string, number>;
  timetable: Array<Record<string, unknown>>;
  observations: EducationObservation[];
  memoryCandidates: EducationMemoryCandidate[];
  c1Memories: EducationC1Memory[];
  receipts: EducationC1Receipt[];
  reviewHistory: EducationReviewHistory[];
  intakeReceipts: EducationC1Receipt[];
  intakeReviewHistory: EducationReviewHistory[];
  intakeTargets: EducationIntakeTarget[];
  teacherContextCandidates: EducationTeacherContextCandidate[];
  teacherContextReceipts: EducationTeacherContextReceipt[];
  teacherContextReviewHistory: EducationTeacherContextReviewHistory[];
  workCandidates: EducationWorkCandidate[];
  workCandidateReceipts: EducationWorkCandidateReceipt[];
  workCandidateReviewHistory: EducationWorkCandidateReviewHistory[];
  workCases: EducationWorkCase[];
  calendar: CalendarFact[];
  tasks: TeacherTask[];
  taskSessions: Record<string, TaskSessionBinding>;
  continuity: {
    memories: EducationMemory[];
    signals: EducationSignal[];
    insights: EducationInsight[];
    themes: EducationTheme[];
    subjectKnowledge: SubjectKnowledgeNode[];
    familyContacts: FamilyContact[];
    documents: EducationDocument[];
    lastDreamAt: string | null;
  };
  dataSources: {
    students: EducationDataSource;
    timetable: EducationDataSource;
    calendar: EducationDataSource;
    tasks: EducationDataSource;
    memory: EducationDataSource;
    insights: EducationDataSource;
    growth: EducationDataSource;
    materials: EducationDataSource;
    documents: EducationDataSource;
  };
  capabilities: {
    taskReview: {
      enabled: boolean;
      mode: "read_only" | "canonical_safe_store";
      actions: TaskReviewAction[];
      reason: string;
    };
    calendar: { enabled: boolean; mode: "read_only" | "canonical_safe_store"; reason: string };
    timetable: { enabled: boolean; mode: "read_only" | "canonical_safe_store"; reason: string };
    materialIntake: { enabled: boolean; mode: "read_only" | "canonical_safe_store"; reason: string };
    c1Review: C1ReviewCapability;
    teacherContextReview: TeacherContextReviewCapability;
    workCandidateReview: WorkCandidateReviewCapability;
    memoryUpdate: { enabled: boolean; commands: ["update_memory"]; reason: string };
    entityDelete: { enabled: boolean; targetKinds: EducationEntityDeleteKind[]; reason: string };
  };
};

type RawRecord = Record<string, unknown>;

type ContractInput = {
  workspace?: string | RawRecord;
  students?: unknown;
  timetable?: unknown;
  calendar?: unknown;
  tasks?: unknown;
  taskSessions?: unknown;
  memoryStores?: unknown;
  subconscious?: unknown;
  subjectKnowledge?: unknown;
  parentProfiles?: unknown;
  documents?: unknown;
  calendarPresent?: boolean;
  tasksPresent?: boolean;
  taskReview?: {
    enabled: boolean;
    mode: "read_only" | "canonical_safe_store";
    reason: string;
  };
  snapshotPayload?: RawRecord;
  snapshot?: RawRecord;
  supportedCommands?: readonly string[];
};

function record(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isoDateStatus(value: unknown): { date: string | null; status: CalendarDateStatus } {
  const raw = text(value);
  if (!raw) return { date: null, status: "missing" };
  return /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? { date: raw, status: "explicit" }
    : { date: null, status: "invalid" };
}

function confidence(value: unknown): CalendarConfidence {
  return value === "confirmed" || value === "teacher_confirmed" || value === "inferred" ? value : "unknown";
}

function taskStatus(value: unknown): TeacherTaskStatus | null {
  if (value === "planned" || value === "accepted" || value === "modified" || value === "rejected" || value === "hold") return value;
  if (value === "held") return "hold";
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record) : [];
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function timestamp(value: unknown): string | null {
  const raw = text(value);
  if (raw) return raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const memoryCategories: EducationMemoryCategory[] = ["semester", "class", "teaching", "preferences", "school"];

function normalizeMemories(value: unknown): EducationMemory[] {
  const stores = record(value);
  return memoryCategories.flatMap((category) => {
    const entries = objectArray(record(stores[category]).entries);
    return entries.flatMap((entry, index) => {
      const content = text(entry.content);
      if (!content) return [];
      return [{
        id: text(entry.id) || `${category}:${index}`,
        category,
        content,
        student: text(entry.student) || text(record(entry.meta).student),
        tags: stringArray(entry.tags),
        count: Math.max(1, Math.trunc(finiteNumber(entry.count, 1))),
        createdAt: timestamp(entry.created_at),
        updatedAt: timestamp(entry.updated_at),
        state: entry.state === "superseded" || entry.superseded_by ? "superseded" : "active",
        revision: Math.max(0, Math.trunc(finiteNumber(entry.revision))),
      } satisfies EducationMemory];
    });
  });
}

function normalizeReviewProvenance(value: unknown): EducationReviewProvenance[] {
  return objectArray(value).flatMap((entry) => {
    const sourceId = text(entry.source_id);
    const sourceKind = text(entry.source_kind);
    const observedAt = text(entry.observed_at);
    if (!sourceId || !sourceKind || !observedAt) return [];
    return [{
      sourceKind,
      sourceId,
      sourcePath: text(entry.source_path),
      sourceHash: text(entry.source_hash),
      observedAt,
      actor: text(entry.actor) || "core",
      evidenceIds: stringArray(entry.evidence_ids),
      parentIds: stringArray(entry.parent_ids),
    } satisfies EducationReviewProvenance];
  }).slice(0, 50);
}

function normalizeC1TeacherReview(value: unknown): EducationTeacherReview {
  const review = record(value);
  const state = review.state === "not_required" || review.state === "accepted" || review.state === "modified"
    || review.state === "rejected" || review.state === "held"
    ? review.state
    : "pending_review";
  return {
    state,
    reviewerId: text(review.reviewer_id),
    reviewedAt: timestamp(review.reviewed_at),
    note: text(review.note),
    revision: Math.max(0, Math.trunc(finiteNumber(review.revision))),
  };
}

function normalizeC1Observations(value: unknown): EducationObservation[] {
  return objectArray(value).flatMap((entry) => {
    const observationId = text(entry.observation_id);
    const content = text(entry.text);
    const observedAt = text(entry.observed_at);
    if (!observationId || !content || !observedAt) return [];
    const inferenceStatus = entry.inference_status === "observed" || entry.inference_status === "confirmed"
      ? entry.inference_status
      : "candidate_only";
    return [{
      observationId,
      text: content,
      subject: text(entry.subject),
      classId: text(entry.class_id),
      studentIds: stringArray(entry.student_ids),
      observedAt,
      provenance: normalizeReviewProvenance(entry.provenance),
      evidenceIds: stringArray(entry.evidence_ids),
      inferenceStatus,
      teacherReview: normalizeC1TeacherReview(entry.teacher_review),
    } satisfies EducationObservation];
  }).slice(0, 200);
}

function memoryCategory(value: unknown): EducationMemoryCategory | null {
  return value === "semester" || value === "class" || value === "teaching" || value === "preferences" || value === "school"
    ? value
    : null;
}

function normalizeMemoryCandidates(value: unknown): EducationMemoryCandidate[] {
  return objectArray(value).flatMap((entry) => {
    const candidateId = text(entry.candidate_id);
    const category = memoryCategory(entry.category);
    const proposedContent = text(entry.proposed_content);
    if (!candidateId || !category || !proposedContent || entry.inference_status !== "candidate_only" || entry.external_send !== false) return [];
    return [{
      candidateId,
      category,
      proposedContent,
      tags: stringArray(entry.tags),
      basedOnObservationIds: stringArray(entry.based_on_observation_ids),
      conflictsWithMemoryIds: stringArray(entry.conflicts_with_memory_ids),
      evidenceIds: stringArray(entry.evidence_ids),
      inferenceStatus: "candidate_only",
      teacherReview: normalizeC1TeacherReview(entry.teacher_review),
      externalSend: false,
    } satisfies EducationMemoryCandidate];
  }).slice(0, 200);
}

function normalizeC1Memories(value: unknown): EducationC1Memory[] {
  return objectArray(value).flatMap((entry) => {
    const memoryId = text(entry.memory_id);
    const category = memoryCategory(entry.category);
    const content = text(entry.content);
    const state = entry.state === "active" || entry.state === "superseded" ? entry.state : null;
    const acceptedFromCandidateId = text(entry.accepted_from_candidate_id);
    const acceptedAt = text(entry.accepted_at);
    if (!memoryId || !category || !content || !state || !acceptedFromCandidateId || !acceptedAt) return [];
    return [{
      memoryId,
      category,
      content,
      state,
      provenance: normalizeReviewProvenance(entry.provenance),
      evidenceIds: stringArray(entry.evidence_ids),
      acceptedFromCandidateId,
      acceptedAt,
    } satisfies EducationC1Memory];
  }).slice(0, 200);
}

const TEACHER_CONTEXT_FIELDS = ["name", "role", "subject", "grade", "class_name"] as const;
const TEACHER_CONTEXT_FIELD_SET = new Set<string>(TEACHER_CONTEXT_FIELDS);
const REVIEW_TARGET_STATUSES = new Set(["candidate", "pending_review", "accepted", "modified", "rejected", "held", "suppressed", "snoozed", "completed"]);

function boundedUniqueStrings(value: unknown, field: string, maxItems = 50, maxLength = 160): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim() || item.length > maxLength) return null;
    const normalized = item.trim();
    if (seen.has(normalized)) return null;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function parseTeacherContextValues(value: unknown, canonical: boolean): EducationTeacherContextValues | null {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) return null;
  const raw = value.trim();
  const prefix = "当前教师背景：";
  let serialized = raw;
  if (canonical) {
    if (!raw.startsWith(prefix)) return null;
    serialized = raw.slice(prefix.length).trim();
  }
  if (serialized === "未配置") return {};
  if (!serialized) return null;
  const parsed: EducationTeacherContextValues = {};
  const seen = new Set<string>();
  for (const pair of serialized.split("；")) {
    const parts = pair.split("=");
    if (parts.length !== 2) return null;
    const key = parts[0].trim();
    const item = parts[1].trim();
    if (!TEACHER_CONTEXT_FIELD_SET.has(key) || seen.has(key) || !item || item.length > 120) return null;
    seen.add(key);
    parsed[key as typeof TEACHER_CONTEXT_FIELDS[number]] = item;
  }
  return parsed;
}

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeTeacherContextCandidate(value: unknown, snapshotPayload: RawRecord | undefined): EducationTeacherContextCandidate | null {
  const targetProjection = record(value);
  const target = record(targetProjection?.target);
  if (!targetProjection || !target || targetProjection.projection_kind !== "teacher_context"
    || target.target_kind !== "teacher_context" || target.command_type !== "review_teacher_context") return null;
  const targetKeys = ["command_type", "target_id", "target_kind"];
  const projectionKeys = ["conflict_ids", "evidence_ids", "external_send", "field_keys", "projection_kind", "revision", "source_ids", "status", "summary", "target", "teacher_review", "title", "value_summary"];
  if (Object.keys(target).sort().join("|") !== targetKeys.join("|")
    || Object.keys(targetProjection).sort().join("|") !== projectionKeys.join("|")) return null;
  const contextId = text(target.target_id);
  const snapshotId = text(snapshotPayload?.snapshot_id);
  const stateHash = text(snapshotPayload?.state_hash);
  const title = text(targetProjection.title);
  const canonicalSummary = text(targetProjection.summary);
  const proposalSummary = text(targetProjection.value_summary);
  const revision = typeof targetProjection.revision === "number" ? targetProjection.revision : null;
  const status = text(targetProjection.status);
  const sourceIds = boundedUniqueStrings(targetProjection.source_ids, "source_ids");
  const evidenceIds = boundedUniqueStrings(targetProjection.evidence_ids, "evidence_ids");
  const fieldKeys = boundedUniqueStrings(targetProjection.field_keys, "field_keys", 5, 120);
  const conflictIds = boundedUniqueStrings(targetProjection.conflict_ids, "conflict_ids");
  if (!contextId || typeof snapshotId !== "string" || typeof stateHash !== "string" || !/^sha256:[A-Za-z0-9_-]+$/.test(stateHash) || !title || !canonicalSummary || !proposalSummary
    || typeof revision !== "number" || !Number.isInteger(revision) || revision < 0 || !status || !REVIEW_TARGET_STATUSES.has(status)
    || !sourceIds || sourceIds.length !== 1 || !evidenceIds || evidenceIds.length === 0 || !fieldKeys || !conflictIds
    || targetProjection.external_send !== false) return null;
  const currentValues = parseTeacherContextValues(canonicalSummary, true);
  const proposedValues = parseTeacherContextValues(proposalSummary, false);
  const rawTeacherReview = record(targetProjection.teacher_review);
  if (!rawTeacherReview || (rawTeacherReview.state !== "not_required" && rawTeacherReview.state !== "pending_review" && rawTeacherReview.state !== "accepted" && rawTeacherReview.state !== "modified" && rawTeacherReview.state !== "rejected" && rawTeacherReview.state !== "held")
    || typeof rawTeacherReview.revision !== "number" || !Number.isInteger(rawTeacherReview.revision) || rawTeacherReview.revision < 0) return null;
  const teacherReview = normalizeC1TeacherReview(rawTeacherReview);
  const sortedFieldKeys = [...fieldKeys].sort();
  const parsedFieldKeys = Object.keys(proposedValues || {}).sort();
  if (!currentValues || !proposedValues || !sameStringList(sortedFieldKeys, parsedFieldKeys)) return null;
  return {
    contextId,
    snapshotId,
    stateHash,
    revision,
    title,
    canonicalSummary,
    proposalSummary,
    currentValues,
    proposedValues,
    fieldKeys: sortedFieldKeys,
    sourceIds,
    evidenceIds,
    conflictIds,
    status,
    teacherReview,
    externalSend: false,
  };
}

function normalizeTeacherContextCandidates(value: unknown, snapshotPayload: RawRecord | undefined): EducationTeacherContextCandidate[] {
  const candidates: EducationTeacherContextCandidate[] = [];
  const seen = new Set<string>();
  for (const item of objectArray(value)) {
    const candidate = normalizeTeacherContextCandidate(item, snapshotPayload);
    if (!candidate) continue;
    if (seen.has(candidate.contextId)) return [];
    seen.add(candidate.contextId);
    candidates.push(candidate);
  }
  return candidates.slice(0, 200);
}

const WORK_CANDIDATE_STATUSES: EducationWorkCandidateStatus[] = ["pending_review", "accepted", "modified", "rejected", "held", "snoozed", "suppressed"];
const WORK_CANDIDATE_NEXT_CYCLE_STATES = new Set([
  "awaiting_teacher", "closed_accepted", "closed_modified", "closed_rejected", "held", "snoozed",
  "suppressed_this_candidate", "suppressed_matching_reason", "suppressed_next_cycle", "reopened_source_changed", "reopened_snooze_expired",
]);
const WORK_CANDIDATE_SUPPRESSION_SCOPES = new Set(["this_candidate", "matching_reason", "next_cycle"]);

function strictRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function hasExactKeys(value: RawRecord, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function hasExactKeysWithOptional(value: RawRecord, required: readonly string[], optional: readonly string[]): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.hasOwn(value, key)) && keys.every(key => allowed.has(key));
}

function strictText(value: unknown, maxLength: number, allowEmpty = false): string | null {
  if (typeof value !== "string" || value.length > maxLength) return null;
  const normalized = value.trim();
  return normalized || allowEmpty ? normalized : null;
}

function strictDateOnly(value: unknown): string | null {
  const normalized = strictText(value, 10);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === normalized ? normalized : null;
}

function nullableStrictDateOnly(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return strictDateOnly(value);
}

function strictWorkTeacherReview(value: unknown): EducationTeacherReview | null {
  const review = strictRecord(value);
  if (!review || !hasExactKeys(review, ["state", "reviewer_id", "reviewed_at", "note", "revision"])) return null;
  if (review.state !== "not_required" && review.state !== "pending_review" && review.state !== "accepted"
    && review.state !== "modified" && review.state !== "rejected" && review.state !== "held") return null;
  if (!Number.isInteger(review.revision) || Number(review.revision) < 0) return null;
  if (review.reviewer_id !== null && strictText(review.reviewer_id, 160) === null) return null;
  if (review.reviewed_at !== null && strictText(review.reviewed_at, 64) === null) return null;
  if (review.note !== null && strictText(review.note, 1000, true) === null) return null;
  return normalizeC1TeacherReview(review);
}

function workCandidateTaskStatus(status: EducationWorkCandidateStatus): TeacherTaskStatus {
  if (status === "pending_review") return "planned";
  if (status === "accepted") return "accepted";
  if (status === "modified") return "modified";
  if (status === "rejected" || status === "suppressed") return "rejected";
  return "hold";
}

function workCandidateReviewState(status: EducationWorkCandidateStatus): EducationTeacherReview["state"] {
  if (status === "pending_review") return "pending_review";
  if (status === "accepted") return "accepted";
  if (status === "modified") return "modified";
  if (status === "rejected" || status === "suppressed") return "rejected";
  return "held";
}

function normalizeWorkCandidateTarget(value: unknown, tasks: TeacherTask[], snapshotPayload: RawRecord | undefined): EducationWorkCandidate | null {
  const projection = strictRecord(value);
  const target = strictRecord(projection?.target);
  if (!projection || !target || projection.projection_kind !== "work_candidate"
    || !hasExactKeys(target, ["target_kind", "target_id", "command_type"])
    || target.target_kind !== "work_candidate" || target.command_type !== "review_work_candidate") return null;
  if (!hasExactKeys(projection, [
    "projection_kind", "target", "revision", "title", "summary", "status", "source_ids", "evidence_ids",
    "teacher_review", "external_send", "reason", "snooze_until", "suppression_scope", "next_cycle_state",
  ])) return null;
  const candidateId = strictText(target.target_id, 160);
  const snapshotId = strictText(snapshotPayload?.snapshot_id, 160);
  const stateHash = strictText(snapshotPayload?.state_hash, 160);
  const title = strictText(projection.title, 240);
  const summary = strictText(projection.summary, 2000);
  const reason = strictText(projection.reason, 1000);
  const sourceIds = boundedUniqueStrings(projection.source_ids, "work_candidate.source_ids");
  const evidenceIds = boundedUniqueStrings(projection.evidence_ids, "work_candidate.evidence_ids");
  if (typeof projection.revision !== "number" || !Number.isInteger(projection.revision) || projection.revision < 0) return null;
  const revision = projection.revision;
  const status = projection.status;
  const snoozeUntil = nullableStrictDateOnly(projection.snooze_until);
  const suppressionScope = projection.suppression_scope === null
    ? null
    : strictText(projection.suppression_scope, 40);
  const teacherReview = strictWorkTeacherReview(projection.teacher_review);
  if (!candidateId || !snapshotId || !stateHash || !/^sha256:[A-Za-z0-9_-]+$/.test(stateHash)
    || !title || !summary || !reason || !sourceIds || sourceIds.length !== 1 || sourceIds[0] !== candidateId
    || !evidenceIds || evidenceIds.length === 0
    || !WORK_CANDIDATE_STATUSES.includes(status as EducationWorkCandidateStatus)
    || snoozeUntil === undefined || (projection.snooze_until !== null && snoozeUntil === null)
    || projection.suppression_scope !== null && (suppressionScope === null || !WORK_CANDIDATE_SUPPRESSION_SCOPES.has(suppressionScope))
    || projection.suppression_scope === undefined || !WORK_CANDIDATE_NEXT_CYCLE_STATES.has(String(projection.next_cycle_state))
    || projection.external_send !== false || !teacherReview || teacherReview.revision !== revision) return null;
  const matchingTasks = tasks.filter((task) => task.id === candidateId);
  if (matchingTasks.length !== 1) return null;
  const task = matchingTasks[0];
  if (status === "pending_review" && task.dueDate === null) return null;
  const systemHeldPending = status === "held"
    && teacherReview.state === "pending_review"
    && task.dueDate === null
    && teacherReview.reviewerId === null
    && teacherReview.reviewedAt === null
    && teacherReview.note === null;
  if (task.title !== title || task.status !== workCandidateTaskStatus(status as EducationWorkCandidateStatus)
    || task.revision !== revision || task.reviewedAt !== teacherReview.reviewedAt
    || task.reviewer !== teacherReview.reviewerId || task.reviewNote !== teacherReview.note
    || task.externalSend !== false || task.requiresTeacherReview !== true || task.scope !== "teacher_internal"
    || (task.dueDate !== null && strictDateOnly(task.dueDate) === null)
    || (teacherReview.state !== workCandidateReviewState(status as EducationWorkCandidateStatus) && !systemHeldPending)) return null;
  return {
    candidateId,
    taskId: candidateId,
    snapshotId,
    stateHash,
    revision,
    title,
    summary,
    dueAt: task.dueDate,
    reason,
    sourceIds,
    evidenceIds,
    status: status as EducationWorkCandidateStatus,
    snoozeUntil,
    suppressionScope: suppressionScope as EducationWorkCandidate["suppressionScope"],
    nextCycleState: String(projection.next_cycle_state),
    teacherReview,
    externalSend: false,
  };
}

function normalizeWorkCandidateTargets(value: unknown, tasks: TeacherTask[], snapshotPayload: RawRecord | undefined): EducationWorkCandidate[] {
  if (!Array.isArray(value)) return [];
  const candidates: EducationWorkCandidate[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const projection = strictRecord(item);
    const target = strictRecord(projection?.target);
    if (projection?.projection_kind !== "work_candidate" && target?.target_kind !== "work_candidate" && target?.command_type !== "review_work_candidate") continue;
    const candidate = normalizeWorkCandidateTarget(item, tasks, snapshotPayload);
    if (!candidate || seen.has(candidate.candidateId)) return [];
    seen.add(candidate.candidateId);
    candidates.push(candidate);
  }
  return candidates.slice(0, 200);
}

function normalizeWorkCandidateReceipts(value: unknown): EducationWorkCandidateReceipt[] {
  return normalizeC1Receipts(value, ["review_work_candidate"]) as EducationWorkCandidateReceipt[];
}

function normalizeWorkCandidateReviewHistory(value: unknown): EducationWorkCandidateReviewHistory[] {
  return normalizeReviewHistory(value, ["review_work_candidate"]) as EducationWorkCandidateReviewHistory[];
}

const WORK_CASE_STATES = new Set<EducationWorkCaseState>(["planned", "accepted", "modified", "rejected", "held", "queued", "running", "draft_ready", "failed", "completed"]);
const WORK_TRANSITION_STATES = new Set<EducationWorkTransitionState>(["planned", "accepted", "modified", "rejected", "held", "queued", "running", "draft_ready", "failed", "stale"]);

function strictTimestamp(value: unknown): string | null {
  const raw = strictText(value, 64);
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

function normalizeWorkCases(value: unknown, tasks: TeacherTask[]): EducationWorkCase[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) return [];
  const taskById = new Map(tasks.filter((task) => task.id).map((task) => [task.id!, task]));
  const cases: EducationWorkCase[] = [];
  const caseIds = new Set<string>();
  const taskIds = new Set<string>();
  for (const item of value) {
    const entry = strictRecord(item);
    if (!entry || !hasExactKeysWithOptional(entry, ["work_case_id", "case_kind", "trigger_id", "task_id", "title", "current_state", "due_date", "execution_revision", "artifact_revision", "transition_revision", "source_ids", "artifact_ids", "transitions", "external_send"], ["artifacts"])) continue;
    const id = strictText(entry.work_case_id, 160);
    const triggerId = strictText(entry.trigger_id, 160);
    const taskId = strictText(entry.task_id, 160);
    const title = strictText(entry.title, 240);
    const dueDate = nullableStrictDateOnly(entry.due_date);
    const sourceIds = boundedUniqueStrings(entry.source_ids, "work_case.source_ids", 50);
    const artifactIds = boundedUniqueStrings(entry.artifact_ids, "work_case.artifact_ids", 50);
    const task = taskId ? taskById.get(taskId) : null;
    const validKind = entry.case_kind === "calendar_preparation" || entry.case_kind === "teaching_before_class" || entry.case_kind === "capability_package";
    const triggerMatchesKind = entry.case_kind === "teaching_before_class"
      ? task?.trigger === "teaching_before_class"
      : entry.case_kind === "capability_package"
        ? task?.trigger === "capability_package"
        : task?.trigger !== "teaching_before_class" && task?.trigger !== "capability_package";
    if (!id || !triggerId || !taskId || !title || !validKind
      || !WORK_CASE_STATES.has(entry.current_state as EducationWorkCaseState)
      || dueDate === undefined || entry.external_send !== false
      || !Number.isInteger(entry.execution_revision) || Number(entry.execution_revision) < 0
      || !Number.isInteger(entry.artifact_revision) || Number(entry.artifact_revision) < 0
      || !Number.isInteger(entry.transition_revision) || Number(entry.transition_revision) < 0
      || !sourceIds || sourceIds.length !== 1 || sourceIds[0] !== triggerId || !artifactIds
      || !task || task.sourceEventId !== triggerId || task.title !== title || task.dueDate !== dueDate
      || !triggerMatchesKind || !Array.isArray(entry.transitions) || entry.transitions.length > 50) continue;
    if (caseIds.has(id) || taskIds.has(taskId)) return [];
    const transitions: EducationWorkTransition[] = [];
    const transitionIds = new Set<string>();
    let previousSequence = 0;
    let validTransitions = true;
    for (const itemTransition of entry.transitions) {
      const transition = strictRecord(itemTransition);
      if (!transition || !hasExactKeys(transition, ["transition_id", "sequence", "state", "occurred_at", "source_kind", "source_id", "artifact_ids", "external_send"])) { validTransitions = false; break; }
      const transitionId = strictText(transition.transition_id, 160);
      const occurredAt = strictTimestamp(transition.occurred_at);
      const sourceId = strictText(transition.source_id, 160);
      const transitionArtifactIds = boundedUniqueStrings(transition.artifact_ids, "work_case.transition.artifact_ids", 50);
      if (!transitionId || transitionIds.has(transitionId) || !Number.isInteger(transition.sequence) || Number(transition.sequence) <= previousSequence
        || !WORK_TRANSITION_STATES.has(transition.state as EducationWorkTransitionState) || !occurredAt || !sourceId
        || (transition.source_kind !== "execution" && transition.source_kind !== "teacher_review")
        || !transitionArtifactIds || transition.external_send !== false) { validTransitions = false; break; }
      previousSequence = Number(transition.sequence);
      transitionIds.add(transitionId);
      transitions.push({ id: transitionId, sequence: previousSequence, state: transition.state as EducationWorkTransitionState, occurredAt, sourceKind: transition.source_kind, sourceId, artifactIds: transitionArtifactIds, externalSend: false });
    }
    if (!validTransitions || (transitions.length === 0 && Number(entry.transition_revision) !== 0)
      || (transitions.length > 0 && transitions.at(-1)!.sequence !== Number(entry.transition_revision))) continue;
    const artifacts: EducationWorkCase["artifacts"] = [];
    let validArtifacts = true;
    if (entry.artifacts !== undefined) {
      if (!Array.isArray(entry.artifacts) || entry.artifacts.length > 50) validArtifacts = false;
      else {
        const artifactIdsSeen = new Set<string>();
        for (const rawArtifact of entry.artifacts) {
          const artifact = strictRecord(rawArtifact);
          const artifactId = strictText(artifact?.artifact_id, 160);
          const key = strictText(artifact?.key, 160);
          const artifactTitle = strictText(artifact?.title, 240);
          const relativePath = strictText(artifact?.relative_path, 1024);
          const sha256 = strictText(artifact?.sha256, 71);
          const evidenceIds = boundedUniqueStrings(artifact?.evidence_ids, "work_case.artifact.evidence_ids", 500);
          if (!artifact || !hasExactKeys(artifact, ["artifact_id", "key", "title", "type", "relative_path", "sha256", "revision", "evidence_ids", "external_send"])
            || !artifactId || artifactIdsSeen.has(artifactId) || !key || !artifactTitle || artifact.type !== "markdown"
            || !relativePath || !relativePath.startsWith(".edupi/output/") || relativePath.split(/[\\/]/).includes("..")
            || !sha256 || !/^sha256:[a-f0-9]{64}$/.test(sha256) || !Number.isInteger(artifact.revision) || Number(artifact.revision) < 1
            || !evidenceIds || artifact.external_send !== false) { validArtifacts = false; break; }
          artifactIdsSeen.add(artifactId);
          artifacts.push({ id: artifactId, key, title: artifactTitle, type: "markdown", relativePath, sha256, revision: Number(artifact.revision), evidenceIds, externalSend: false });
        }
      }
      if (validArtifacts && (artifacts.length !== artifactIds.length || artifacts.some((artifact, index) => artifact.id !== artifactIds[index])
        || Math.max(0, ...artifacts.map(artifact => artifact.revision)) !== Number(entry.artifact_revision))) validArtifacts = false;
    }
    if (!validArtifacts) continue;
    caseIds.add(id);
    taskIds.add(taskId);
    cases.push({ id, kind: entry.case_kind as EducationWorkCase["kind"], triggerId, taskId, title, currentState: entry.current_state as EducationWorkCaseState, dueDate, executionRevision: Number(entry.execution_revision), artifactRevision: Number(entry.artifact_revision), transitionRevision: Number(entry.transition_revision), sourceIds, artifactIds, artifacts, transitions, externalSend: false });
  }
  return cases;
}

function normalizeIntakeTargets(value: unknown): EducationIntakeTarget[] {
  const pairs = {
    calendar_import: "import_calendar",
    timetable_import: "import_timetable",
    material_intake: "intake_material",
  } as const;
  return objectArray(value).flatMap((entry) => {
    const projectionKind = text(entry.projection_kind) as keyof typeof pairs | null;
    if (!projectionKind || !Object.hasOwn(pairs, projectionKind)) return [];
    const target = record(entry.target);
    const targetId = text(target.target_id);
    const commandType = text(target.command_type);
    const title = text(entry.title);
    const summary = text(entry.summary);
    const status = text(entry.status);
    if (!targetId || commandType !== pairs[projectionKind] || !title || !summary || !status || entry.external_send !== false) return [];
    return [{
      projectionKind,
      targetId,
      commandType: pairs[projectionKind],
      title,
      summary,
      status,
      reviewedAt: timestamp(record(entry.teacher_review).reviewed_at),
    } satisfies EducationIntakeTarget];
  }).slice(0, 200);
}

function teacherFacingIntakeReceipt(receipt: EducationC1Receipt): EducationC1Receipt {
  return { ...receipt, evidenceIds: receipt.evidenceIds.filter((id) => !id.startsWith("stg_")) };
}

function teacherFacingIntakeHistory(history: EducationReviewHistory): EducationReviewHistory {
  return { ...history, evidenceIds: history.evidenceIds.filter((id) => !id.startsWith("stg_")) };
}

function normalizeReviewTarget(value: unknown): EducationReviewTarget {
  if (value === null || value === undefined) return null;
  const target = record(value);
  const targetKind = text(target.target_kind);
  const targetId = text(target.target_id);
  const commandType = text(target.command_type);
  return targetKind && targetId && commandType ? { targetKind, targetId, commandType } : null;
}

function normalizeRollback(value: unknown): { available: boolean; rollbackId: string | null; expiresAt: string | null } {
  const rollback = record(value);
  return {
    available: rollback.available === true,
    rollbackId: text(rollback.rollback_id),
    expiresAt: timestamp(rollback.expires_at),
  };
}

function normalizeC1Receipts(value: unknown, commandTypes: readonly string[] = ["review_observation", "review_memory_candidate"]): EducationC1Receipt[] {
  return objectArray(value).flatMap((entry) => {
    const receiptId = text(entry.receipt_id);
    const commandId = text(entry.command_id);
    const requestId = text(entry.request_id);
    const commandType = text(entry.command_type);
    const status = text(entry.status);
    const beforeSnapshotId = text(entry.before_snapshot_id);
    const beforeStateHash = text(entry.before_state_hash);
    const createdAt = text(entry.created_at);
    if (!receiptId || !commandId || !requestId || !commandType || !status || !beforeSnapshotId || !beforeStateHash || !createdAt || entry.external_send !== false) return [];
    if (!commandTypes.includes(commandType)) return [];
    return [{
      receiptId,
      commandId,
      requestId,
      commandType,
      target: normalizeReviewTarget(entry.target),
      receiptPhase: text(entry.receipt_phase) || "mutation",
      decision: text(entry.decision),
      status,
      appliedIds: stringArray(entry.applied_ids),
      rejectedIds: stringArray(entry.rejected_ids),
      reasonCode: text(entry.reason_code),
      evidenceIds: stringArray(entry.evidence_ids),
      beforeSnapshotId,
      afterSnapshotId: text(entry.after_snapshot_id),
      beforeStateHash,
      afterStateHash: text(entry.after_state_hash),
      teacherReview: normalizeC1TeacherReview(entry.teacher_review),
      rollback: normalizeRollback(entry.rollback),
      externalSend: false,
      createdAt,
    } satisfies EducationC1Receipt];
  }).slice(0, 100);
}

function normalizeReviewHistory(value: unknown, commandTypes: readonly string[] = ["review_observation", "review_memory_candidate"]): EducationReviewHistory[] {
  return objectArray(value).flatMap((entry) => {
    const reviewId = text(entry.review_id);
    const commandType = text(entry.command_type);
    const decision = text(entry.decision);
    const status = text(entry.status);
    const beforeSnapshotId = text(entry.before_snapshot_id);
    const beforeStateHash = text(entry.before_state_hash);
    const reviewedAt = text(entry.reviewed_at);
    if (!reviewId || !commandType || !decision || !status || !beforeSnapshotId || !beforeStateHash || !reviewedAt || entry.external_send !== false) return [];
    if (!commandTypes.includes(commandType)) return [];
    return [{
      reviewId,
      commandId: text(entry.command_id),
      commandType,
      target: normalizeReviewTarget(entry.target),
      decision,
      revision: Math.max(0, Math.trunc(finiteNumber(entry.revision))),
      status,
      evidenceIds: stringArray(entry.evidence_ids),
      receiptId: text(entry.receipt_id),
      beforeSnapshotId,
      afterSnapshotId: text(entry.after_snapshot_id),
      beforeStateHash,
      afterStateHash: text(entry.after_state_hash),
      teacherReview: normalizeC1TeacherReview(entry.teacher_review),
      rollback: normalizeRollback(entry.rollback),
      externalSend: false,
      reviewedAt,
    } satisfies EducationReviewHistory];
  }).slice(0, 100);
}

function normalizeSignals(value: unknown): EducationSignal[] {
  return objectArray(record(value).signals).flatMap((signal, index) => {
    const content = text(signal.content);
    if (!content) return [];
    return [{
      id: text(signal.id) || text(signal.signal_id) || `signal:${index}`,
      content,
      related: stringArray(signal.related ?? signal.related_ids),
      strength: Math.max(1, Math.trunc(finiteNumber(signal.strength, 1))),
      createdAt: timestamp(signal.created_at),
      lastSeenAt: timestamp(signal.last_seen ?? signal.last_seen_at),
    } satisfies EducationSignal];
  });
}

function normalizeInsights(value: unknown): EducationInsight[] {
  return objectArray(record(value).insights).flatMap((insight, index) => {
    const content = text(insight.content);
    if (!content) return [];
    const status = insight.status === "surfaced" || insight.status === "dismissed" ? insight.status : "brewing";
    return [{
      id: text(insight.id) || text(insight.insight_id) || `insight:${index}`,
      content,
      evidenceIds: stringArray(insight.evidence ?? insight.evidence_ids),
      confidence: Math.max(0, Math.min(1, finiteNumber(insight.confidence))),
      status,
      createdAt: timestamp(insight.created_at),
      surfacedAt: timestamp(insight.surfaced_at),
    } satisfies EducationInsight];
  });
}

function normalizeThemes(value: unknown): EducationTheme[] {
  if (Array.isArray(value)) {
    return value.flatMap((raw) => {
      const theme = record(raw);
      const topic = text(theme.topic);
      if (!topic) return [];
      return [{
        topic,
        occurrences: Math.max(0, Math.trunc(finiteNumber(theme.occurrences))),
        reviewState: text(theme.review_state),
        skillCandidate: theme.skill_candidate === true,
        evidenceIds: stringArray(theme.evidence_ids),
        firstSeenAt: timestamp(theme.first_seen_at),
        lastSeenAt: timestamp(theme.last_seen_at),
      } satisfies EducationTheme];
    }).sort((left, right) => right.occurrences - left.occurrences || left.topic.localeCompare(right.topic, "zh-CN"));
  }
  const themes = record(record(value).themes);
  return Object.entries(themes).flatMap(([topic, raw]) => {
    const theme = record(raw);
    if (!topic.trim()) return [];
    return [{
      topic: topic.trim(),
      occurrences: Math.max(0, Math.trunc(finiteNumber(theme.count ?? theme.occurrences))),
      reviewState: text(theme.status),
      skillCandidate: theme.skill_candidate === true,
      evidenceIds: stringArray(theme.evidence_ids),
      firstSeenAt: timestamp(theme.first_dream ?? theme.first_seen),
      lastSeenAt: timestamp(theme.last_dream ?? theme.last_seen),
    } satisfies EducationTheme];
  }).sort((left, right) => right.occurrences - left.occurrences || left.topic.localeCompare(right.topic, "zh-CN"));
}

function normalizeSubjectKnowledge(value: unknown): SubjectKnowledgeNode[] {
  if (Array.isArray(value)) {
    return value.flatMap((raw) => {
      const node = record(raw);
      const subject = text(node.subject);
      const topic = text(node.topic);
      if (!subject || !topic) return [];
      const errors = objectArray(node.common_errors).flatMap((error) => {
        const description = text(error.description);
        if (!description) return [];
        return [{ description, count: Math.max(1, Math.trunc(finiteNumber(error.count, 1))), students: stringArray(error.student_ids ?? error.students) }];
      });
      return [{
        id: text(node.knowledge_id) || `${subject}:${topic}`,
        subject,
        topic,
        mastery: typeof node.mastery === "number" && Number.isFinite(node.mastery) ? Math.max(0, Math.min(1, node.mastery)) : null,
        commonErrors: errors,
        strugglingStudents: stringArray(node.struggling_student_ids ?? node.struggling_students),
        masteredStudents: stringArray(node.mastered_student_ids ?? node.mastered_students),
        prerequisites: stringArray(node.prerequisites),
        lastTaughtAt: timestamp(node.last_taught_at ?? node.last_taught),
        lastAssessedAt: timestamp(node.last_assessed_at ?? node.last_assessed),
        updatedAt: timestamp(node.updated_at),
      } satisfies SubjectKnowledgeNode];
    });
  }
  const subjects = record(value);
  const nodes = Object.entries(subjects).flatMap(([subject, rawTopics]) => Object.entries(record(rawTopics)).flatMap(([topic, raw]) => {
    const node = record(raw);
    const errors = objectArray(node.common_errors).flatMap((error) => {
      const description = text(error.desc) || text(error.description);
      if (!description) return [];
      return [{
        description,
        count: Math.max(1, Math.trunc(finiteNumber(error.count, 1))),
        students: stringArray(error.students),
      }];
    });
    return [{
      id: `${subject}:${topic}`,
      subject,
      topic,
      mastery: typeof node.mastery === "number" && Number.isFinite(node.mastery) ? Math.max(0, Math.min(1, node.mastery)) : null,
      commonErrors: errors,
      strugglingStudents: stringArray(node.struggling_students),
      masteredStudents: stringArray(node.mastered_students),
      prerequisites: stringArray(node.prerequisites),
      lastTaughtAt: timestamp(node.last_taught),
      lastAssessedAt: timestamp(node.last_assessed),
      updatedAt: timestamp(node.updated_at),
    } satisfies SubjectKnowledgeNode];
  }));
  const familyName = (topic: string) => {
    const plain = topic.replace(/[（(：:].*$/, "").trim();
    if (plain.includes("的移项")) return `${plain.replace(/的移项.*$/, "")} · 移项`;
    if (plain.endsWith("移项")) return `${plain.slice(0, -2)} · 移项`;
    return plain;
  };
  const grouped = new Map<string, SubjectKnowledgeNode>();
  for (const node of nodes) {
    const topic = familyName(node.topic);
    const key = `${node.subject}:${topic}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...node, id: key, topic });
      continue;
    }
    existing.commonErrors.push(...node.commonErrors);
    existing.strugglingStudents = [...new Set([...existing.strugglingStudents, ...node.strugglingStudents])];
    existing.masteredStudents = [...new Set([...existing.masteredStudents, ...node.masteredStudents])];
    existing.prerequisites = [...new Set([...existing.prerequisites, ...node.prerequisites])];
    if (node.mastery !== null) existing.mastery = existing.mastery === null ? node.mastery : Math.max(existing.mastery, node.mastery);
    if (String(node.updatedAt || "") > String(existing.updatedAt || "")) existing.updatedAt = node.updatedAt;
    if (String(node.lastTaughtAt || "") > String(existing.lastTaughtAt || "")) existing.lastTaughtAt = node.lastTaughtAt;
    if (String(node.lastAssessedAt || "") > String(existing.lastAssessedAt || "")) existing.lastAssessedAt = node.lastAssessedAt;
  }
  return [...grouped.values()];
}

function normalizeFamilyContacts(value: unknown): FamilyContact[] {
  if (Array.isArray(value)) {
    return value.flatMap((raw) => {
      const profile = record(raw);
      const student = text(profile.student);
      const id = text(profile.contact_id);
      if (!student || !id) return [];
      return [{
        id,
        student,
        name: text(profile.name) || id,
        relationship: text(profile.relationship),
        communicationStyle: stringArray(profile.communication_style),
        concerns: stringArray(profile.concerns),
        historyCount: Math.max(0, Math.trunc(finiteNumber(profile.history_count))),
        lastContactAt: timestamp(profile.last_contact_at),
        lastTopic: text(profile.last_topic),
        lastOutcome: text(profile.last_outcome),
      } satisfies FamilyContact];
    });
  }
  return Object.entries(record(value)).flatMap(([key, raw]) => {
    const profile = record(raw);
    const student = text(profile.student);
    if (!student) return [];
    const history = objectArray(profile.history);
    const latest = history.at(-1) || {};
    return [{
      id: key,
      student,
      name: text(profile.name) || key,
      relationship: text(profile.relationship),
      communicationStyle: stringArray(profile.communication_style),
      concerns: stringArray(profile.concerns),
      historyCount: history.length,
      lastContactAt: timestamp(latest.date),
      lastTopic: text(latest.topic),
      lastOutcome: text(latest.outcome),
    } satisfies FamilyContact];
  });
}

// Core excerpts are raw file heads; briefs start with a YAML front-matter
// block that must never be shown to teachers. The projection may flatten
// whitespace, so both the multiline and the single-line form are stripped.
function stripFrontMatter(excerpt: string): string {
  return excerpt
    .replace(/^---\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(\r?\n)?/, "")
    .replace(/^---\s+[^\n]*?\s+---\s+(?=\S)/, "")
    .trim();
}

function normalizeDocuments(value: unknown): EducationDocument[] {
  return objectArray(value).flatMap((raw, index) => {
    const kind = raw.kind;
    const path = text(raw.path) || text(raw.relative_path);
    const title = text(raw.title);
    const excerpt = stripFrontMatter(text(raw.excerpt) ?? "");
    if ((kind !== "daily" && kind !== "weekly" && kind !== "insight" && kind !== "dream") || !path?.startsWith(".edupi/output/") || !title || !excerpt) return [];
    const reportDate = kind === "daily" ? path.match(/\/(\d{4}-\d{2}-\d{2})\.md$/)?.[1] : null;
    return [{
      id: reportDate ? `daily:${reportDate}` : text(raw.id) || text(raw.document_id) || `document:${index}`,
      kind,
      title,
      date: reportDate || timestamp(raw.date),
      path,
      excerpt,
    } satisfies EducationDocument];
  });
}

function normalizeCalendarEvent(value: unknown): CalendarFact {
  const source = record(value);
  const start = isoDateStatus(source.date);
  const end = isoDateStatus(source.end_date);
  // Core's status is authoritative; a syntactically valid date cannot promote a held fact.
  const coreDateStatus = source.date_status === "explicit" || source.date_status === "missing" || source.date_status === "invalid"
    ? source.date_status
    : null;
  const requestedDateStatus: CalendarDateStatus = coreDateStatus || start.status;
  const invalidEnd = requestedDateStatus === "explicit" && end.status === "invalid";
  const reversedEnd = requestedDateStatus === "explicit"
    && start.status === "explicit"
    && end.status === "explicit"
    && Boolean(start.date && end.date && end.date < start.date);
  const dateStatus: CalendarDateStatus = requestedDateStatus === "explicit"
    && start.status !== "explicit"
    ? start.status
    // Do not collapse a contradictory explicit range into a made-up one-day event.
    : invalidEnd || reversedEnd
      ? "invalid"
      : requestedDateStatus;
  const hasUsableDate = dateStatus === "explicit" && start.status === "explicit";
  const eventConfidence = confidence(source.confidence);
  const heldByCoreState = source.state === "pending_review" || source.state === "held";
  const preparationStatus: CalendarPreparationStatus = !hasUsableDate || heldByCoreState || source.preparation_status === "hold"
    ? "hold"
    : source.preparation_status === "read_only"
      ? "read_only"
      : start.status === "explicit" && eventConfidence !== "inferred" ? "read_only" : "hold";

  return {
    id: text(source.id) || text(source.event_id),
    date: hasUsableDate ? start.date : null,
    endDate: hasUsableDate && end.status === "explicit" ? end.date : null,
    dateStatus,
    name: text(source.name) || "未命名校历节点",
    type: text(source.type),
    source: text(source.source),
    confidence: eventConfidence,
    notes: text(source.notes),
    preparationStatus,
  };
}

function normalizeTimetable(value: unknown): Array<Record<string, unknown>> {
  return objectArray(value).flatMap((slot, index) => {
    const subject = text(slot.subject);
    const dayOfWeek = finiteNumber(slot.day_of_week ?? slot.dayOfWeek, NaN);
    const period = finiteNumber(slot.period, NaN);
    if (!subject || !Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7 || !Number.isInteger(period) || period < 0 || period > 64) return [];
    const slotId = text(slot.slot_id);
    const legacyId = text(slot.id);
    return [{
      ...(slotId ? { slot_id: slotId } : {}),
      ...(legacyId ? { id: legacyId } : {}),
      ...(!slotId && !legacyId ? { id: `timetable:${index}` } : {}),
      day_of_week: dayOfWeek,
      period,
      subject,
      class_name: text(slot.class_name ?? slot.className),
      kind: text(slot.kind) || "class",
      notes: text(slot.notes),
      ...(text(slot.confidence) ? { confidence: text(slot.confidence) } : {}),
      ...(text(slot.status) ? { status: text(slot.status) } : {}),
      ...(text(slot.preparationStatus ?? slot.preparation_status) ? { preparationStatus: text(slot.preparationStatus ?? slot.preparation_status) } : {}),
    }];
  });
}

function normalizeTask(value: unknown): TeacherTask {
  const source = record(value);
  const rawExternalSend = source.external_send === true;
  return {
    id: text(source.id) || text(source.task_id),
    title: text(source.title) || text(source.source_event_name) || "教师内部准备任务",
    trigger: text(source.trigger),
    status: taskStatus(source.status) || taskStatus(source.review_status) || "planned",
    contentStatus: text(source.content_status),
    deliveryStatus: text(source.delivery_status),
    sourceEventId: text(source.source_event_id),
    sourceEventName: text(source.source_event_name),
    sourceEventDate: isoDateStatus(source.source_event_date).date,
    triggerDate: isoDateStatus(source.trigger_date).date,
    dueDate: isoDateStatus(source.due_date).date,
    deliverables: stringArray(source.deliverables),
    audience: stringArray(source.audience),
    // A missing review flag is treated as requiring review at this boundary.
    // The desktop never relaxes the EduPi safety default.
    requiresTeacherReview: source.requires_teacher_review !== false,
    externalSend: rawExternalSend,
    scope: text(source.scope),
    student: text(source.student),
    studentEventType: text(source.student_event_type),
    materialId: text(source.material_id),
    materialKind: text(source.material_kind),
    topic: text(source.topic),
    revision: typeof source.revision === "number" && source.revision % 1 === 0
      ? source.revision
      : typeof source.review_revision === "number" && source.review_revision % 1 === 0
        ? source.review_revision
        : 0,
    reviewedAt: text(source.reviewed_at),
    reviewer: text(source.reviewer),
    reviewNote: text(source.review_note),
    reviewHistory: Array.isArray(source.review_history)
      ? source.review_history.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : [],
    evidence: record(source.evidence),
    boardStage: source.board_stage === "todo" || source.board_stage === "progress" || source.board_stage === "review" || source.board_stage === "done" ? source.board_stage : null,
    boardRevision: typeof source.board_revision === "number" && Number.isInteger(source.board_revision) && source.board_revision >= 0 ? source.board_revision : 0,
    boardUpdatedAt: timestamp(source.board_updated_at),
  };
}

function normalizeTaskSessions(value: unknown, taskIds: ReadonlySet<string>): Record<string, TaskSessionBinding> {
  const source = record(value);
  const bindings: Record<string, TaskSessionBinding> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!taskIds.has(key)) continue;
    const binding = record(value);
    const taskId = text(binding.taskId);
    const sessionId = text(binding.sessionId);
    const boundAt = text(binding.boundAt);
    const status = binding.status;
    if (taskId !== key || !sessionId || !boundAt || (status !== "running" && status !== "idle" && status !== "missing")) continue;
    bindings[key] = { taskId, sessionId, boundAt, status };
  }
  return bindings;
}

const CORE_PROJECTION_UNAVAILABLE = "Core v1.1 当前仅提供只读 education_workspace 投影。";
const C1_REVIEW_COMMANDS: ["review_observation", "review_memory_candidate"] = ["review_observation", "review_memory_candidate"];
const CUMULATIVE_REVIEW_COMMANDS: ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate"] = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate"];
const C1_REVIEW_ACTIONS: ["accept", "modify", "reject", "hold"] = ["accept", "modify", "reject", "hold"];
const TEACHER_CONTEXT_REVIEW_COMMANDS: ["review_teacher_context"] = ["review_teacher_context"];
const WORK_CANDIDATE_REVIEW_COMMANDS: ["review_work_candidate"] = ["review_work_candidate"];
const WORK_CANDIDATE_REVIEW_ACTIONS: EducationWorkCandidateDecision[] = ["accept", "modify", "reject", "hold", "snooze", "suppress"];
const MEMORY_UPDATE_COMMANDS: ["update_memory"] = ["update_memory"];

function intakeCapability(
  command: "import_calendar" | "import_timetable" | "intake_material",
  label: string,
  snapshotPayload: RawRecord | undefined,
  supportedCommands?: readonly string[],
): EducationContract["capabilities"]["calendar"] {
  const manifestCommands = supportedCommands || [];
  const snapshotCommands = record(snapshotPayload?.capabilities).supported_commands;
  const enabled = manifestCommands.includes(command) && exactStringList(snapshotCommands, manifestCommands);
  return {
    enabled,
    mode: enabled ? "canonical_safe_store" : "read_only",
    reason: enabled ? `${label}通过 Core receipt 写入。` : `Core 尚未启用${label}。`,
  };
}

function taskReviewCapability(snapshotPayload: RawRecord | undefined, supportedCommands?: readonly string[]): EducationContract["capabilities"]["taskReview"] {
  const manifestCommands = supportedCommands || [];
  const snapshotCommands = record(snapshotPayload?.capabilities).supported_commands;
  const enabled = manifestCommands.includes("review_task") && exactStringList(snapshotCommands, manifestCommands);
  return {
    enabled,
    mode: enabled ? "canonical_safe_store" : "read_only",
    actions: ["accept", "modify", "reject", "hold", "rollback"],
    reason: enabled ? "任务审核已连接 Core。" : "Core 尚未启用任务审核。",
  };
}

function memoryUpdateCapability(snapshotPayload: RawRecord | undefined, supportedCommands?: readonly string[]): EducationContract["capabilities"]["memoryUpdate"] {
  const manifestCommands = supportedCommands || [];
  const snapshotCommands = record(snapshotPayload?.capabilities).supported_commands;
  const enabled = manifestCommands.includes("update_memory") && exactStringList(snapshotCommands, manifestCommands);
  return { enabled, commands: [...MEMORY_UPDATE_COMMANDS], reason: enabled ? "记忆可直接手动修改。" : "Core 尚未启用手动修改记忆。" };
}

function exactStringList(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

function cumulativeReviewCapabilitiesMatch(snapshotPayload: RawRecord | undefined, supportedCommands: readonly string[] | undefined): { commandsMatch: boolean; payloadMatches: boolean } {
  const manifestCommands = supportedCommands || [];
  const payloadCommands = record(snapshotPayload?.capabilities)?.supported_commands;
  const commandsMatch = manifestCommands.length >= CUMULATIVE_REVIEW_COMMANDS.length
    && CUMULATIVE_REVIEW_COMMANDS.every((command, index) => manifestCommands[index] === command);
  const payloadMatches = Array.isArray(payloadCommands)
    && payloadCommands.length === manifestCommands.length
    && manifestCommands.every((command, index) => payloadCommands[index] === command);
  return { commandsMatch, payloadMatches };
}

function c1ReviewCapability(snapshotPayload: RawRecord | undefined, supportedCommands?: readonly string[]): C1ReviewCapability {
  const { commandsMatch, payloadMatches } = cumulativeReviewCapabilitiesMatch(snapshotPayload, supportedCommands);
  const enabled = commandsMatch && payloadMatches;
  return {
    enabled,
    commands: [...C1_REVIEW_COMMANDS],
    actions: [...C1_REVIEW_ACTIONS],
    reason: enabled
      ? "Core C1 observation and memory-candidate review is enabled by the pinned capability manifest."
      : !commandsMatch
        ? "C1 observation and memory-candidate review is unavailable until the pinned Core capability manifest enables both commands."
        : "C1 review is unavailable because the Core snapshot capability does not match the pinned manifest.",
  };
}

function teacherContextReviewCapability(snapshotPayload: RawRecord | undefined, supportedCommands?: readonly string[]): TeacherContextReviewCapability {
  const { commandsMatch, payloadMatches } = cumulativeReviewCapabilitiesMatch(snapshotPayload, supportedCommands);
  const enabled = commandsMatch && payloadMatches;
  return {
    enabled,
    commands: [...TEACHER_CONTEXT_REVIEW_COMMANDS],
    actions: [...C1_REVIEW_ACTIONS],
    reason: enabled
      ? "Core teacher-context review is enabled by the pinned cumulative capability manifest."
      : !commandsMatch
        ? "Teacher-context review is unavailable until the pinned cumulative Core capability enables it."
        : "Teacher-context review is unavailable because the Core snapshot capability does not match the pinned manifest.",
  };
}

function workCandidateReviewCapability(snapshotPayload: RawRecord | undefined, supportedCommands?: readonly string[]): WorkCandidateReviewCapability {
  const { commandsMatch, payloadMatches } = cumulativeReviewCapabilitiesMatch(snapshotPayload, supportedCommands);
  const enabled = commandsMatch && payloadMatches;
  return {
    enabled,
    commands: [...WORK_CANDIDATE_REVIEW_COMMANDS],
    actions: [...WORK_CANDIDATE_REVIEW_ACTIONS],
    reason: enabled
      ? "Core Today work-candidate review is enabled by the pinned cumulative capability manifest."
      : !commandsMatch
        ? "Today work-candidate review is unavailable until the pinned cumulative Core capability enables it."
        : "Today work-candidate review is unavailable because the Core snapshot capability does not match the pinned manifest.",
  };
}

function coreSourceSummary(workspace: RawRecord, sourceId: string): { present: boolean; count: number; observedAt: string | null } {
  const summary = objectArray(workspace.source_summaries).find((item) => item.source_id === sourceId);
  return {
    present: summary?.present === true,
    count: Math.max(0, Math.trunc(finiteNumber(summary?.item_count))),
    observedAt: timestamp(summary?.observed_at),
  };
}

function dataSource(path: string, present: boolean, count: number, observedAt: string | null = null): EducationDataSource {
  const safeCount = Math.max(0, Math.trunc(count));
  return { path, present, count: safeCount, observedAt, status: !present ? "unavailable" : safeCount > 0 ? "ready" : "empty" };
}

function combineSourceSummaries(summaries: Array<{ present: boolean; count: number; observedAt: string | null }>): { present: boolean; count: number; observedAt: string | null } {
  return {
    present: summaries.some((summary) => summary.present),
    count: summaries.reduce((total, summary) => total + summary.count, 0),
    observedAt: summaries.map((summary) => summary.observedAt).filter((value): value is string => Boolean(value)).sort().at(-1) || null,
  };
}

export function buildEducationContractFromWorkspace(workspaceInput: RawRecord, options: {
  workspacePath: string;
  taskSessions?: unknown;
  snapshotPayload?: RawRecord;
  snapshot?: RawRecord;
  supportedCommands?: readonly string[];
  entityDeleteEnabled?: boolean;
} ): EducationContract {
  const workspace = record(workspaceInput);
  const snapshotPayload = options.snapshotPayload || options.snapshot;
  const observations = normalizeC1Observations(snapshotPayload?.observations);
  const memoryCandidates = normalizeMemoryCandidates(snapshotPayload?.memory_candidates);
  const rejectedCandidateIds = new Set(memoryCandidates.filter((candidate) => candidate.teacherReview.state === "rejected").map((candidate) => candidate.candidateId));
  const c1Memories = normalizeC1Memories(snapshotPayload?.memories).filter((memory) => !rejectedCandidateIds.has(memory.acceptedFromCandidateId));
  const receipts = normalizeC1Receipts(snapshotPayload?.receipts);
  const reviewHistory = normalizeReviewHistory(snapshotPayload?.review_history);
  const intakeReceipts = normalizeC1Receipts(snapshotPayload?.receipts, ["import_calendar", "import_timetable", "intake_material"]).map(teacherFacingIntakeReceipt);
  const intakeReviewHistory = normalizeReviewHistory(snapshotPayload?.review_history, ["import_calendar", "import_timetable", "intake_material"]).map(teacherFacingIntakeHistory);
  const intakeTargets = normalizeIntakeTargets(snapshotPayload?.review_targets);
  const teacherContextCandidates = normalizeTeacherContextCandidates(snapshotPayload?.review_targets, snapshotPayload);
  const teacherContextReceipts = normalizeC1Receipts(snapshotPayload?.receipts, ["review_teacher_context"]);
  const teacherContextReviewHistory = normalizeReviewHistory(snapshotPayload?.review_history, ["review_teacher_context"]);
  const students = objectArray(workspace.students);
  const timetable = normalizeTimetable(workspace.timetable);
  const calendar = objectArray(workspace.calendar).map(normalizeCalendarEvent);
  const tasks = objectArray(workspace.tasks).map(normalizeTask);
  const workCandidates = normalizeWorkCandidateTargets(snapshotPayload?.review_targets, tasks, snapshotPayload);
  const workCandidateReceipts = normalizeWorkCandidateReceipts(snapshotPayload?.receipts);
  const workCandidateReviewHistory = normalizeWorkCandidateReviewHistory(snapshotPayload?.review_history);
  for (const candidate of workCandidates) {
    const task = tasks.find(item => item.id === candidate.taskId);
    const history = workCandidateReviewHistory.filter(item => item.target?.targetId === candidate.candidateId);
    if (task && history.length) task.reviewHistory = history.map(item => ({ review_id:item.reviewId, action:item.decision, reviewed_at:item.reviewedAt, note:item.teacherReview.note, reviewer:item.teacherReview.reviewerId }));
  }
  const workCases = normalizeWorkCases(snapshotPayload?.work_cases, tasks);
  const continuity = record(workspace.continuity);
  const memories = normalizeMemories({
    semester: { entries: objectArray(continuity.memories).filter((item) => item.category === "semester").map((item) => ({ ...item, id: item.memory_id, created_at: item.created_at, updated_at: item.updated_at })) },
    class: { entries: objectArray(continuity.memories).filter((item) => item.category === "class").map((item) => ({ ...item, id: item.memory_id, created_at: item.created_at, updated_at: item.updated_at })) },
    teaching: { entries: objectArray(continuity.memories).filter((item) => item.category === "teaching").map((item) => ({ ...item, id: item.memory_id, created_at: item.created_at, updated_at: item.updated_at })) },
    preferences: { entries: objectArray(continuity.memories).filter((item) => item.category === "preferences").map((item) => ({ ...item, id: item.memory_id, created_at: item.created_at, updated_at: item.updated_at })) },
    school: { entries: objectArray(continuity.memories).filter((item) => item.category === "school").map((item) => ({ ...item, id: item.memory_id, created_at: item.created_at, updated_at: item.updated_at })) },
  });
  const subconscious = {
    signals: objectArray(continuity.signals).map((item) => ({ ...item, id: item.signal_id, related: item.related_ids, last_seen: item.last_seen_at })),
    insights: objectArray(continuity.insights).map((item) => ({ ...item, id: item.insight_id, evidence: item.evidence_ids })),
    themes: continuity.themes,
    last_dream: continuity.last_dream,
  };
  const signals = normalizeSignals(subconscious);
  const insights = normalizeInsights(subconscious);
  const themes = normalizeThemes(subconscious);
  const subjectKnowledge = normalizeSubjectKnowledge(continuity.subject_knowledge);
  const familyContacts = normalizeFamilyContacts(continuity.family_contacts);
  const documents = normalizeDocuments(continuity.documents);
  const taskSessions = normalizeTaskSessions(options.taskSessions, new Set(tasks.map((task) => task.id).filter((id): id is string => Boolean(id))));
  const sourceCounts = {
    students: coreSourceSummary(workspace, "student_profiles"),
    timetable: coreSourceSummary(workspace, "timetable"),
    calendar: coreSourceSummary(workspace, "calendar"),
    tasks: coreSourceSummary(workspace, "rhythm_plan"),
    memory: combineSourceSummaries(["class_memory", "teaching_memory", "semester_memory", "preferences_memory", "school_memory"].map((sourceId) => coreSourceSummary(workspace, sourceId))),
    insights: coreSourceSummary(workspace, "subconscious"),
    materials: coreSourceSummary(workspace, "material_candidates"),
    documents: coreSourceSummary(workspace, "documents"),
  };
  return {
    scope: "teacher_internal",
    externalSend: false,
    requiresTeacherReview: true,
    workspace: options.workspacePath,
    students,
    timetable,
    observations,
    memoryCandidates,
    c1Memories,
    receipts,
    reviewHistory,
    intakeReceipts,
    intakeReviewHistory,
    intakeTargets,
    teacherContextCandidates,
    teacherContextReceipts,
    teacherContextReviewHistory,
    workCandidates,
    workCandidateReceipts,
    workCandidateReviewHistory,
    workCases,
    calendar,
    tasks,
    taskSessions,
    continuity: {
      memories,
      signals,
      insights,
      themes,
      subjectKnowledge,
      familyContacts,
      documents,
      lastDreamAt: timestamp(continuity.last_dream),
    },
    dataSources: {
      students: dataSource(".edupi/memory/student_profiles.json", sourceCounts.students.present, students.length, sourceCounts.students.observedAt),
      timetable: dataSource(".edupi/memory/timetable.json", sourceCounts.timetable.present, timetable.length, sourceCounts.timetable.observedAt),
      calendar: dataSource(".edupi/memory/calendar.json", sourceCounts.calendar.present, calendar.length, sourceCounts.calendar.observedAt),
      tasks: dataSource(".edupi/output/rhythm_plan.json", sourceCounts.tasks.present, tasks.length, sourceCounts.tasks.observedAt),
      memory: dataSource(".edupi/memory", sourceCounts.memory.present, memories.length, sourceCounts.memory.observedAt),
      insights: dataSource(".edupi/memory/subconscious.json", sourceCounts.insights.present, signals.length + insights.length + themes.length, sourceCounts.insights.observedAt),
      growth: dataSource(".edupi/output", sourceCounts.documents.present || sourceCounts.insights.present, documents.length + themes.length, [sourceCounts.documents.observedAt, sourceCounts.insights.observedAt].filter((value): value is string => Boolean(value)).sort().at(-1) || null),
      materials: dataSource(".edupi/output", sourceCounts.materials.present || sourceCounts.documents.present || intakeTargets.some((target) => target.projectionKind === "material_intake") || tasks.some((task) => Boolean(task.materialId)), Math.max(sourceCounts.materials.count + documents.length, intakeTargets.filter((target) => target.projectionKind === "material_intake").length + tasks.filter((task) => Boolean(task.materialId)).length + documents.length), [sourceCounts.materials.observedAt, sourceCounts.documents.observedAt].filter((value): value is string => Boolean(value)).sort().at(-1) || null),
      documents: dataSource(".edupi/output", sourceCounts.documents.present, documents.length, sourceCounts.documents.observedAt),
    },
    capabilities: {
      taskReview: taskReviewCapability(snapshotPayload, options.supportedCommands),
      calendar: intakeCapability("import_calendar", "校历导入", snapshotPayload, options.supportedCommands),
      timetable: intakeCapability("import_timetable", "课表导入", snapshotPayload, options.supportedCommands),
      materialIntake: intakeCapability("intake_material", "材料接入", snapshotPayload, options.supportedCommands),
      c1Review: c1ReviewCapability(snapshotPayload, options.supportedCommands),
      teacherContextReview: teacherContextReviewCapability(snapshotPayload, options.supportedCommands),
      workCandidateReview: workCandidateReviewCapability(snapshotPayload, options.supportedCommands),
      memoryUpdate: memoryUpdateCapability(snapshotPayload, options.supportedCommands),
      entityDelete: { enabled: options.entityDeleteEnabled === true, targetKinds: options.entityDeleteEnabled === true ? ["calendar", "timetable", "memory", "student", "task", "material"] : [], reason: options.entityDeleteEnabled === true ? "Core 软删除已启用。" : CORE_PROJECTION_UNAVAILABLE },
    },
  };
}

export function buildEducationContract(input: ContractInput = {}): EducationContract {
  if (input.workspace && typeof input.workspace === "object" && !Array.isArray(input.workspace)) {
    return buildEducationContractFromWorkspace(input.workspace, {
      workspacePath: "",
      taskSessions: input.taskSessions,
      snapshotPayload: input.snapshotPayload || input.snapshot,
      supportedCommands: input.supportedCommands,
    });
  }
  const calendar = Array.isArray(input.calendar) ? input.calendar.map(normalizeCalendarEvent) : [];
  const normalizedTasks = Array.isArray(input.tasks) ? input.tasks.map(normalizeTask) : [];
  const tasks = normalizedTasks;
  const students = objectArray(input.students);
  const timetable = normalizeTimetable(input.timetable);
  const taskSessions = normalizeTaskSessions(input.taskSessions, new Set(tasks.map((task) => task.id).filter((id): id is string => Boolean(id))));
  const memories = normalizeMemories(input.memoryStores);
  const snapshotPayload = input.snapshotPayload || input.snapshot;
  const observations = normalizeC1Observations(snapshotPayload?.observations);
  const memoryCandidates = normalizeMemoryCandidates(snapshotPayload?.memory_candidates);
  const rejectedCandidateIds = new Set(memoryCandidates.filter((candidate) => candidate.teacherReview.state === "rejected").map((candidate) => candidate.candidateId));
  const receipts = normalizeC1Receipts(snapshotPayload?.receipts);
  const reviewHistory = normalizeReviewHistory(snapshotPayload?.review_history);
  const intakeReceipts = normalizeC1Receipts(snapshotPayload?.receipts, ["import_calendar", "import_timetable", "intake_material"]).map(teacherFacingIntakeReceipt);
  const intakeReviewHistory = normalizeReviewHistory(snapshotPayload?.review_history, ["import_calendar", "import_timetable", "intake_material"]).map(teacherFacingIntakeHistory);
  const intakeTargets = normalizeIntakeTargets(snapshotPayload?.review_targets);
  const teacherContextCandidates = normalizeTeacherContextCandidates(snapshotPayload?.review_targets, snapshotPayload);
  const teacherContextReceipts = normalizeC1Receipts(snapshotPayload?.receipts, ["review_teacher_context"]);
  const teacherContextReviewHistory = normalizeReviewHistory(snapshotPayload?.review_history, ["review_teacher_context"]);
  const workCandidates = normalizeWorkCandidateTargets(snapshotPayload?.review_targets, tasks, snapshotPayload);
  const workCandidateReceipts = normalizeWorkCandidateReceipts(snapshotPayload?.receipts);
  const workCandidateReviewHistory = normalizeWorkCandidateReviewHistory(snapshotPayload?.review_history);
  const workCases = normalizeWorkCases(snapshotPayload?.work_cases, tasks);
  const signals = normalizeSignals(input.subconscious);
  const insights = normalizeInsights(input.subconscious);
  const themes = normalizeThemes(input.subconscious);
  const subjectKnowledge = normalizeSubjectKnowledge(input.subjectKnowledge);
  const familyContacts = normalizeFamilyContacts(input.parentProfiles);
  const documents = normalizeDocuments(input.documents);

  return {
    scope: "teacher_internal",
    externalSend: false,
    requiresTeacherReview: true,
    workspace: typeof input.workspace === "string" ? input.workspace : "",
    students,
    timetable,
    observations,
    memoryCandidates,
    c1Memories: normalizeC1Memories(snapshotPayload?.memories).filter((memory) => !rejectedCandidateIds.has(memory.acceptedFromCandidateId)),
    receipts,
    reviewHistory,
    intakeReceipts,
    intakeReviewHistory,
    intakeTargets,
    teacherContextCandidates,
    teacherContextReceipts,
    teacherContextReviewHistory,
    workCandidates,
    workCandidateReceipts,
    workCandidateReviewHistory,
    workCases,
    calendar,
    tasks,
    taskSessions,
    continuity: {
      memories,
      signals,
      insights,
      themes,
      subjectKnowledge,
      familyContacts,
      documents,
      lastDreamAt: timestamp(record(input.subconscious).last_dream),
    },
    dataSources: {
      students: dataSource(".edupi/memory/student_profiles.json", students.length > 0, students.length),
      timetable: dataSource(".edupi/memory/timetable.json", timetable.length > 0, timetable.length),
      calendar: dataSource(".edupi/memory/calendar.json", input.calendarPresent === true, calendar.length),
      tasks: dataSource(".edupi/output/rhythm_plan.json", input.tasksPresent === true, tasks.length),
      memory: dataSource(".edupi/memory", memories.length > 0, memories.length),
      insights: dataSource(".edupi/memory/subconscious.json", signals.length > 0 || insights.length > 0 || themes.length > 0, signals.length + insights.length + themes.length),
      growth: dataSource(".edupi/output", documents.length > 0 || themes.length > 0, documents.length + themes.length),
      materials: dataSource(".edupi/output", documents.length > 0 || intakeTargets.some((target) => target.projectionKind === "material_intake") || tasks.some((task) => Boolean(task.materialId)), documents.length + intakeTargets.filter((target) => target.projectionKind === "material_intake").length + tasks.filter((task) => Boolean(task.materialId)).length),
      documents: dataSource(".edupi/output", documents.length > 0, documents.length),
    },
    capabilities: {
      taskReview: taskReviewCapability(snapshotPayload, input.supportedCommands),
      calendar: intakeCapability("import_calendar", "校历导入", snapshotPayload, input.supportedCommands),
      timetable: intakeCapability("import_timetable", "课表导入", snapshotPayload, input.supportedCommands),
      materialIntake: intakeCapability("intake_material", "材料接入", snapshotPayload, input.supportedCommands),
      c1Review: c1ReviewCapability(snapshotPayload, input.supportedCommands),
      teacherContextReview: teacherContextReviewCapability(snapshotPayload, input.supportedCommands),
      workCandidateReview: workCandidateReviewCapability(snapshotPayload, input.supportedCommands),
      memoryUpdate: memoryUpdateCapability(snapshotPayload, input.supportedCommands),
      entityDelete: { enabled: false, targetKinds: [], reason: CORE_PROJECTION_UNAVAILABLE },
    },
  };
}
