export type ReminderAction = { id: string; type: "read" | "dismiss" | "handled" | "snooze" | "claim_notifications" | "release_notification" | "rearm_notification" | "notification_unknown" | "notification_deferred" | "notification_delivered" | "notification_failed" | "notification_opened"; attemptedAt?: string; attemptId?: string; taskId?: string };

const REMINDER_ACTIONS = new Set(["read", "dismiss", "handled", "snooze", "claim_notifications", "release_notification", "rearm_notification", "notification_unknown", "notification_deferred", "notification_delivered", "notification_failed", "notification_opened"]);
const CLAIM_OUTCOMES = new Set(["notification_delivered", "notification_failed", "notification_unknown", "rearm_notification"]);

export function validReminderAction(value: unknown): value is ReminderAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.id !== "string" || !body.id || body.id.length > 64 || !REMINDER_ACTIONS.has(String(body.type))
    || Object.keys(body).some((key) => !["id", "type", "attemptedAt", "attemptId", "taskId"].includes(key))) return false;
  if (body.taskId !== undefined && (typeof body.taskId !== "string" || body.taskId.length > 500)) return false;
  if (body.attemptId !== undefined && (typeof body.attemptId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(body.attemptId))) return false;
  if (body.type === "release_notification" || body.type === "notification_deferred" || CLAIM_OUTCOMES.has(String(body.type))) {
    if (typeof body.attemptedAt !== "string" || body.attemptedAt.length > 80 || !Number.isFinite(Date.parse(body.attemptedAt))) return false;
  }
  if (body.type === "notification_opened" && body.id === "*") return false;
  return !CLAIM_OUTCOMES.has(String(body.type)) || body.id !== "*";
}
