import { NextResponse } from "next/server";
import path from "node:path";
import { readEducationWorkspaceBundle } from "@/lib/edupi-education-server";
import { reminderEvents } from "@/lib/edupi-reminder-events";
import { updateReminderStore } from "@/lib/edupi-reminder-store";
import { syncReminderAttention } from "@/lib/edupi-attention-delivery";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";
type ReminderAction = { id: string; type: "read" | "dismiss" | "handled" | "snooze" | "claim_notifications" | "release_notification" | "notification_delivered" | "notification_failed" | "notification_opened"; attemptedAt?: string; taskId?: string };
async function result(action?: ReminderAction) {
  const { data } = await readEducationWorkspaceBundle();
  const state = await updateReminderStore(path.join(data.workspace, ".edupi", "desktop", "reminders.json"), reminderEvents(data.tasks, data.workspace, new Date(), data.continuity.documents), action);
  const attention = action ? await syncReminderAttention({ data, items: state.items, action, now: new Date() }) : { status: "synced", recorded: 0 };
  return NextResponse.json({ items: state.items, notifications: state.notifications, metrics: state.metrics, attention, workspace: data.workspace, taskSessions: data.taskSessions });
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
