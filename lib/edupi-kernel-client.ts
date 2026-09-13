export type EduPiKernelRun = {
  runId: string;
  triggerId: string;
  fireKey: string | null;
  status: "running" | "awaiting_delivery" | "failed" | "needs_review" | "succeeded" | "skipped";
  updatedAt: string;
  resultSummary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type EduPiKernelState = {
  status: "ready" | "empty" | "unavailable";
  updatedAt: string | null;
  running: number;
  runs: EduPiKernelRun[];
};

type RawRecord = Record<string, unknown>;
const RUN_STATES = new Set(["running", "awaiting_delivery", "failed", "needs_review", "succeeded", "skipped"]);
const unavailable = (): EduPiKernelState => ({ status: "unavailable", updatedAt: null, running: 0, runs: [] });
const record = (value: unknown): RawRecord | null => value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;

export function normalizeKernelState(value: unknown): EduPiKernelState {
  const projection = record(record(value)?.projection);
  if (!projection || projection.projection_kind !== "proactive_work_kernel" || !Array.isArray(projection.runs)) return unavailable();
  const runs = projection.runs.flatMap((value) => {
    const item = record(value);
    if (!item || typeof item.run_id !== "string" || typeof item.trigger_id !== "string" || typeof item.updated_at !== "string" || typeof item.status !== "string" || !RUN_STATES.has(item.status)) return [];
    return [{ runId: item.run_id, triggerId: item.trigger_id, fireKey: typeof item.fire_key === "string" ? item.fire_key : null, status: item.status as EduPiKernelRun["status"], updatedAt: item.updated_at, resultSummary: typeof item.result_summary === "string" ? item.result_summary : null, errorCode: typeof item.error_code === "string" ? item.error_code : null, errorMessage: typeof item.error_message === "string" ? item.error_message : null }];
  });
  const summary = record(projection.summary);
  const running = typeof summary?.running === "number" && Number.isInteger(summary.running) && summary.running >= 0 ? summary.running : runs.filter((run) => run.status === "running" || run.status === "awaiting_delivery").length;
  return { status: runs.length > 0 ? "ready" : "empty", updatedAt: typeof projection.updated_at === "string" ? projection.updated_at : null, running, runs };
}

export async function readEduPiKernel(signal?: AbortSignal): Promise<EduPiKernelState> {
  try {
    const response = await fetch("/api/edupi/kernel", { cache: "no-store", signal });
    return response.ok ? normalizeKernelState(await response.json()) : unavailable();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return unavailable();
  }
}
