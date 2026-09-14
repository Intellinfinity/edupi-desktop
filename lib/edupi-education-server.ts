import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { lstatSync, realpathSync } from "node:fs";
import { buildEducationContractFromWorkspace, type EducationContract } from "./edupi-education-contract";
import { issueC1Review, type C1ReviewDependencies, type C1ReviewDecision, type C1ReviewTargetKind } from "./edupi-c1-review";
import { issueTeacherContextReview, type TeacherContextReviewDependencies, type TeacherContextReviewInput } from "./edupi-teacher-context-review";
import { issueWorkCandidateReview, type WorkCandidateReviewDependencies, type WorkCandidateReviewInput } from "./edupi-work-candidate-review";
import { issueTaskReview, type TaskReviewDependencies, type TaskReviewInput } from "./edupi-task-review";
import { issueMemoryUpdate, type MemoryUpdateDependencies, type MemoryUpdateInput } from "./edupi-memory-update";
import { EntityDeleteError, issueEntityDelete, issueEntityRestore, parseEntityDeletionSummary, type EntityDeleteKind } from "./edupi-entity-delete";
import { projectTeacherContextSnapshot } from "./edupi-onboarding-server";
import type { TeacherContextSnapshot } from "./edupi-onboarding-types";
import { activeBridgeIdentity } from "./edupi-bridge-manifest";
import { readEduPiEducationSnapshot } from "./edupi-core-snapshot";
import { bindTaskSessionFile, readTaskSessionFile, taskSessionFile } from "./edupi-task-session-store";
import { projectTaskSessionBindings } from "./edupi-task-sessions";
import { getLiveSessionSnapshots, getRpcSession, getRunningRpcSessionIds } from "./rpc-manager";
import { listAllSessions } from "./session-reader";
import { workspaceResourcesRequest } from "./edupi-generated-artifacts";
import { setScopedAllowedFileRoots } from "./allowed-roots";


export { taskSessionFile } from "./edupi-task-session-store";

function requiredText(value: unknown, field: string, max = 240): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} 不能为空`);
  const result = value.trim();
  if (result.length > max) throw new Error(`${field} 过长`);
  return result;
}

export function canonicalEduPiCwd(value: string): string {
  try { return realpathSync(value); } catch { return resolve(value); }
}

type EducationSnapshot = Awaited<ReturnType<typeof readEduPiEducationSnapshot>>;

function containedEducationDirectory(root: string, segments: readonly string[]): string | null {
  try {
    const physicalRoot = realpathSync(root);
    let current = physicalRoot;
    for (const segment of segments) {
      const candidate = join(current, segment);
      const stat = lstatSync(candidate);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
      current = realpathSync(candidate);
      const local = relative(physicalRoot, current);
      if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) return null;
    }
    return current;
  } catch {
    return null;
  }
}

export function scopedEducationFileRoots(dataRoot: string): string[] {
  return [
    containedEducationDirectory(dataRoot, [".edupi", "output"]),
    containedEducationDirectory(dataRoot, [".edupi", "inbox", "teacher-materials"]),
  ].filter((value): value is string => value !== null);
}

export async function projectEducationContract(snapshot: EducationSnapshot): Promise<EducationContract> {
  setScopedAllowedFileRoots("edupi-education", scopedEducationFileRoots(snapshot.dataRoot.root));
  const [taskSessionStore, scannedSessions] = await Promise.all([
    readTaskSessionFile(taskSessionFile(snapshot.dataRoot.root)),
    listAllSessions(),
  ]);
  const knownSessionIds = new Set(scannedSessions.map((session) => session.id));
  for (const live of getLiveSessionSnapshots(knownSessionIds)) knownSessionIds.add(live.id);
  for (const binding of taskSessionStore.bindings) {
    if (getRpcSession(binding.session_id)?.isAlive()) knownSessionIds.add(binding.session_id);
  }
  const contract = buildEducationContractFromWorkspace(snapshot.workspace, {
    workspacePath: snapshot.dataRoot.root,
    taskSessions: taskSessionStore,
    snapshotPayload: snapshot.payload,
    supportedCommands: activeBridgeIdentity().contract.supported_commands,
    entityDeleteEnabled: true,
  });
  const generated = await workspaceResourcesRequest().catch(() => null);
  let deletionSummary: ReturnType<typeof parseEntityDeletionSummary> | null = null;
  try { if (generated) deletionSummary = parseEntityDeletionSummary(generated); } catch { /* Keep resources visible while the deletion summary is unavailable. */ }
  const studentNames = new Map<string,number>();
  const studentMetadata = new Map(generated?.studentMetadata.map((student) => [student.student_id, student]) || []);
  for (const student of generated?.studentMetadata || []) studentNames.set(student.name,(studentNames.get(student.name) || 0) + 1);
  return {
    ...contract,
    students: contract.students.map((student) => {
      const metadata = typeof student.student_id === "string" ? studentMetadata.get(student.student_id) : undefined;
      return metadata ? { ...student, class_name: metadata.class_name, profile_revision: metadata.profile_revision, profile_history_count: metadata.profile_history_count } : student;
    }),
    studentNameCounts: Object.fromEntries(studentNames),
    generatedArtifacts: generated?.artifacts || [],
    teacherMaterials: generated?.teacherMaterials || [],
    workspaceResourcesUnavailable: generated === null,
    generatedArtifactsUnavailable: generated === null || generated.artifacts === null,
    entityDeletionCount: deletionSummary?.activeCount || 0,
    entityDeletionHistoryCount: deletionSummary?.historyCount || 0,
    entityDeletionLedgerUnavailable: deletionSummary === null,
    taskSessions: projectTaskSessionBindings(taskSessionStore, {
      taskIds: new Set([...contract.tasks.map((task) => task.id).filter((id): id is string => Boolean(id)), ...contract.continuity.documents.map(document => `document:${document.id}`)]),
      knownSessionIds,
      runningSessionIds: new Set(getRunningRpcSessionIds()),
    }),
  };
}

export async function readEducationContract(): Promise<EducationContract> {
  return projectEducationContract(await readEduPiEducationSnapshot());
}

export async function readEducationWorkspaceBundle(): Promise<{ context: TeacherContextSnapshot; data: EducationContract }> {
  const snapshot = await readEduPiEducationSnapshot();
  const [context, data] = await Promise.all([
    Promise.resolve(projectTeacherContextSnapshot(snapshot)),
    projectEducationContract(snapshot),
  ]);
  return { context, data };
}

export type EducationReviewInput = {
  targetKind: C1ReviewTargetKind;
  targetId: string;
  decision: C1ReviewDecision;
  patch?: Record<string, unknown> | null;
  note?: string | null;
  reviewerId?: string | null;
  reviewer?: string | null;
  issuedAt?: string;
};

/**
 * Execute a C1 observation/memory-candidate review through Core and project
 * the receipt-bound snapshot using the existing task-session overlay.
 */
export async function reviewEducationCandidate(
  input: EducationReviewInput,
  deps?: C1ReviewDependencies,
): Promise<{ receipt: Record<string, unknown>; data: EducationContract }> {
  const snapshot = await readEduPiEducationSnapshot();
  const result = await issueC1Review({ ...input, snapshot: snapshot.envelope }, deps);
  const refreshedPayloadValue = result.data.payload;
  if (!refreshedPayloadValue || typeof refreshedPayloadValue !== "object" || Array.isArray(refreshedPayloadValue)) {
    throw new Error("Core education snapshot refresh is unavailable");
  }
  const refreshedPayload = refreshedPayloadValue as Record<string, unknown>;
  const refreshedWorkspace = refreshedPayload.education_workspace;
  if (!refreshedWorkspace || typeof refreshedWorkspace !== "object" || Array.isArray(refreshedWorkspace)) {
    throw new Error("Core education workspace refresh is unavailable");
  }
  const data = await projectEducationContract({
    ...snapshot,
    envelope: result.data,
    payload: refreshedPayload as EducationSnapshot["payload"],
    workspace: refreshedWorkspace as EducationSnapshot["workspace"],
  });
  return { receipt: result.receipt, data };
}

/** Execute a teacher-context review through Core and project its refreshed snapshot. */
export async function reviewTeacherContextCandidate(
  input: Omit<TeacherContextReviewInput, "snapshot">,
  deps?: TeacherContextReviewDependencies,
): Promise<{ receipt: Record<string, unknown>; data: EducationContract }> {
  const snapshot = await readEduPiEducationSnapshot();
  const result = await issueTeacherContextReview({ ...input, snapshot: snapshot.envelope }, deps);
  const refreshedPayloadValue = result.data.payload;
  if (!refreshedPayloadValue || typeof refreshedPayloadValue !== "object" || Array.isArray(refreshedPayloadValue)) {
    throw new Error("Core education snapshot refresh is unavailable");
  }
  const refreshedPayload = refreshedPayloadValue as Record<string, unknown>;
  const refreshedWorkspace = refreshedPayload.education_workspace;
  if (!refreshedWorkspace || typeof refreshedWorkspace !== "object" || Array.isArray(refreshedWorkspace)) {
    throw new Error("Core education workspace refresh is unavailable");
  }
  const data = await projectEducationContract({
    ...snapshot,
    envelope: result.data,
    payload: refreshedPayload as EducationSnapshot["payload"],
    workspace: refreshedWorkspace as EducationSnapshot["workspace"],
  });
  return { receipt: result.receipt, data };
}

/** Execute a Today work-candidate review through Core and project its refreshed snapshot. */
export async function reviewWorkCandidate(
  input: Omit<WorkCandidateReviewInput, "snapshot">,
  deps?: WorkCandidateReviewDependencies,
): Promise<{ receipt: Record<string, unknown>; data: EducationContract }> {
  const snapshot = await readEduPiEducationSnapshot();
  const result = await issueWorkCandidateReview({ ...input, snapshot: snapshot.envelope }, deps);
  const refreshedPayloadValue = result.data.payload;
  if (!refreshedPayloadValue || typeof refreshedPayloadValue !== "object" || Array.isArray(refreshedPayloadValue)) {
    throw new Error("Core education snapshot refresh is unavailable");
  }
  const refreshedPayload = refreshedPayloadValue as Record<string, unknown>;
  const refreshedWorkspace = refreshedPayload.education_workspace;
  if (!refreshedWorkspace || typeof refreshedWorkspace !== "object" || Array.isArray(refreshedWorkspace)) {
    throw new Error("Core education workspace refresh is unavailable");
  }
  const data = await projectEducationContract({
    ...snapshot,
    envelope: result.data,
    payload: refreshedPayload as EducationSnapshot["payload"],
    workspace: refreshedWorkspace as EducationSnapshot["workspace"],
  });
  return { receipt: result.receipt, data };
}

/** Execute a native task review through Core and project its refreshed snapshot. */
export async function reviewEducationTask(
  input: TaskReviewInput,
  deps?: TaskReviewDependencies,
): Promise<{ receipt: Record<string, unknown>; data: EducationContract }> {
  const snapshot = await readEduPiEducationSnapshot();
  const result = await issueTaskReview(input, {
    ...deps,
    readSnapshot: deps?.readSnapshot || (async () => ({
      payload: snapshot.payload,
      roots: { runtime: snapshot.runtime, dataRoot: snapshot.dataRoot },
    })),
  });
  const refreshedWorkspace = result.data.education_workspace;
  if (!refreshedWorkspace || typeof refreshedWorkspace !== "object" || Array.isArray(refreshedWorkspace)) {
    throw new Error("Core education workspace refresh is unavailable");
  }
  const data = await projectEducationContract({
    ...snapshot,
    payload: result.data,
    workspace: refreshedWorkspace as EducationSnapshot["workspace"],
  });
  return { receipt: result.receipt, data };
}

/** Update one active memory through Core and project the receipt-bound snapshot. */
export async function updateEducationMemory(
  input: MemoryUpdateInput,
  deps?: MemoryUpdateDependencies,
): Promise<{ receipt: Record<string, unknown>; data: EducationContract }> {
  const snapshot = await readEduPiEducationSnapshot();
  const result = await issueMemoryUpdate(input, {
    ...deps,
    readSnapshot: deps?.readSnapshot || (async () => ({ payload: snapshot.payload, roots: { runtime: snapshot.runtime, dataRoot: snapshot.dataRoot } })),
  });
  const refreshedWorkspace = result.data.education_workspace;
  if (!refreshedWorkspace || typeof refreshedWorkspace !== "object" || Array.isArray(refreshedWorkspace)) throw new Error("Core education workspace refresh is unavailable");
  const data = await projectEducationContract({ ...snapshot, payload: result.data, workspace: refreshedWorkspace as EducationSnapshot["workspace"] });
  return { receipt: result.receipt, data };
}

export async function deleteEducationEntity(input: { kind: EntityDeleteKind; id: string; note: string | null; signal?: AbortSignal }): Promise<{ target: { kind: EntityDeleteKind; id: string }; deletedAt: string | null; data: EducationContract }> {
  const snapshot = await readEduPiEducationSnapshot({ signal: input.signal });
  const result = await issueEntityDelete(input, {
    readSnapshot: async () => ({ ...snapshot, roots: { runtime: snapshot.runtime, dataRoot: snapshot.dataRoot } }),
  });
  const refreshedWorkspace = result.data.education_workspace;
  const data = await projectEducationContract({
    ...snapshot,
    payload: result.data as EducationSnapshot["payload"],
    workspace: refreshedWorkspace as EducationSnapshot["workspace"],
  });
  if (input.kind === "material" && data.teacherMaterials?.some((item) => item.material_id === result.target.id)) {
    throw new EntityDeleteError("invalid_response", "Core 删除结果无效。");
  }
  return { target: result.target, deletedAt: result.deletedAt, data };
}

export async function restoreEducationEntity(input: { kind: EntityDeleteKind; id: string; note: string | null; restoreRequestId: string; signal?: AbortSignal }): Promise<{ target: { kind: EntityDeleteKind; id: string }; restoredAt: string | null; data: EducationContract }> {
  const snapshot = await readEduPiEducationSnapshot({ signal: input.signal });
  const result = await issueEntityRestore(input, { roots: { runtime: snapshot.runtime, dataRoot: snapshot.dataRoot } });
  const refreshedWorkspace = result.data.education_workspace;
  const data = await projectEducationContract({
    ...snapshot,
    payload: result.data as EducationSnapshot["payload"],
    workspace: refreshedWorkspace as EducationSnapshot["workspace"],
  });
  if (!restoredEntityProjectionIsValid(input.kind, result.target.id, data)) {
    throw new EntityDeleteError("invalid_response", "Core 恢复结果无效。");
  }
  return { target: result.target, restoredAt: result.restoredAt, data };
}

export function restoredEntityProjectionIsValid(kind: EntityDeleteKind, id: string, data: Pick<EducationContract, "teacherMaterials" | "workspaceResourcesUnavailable">): boolean {
  return kind !== "material" || data.workspaceResourcesUnavailable === true || Boolean(data.teacherMaterials?.some((item) => item.material_id === id));
}

export async function bindEducationTaskSession(input: { taskId: unknown; sessionId: unknown }): Promise<{ binding: EducationContract["taskSessions"][string]; data: EducationContract }> {
  const taskId = requiredText(input.taskId, "taskId");
  const sessionId = requiredText(input.sessionId, "sessionId");
  const snapshot = await readEduPiEducationSnapshot();
  const root = snapshot.dataRoot.root;
  const current = await readEducationContract();
  const task = current.tasks.find((item) => item.id === taskId);
  const document = current.continuity.documents.find(item => `document:${item.id}` === taskId);
  if (!document && (!task || task.externalSend || task.scope !== "teacher_internal" || !task.requiresTeacherReview || task.audience.some((item) => item !== "teacher"))) {
    throw new Error("该任务不满足 teacher_internal 会话绑定边界");
  }

  const runtime = getRpcSession(sessionId);
  const runtimeCwd = runtime?.isAlive() ? runtime.cwd : undefined;
  if (runtimeCwd && canonicalEduPiCwd(runtimeCwd) !== root) throw new Error("Pi Session 不属于 EduPi 工作区");
  const scanned = await listAllSessions();
  const sessionInfo = scanned.find((item) => item.id === sessionId);
  const sessionCwd = runtimeCwd || sessionInfo?.cwd;
  if (!sessionCwd) throw new Error("Pi Session 不存在或尚未形成可恢复记录");
  if (canonicalEduPiCwd(sessionCwd) !== root) throw new Error("Pi Session 不属于 EduPi 工作区");
  const previousBinding = current.taskSessions[taskId];
  if (previousBinding && previousBinding.sessionId !== sessionId && previousBinding.status !== "missing" && sessionInfo?.parentSessionId !== previousBinding.sessionId) {
    throw new Error("只能把教学任务切换到当前绑定 Session 的合法 fork");
  }
  const persistSession = runtime && (runtime as { ensureSessionPersisted?: () => void }).ensureSessionPersisted;
  if (typeof persistSession === "function") persistSession.call(runtime);

  await bindTaskSessionFile(taskSessionFile(snapshot.dataRoot.root), { taskId, sessionId });
  const data = await readEducationContract();
  const binding = data.taskSessions[taskId];
  if (!binding) throw new Error("任务会话绑定写入后未能重新读取");
  return { binding, data };
}
