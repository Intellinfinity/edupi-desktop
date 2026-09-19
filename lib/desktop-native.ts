import { isTauriDesktop } from "@/lib/desktop-updater";
import {
  DESKTOP_API_TOKEN_HEADER,
  MAX_DESKTOP_SAVE_BYTES,
} from "@/lib/desktop-api";
import {
  loadStagedMaterials,
  removeStagedMaterial,
  stageBrowserMaterialFiles,
  stageNativeMaterialPaths,
  type MaterialStagingDescriptor,
} from "@/lib/edupi-material-staging-client";

export type DesktopDialogFilter = {
  name: string;
  extensions: string[];
};

export type SelectFilesOptions = {
  multiple?: boolean;
  defaultPath?: string;
  title?: string;
  filters?: DesktopDialogFilter[];
};

export type SelectSavePathOptions = {
  defaultPath?: string;
  title?: string;
  filters?: DesktopDialogFilter[];
};

function asPathArray(selection: string | string[] | null): string[] {
  if (selection == null) return [];
  return Array.isArray(selection) ? selection.filter((path) => typeof path === "string") : [selection];
}

let desktopApiTokenPromise: Promise<string> | null = null;

async function getDesktopApiToken(): Promise<string> {
  if (!isTauriDesktop()) {
    throw new Error("Desktop filesystem authorization is only available in the desktop app.");
  }
  if (!desktopApiTokenPromise) {
    desktopApiTokenPromise = import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<string>("get_desktop_api_token"))
      .then((token) => {
        if (typeof token !== "string" || token.length < 32) {
          throw new Error("Desktop filesystem authorization is unavailable.");
        }
        return token;
      })
      .catch((error) => {
        desktopApiTokenPromise = null;
        throw error;
      });
  }
  return desktopApiTokenPromise;
}

async function desktopApiHeaders(initial?: HeadersInit): Promise<Headers> {
  const headers = new Headers(initial);
  headers.set(DESKTOP_API_TOKEN_HEADER, await getDesktopApiToken());
  return headers;
}

async function readResponseBytesWithinLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    throw new Error(`File is larger than ${maxBytes / (1024 * 1024)}MB`);
  }

  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`File is larger than ${maxBytes / (1024 * 1024)}MB`);
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Native folder-selection dialog (desktop shell only). Resolves null when cancelled. */
export async function selectDirectoryNative(defaultPath?: string, title = "Select project folder"): Promise<string | null> {
  if (!isTauriDesktop()) {
    throw new Error("Native directory selection is only available in the desktop app.");
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selection = await open({
    directory: true,
    multiple: false,
    defaultPath,
    title,
  });
  return typeof selection === "string" ? selection : null;
}

export type EduPiRootStatus = {
  dataRoot: string;
  dataSource: "environment" | "persisted" | "managed";
  coreRoot: string;
  coreSource: "environment" | "bundled";
  fallbackReason: string | null;
  canChangeDataRoot: boolean;
  restartRequired: boolean;
};

async function invokeEduPiRootCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriDesktop()) throw new Error("EduPi root settings are only available in the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export function getEduPiRootStatusNative(): Promise<EduPiRootStatus> {
  return invokeEduPiRootCommand<EduPiRootStatus>("get_edupi_root_status");
}

export function setEduPiDataRootNative(path: string): Promise<EduPiRootStatus> {
  return invokeEduPiRootCommand<EduPiRootStatus>("set_edupi_data_root", { path });
}

export function resetEduPiDataRootNative(): Promise<EduPiRootStatus> {
  return invokeEduPiRootCommand<EduPiRootStatus>("reset_edupi_data_root");
}

/** Native file-selection dialog. Resolves [] when cancelled. */
export async function selectFilesNative(options: SelectFilesOptions = {}): Promise<string[]> {
  if (!isTauriDesktop()) {
    throw new Error("Native file selection is only available in the desktop app.");
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selection = await open({
    directory: false,
    multiple: options.multiple ?? true,
    defaultPath: options.defaultPath,
    title: options.title ?? "Select files",
    filters: options.filters,
  });
  return asPathArray(selection);
}

/** Native save dialog. Resolves null when cancelled. */
export async function selectSavePathNative(options: SelectSavePathOptions = {}): Promise<string | null> {
  if (!isTauriDesktop()) {
    throw new Error("Native save dialog is only available in the desktop app.");
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const selection = await save({
    defaultPath: options.defaultPath,
    title: options.title ?? "Save as",
    filters: options.filters,
  });
  return typeof selection === "string" ? selection : null;
}

/** Open http(s)/mailto URLs in the system handler; fall back to window.open on web. */
export async function openExternal(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) return;

  if (!isTauriDesktop()) {
    window.open(trimmed, "_blank", "noopener,noreferrer");
    return;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("open_external_url", { url: trimmed });
  } catch (error) {
    const opened = window.open(trimmed, "_blank", "noopener,noreferrer");
    if (!opened) throw error;
  }
}

/** Open a local path with the OS default application. */
export async function openPathNative(path: string): Promise<void> {
  if (!isTauriDesktop()) {
    throw new Error("Opening local paths is only available in the desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_path", { path });
}

/** Reveal a local path in Finder / Explorer / file manager. */
export async function revealItemInDirNative(path: string): Promise<void> {
  if (!isTauriDesktop()) {
    throw new Error("Reveal in folder is only available in the desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reveal_item_in_dir", { path });
}

function triggerBrowserDownload(url: string, fileName?: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  if (fileName) anchor.download = fileName;
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Desktop: save-dialog + write bytes from a same-origin URL.
 * Web: trigger a normal browser download.
 * Returns false when the user cancels the save dialog.
 */
export async function downloadUrlAsFile(url: string, defaultFileName: string): Promise<boolean> {
  if (!isTauriDesktop()) {
    triggerBrowserDownload(url, defaultFileName);
    return true;
  }

  const destPath = await selectSavePathNative({ defaultPath: defaultFileName });
  if (!destPath) return false;

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Download failed (HTTP ${response.status})`);
  }
  const bytes = await readResponseBytesWithinLimit(response, MAX_DESKTOP_SAVE_BYTES);
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  const saveResponse = await fetch("/api/desktop/save", {
    method: "POST",
    headers: await desktopApiHeaders({
      "Content-Type": "application/octet-stream",
      "X-Pi-Dest-Path": encodeURIComponent(destPath),
    }),
    body,
  });
  if (!saveResponse.ok) {
    const data = await saveResponse.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `Save failed (HTTP ${saveResponse.status})`);
  }
  return true;
}

/**
 * Desktop: save-dialog + server-side copy of an allowed local file.
 * Web: trigger download via the files API.
 */
export async function saveLocalFileAs(
  sourcePath: string,
  defaultFileName: string,
  downloadUrl: string,
): Promise<boolean> {
  if (!isTauriDesktop()) {
    triggerBrowserDownload(downloadUrl, defaultFileName);
    return true;
  }

  const destPath = await selectSavePathNative({ defaultPath: defaultFileName });
  if (!destPath) return false;

  const response = await fetch("/api/desktop/save", {
    method: "POST",
    headers: await desktopApiHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ sourcePath, destPath }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `Save failed (HTTP ${response.status})`);
  }
  return true;
}

export type DesktopImageAttachment = {
  name: string;
  mimeType: string;
  data: string;
  previewUrl: string;
};

/** Read image files selected via native dialog into chat attachment payloads. */
export async function readDesktopImageAttachments(paths: string[]): Promise<DesktopImageAttachment[]> {
  if (paths.length === 0) return [];
  const response = await fetch("/api/desktop/read-images", {
    method: "POST",
    headers: await desktopApiHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ paths }),
  });
  const data = await response.json().catch(() => ({})) as {
    error?: string;
    files?: Array<{ name: string; mimeType: string; data: string }>;
  };
  if (!response.ok) {
    throw new Error(data.error || `Failed to read images (HTTP ${response.status})`);
  }
  return (data.files ?? []).map((file) => ({
    ...file,
    previewUrl: `data:${file.mimeType};base64,${file.data}`,
  }));
}

/** Stage native-dialog material paths outside Core truth with desktop authorization. */
export async function stageDesktopMaterialPaths(paths: string[]): Promise<MaterialStagingDescriptor[]> {
  if (paths.length === 0) return [];
  return stageNativeMaterialPaths(paths, await desktopApiHeaders({ "Content-Type": "application/json" }));
}

/** Stage browser-dropped material files with packaged Desktop authorization. */
export async function stageDesktopMaterialFiles(files: File[]): Promise<MaterialStagingDescriptor[]> {
  if (files.length === 0) return [];
  return stageBrowserMaterialFiles(files, fetch, await desktopApiHeaders());
}

/** Subscribe to the fixed tray quick-entry event. Returns a no-op outside Tauri. */
export async function listenQuickEntryNative(handler: () => void): Promise<() => void> {
  if (!isTauriDesktop()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen("edupi://quick-entry", () => handler());
}

/** Subscribe to the native event-loop resume signal after system sleep. */
export async function listenDesktopResumeNative(handler: () => void): Promise<() => void> {
  if (!isTauriDesktop()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen("edupi://resume", () => handler());
}

export type NotificationPermissionStatus = {
  authorizationStatus: number;
  notificationCenterSetting: number;
  alertSetting: number;
  soundSetting: number;
  alertStyle: number;
};

export async function getNotificationPermissionStatusNative(): Promise<NotificationPermissionStatus> {
  if (!isTauriDesktop()) throw new Error("请在桌面应用中查看通知状态");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<NotificationPermissionStatus>("get_notification_permission_status");
}

export type ReminderNotificationTarget = { taskId: string; kind: "ready" | "failed" | "due" | "brief" };
export type ReminderNotificationClaim = { id: string; attemptedAt: string };
export type NativeReminderNotification = { title: string; body: string; target: ReminderNotificationTarget | null; claims: ReminderNotificationClaim[] };

export async function sendReminderNotificationNative(request: NativeReminderNotification): Promise<void> {
  if (!isTauriDesktop()) throw new Error("请在桌面应用中使用通知");
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("send_reminder_notification", { request });
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    if (code === "notification_permission_denied") throw new Error("通知权限未开启，请在系统设置中允许 EduPi 通知");
    if (code === "notification_permission_timeout") throw new Error("系统未返回通知授权结果，请重试");
    if (code === "notification_permission_unavailable") throw new Error("暂时无法请求通知授权，请重试");
    if (code === "notification_failed") throw new Error("通知发送失败，请检查系统通知设置");
    if (code === "notification_busy") throw new Error("通知发送繁忙，请稍后重试");
    throw error;
  }
}

export async function listenReminderNotificationsNative(onOpen: (target: ReminderNotificationTarget | null) => void, onFailure: (claims: ReminderNotificationClaim[]) => void): Promise<() => void> {
  if (!isTauriDesktop()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const open = await listen<ReminderNotificationTarget | null>("edupi://reminder-open", event => onOpen(event.payload));
  try {
    const failure = await listen<ReminderNotificationClaim[]>("edupi://reminder-failed", event => onFailure(event.payload));
    return () => { open(); failure(); };
  } catch (error) { open(); throw error; }
}

/** Remove one pending staging copy with packaged Desktop authorization. */
export async function removeDesktopStagedMaterial(stagingId: string): Promise<MaterialStagingDescriptor[]> {
  return removeStagedMaterial(stagingId, await desktopApiHeaders());
}

/** List completed material staging entries after a desktop restart. */
export async function listDesktopStagedMaterials(): Promise<MaterialStagingDescriptor[]> {
  return loadStagedMaterials(await desktopApiHeaders());
}

export type DesktopImportResult = {
  uploaded: string[];
  skipped: string[];
  errors: Array<{ name: string; error: string }>;
};

/** Copy local source paths into a project directory (desktop native import). */
export async function importLocalFiles(options: {
  destDirectory: string;
  sourcePaths: string[];
  conflict: "error" | "overwrite" | "skip";
  encodeDestPath: (path: string) => string;
}): Promise<{ status: number; data: DesktopImportResult & { error?: string; conflicts?: string[]; nonReplaceable?: string[] } }> {
  const response = await fetch(
    `/api/files/${options.encodeDestPath(options.destDirectory)}?type=import&conflict=${options.conflict}`,
    {
      method: "POST",
      headers: await desktopApiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ sourcePaths: options.sourcePaths }),
    },
  );
  const data = await response.json().catch(() => ({})) as DesktopImportResult & {
    error?: string;
    conflicts?: string[];
    nonReplaceable?: string[];
  };
  return { status: response.status, data };
}

/** Intercept primary clicks on external anchors so desktop uses the system browser. */
export function handleExternalLinkClick(
  event: {
    preventDefault(): void;
    defaultPrevented: boolean;
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  },
  url: string | undefined | null,
): void {
  if (!url || !isTauriDesktop()) return;
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  void openExternal(url);
}

export async function setCloseQuitsNative(quit: boolean): Promise<void> {
  if (!isTauriDesktop()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_close_quits", { quit });
}

export async function quitAppNative(): Promise<void> {
  if (!isTauriDesktop()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("quit_app");
}

export async function showMainWindowNative(): Promise<void> {
  if (!isTauriDesktop()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("show_main_window_cmd");
}

/** Relaunch the desktop shell and its packaged local server. */
export async function relaunchAppNative(): Promise<void> {
  if (!isTauriDesktop()) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/**
 * Read an image from the native clipboard as a PNG `File`.
 *
 * WebKitGTK can omit browser clipboard items for images, so the caller uses
 * this only after an empty desktop paste payload. Source adaptation:
 * abcwyc/pi-agent-desktop@deee754; Tauri API:
 * https://v2.tauri.app/reference/javascript/clipboard-manager/#readimage
 */
export async function readClipboardImageFileNative(): Promise<File | null> {
  if (!isTauriDesktop()) return null;
  try {
    const { readImage } = await import("@tauri-apps/plugin-clipboard-manager");
    const img = await readImage();
    const rgba = await img.rgba();
    const { width, height } = await img.size();
    if (!width || !height || rgba.byteLength < width * height * 4) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
    context.putImageData(imageData, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;

    const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 14);
    return new File([blob], `clipboard-${stamp}.png`, { type: "image/png" });
  } catch {
    return null;
  }
}

export { isTauriDesktop };
