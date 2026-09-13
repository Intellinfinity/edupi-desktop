import type { EducationContract } from "./edupi-education-contract";

export type EduPiPreparationReadStatus = {
  state?: "idle" | "running" | "ready" | "error";
  retryable?: boolean;
};

export function isTerminalPreparationRead(status: EduPiPreparationReadStatus): boolean {
  return status.state === "ready" || status.state === "error" && status.retryable !== true;
}

export function workspaceHasReadyPreparation(data: Pick<EducationContract, "workCases">, taskId: string): boolean {
  return data.workCases.some((workCase) => workCase.taskId === taskId && workCase.artifactIds.length > 0
    && ["draft_ready", "accepted", "modified", "completed"].includes(workCase.currentState));
}
