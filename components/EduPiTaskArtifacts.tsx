"use client";

import type { PreparedTaskArtifact } from "@/lib/edupi-task-artifacts";
import { getFileIcon } from "./FileIcons";

export type EduPiTaskArtifactsProps = {
  artifacts: readonly PreparedTaskArtifact[];
  onOpenFile: (path: string) => void;
  unavailable?: boolean;
};

function fileType(path: string): string {
  const extension = /\.([a-z\d]+)$/i.exec(path.split(/[\\/]/).at(-1) || "")?.[1].toLowerCase();
  return extension && ["md", "txt", "docx", "pdf", "pptx", "xlsx", "csv", "html"].includes(extension) ? extension.toUpperCase() : "文件";
}

export function EduPiTaskArtifacts({ artifacts, onOpenFile, unavailable = false }: EduPiTaskArtifactsProps) {
  return (
    <div className="edupi-task-artifact-list">
      {unavailable ? <p className="edupi-task-artifact-list__empty" role="status">文件列表暂不可用</p> : null}
      {artifacts.map(artifact => (
        <button
          key={artifact.id}
          type="button"
          className={`edupi-task-artifact-list__item${artifact.available ? "" : " is-unavailable"}`}
          disabled={!artifact.available}
          onClick={() => { if (artifact.available) onOpenFile(artifact.path); }}
        >
          <span className="edupi-task-artifact-list__icon" aria-hidden="true">{getFileIcon(artifact.path, 20)}</span>
          <span className="edupi-task-artifact-list__content">
            <span className="edupi-task-artifact-list__title">{artifact.title}</span>
            <span className="edupi-task-artifact-list__meta">
              <span>{fileType(artifact.path)}</span>
              {artifact.revision !== undefined ? <span>版本 {artifact.revision}</span> : null}
              {artifact.readOnly ? <span className="edupi-task-artifact-list__state">只读</span> : null}
              {!artifact.available ? <span className="edupi-task-artifact-list__state">文件不可用</span> : null}
            </span>
          </span>
        </button>
      ))}
      {!artifacts.length && !unavailable ? <p className="edupi-task-artifact-list__empty">暂无已生成文件</p> : null}
    </div>
  );
}
