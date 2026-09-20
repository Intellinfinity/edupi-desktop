import { appendFileSync, chmodSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createHash } from "node:crypto";

export type StartupDiagnosticStage = "server" | "resource_loader" | "session_start" | "window" | "unknown";

export interface StartupDiagnostic {
  at: string;
  stage: StartupDiagnosticStage;
  component: string;
  errorCode: string;
  logPath?: string;
}

function diagnosticsPath(): string {
  const stateDir = process.env.PI_DESKTOP_STATE_DIR?.trim();
  const root = stateDir && isAbsolute(stateDir) ? stateDir : resolve(process.env.EDUPI_DATA_ROOT || ".", ".edupi/desktop");
  return resolve(root, "startup-diagnostics.jsonl");
}

function errorCode(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return `START-${createHash("sha256").update(text.slice(0, 1024)).digest("hex").slice(0, 12)}`;
}

export function recordStartupDiagnostic(input: {
  stage: StartupDiagnosticStage;
  component: string;
  error: unknown;
  logPath?: string;
}): StartupDiagnostic {
  const record: StartupDiagnostic = {
    at: new Date().toISOString(),
    stage: input.stage,
    component: input.component.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80),
    errorCode: errorCode(input.error),
    ...(input.logPath ? { logPath: input.logPath.slice(0, 500) } : {}),
  };
  const path = diagnosticsPath();
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    appendFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    try { chmodSync(path, 0o600); } catch { /* best effort on Windows */ }
  } catch {
    // Diagnostics must never prevent the original startup error from surfacing.
  }
  return record;
}

export function readStartupDiagnostics(limit = 20): StartupDiagnostic[] {
  const path = diagnosticsPath();
  try {
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean).slice(-Math.max(1, Math.min(limit, 100)));
    return lines.flatMap((line) => {
      try {
        const value = JSON.parse(line) as StartupDiagnostic;
        return value && typeof value.at === "string" && typeof value.errorCode === "string" ? [value] : [];
      } catch { return []; }
    }).reverse();
  } catch {
    return [];
  }
}

export function startupDiagnosticsFile(): string {
  return diagnosticsPath();
}
