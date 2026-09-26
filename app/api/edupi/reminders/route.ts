import { NextResponse } from "next/server";
import path from "node:path";
import { readEducationWorkspaceBundle } from "@/lib/edupi-education-server";
import { reminderEvents } from "@/lib/edupi-reminder-events";
import { updateReminderStore } from "@/lib/edupi-reminder-store";
import { selectNativeReminderNotifications, syncReminderAttention } from "@/lib/edupi-attention-delivery";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { shouldSyncReminderAttention, validReminderAction, type ReminderAction } from "@/lib/edupi-reminder-action";

export const dynamic = "force-dynamic";
async function result(action?: ReminderAction) {
  const { data } = await readEducationWorkspaceBundle();
  const file = path.join(data.workspace, ".edupi", "desktop", "reminders.json");
  const events = reminderEvents(data.tasks, data.workspace, new Date(), data.continuity.documents, data.workCases, data.generatedArtifacts);
  let state = await updateReminderStore(file, events, action);
  const claimed = action?.type === "claim_notifications" ? state.notifications || [] : [];
  const attention = action && shouldSyncReminderAttention(action, state.notificationTransitionApplied)
    ? await syncReminderAttention({ data, items: action.type === "claim_notifications" ? claimed : state.items, action, now: new Date() })
    : { status: "synced" as const, recorded: 0 };
  const notifications = selectNativeReminderNotifications(claimed, attention);
  const allowed = new Set(notifications.map((item) => item.id));
  for (const item of claimed) {
    if (!allowed.has(item.id)) state = await updateReminderStore(file, events, { id: item.id, type: "notification_deferred", attemptedAt: item.notificationAttemptedAt });
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
