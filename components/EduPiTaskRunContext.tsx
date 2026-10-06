"use client";

import { createContext } from "react";
import type { EducationWorkCase, TeacherTask } from "@/lib/edupi-education-contract";
import type { PreparedTaskArtifact } from "@/lib/edupi-task-artifacts";

export type EduPiTaskRunInfo = {
  sessionId: string;
  task: TeacherTask;
  workCase: EducationWorkCase | null;
  artifacts: readonly PreparedTaskArtifact[];
  unavailable: boolean;
  artifactsUnavailable: boolean;
  onOpen: () => void;
};

export const EduPiTaskRunContext = createContext<EduPiTaskRunInfo | null>(null);
