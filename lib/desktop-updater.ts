export type DesktopUpgradePhase = "checking" | "downloading" | "installing";

export interface DesktopUpgradeProgress {
  phase: DesktopUpgradePhase;
  downloadedBytes?: number;
  totalBytes?: number;
  targetVersion?: string;
}

export interface DesktopUpgradeResult {
  installed: boolean;
  targetVersion?: string;
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

function isInterruptedDownload(error: unknown): boolean {
  return /error decoding response body|connection (?:reset|closed)|timed? out|error sending request|incomplete message|body error/i.test(errorText(error));
}

export function desktopUpgradeErrorKind(error: unknown): "download" | "signature" | "unknown" {
  if (isInterruptedDownload(error)) return "download";
  if (/signature|签名|verification/i.test(errorText(error))) return "signature";
  return "unknown";
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

export async function installLatestDesktopRelease(
  onProgress: (progress: DesktopUpgradeProgress) => void,
): Promise<DesktopUpgradeResult> {
  if (!isTauriDesktop()) {
    throw new Error("Automatic installation is only available in the packaged desktop app.");
  }

  onProgress({ phase: "checking" });
  const [{ check }, { relaunch }] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process"),
  ]);
  const update = await check({ timeout: 30_000 });
  if (!update) return { installed: false };

  let downloadedBytes = 0;
  let totalBytes: number | undefined;
  const resetProgress = () => {
    downloadedBytes = 0;
    totalBytes = undefined;
    onProgress({ phase: "downloading", downloadedBytes, targetVersion: update.version });
  };
  resetProgress();
  try {
    await downloadVerifiedUpdate(() => update.download((event) => {
      if (event.event === "Started") {
        totalBytes = event.data.contentLength;
      } else if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
      } else return;
      onProgress({ phase: "downloading", downloadedBytes, totalBytes, targetVersion: update.version });
    }), resetProgress);
    onProgress({ phase: "installing", targetVersion: update.version });
    await update.install();
  } finally {
    await update.close().catch(() => {});
  }
  await relaunch();
  return { installed: true, targetVersion: update.version };
}
