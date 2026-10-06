import type { EducationWorkCase, TeacherTask } from "./edupi-education-contract";
import type { GeneratedArtifact } from "./edupi-generated-artifacts";
import { taskArtifactFile, taskContentReady } from "./edupi-workbench.ts";

export type PreparedTaskArtifact = {
  id: string;
  title: string;
  path: string;
  available: boolean;
  readOnly: boolean;
  revision?: number;
};

function relativeFilePath(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) return null;
  const path = value.trim().replaceAll("\\", "/");
  if (path.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(path) || path.endsWith("/")) return null;
  const parts = path.split("/");
  if (parts.includes("..")) return null;
  return parts.filter(part => part && part !== ".").join("/") || null;
}

function fileTitle(title: unknown, path: string): string {
  return typeof title === "string" && title.trim() ? title.trim() : path.split("/").at(-1) || "文件";
}

/** Project file references only; task deliverables and execution state are not files. */
export function taskPreparedArtifacts(
  task: TeacherTask,
  workCase: EducationWorkCase | null | undefined,
  generatedArtifacts: readonly GeneratedArtifact[] | null | undefined,
  workspace: string,
): PreparedTaskArtifact[] {
  const root = workspace.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  if (!root || root.includes("\0")) return [];
  const artifacts: PreparedTaskArtifact[] = [];
  const byId = new Map<string, PreparedTaskArtifact>();
  const byPath = new Map<string, PreparedTaskArtifact>();
  const add = (artifact: PreparedTaskArtifact, current: boolean) => {
    const existing = byId.get(artifact.id) || byPath.get(artifact.path);
    if (existing) {
      // Current resource restrictions cannot be replaced by a work-case fallback.
      if (current) {
        existing.available = existing.available && artifact.available;
        existing.readOnly = existing.readOnly || artifact.readOnly;
      }
      if (existing.id === artifact.id && existing.path === artifact.path && artifact.revision !== undefined) existing.revision = artifact.revision;
      byId.set(artifact.id, existing);
      byPath.set(artifact.path, existing);
      return;
    }
    artifacts.push(artifact);
    byId.set(artifact.id, artifact);
    byPath.set(artifact.path, artifact);
  };

  for (const file of generatedArtifacts || []) {
    if (!task.id || file.task_id !== task.id) continue;
    const relativePath = relativeFilePath(file.relative_path);
    if (!relativePath) continue;
    const path = `${root}/${relativePath}`;
    add({ id: file.artifact_id || path, title: fileTitle(file.title, path), path, available: file.available !== false, readOnly: file.access === "read_only" }, true);
  }

  if (task.id && workCase?.taskId === task.id) {
    for (const file of workCase.artifacts) {
      const relativePath = relativeFilePath(file.relativePath);
      if (!relativePath) continue;
      const path = `${root}/${relativePath}`;
      const revision = Number.isSafeInteger(file.revision) && file.revision > 0 ? file.revision : undefined;
      add({ id: file.id || path, title: fileTitle(file.title, path), path, available: true, readOnly: false, ...(revision !== undefined ? { revision } : {}) }, false);
    }
  }

  const legacy = taskContentReady(task) ? taskArtifactFile(task, root) : null;
  if (legacy) {
    const path = legacy.path.replaceAll("\\", "/");
    const relativePath = path.startsWith(`${root}/`) ? relativeFilePath(path.slice(root.length + 1)) : null;
    if (relativePath) {
      const normalizedPath = `${root}/${relativePath}`;
      add({ id: normalizedPath, title: fileTitle(null, normalizedPath), path: normalizedPath, available: true, readOnly: false }, false);
    }
  }
  return artifacts;
}
