import { getUpdateProxyNative } from "./update-proxy-native";

export type DesktopUpgradePhase = "checking" | "downloading" | "verifying" | "installing";

export type DesktopUpgradeErrorStage = "manifest" | "download" | "signature" | "install" | "unknown";

export interface DesktopUpgradeProgress {
  phase: DesktopUpgradePhase;
  downloadedBytes?: number;
  totalBytes?: number;
  targetVersion?: string;
  retryCount?: number;
}

export interface DesktopUpgradeResult {
  installed: boolean;
  targetVersion?: string;
}

export class DesktopUpgradeError extends Error {
  readonly stage: DesktopUpgradeErrorStage;
  readonly phase: DesktopUpgradePhase;
  readonly host: string;
  readonly retryCount: number;
  readonly errorCode: string;

  constructor(
    message: string,
    details: {
      stage: DesktopUpgradeErrorStage;
      phase: DesktopUpgradePhase;
      host: string;
      retryCount?: number;
      errorCode?: string;
    },
  ) {
    super(message);
    this.name = "DesktopUpgradeError";
    this.stage = details.stage;
    this.phase = details.phase;
    this.host = details.host;
    this.retryCount = details.retryCount ?? 0;
    this.errorCode = details.errorCode ?? errorCodeFor(message);
  }
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriDesktop(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCodeFor(value: string): string {
  // A short deterministic diagnostic code is useful in support reports while
  // avoiding the raw exception, URL query, token, or signature in the UI.
  let hash = 2166136261;
  for (const char of value.slice(0, 512)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `UPD-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function hostFromText(value: string): string | null {
  const match = /https?:\/\/([^/\s:?#]+)/i.exec(value);
  return match?.[1]?.toLowerCase() ?? null;
}

function hostFromUpdate(update: { rawJson?: Record<string, unknown> }): string {
  const visit = (value: unknown): string | null => {
    if (typeof value === "string") return hostFromText(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const host = visit(item);
        if (host) return host;
      }
      return null;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) {
        const host = visit(item);
        if (host) return host;
      }
    }
    return null;
  };
  const raw = update.rawJson ?? {};
  return visit(raw.platforms)
    ?? hostFromText(typeof raw.url === "string" ? raw.url : "")
    ?? hostFromText(typeof raw.download_url === "string" ? raw.download_url : "")
    ?? "api.github.com";
}

function isInterruptedDownload(error: unknown): boolean {
  return /error decoding response body|connection (?:reset|closed)|timed? out|error sending request|incomplete message|body error/i.test(errorText(error));
}

export function desktopUpgradeErrorKind(error: unknown): DesktopUpgradeErrorStage {
  if (error instanceof DesktopUpgradeError) return error.stage;
  if (isInterruptedDownload(error)) return "download";
  if (/signature|签名|verification/i.test(errorText(error))) return "signature";
  return "unknown";
}

export function desktopUpgradeErrorDetails(error: unknown): Pick<DesktopUpgradeError, "stage" | "phase" | "host" | "retryCount" | "errorCode"> {
  if (error instanceof DesktopUpgradeError) {
    return {
      stage: error.stage,
      phase: error.phase,
      host: error.host,
      retryCount: error.retryCount,
      errorCode: error.errorCode,
    };
  }
  const stage = desktopUpgradeErrorKind(error);
  return {
    stage,
    phase: stage === "manifest" ? "checking" : stage === "install" ? "installing" : stage === "signature" ? "verifying" : "downloading",
    host: hostFromText(errorText(error)) ?? "unknown",
    retryCount: 0,
    errorCode: errorCodeFor(errorText(error)),
  };
}

export async function downloadVerifiedUpdate(
  download: () => Promise<void>,
  onRetry: () => void,
  pause: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await download();
      return;
    } catch (error) {
      if (attempt === 3 || !isInterruptedDownload(error)) throw error;
      onRetry();
      await pause(750 * attempt);
    }
  }
}

export function updaterCheckOptions(proxy: string | null): { timeout: number; proxy?: string } {
  return proxy ? { timeout: 30_000, proxy } : { timeout: 30_000 };
}

export async function installLatestDesktopRelease(
  onProgress: (progress: DesktopUpgradeProgress) => void,
): Promise<DesktopUpgradeResult> {
  if (!isTauriDesktop()) {
    throw new Error("Automatic installation is only available in the packaged desktop app.");
  }

  onProgress({ phase: "checking", retryCount: 0 });
  let proxy: string | null;
  try {
    proxy = await getUpdateProxyNative();
  } catch {
    throw new DesktopUpgradeError("更新代理设置不可用", {
      stage: "manifest",
      phase: "checking",
      host: "local",
    });
  }
  const [{ check }, { relaunch }] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process"),
  ]);
  let update;
  try {
    update = await check(updaterCheckOptions(proxy));
  } catch (error) {
    throw new DesktopUpgradeError(errorText(error), {
      stage: "manifest",
      phase: "checking",
      host: hostFromText(errorText(error)) ?? "raw.githubusercontent.com",
    });
  }
  if (!update) return { installed: false };

  let downloadedBytes = 0;
  let totalBytes: number | undefined;
  let retryCount = 0;
  const resetProgress = () => {
    downloadedBytes = 0;
    totalBytes = undefined;
    onProgress({ phase: "downloading", downloadedBytes, retryCount, targetVersion: update.version });
  };
  resetProgress();
  try {
    try {
      await downloadVerifiedUpdate(() => update.download((event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
        } else return;
        onProgress({ phase: "downloading", downloadedBytes, totalBytes, retryCount, targetVersion: update.version });
      }), () => {
        retryCount += 1;
        resetProgress();
      });
    } catch (error) {
      const signature = /signature|签名|verification/i.test(errorText(error));
      throw new DesktopUpgradeError(errorText(error), {
        stage: signature ? "signature" : "download",
        phase: signature ? "verifying" : "downloading",
        host: hostFromUpdate(update),
        retryCount,
      });
    }
    onProgress({ phase: "verifying", retryCount, targetVersion: update.version });
    try {
      onProgress({ phase: "installing", retryCount, targetVersion: update.version });
      await update.install();
    } catch (error) {
      throw new DesktopUpgradeError(errorText(error), {
        stage: "install",
        phase: "installing",
        host: hostFromUpdate(update),
        retryCount,
      });
    }
  } finally {
    await update.close().catch(() => {});
  }
  try {
    await relaunch();
  } catch (error) {
    throw new DesktopUpgradeError(errorText(error), {
      stage: "install",
      phase: "installing",
      host: hostFromUpdate(update),
      retryCount,
    });
  }
  return { installed: true, targetVersion: update.version };
}
