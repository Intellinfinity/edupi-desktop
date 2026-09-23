export type QueueSnapshot = { steering: string[]; followUp: string[]; recoveryId?: string };

export type QueueRecallResult = "restored" | "ack_pending" | "manual_review" | "uncertain_empty" | "switched" | "empty" | "read_failed" | "storage_failed" | "uncertain" | "restore_failed";

function needsManualReview(error: unknown): boolean {
  return error instanceof Error && error.message.includes("QUEUE_RECOVERY_MANUAL_REVIEW");
}

/** Save the current queue before the destructive clear, then route the result to its original session. */
export async function recallQueueWithBackup(options: {
  recoveryId: string;
  read: () => Promise<QueueSnapshot>;
  stage: (messages: string[], recoveryId: string) => string[] | null;
  clear: (recoveryId: string) => Promise<QueueSnapshot>;
  isCurrent: () => boolean;
  finalizeCurrent: (previous: string[], messages: string[], recoveryId: string) => boolean;
  persistInactive: (previous: string[], messages: string[], recoveryId: string) => boolean;
  markUncertain: (recoveryId: string) => boolean;
  acknowledge: (recoveryId: string) => Promise<void>;
  clearVisible: () => void;
}): Promise<QueueRecallResult> {
  let snapshot: QueueSnapshot;
  try {
    snapshot = await options.read();
  } catch {
    return "read_failed";
  }
  if (!options.isCurrent()) return "switched";
  const visible = [...snapshot.steering, ...snapshot.followUp];
  if (visible.length === 0) {
    options.clearVisible();
    return "empty";
  }
  const previous = options.stage(visible, options.recoveryId);
  if (previous === null) return "storage_failed";

  let removed: QueueSnapshot;
  try {
    removed = await options.clear(options.recoveryId);
  } catch (error) {
    if (needsManualReview(error)) return "manual_review";
    try {
      // The server persists the exact clear result by recovery id. Retrying
      // the same id reads that record without clearing a second time.
      removed = await options.clear(options.recoveryId);
    } catch (retryError) {
      if (needsManualReview(retryError)) return "manual_review";
      return "uncertain";
    }
  }
  if (removed.recoveryId !== options.recoveryId) return "uncertain";
  const messages = [...removed.steering, ...removed.followUp];
  if (messages.length === 0 && visible.length > 0) {
    return options.markUncertain(options.recoveryId) ? "uncertain_empty" : "restore_failed";
  }
  if (options.isCurrent()) options.clearVisible();
  const saved = options.finalizeCurrent(previous, messages, options.recoveryId)
    || options.persistInactive(previous, messages, options.recoveryId);
  if (!saved) return "restore_failed";
  try { await options.acknowledge(options.recoveryId); } catch { return "ack_pending"; }
  return "restored";
}
