import { createHash } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { buildEducationContractFromWorkspace, type EducationContract } from "./edupi-education-contract";
import { consumeCoreEnvelope } from "./edupi-bridge-consumer";
import { activeBridgeIdentity } from "./edupi-bridge-manifest";
import { resolveEduPiBridgeRoots, validateScheduleOccurrenceV12Projection } from "./edupi-core-snapshot";
import { getActiveEduPiRuntime } from "./edupi-runtime-supervisor";
import { runCoreProcess } from "./edupi-core-process-client";
import { readTaskSessionFile, taskSessionFile } from "./edupi-task-session-store";
import { projectTaskSessionBindings } from "./edupi-task-sessions";
import { getRunningRpcSessionIds } from "./rpc-manager";
import { readServerForegroundPolicy } from "./edupi-foreground-server";
import { isReminderForeground, shanghaiDate } from "./edupi-foreground";
import { reminderEvents } from "./edupi-reminder-events";
import type { Reminder } from "./edupi-reminder-store";

export type NotificationClaim = { id: string; attemptId: string; attemptedAt: string };
export type NotificationProofRequest = { version: 1; nonce: string; claims: NotificationClaim[] };
export const NOTIFICATION_PROOF_NONCE_HEADER = "x-pi-reminder-proof-nonce";
export const NOTIFICATION_PROOF_DEADLINE_MS = 1500;
const MAX_STATE_BYTES = 16 * 1024 * 1024;

export function validNotificationProofRequest(value: unknown): value is NotificationProofRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["version", "nonce", "claims"].includes(key)) || input.version !== 1
    || typeof input.nonce !== "string" || !/^[a-f0-9]{64}$/.test(input.nonce)
    || !Array.isArray(input.claims) || !input.claims.length || input.claims.length > 16) return false;
  const ids = new Set<string>();
  return input.claims.every(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const claim = value as Record<string, unknown>;
    if (Object.keys(claim).some(key => !["id", "attemptId", "attemptedAt"].includes(key)) || typeof claim.id !== "string"
      || !/^[A-Za-z0-9._-]{1,64}$/.test(claim.id) || ids.has(claim.id)
      || typeof claim.attemptId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(claim.attemptId)
      || typeof claim.attemptedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(claim.attemptedAt)
      || claim.attemptedAt.length > 80 || !Number.isFinite(Date.parse(claim.attemptedAt))) return false;
    ids.add(claim.id); return true;
  });
}

/** Only the server captures this source proof; it is never accepted from a caller. */
export function reminderNotificationSourceFingerprint(item: Reminder, data: EducationContract): string {
  const task = data.tasks.find(task => task.id === item.taskId);
  const workCase = data.workCases.find(work => work.taskId === item.taskId || work.id === item.taskId);
  const source = task && data.calendar.find(event => event.id === task.sourceEventId);
  const candidate = data.workCandidates.find(candidate => candidate.taskId === item.taskId);
  const document = item.kind === "brief" ? data.continuity.documents.find(document => `document:${document.id}` === item.taskId) : null;
  return createHash("sha256").update(JSON.stringify({ workspace: realpathSync(data.workspace), identity: item.identity, kind: item.kind,
    task: task ? { id: task.id, revision: task.revision, status: task.status, title: task.title, trigger: task.trigger,
      triggerDate: task.triggerDate, dueDate: task.dueDate, sourceEventId: task.sourceEventId, sourceEventDate: task.sourceEventDate,
      sourceEventName: task.sourceEventName, topic: task.topic, student: task.student, scope: task.scope,
      requiresTeacherReview: task.requiresTeacherReview, externalSend: task.externalSend,
      reviewedAt: task.reviewedAt, boardStage: task.boardStage, boardRevision: task.boardRevision, boardUpdatedAt: task.boardUpdatedAt,
      evidence: task.evidence } : null, source: source || null, candidate: candidate || null, document: document || null,
    occurrences: data.l4Preparation?.opportunities.filter(opportunity => opportunity.workCaseId === (workCase?.id || item.taskId))
      .map(opportunity => ({ logicalOccurrenceKey: opportunity.logicalOccurrenceKey, sourceRevision: opportunity.sourceRevision })) || [],
  })).digest("hex");
}

/** Existing-host reads, or the same pinned read-only one-shot bridge; never ensure/start a runtime. */
export async function readCurrentReminderEducation(signal: AbortSignal): Promise<EducationContract> {
  const roots = resolveEduPiBridgeRoots();
  const host = getActiveEduPiRuntime(roots.dataRoot.root);
  const read = async (operation: string, fields: Record<string, unknown> = {}) => {
    const request = { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop",
      request_id: crypto.randomUUID(), operation, ...fields };
    if (!host) return runCoreProcess<Record<string, unknown>>({ ...roots, request, timeoutMs: NOTIFICATION_PROOF_DEADLINE_MS, signal });
    const result = await host.callBridge(request, signal);
    const frame = (result.result as { bridge_frame?: unknown } | undefined)?.bridge_frame;
    if (signal.aborted || result.ok !== true || typeof frame !== "string" || Buffer.byteLength(frame) > 8 * 1024 * 1024) throw new Error("提醒来源暂不可用");
    const value: unknown = JSON.parse(frame);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("提醒来源暂不可用");
    return value as Record<string, unknown>;
  };
  const bindings = await readTaskSessionFile(taskSessionFile(roots.dataRoot.root));
  const identity = activeBridgeIdentity();
  const project = (snapshot: Record<string, unknown>) => {
    if (snapshot.ok !== true || snapshot.operation !== "snapshot"
      || JSON.stringify(snapshot.supported_commands) !== JSON.stringify(identity.contract.supported_commands)
      || JSON.stringify(snapshot.supported_projections) !== JSON.stringify(identity.contract.supported_projections)) throw new Error("提醒来源暂不可用");
    const consumed = consumeCoreEnvelope(snapshot.envelope, { allowInvalidFactSpine: true });
    if (!consumed.ok || consumed.kind !== "snapshot") throw new Error("提醒来源暂不可用");
    const payload = consumed.value as Record<string, unknown>;
    if (!validateScheduleOccurrenceV12Projection(snapshot.occurrence_projection, String(payload.snapshot_id))) throw new Error("提醒来源暂不可用");
    const workspace = payload.education_workspace;
    if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) throw new Error("提醒来源暂不可用");
    return buildEducationContractFromWorkspace({ ...workspace, calendar: snapshot.occurrence_projection.events }, {
      workspacePath: roots.dataRoot.root, snapshotPayload: payload, supportedCommands: identity.contract.supported_commands,
    });
  };
  let data = project(await read("snapshot", { schedule_occurrence_version: "1.2" }));
  if (data.tasks.some(task => task.trigger === "teaching_before_class")) {
    const resources = await read("workspace-resources");
    if (resources.ok !== true || resources.artifacts !== null && !Array.isArray(resources.artifacts)) throw new Error("提醒来源暂不可用");
    // Re-read source after slower resource work; no task snapshot is promoted late.
    data = project(await read("snapshot", { schedule_occurrence_version: "1.2" }));
    data.generatedArtifacts = (resources.artifacts || []) as EducationContract["generatedArtifacts"];
  }
  const running = new Set(getRunningRpcSessionIds());
  data.taskSessions = projectTaskSessionBindings(bindings, { taskIds: new Set(data.tasks.flatMap(task => task.id ? [task.id] : [])), knownSessionIds: running, runningSessionIds: running });
  return data;
}

async function readReminderItems(file: string): Promise<Reminder[]> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_STATE_BYTES) throw new Error("提醒记录无法读取");
    const bytes = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const chunk = await handle.read(bytes, count, bytes.length - count, count);
      if (!chunk.bytesRead) break;
      count += chunk.bytesRead;
    }
    const after = await handle.stat(), current = await lstat(file);
    if (!current.isFile() || count !== before.size || [after, current].some(stat => before.dev !== stat.dev || before.ino !== stat.ino
      || before.size !== stat.size || before.mtimeMs !== stat.mtimeMs || before.ctimeMs !== stat.ctimeMs)) throw new Error("提醒记录已变化");
    const state = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, count)));
    if (state?.version !== 1 || !Array.isArray(state.items)) throw new Error("提醒记录无法读取");
    return state.items;
  } finally { await handle.close(); }
}

export async function notificationClaimsAreCurrent(claims: readonly NotificationClaim[], {
  signal = AbortSignal.timeout(NOTIFICATION_PROOF_DEADLINE_MS), readData = readCurrentReminderEducation,
  readPolicy = readServerForegroundPolicy, now = () => new Date(),
}: { signal?: AbortSignal; readData?: (signal: AbortSignal) => Promise<EducationContract>;
  readPolicy?: typeof readServerForegroundPolicy; now?: () => Date } = {}): Promise<boolean> {
  const data = await readData(signal);
  const policy = await readPolicy(now());
  const items = await readReminderItems(path.join(data.workspace, ".edupi", "desktop", "reminders.json"));
  if (signal.aborted) throw new Error("提醒校验暂不可用");
  const currentTime = now();
  if (shanghaiDate(currentTime) !== policy.today) return false;
  const currentEvents = Object.values(reminderEvents(data.tasks, data.workspace, currentTime, data.continuity.documents, data.workCases, data.generatedArtifacts));
  return claims.every(claim => {
    const matches = items.filter(item => item?.id === claim.id);
    const item = matches.length === 1 ? matches[0] : null;
    if (!item || item.notificationAttemptedAt !== claim.attemptedAt || item.notificationAttemptId !== claim.attemptId
      || item.notificationSendState !== "claimed" || Date.parse(item.notificationClaimExpiresAt || "") <= currentTime.getTime()
      || item.read !== false || item.handled !== false || item.withdrawn !== false
      || item.snoozedUntil || item.notificationDeliveredAt || item.notificationOpenedAt || !isReminderForeground(item, policy, data)
      || item.notificationSourceFingerprint !== reminderNotificationSourceFingerprint(item, data)) return false;
    const event = currentEvents.find(event => event.taskId === item.taskId && event.identity === item.identity && event.completion === item.kind);
    if (!event) return false;
    if (item.attentionRoute === "core_linked") return data.l4Preparation?.attentionDeliveries.some(delivery => delivery.deliveryId === item.id
      && delivery.carrier.instanceId === item.attentionCarrierInstanceId && delivery.carrier.kind === "desktop" && delivery.intentCurrent === true
      && (delivery.status === "queued" || delivery.status === "retry")) === true;
    return item.attentionRoute === "teacher_local" && event.nativeSource === "teacher_created"
      || item.attentionRoute === "g1_local" && event.nativeSource === "core_g1" && !data.l4Preparation?.attentionIntents.some(intent => intent.workCaseId === item.taskId)
      || item.attentionRoute === "legacy_local" && item.kind === "brief";
  });
}
