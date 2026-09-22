import { NextResponse } from "next/server";
import path from "node:path";
import { readEducationWorkspaceBundle } from "@/lib/edupi-education-server";
import { reminderEvents } from "@/lib/edupi-reminder-events";
import { updateReminderStore } from "@/lib/edupi-reminder-store";
import { selectNativeReminderNotifications, syncReminderAttention } from "@/lib/edupi-attention-delivery";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";
type ReminderAction = { id: string; type: "read" | "dismiss" | "handled" | "snooze" | "claim_notifications" | "release_notification" | "notification_delivered" | "notification_failed" | "notification_opened"; attemptedAt?: string; taskId?: string };
async function result(action?: ReminderAction) {
  const { data } = await readEducationWorkspaceBundle();
  const file = path.join(data.workspace, ".edupi", "desktop", "reminders.json");
  const events = reminderEvents(data.tasks, data.workspace, new Date(), data.continuity.documents);
  let state = await updateReminderStore(file, events, action);
  const claimed = action?.type === "claim_notifications" ? state.notifications || [] : [];
  const attention = action ? await syncReminderAttention({ data, items: action.type === "claim_notifications" ? claimed : state.items, action, now: new Date() }) : { status: "synced" as const, recorded: 0 };
  const notifications = selectNativeReminderNotifications(claimed, attention);
  const allowed = new Set(notifications.map((item) => item.id));
  for (const item of claimed) {
    if (!allowed.has(item.id)) state = await updateReminderStore(file, events, { id: item.id, type: "notification_failed" });
  }
  return NextResponse.json({ items: state.items, notifications, nativeNotificationIds: notifications.map((item) => item.id), metrics: state.metrics, attention, workspace: data.workspace, taskSessions: data.taskSessions });
}
export async function GET() {
  try { return await result(); } catch { return NextResponse.json({ error: "提醒暂不可用" }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  try {
    const body = await parseJsonWithinLimit(request, 2048) as ReminderAction;
    if (typeof body.id !== "string" || body.id.length > 64 || !["read", "dismiss", "handled", "snooze", "claim_notifications", "release_notification", "notification_delivered", "notification_failed", "notification_opened"].includes(body.type)) return NextResponse.json({ error: "操作无效" }, { status: 400 });
    if (body.taskId !== undefined && (typeof body.taskId !== "string" || body.taskId.length > 500)) return NextResponse.json({ error: "事项标识无效" }, { status: 400 });
    if (body.type === "release_notification" && (typeof body.attemptedAt !== "string" || !Number.isFinite(Date.parse(body.attemptedAt)))) return NextResponse.json({ error: "通知标识无效" }, { status: 400 });
    return await result(body);
  } catch { return NextResponse.json({ error: "提醒保存失败" }, { status: 503 }); }
}
