export type EduPiPreparationReadStatus = {
  state?: "idle" | "running" | "ready" | "error";
  retryable?: boolean;
};

export function isTerminalPreparationRead(status: EduPiPreparationReadStatus): boolean {
  return status.state === "ready" || status.state === "error" && status.retryable !== true;
}
