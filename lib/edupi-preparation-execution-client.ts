import { desktopApiHeaders } from "./desktop-native";
import { decodePreparationExecution, PreparationExecutionError, type PreparationExecution } from "./edupi-preparation-execution";

type Fetcher = typeof fetch;
type HeadersProvider = typeof desktopApiHeaders;
const path = (taskId: string) => `/api/edupi/tasks/${encodeURIComponent(taskId)}/execution`;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function identity(taskId: string, revision: number) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/.test(taskId) || !Number.isSafeInteger(revision) || revision < 0) throw new PreparationExecutionError("invalid_request");
}
async function body(response: Response) {
  const value = record(await response.json());
  if (!response.ok || value?.ok !== true || value.externalSend !== false) throw new PreparationExecutionError(typeof value?.errorCode === "string" ? value.errorCode : "unavailable");
  return value;
}
export async function readPreparationExecution(taskId: string, revision: number, signal?: AbortSignal, fetcher: Fetcher = fetch, headers: HeadersProvider = desktopApiHeaders): Promise<PreparationExecution> {
  identity(taskId, revision);
  const response = await fetcher(`${path(taskId)}?revision=${revision}`, { method: "GET", cache: "no-store", signal, headers: await headers() });
  return decodePreparationExecution((await body(response)).result, { taskId, revision });
}
export async function controlPreparationExecution(view: PreparationExecution, action: "cancel" | "retry", signal?: AbortSignal, fetcher: Fetcher = fetch, headers: HeadersProvider = desktopApiHeaders): Promise<void> {
  const current = decodePreparationExecution(view, { taskId: view.task_id, revision: view.task_revision });
  if (!current.actions[action] || !current.event_id || current.attempt === null || !current.source_revision) throw new PreparationExecutionError("permission_denied");
  const response = await fetcher(path(current.task_id), { method: "POST", signal, headers: await headers({ "content-type": "application/json" }),
    body: JSON.stringify({ action, eventId: current.event_id, attempt: current.attempt, revision: current.task_revision, sourceRevision: current.source_revision }) });
  const value = await body(response), result = record(value.result);
  if (!result || result.event_id !== current.event_id || result.state !== (action === "cancel" ? "cancelled" : "queued")) throw new PreparationExecutionError("invalid_response");
}
