export type EduPiTeachingSkill = {
  skillId: string;
  title: string;
  lifecycleState: "draft" | "trial" | "validated" | "published" | "retired" | string;
  trialCount: number;
  canReuse: boolean;
  evidenceIds: string[];
  updatedAt: string | null;
  origin: "managed" | "legacy_read_only" | null;
  revision: number | null;
  contentRevision: number | null;
  availableActions: EduPiTeachingMethodAction[];
  details?: { content: string | null; truncated: boolean; retirementReason: string | null; approval: { status: string | null; feedback: string | null; at: string | null } | null; evaluation: { baseline: number | null; candidate: number | null; heldout: number | null; eligible: boolean; at: string | null } | null; trials: EduPiTeachingMethodTrial[]; files: Array<{ label: string; relativePath: string }> };
};

export type EduPiTeachingMethodAction = "create" | "update" | "record_trial" | "validate" | "publish" | "retire";
export type EduPiTeachingMethodOutcome = "helpful" | "mixed" | "not_helpful";
export type EduPiTeachingMethodTrial = { trialId: string | null; contentRevision: number | null; taskId: string | null; taskTitle: string | null; at: string | null; outcome: string | null; feedback: string | null; evidence: string[]; artifactIds: string[] };
export type EduPiTeacherGrowthRecord = { growthId: string; methodId: string; methodTitle: string; contentRevision: number; taskId: string; taskTitle: string; outcome: EduPiTeachingMethodOutcome; feedback: string; evidenceIds: string[]; artifactIds: string[]; recordedAt: string };
export type EduPiTeachingMethodReceipt = { requestId: string; action: EduPiTeachingMethodAction; methodId: string; revision: number; contentRevision: number; status: string; trialId: string | null };

export type EduPiTeachingSkillLifecycle = {
  status: "ready" | "empty" | "unavailable";
  generatedAt: string | null;
  mutationEnabled: boolean;
  skills: EduPiTeachingSkill[];
  teacherGrowth: EduPiTeacherGrowthRecord[];
  mutationReceipts: EduPiTeachingMethodReceipt[];
};

export type EduPiTeachingMethodMutation =
  | { action: "create"; title: string; content: string }
  | { action: "update"; methodId: string; expectedRevision: number; title: string; content: string }
  | { action: "record_trial"; methodId: string; expectedRevision: number; taskId: string; outcome: EduPiTeachingMethodOutcome; feedback: string }
  | { action: "validate"; methodId: string; expectedRevision: number; decision: "accepted" | "rejected"; feedback: string }
  | { action: "publish"; methodId: string; expectedRevision: number }
  | { action: "retire"; methodId: string; expectedRevision: number; reason: string };

type RawRecord = Record<string, unknown>;

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function methodOrigin(value: unknown): EduPiTeachingSkill["origin"] {
  if (value === "managed") return "managed";
  if (value === "legacy_read_only") return "legacy_read_only";
  return null;
}

const METHOD_ACTIONS = new Set<EduPiTeachingMethodAction>(["create", "update", "record_trial", "validate", "publish", "retire"]);
const METHOD_OUTCOMES = new Set<EduPiTeachingMethodOutcome>(["helpful", "mixed", "not_helpful"]);

function emptyLifecycle(): EduPiTeachingSkillLifecycle {
  return { status: "unavailable", generatedAt: null, mutationEnabled: false, skills: [], teacherGrowth: [], mutationReceipts: [] };
}

export function normalizeTeachingSkillLifecycle(value: unknown): EduPiTeachingSkillLifecycle {
  const projection = record(value);
  if (!projection || projection.projection_kind !== "teaching_skill_lifecycle" || projection.external_send !== false || !Array.isArray(projection.skills)) {
    return emptyLifecycle();
  }
  const skills = projection.skills.flatMap((value) => {
    const item = record(value);
    const skillId = text(item?.skill_id);
    if (!item || !skillId) return [];
    const details = record(item.details);
    const approval = record(details?.approval);
    const evaluation = record(details?.evaluation);
    const score = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
    return [{
      skillId,
      title: text(item.title) || "未命名教学能力",
      lifecycleState: text(item.lifecycle_state) || "draft",
      trialCount: typeof item.trial_count === "number" && Number.isInteger(item.trial_count) && item.trial_count >= 0 ? item.trial_count : 0,
      canReuse: item.can_reuse === true,
      evidenceIds: strings(item.evidence_ids),
      updatedAt: text(item.updated_at),
      origin: methodOrigin(item.origin),
      revision: integer(item.revision),
      contentRevision: integer(item.content_revision),
      availableActions: strings(item.available_actions).filter((action): action is EduPiTeachingMethodAction => METHOD_ACTIONS.has(action as EduPiTeachingMethodAction)),
      ...(details ? { details: {
        content: text(details.content)?.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim() || null, truncated: details.truncated === true,
        retirementReason: text(details.retirement_reason),
        approval: approval ? { status: text(approval.status), feedback: text(approval.feedback), at: text(approval.at) } : null,
        evaluation: evaluation ? { baseline: score(evaluation.baseline), candidate: score(evaluation.candidate), heldout: score(evaluation.heldout), eligible: evaluation.eligible === true, at: text(evaluation.at) } : null,
        trials: (Array.isArray(details.trials) ? details.trials : []).flatMap(value => { const trial = record(value); return trial ? [{ trialId: text(trial.trial_id), contentRevision: integer(trial.content_revision), taskId: text(trial.task_id), taskTitle: text(trial.task_title), at: text(trial.at), outcome: text(trial.outcome), feedback: text(trial.prompt), evidence: strings(trial.evidence), artifactIds: strings(trial.artifact_ids) }] : []; }),
        files: (Array.isArray(details.files) ? details.files : []).flatMap(value => { const file = record(value); const relativePath = text(file?.relative_path); return relativePath && !/^(?:[\\/]|[A-Za-z]:)/.test(relativePath) && !relativePath.split(/[\\/]/).includes("..") ? [{ label: text(file?.label) || "文件", relativePath }] : []; }),
      } } : {}),
    }];
  });
  const teacherGrowth = (Array.isArray(projection.teacher_growth) ? projection.teacher_growth : []).flatMap((value) => {
    const item = record(value);
    const growthId = text(item?.growth_id);
    const methodId = text(item?.method_id);
    const methodTitle = text(item?.method_title);
    const contentRevision = integer(item?.content_revision);
    const taskId = text(item?.task_id);
    const taskTitle = text(item?.task_title);
    const outcome = text(item?.outcome);
    const feedback = text(item?.feedback);
    const recordedAt = text(item?.recorded_at);
    if (!growthId || !methodId || !methodTitle || contentRevision === null || contentRevision < 1 || !taskId || !taskTitle || !outcome || !METHOD_OUTCOMES.has(outcome as EduPiTeachingMethodOutcome) || !feedback || !recordedAt) return [];
    return [{ growthId, methodId, methodTitle, contentRevision, taskId, taskTitle, outcome: outcome as EduPiTeachingMethodOutcome, feedback, evidenceIds: strings(item?.evidence_ids), artifactIds: strings(item?.artifact_ids), recordedAt }];
  });
  const mutationReceipts = (Array.isArray(projection.mutation_receipts) ? projection.mutation_receipts : []).flatMap((value) => {
    const item = record(value);
    const requestId = text(item?.request_id);
    const action = text(item?.action);
    const methodId = text(item?.method_id);
    const revision = integer(item?.revision);
    const contentRevision = integer(item?.content_revision);
    const status = text(item?.status);
    if (!requestId || !action || !METHOD_ACTIONS.has(action as EduPiTeachingMethodAction) || !methodId || revision === null || contentRevision === null || contentRevision < 1 || !status) return [];
    return [{ requestId, action: action as EduPiTeachingMethodAction, methodId, revision, contentRevision, status, trialId: text(item?.trial_id) }];
  });
  return { status: skills.length > 0 ? "ready" : "empty", generatedAt: text(projection.generated_at), mutationEnabled: projection.mutation_enabled === true, skills, teacherGrowth, mutationReceipts };
}

export async function readEduPiTeachingSkills(signal?: AbortSignal): Promise<EduPiTeachingSkillLifecycle> {
  try {
    const response = await fetch("/api/edupi/platform", { cache: "no-store", signal });
    if (!response.ok) return emptyLifecycle();
    const payload = record(await response.json());
    return normalizeTeachingSkillLifecycle(payload?.teachingSkills);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return emptyLifecycle();
  }
}

function mutationBody(input: EduPiTeachingMethodMutation): Record<string, unknown> {
  if (input.action === "create") return { action: input.action, title: input.title, content: input.content };
  if (input.action === "update") return { action: input.action, method_id: input.methodId, expected_revision: input.expectedRevision, title: input.title, content: input.content };
  if (input.action === "record_trial") return { action: input.action, method_id: input.methodId, expected_revision: input.expectedRevision, task_id: input.taskId, outcome: input.outcome, feedback: input.feedback };
  if (input.action === "validate") return { action: input.action, method_id: input.methodId, expected_revision: input.expectedRevision, decision: input.decision, feedback: input.feedback };
  if (input.action === "publish") return { action: input.action, method_id: input.methodId, expected_revision: input.expectedRevision };
  return { action: input.action, method_id: input.methodId, expected_revision: input.expectedRevision, reason: input.reason };
}

export async function mutateEduPiTeachingMethod(input: EduPiTeachingMethodMutation): Promise<EduPiTeachingSkillLifecycle> {
  const response = await fetch("/api/edupi/teaching-skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutationBody(input)) });
  const payload = record(await response.json().catch(() => null));
  if (!response.ok) throw new Error(text(payload?.error) || "教学方法操作失败");
  const lifecycle = normalizeTeachingSkillLifecycle(payload?.teachingSkills);
  if (lifecycle.status === "unavailable") throw new Error("教学方法状态无效，请刷新后重试");
  return lifecycle;
}
