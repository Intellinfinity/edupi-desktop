import { NextResponse } from "next/server";
import path from "node:path";
import { readEducationWorkspaceBundle } from "@/lib/edupi-education-server";
import { reminderEvents } from "@/lib/edupi-reminder-events";
import { pendingReminderAttentionOutcomes, updateReminderStore } from "@/lib/edupi-reminder-store";
import { revalidateG1LocalClaims, syncReminderAttention } from "@/lib/edupi-attention-delivery";
import { nativeAttentionRoute, persistNativeAttentionRouteMarks, reconcileReminderAttentionOutboxWithin } from "@/lib/edupi-attention-outbox";
import { DESKTOP_INSTANCE_ID_ENV } from "@/lib/desktop-api";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { validReminderAction, type ReminderAction } from "@/lib/edupi-reminder-action";

export const dynamic = "force-dynamic";
async function result(action?: ReminderAction) {
  let { data } = await readEducationWorkspaceBundle();
  const file = path.join(data.workspace, ".edupi", "desktop", "reminders.json");
  let events = reminderEvents(data.tasks, data.workspace, new Date(), data.continuity.documents, data.workCases, data.generatedArtifacts);
  let state = await updateReminderStore(file, events, action?.type === "claim_notifications" ? undefined : action);
  const recovery = await reconcileReminderAttentionOutboxWithin({ file, snapshot: events,
    readData: async () => (await readEducationWorkspaceBundle()).data }, action ? 1_500 : 100, pendingReminderAttentionOutcomes(state));
  if (action?.type === "claim_notifications") {
    // A replay or another process may advance the Core/task projection. Never
    // claim against the snapshot that preceded reconciliation.
    const refreshed = (await readEducationWorkspaceBundle()).data;
    if (refreshed.workspace !== data.workspace) throw new Error("提醒工作区已变化");
    data = refreshed;
    events = reminderEvents(data.tasks, data.workspace, new Date(), data.continuity.documents, data.workCases, data.generatedArtifacts);
    state = await updateReminderStore(file, events, action);
  }
  const claimed = action?.type === "claim_notifications" ? state.notifications || [] : [];
  const blockedIds = new Set([...recovery.pendingIds, ...pendingReminderAttentionOutcomes(state).map((item) => item.reminderId)]);
  let notifications = [] as typeof claimed;
  let routeMarks = [] as { reminderId: string; attemptedAt: string; route: "core_linked" | "g1_local" | "teacher_local" | "legacy_local"; instanceId?: string }[];
  const markDeferredIds = new Set<string>();
  let attention: { status: "synced" | "unsupported" | "unavailable"; recorded: number; pendingCount?: number; blocked?: typeof recovery.blocked } = recovery;
  if (action?.type === "claim_notifications") {
    attention = { ...recovery };
    const currentInstanceId = process.env[DESKTOP_INSTANCE_ID_ENV]?.trim() || "desktop-dev";
    for (const item of claimed) {
      if (blockedIds.has(item.id)) continue;
      const instanceId = item.attentionRoute === "core_linked" ? item.attentionCarrierInstanceId : currentInstanceId;
      if (!instanceId) continue;
      const synced = await syncReminderAttention({ data, items: [item], action: { id: "*", type: "claim_notifications" }, now: new Date(), instanceId });
      attention.recorded += synced.recorded;
      if (synced.status === "unavailable" || attention.status === "unavailable") attention.status = "unavailable";
      else if (synced.status === "unsupported" || attention.status === "unsupported") attention.status = "unsupported";
      const route = nativeAttentionRoute(item, synced);
      if (!route || !item.notificationAttemptedAt) continue;
      notifications.push(item);
      routeMarks.push({ reminderId: item.id, attemptedAt: item.notificationAttemptedAt, route,
        ...(route === "core_linked" ? { instanceId } : {}) });
    }
    const g1LocalIds = new Set(routeMarks.filter((mark) => mark.route === "g1_local").map((mark) => mark.reminderId));
    if (g1LocalIds.size) {
      const current = await revalidateG1LocalClaims(notifications.filter((item) => g1LocalIds.has(item.id)),
        async () => (await readEducationWorkspaceBundle()).data);
      const currentIds = new Set(current.map((item) => item.id));
      notifications = notifications.filter((item) => !g1LocalIds.has(item.id) || currentIds.has(item.id));
      routeMarks = routeMarks.filter((mark) => mark.route !== "g1_local" || currentIds.has(mark.reminderId));
    }
    if (routeMarks.length) {
      const marked = await persistNativeAttentionRouteMarks(file, events, routeMarks);
      const accepted = new Set(marked.acceptedIds);
      notifications = notifications.filter((item) => accepted.has(item.id));
      for (const id of marked.deferredIds) markDeferredIds.add(id);
      if (marked.state) state = marked.state;
    }
  }
  const allowed = new Set(notifications.map((item) => item.id));
  for (const item of claimed) {
    if (!allowed.has(item.id) && !markDeferredIds.has(item.id)) state = await updateReminderStore(file, events, { id: item.id, type: "notification_deferred", attemptedAt: item.notificationAttemptedAt });
  }
  return NextResponse.json({ items: state.items, notifications, nativeNotificationIds: notifications.map((item) => item.id), metrics: state.metrics, attention, workspace: data.workspace, taskSessions: data.taskSessions });
}
export async function GET() {
  try { return await result(); } catch { return NextResponse.json({ error: "提醒暂不可用" }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  try {
    const body = await parseJsonWithinLimit(request, 2048);
    if (!validReminderAction(body)) return NextResponse.json({ error: "操作无效" }, { status: 400 });
    return await result(body);
  } catch { return NextResponse.json({ error: "提醒保存失败" }, { status: 503 }); }
}
