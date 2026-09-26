export type ReminderAction = { id: string; type: "read" | "dismiss" | "handled" | "snooze" | "claim_notifications" | "release_notification" | "notification_delivered" | "notification_failed" | "notification_opened"; attemptedAt?: string; taskId?: string };

const REMINDER_ACTIONS = new Set(["read", "dismiss", "handled", "snooze", "claim_notifications", "release_notification", "notification_delivered", "notification_failed", "notification_opened"]);
const CLAIM_OUTCOMES = new Set(["notification_delivered", "notification_failed"]);

export function validReminderAction(value: unknown): value is ReminderAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.id !== "string" || !body.id || body.id.length > 64 || !REMINDER_ACTIONS.has(String(body.type))
    || Object.keys(body).some((key) => !["id", "type", "attemptedAt", "taskId"].includes(key))) return false;
  if (body.taskId !== undefined && (typeof body.taskId !== "string" || body.taskId.length > 500)) return false;
  if (body.type === "release_notification" || CLAIM_OUTCOMES.has(String(body.type))) {
    if (typeof body.attemptedAt !== "string" || body.attemptedAt.length > 80 || !Number.isFinite(Date.parse(body.attemptedAt))) return false;
  }
  return !CLAIM_OUTCOMES.has(String(body.type)) || body.id !== "*";
}

export function shouldSyncReminderAttention(action: ReminderAction | undefined, notificationTransitionApplied: boolean): boolean {
  if (!action) return false;
  return action.type === "claim_notifications"
    || !["notification_delivered", "notification_failed", "notification_opened"].includes(action.type)
    || notificationTransitionApplied;
}
