import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import { runCoreProcess } from "./edupi-core-process-client";
import { findTaskIdForSession, taskSessionFile } from "./edupi-task-session-store";
import type { EducationContract } from "./edupi-education-contract";

export type GeneratedArtifact = { artifact_id: string; title: string; relative_path: string; available?: boolean; session_id: string; task_id: string | null; updated_at: string; size_bytes: number; origin?: "preparation" };

export async function workspaceResourcesRequest() {
  const roots = resolveEduPiBridgeRoots();
  const result = await runCoreProcess<{ ok: boolean; artifacts: GeneratedArtifact[] | null; teacherMaterials: EducationContract["teacherMaterials"]; studentMetadata: Array<{ student_id: string; name: string; class_name: string | null }>; entityDeletionSummary?: { active_count?: unknown; history_count?: unknown } }>({ ...roots, timeoutMs: 5000, request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", request_id: crypto.randomUUID(), operation: "workspace-resources" } });
  if (!result.ok) throw new Error("工作区资源暂不可用");
  return result;
}
const extensions = new Set([".md", ".txt", ".docx", ".pdf", ".pptx", ".xlsx", ".csv", ".html"]);

export function nativeToolArtifactPath(event: { type: string; toolName?: unknown; isError?: unknown; result?: unknown }): string | null {
  if (event.type !== "tool_execution_end" || event.isError || !["edupi_make_document", "edupi_make_ppt", "try_teaching_method"].includes(String(event.toolName))) return null;
  const result = event.result as { details?: { path?: unknown } } | undefined;
  return typeof result?.details?.path === "string" ? result.details.path : null;
}

function artifactOutputRoots(root: string): string[] {
  return [
    join(root, ".edupi", "output"),
    join(root, "教学产物"),
    join(root, "deliverables"),
    join(root, "output"),
  ];
}

function isArtifactOutputFile(filePath: string, root: string): boolean {
  const normalized = resolve(filePath);
  return extensions.has(extname(normalized).toLowerCase())
    && artifactOutputRoots(root).some(outputRoot => normalized === outputRoot || normalized.startsWith(`${resolve(outputRoot)}${sep}`));
}

/**
 * Recover explicit output paths from a completed bash command without
 * executing or broadly scanning the command. Only existing education output
 * files are returned; shell paths outside the four approved output roots are
 * ignored.
 */
export function bashToolArtifactPaths(command: unknown, root: string): string[] {
  if (typeof command !== "string" || !command.trim()) return [];
  const candidates = new Set<string>();
  const tokenPattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(2>>|2>|&>>|&>|>>\||>>|>\||>|&&|\|\||[;&|]|[^\s"'`;&|]+)/g;
  const outputRedirects = new Set([">", ">>", ">|", "2>", "2>>", "&>", "&>>"]);
  const outputFlags = new Set(["-o", "-O", "--out", "--output", "--output-file"]);
  let expectsOutput = false;
  const addCandidate = (value: string) => {
    const token = value.replace(/\\([\\"'])/g, "$1");
    const file = resolve(root, token);
    if (!isArtifactOutputFile(file, root)) return;
    try {
      if (statSync(file).isFile()) candidates.add(file);
    } catch { /* A failed or removed bash target is not an artifact. */ }
  };
  for (const match of command.matchAll(tokenPattern)) {
    const token = (match[1] ?? match[2] ?? match[3] ?? "").replace(/\\([\\"'])/g, "$1");
    if (outputRedirects.has(token)) {
      expectsOutput = true;
      continue;
    }
    if (token === "&&" || token === "||" || token === ";" || token === "|") {
      expectsOutput = false;
      continue;
    }
    if (expectsOutput) {
      addCandidate(token);
      expectsOutput = false;
      continue;
    }
    if (outputFlags.has(token)) {
      expectsOutput = true;
      continue;
    }
    const inlineOutput = /^(?:--out|--output|--output-file)=(.+)$/.exec(token);
    if (inlineOutput) addCandidate(inlineOutput[1]);
  }
  return [...candidates].sort();
}

export function writtenToolArtifactPath(event: { type: string; toolCallId?: unknown; toolName?: unknown; args?: unknown; isError?: unknown }, root: string, pending: Map<string, string>): string | null {
  if (typeof event.toolCallId !== "string") return null;
  if (event.type === "tool_execution_start" && (event.toolName === "write" || event.toolName === "edit")) {
    const args = event.args as { path?: unknown } | undefined;
    if (typeof args?.path === "string" && extensions.has(extname(args.path).toLowerCase())) pending.set(event.toolCallId, resolve(root, args.path));
  }
  if (event.type !== "tool_execution_end") return null;
  const file = pending.get(event.toolCallId);
  pending.delete(event.toolCallId);
  return !event.isError && file ? file : null;
}

export function completedSessionFiles(entries: Array<Record<string, unknown>>, root: string): string[] {
  const writes = new Map<string, string>();
  const nativeCalls = new Map<string, string>();
  const bashCommands = new Map<string, string>();
  const completed = new Set<string>();
  for (const entry of entries) {
    const message = entry.message as { role?: string; content?: Array<{ type?: string; name?: string; id?: string; arguments?: { path?: string } }>; toolCallId?: string; isError?: boolean; details?: { path?: unknown } } | undefined;
    if (message?.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "toolCall" && block.id && ["edupi_make_ppt", "edupi_make_document", "try_teaching_method"].includes(block.name || "")) nativeCalls.set(block.id, block.name!);
        if (block.type === "toolCall" && block.id && block.name === "bash" && typeof (block.arguments as { command?: unknown } | undefined)?.command === "string") bashCommands.set(block.id, (block.arguments as { command: string }).command);
        if (block.type === "toolCall" && ["write", "edit", "edupi_make_ppt", "edupi_make_document"].includes(block.name || "") && block.id && typeof block.arguments?.path === "string") {
          const file = resolve(root, block.arguments.path);
          if (extensions.has(extname(file).toLowerCase())) writes.set(block.id, file);
        }
      }
    }
    if (message?.role === "toolResult" && message.toolCallId) {
      const nativePath = nativeToolArtifactPath({ type: "tool_execution_end", toolName: nativeCalls.get(message.toolCallId), isError: message.isError, result: message });
      const file = nativePath ? resolve(root, nativePath) : writes.get(message.toolCallId);
      if (!message.isError && file && extensions.has(extname(file).toLowerCase())) completed.add(file);
      if (!message.isError) for (const bashFile of bashToolArtifactPaths(bashCommands.get(message.toolCallId), root)) completed.add(bashFile);
      writes.delete(message.toolCallId);
      nativeCalls.delete(message.toolCallId);
      bashCommands.delete(message.toolCallId);
    }
  }
  return [...completed];
}

export async function recoverSessionArtifacts(sessionFile: string, root: string, sessionId: string) {
  const entries = readFileSync(sessionFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const paths = completedSessionFiles(entries, root);
  const failed: string[] = [];
  let registered = 0;
  for (const file of paths) {
    try { await generatedArtifactsRequest("register", { file_path: file, session_id: sessionId }); registered++; }
    catch { failed.push(file); }
  }
  return { registered, failedCount: failed.length };
}

export async function resolveArtifactRegistrationFields(
  fields: Record<string, unknown>,
  findTaskId: (sessionId: string) => Promise<string | null>,
): Promise<Record<string, unknown>> {
  if (fields.action !== "register" || fields.task_id || typeof fields.session_id !== "string") return fields;
  const taskId = await findTaskId(fields.session_id);
  return taskId ? { ...fields, task_id: taskId } : fields;
}

export async function generatedArtifactsRequest(action: "list" | "register" | "archive" | "restore", fields: Record<string, unknown> = {}) {
  const roots = resolveEduPiBridgeRoots();
  const requestFields = action === "register"
    ? await resolveArtifactRegistrationFields({ action, ...fields }, sessionId => findTaskIdForSession(taskSessionFile(roots.dataRoot.root), sessionId))
    : fields;
  const response = await runCoreProcess<{ ok: boolean; artifacts?: GeneratedArtifact[]; artifact?: GeneratedArtifact; teacherMaterials?: EducationContract["teacherMaterials"] }>({
    ...roots, timeoutMs: 5000,
    request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", request_id: crypto.randomUUID(), operation: "generated-artifacts", action, ...requestFields },
  });
  if (!response.ok) throw new Error("产物登记暂不可用");
  return response;
}

export function snapshotGeneratedFiles(root: string, outputDirectory?: string): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (directory: string, depth: number) => {
    if (depth > 6 || files.size >= 2000) return;
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { visit(file, depth + 1); continue; }
      if (!entry.isFile() || !extensions.has(extname(file).toLowerCase())) continue;
      try { const stat = statSync(file); files.set(file, `${stat.mtimeMs}:${stat.size}`); } catch { /* File can be moved by the active tool. */ }
    }
  };
  for (const directory of outputDirectory ? [outputDirectory] : [".edupi/output", "教学产物", "deliverables", "output"]) visit(resolve(root, directory), 0);
  return files;
}
