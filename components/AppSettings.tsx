"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { AppComponentReleaseInfo, AppUpdatesResponse } from "@/lib/app-update-types";
import {
  APP_DISTRIBUTION_NAME,
  APP_RELEASES_URL,
  APP_VERSION,
  APP_VERSION_DISPLAY,
  PRODUCT_NAME,
} from "@/lib/branding";
import { compareAppVersions, hasAppUpdateCheckError } from "@/lib/app-updates";
import { APP_PREF_KEYS, getPrefBool, setPrefBool } from "@/lib/app-prefs";
import type { ComputerUseStatus } from "@/lib/edupi-computer-use";
import {
  emergencyStopComputerUseNative,
  getComputerUseStatusNative,
  requestComputerUsePermissionNative,
  setComputerUseEnabledNative,
} from "@/lib/desktop-computer-use";
import {
  installLatestDesktopRelease,
  desktopUpgradeErrorDetails,
  desktopUpgradeErrorKind,
  isTauriDesktop,
  type DesktopUpgradeProgress,
} from "@/lib/desktop-updater";
import type { DesktopUpgradeErrorStage } from "@/lib/desktop-updater";
import {
  getEduPiRootStatusNative,
  getNotificationPermissionStatusNative,
  handleExternalLinkClick,
  quitAppNative,
  relaunchAppNative,
  resetEduPiDataRootNative,
  selectDirectoryNative,
  setCloseQuitsNative,
  setEduPiDataRootNative,
  type EduPiRootStatus,
  type NotificationPermissionStatus,
} from "@/lib/desktop-native";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { testDesktopNotification } from "@/lib/desktop-notify";
import {
  computerUsePermissionFlowAfterStatus,
  computerUsePrimaryAction,
  computerUsePrimaryActionLabel,
  type ComputerUsePermissionFlow,
} from "@/lib/computer-use-permissions";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import { EduPiHelpPanel } from "./EduPiHelpPanel";
import { JevSettingsCard } from "./JevSettingsCard";
import { announceComputerUseChanged, COMPUTER_USE_CHANGED_EVENT } from "./EduPiComputerUseStop";
import { MobileBridgeSettingsCard } from "./MobileBridgeSettingsCard";

const sectionCardStyle: CSSProperties = {
  padding: "13px 14px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg)",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
};

const sectionHintStyle: CSSProperties = {
  marginTop: 3,
  color: "var(--text-muted)",
  fontSize: 11,
  lineHeight: 1.5,
};

function notificationStatusLabel(status: NotificationPermissionStatus | null): string {
  if (!status) return "不可用";
  if (status.authorizationStatus === 0) return "待授权";
  if (status.authorizationStatus === 1) return "已拒绝";
  if (status.authorizationStatus < 0) return "无需";
  if (status.notificationCenterSetting !== 2) return "通知中心关闭";
  if (status.alertSetting !== 2) return "横幅关闭";
  if (status.soundSetting !== 2) return "声音关闭";
  return "已开启";
}

function TeacherContextSettingsCard() {
  const [context, setContext] = useState<TeacherContextSnapshot | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => { fetch("/api/edupi/onboarding", { cache: "no-store" }).then((response) => response.json()).then(setContext).catch(() => undefined); }, []);
  return <div className="native-settings-card" style={sectionCardStyle}><div style={sectionTitleStyle}>EduPi 教师上下文</div><div style={sectionHintStyle}>这是 EduPi 判断课程、校历和材料语境的基础；可随时回来更新。</div><div className="settings-context-summary"><strong>{context?.name || "尚未设置称呼"}</strong><span>{context?.school || "学校待设置"} · {context?.subject || "学科待设置"} · {context?.grade || "年级待设置"}</span></div><div style={{ display: "flex", gap: 8, marginTop: 10 }}><button type="button" className="native-button native-button-primary" onClick={() => setHelpOpen(true)}>查看初始化指引</button><button type="button" className="native-button" onClick={() => window.dispatchEvent(new CustomEvent("edupi-open-context"))}>编辑教育上下文</button></div>{helpOpen ? <EduPiHelpPanel onClose={() => setHelpOpen(false)} onStartSetup={() => { setHelpOpen(false); window.dispatchEvent(new CustomEvent("edupi-open-context")); }} onOpenContext={() => { setHelpOpen(false); window.dispatchEvent(new CustomEvent("edupi-open-context")); }} /> : null}</div>;
}

function ComputerUseSettingsCard() {
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [flow, setFlow] = useState<ComputerUsePermissionFlow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flowRef = useRef<ComputerUsePermissionFlow | null>(null);

  const setPermissionFlow = useCallback((next: ComputerUsePermissionFlow | null) => {
    flowRef.current = next;
    setFlow(next);
  }, []);

  const requestPermission = useCallback(async (permission: "accessibility" | "screen_recording") => {
    setBusy(true);
    setError(null);
    try {
      const pendingFlow: ComputerUsePermissionFlow = permission === "accessibility"
        ? { permission, screenRecordingRequested: false }
        : { permission, screenRecordingRequested: true };
      setPermissionFlow(pendingFlow);
      let next = await requestComputerUsePermissionNative(permission);

      if (
        permission === "accessibility"
        && next.accessibility !== false
        && next.screenRecording === false
      ) {
        const screenFlow: ComputerUsePermissionFlow = {
          permission: "screen_recording",
          screenRecordingRequested: true,
        };
        setPermissionFlow(screenFlow);
        next = await requestComputerUsePermissionNative("screen_recording");
        setPermissionFlow(computerUsePermissionFlowAfterStatus(next, screenFlow));
      } else {
        setPermissionFlow(computerUsePermissionFlowAfterStatus(next, pendingFlow));
      }
      setStatus(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [setPermissionFlow]);

  const readStatus = useCallback(async (currentFlow: ComputerUsePermissionFlow | null) => {
    const next = await getComputerUseStatusNative();
    const resolvedFlow = computerUsePermissionFlowAfterStatus(next, currentFlow);
    setStatus(next);
    setPermissionFlow(resolvedFlow);
    if (currentFlow?.permission === "accessibility" && resolvedFlow?.permission === "screen_recording") {
      await requestPermission("screen_recording");
    }
  }, [requestPermission, setPermissionFlow]);

  const refreshStatus = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await readStatus(flowRef.current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [readStatus]);

  useEffect(() => {
    let active = true;
    void getComputerUseStatusNative()
      .then((value) => { if (active) setStatus(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const update = (event: Event) => {
      const enabled = (event as CustomEvent<boolean>).detail === true;
      setStatus((current) => current ? { ...current, enabled } : current);
    };
    window.addEventListener(COMPUTER_USE_CHANGED_EVENT, update);
    return () => window.removeEventListener(COMPUTER_USE_CHANGED_EVENT, update);
  }, []);

  useEffect(() => {
    const refreshAfterSystemSettings = () => { void refreshStatus(); };
    window.addEventListener("focus", refreshAfterSystemSettings);
    return () => window.removeEventListener("focus", refreshAfterSystemSettings);
  }, [refreshStatus]);

  useEffect(() => {
    if (flow?.permission !== "accessibility" || busy) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void readStatus(flowRef.current);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [busy, flow?.permission, readStatus]);

  const updateEnabled = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const next = enabled ? await setComputerUseEnabledNative(true) : await emergencyStopComputerUseNative();
      setStatus(next);
      setPrefBool(APP_PREF_KEYS.computerUseEnabled, next.enabled);
      announceComputerUseChanged(next.enabled);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const restartForPermission = async () => {
    setBusy(true);
    setError(null);
    try {
      setPrefBool(APP_PREF_KEYS.computerUseEnabled, true);
      await relaunchAppNative();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const permissionLabel = (value: boolean | null | undefined) => value === undefined || value === null ? "无需" : value ? "已授权" : "待授权";
  const primaryAction = computerUsePrimaryAction({ status, flow });
  const runPrimaryAction = async () => {
    if (primaryAction.kind === "detect") return refreshStatus();
    if (primaryAction.kind === "request") return requestPermission(primaryAction.permission);
    if (primaryAction.kind === "restart") return restartForPermission();
    return updateEnabled(primaryAction.kind === "enable");
  };
  const activePermission = flow?.permission;
  return <div className="native-settings-card" style={sectionCardStyle}>
    <div style={sectionTitleStyle}>桌面控制</div>
    <div style={sectionHintStyle}>默认关闭。开启后，每次读取或操作仍需你确认。</div>
    <div className="computer-use-settings">
      <div className="computer-use-status-row"><strong>总开关</strong><span className={status?.enabled ? "is-ready" : "is-off"}>{status?.enabled ? "已开启" : "已关闭"}</span></div>
      <div className={activePermission === "accessibility" ? "computer-use-status-row is-active" : "computer-use-status-row"}><strong>辅助功能</strong><span className={status?.accessibility ? "is-ready" : "is-off"}>{permissionLabel(status?.accessibility)}</span></div>
      <div className={activePermission === "screen_recording" ? "computer-use-status-row is-active" : "computer-use-status-row"}><strong>屏幕录制</strong><span className={status?.screenRecording ? "is-ready" : "is-off"}>{permissionLabel(status?.screenRecording)}</span></div>
      <div className="computer-use-actions">
        <button type="button" className="native-button native-button-primary computer-use-primary-action" disabled={busy} onClick={() => void runPrimaryAction()}>{computerUsePrimaryActionLabel(primaryAction)}</button>
        <button type="button" className="native-button native-button-compact" disabled={busy} onClick={() => void refreshStatus()} aria-label="重新检测权限" title="重新检测权限">↻</button>
        {status?.enabled && primaryAction.kind !== "stop" ? <button type="button" className="native-button native-button-compact" disabled={busy} onClick={() => void updateEnabled(false)} aria-label="停止控制" title="停止控制">×</button> : null}
      </div>
      {flow?.permission === "accessibility" ? <div style={sectionHintStyle} role="status">在系统设置允许 EduPi 后返回。</div> : null}
      {flow?.permission === "screen_recording" && flow.screenRecordingRequested ? <div style={sectionHintStyle} role="status">在系统设置允许 EduPi，重启后开启控制。</div> : null}
      {error ? <div className="computer-use-error" role="alert">{error}</div> : null}
    </div>
  </div>;
}

function EduPiDataSettingsCard() {
  const { t } = useI18n();
  const [status, setStatus] = useState<EduPiRootStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getEduPiRootStatusNative()
      .then((value) => { if (active) setStatus(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, []);

  const changeRoot = async () => {
    if (!status?.canChangeDataRoot || busy) return;
    setBusy(true);
    setError(null);
    try {
      const selected = await selectDirectoryNative(status.dataRoot, t("appSettings.dataSelectTitle"));
      if (!selected) return;
      setStatus(await setEduPiDataRootNative(selected));
      await relaunchAppNative();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const resetRoot = async () => {
    if (!status?.canChangeDataRoot || busy) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await resetEduPiDataRootNative());
      await relaunchAppNative();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return <div className="native-settings-card" style={sectionCardStyle}>
    <div style={sectionTitleStyle}>{t("appSettings.dataSection")}</div>
    <div style={{ marginTop: 8, display: "grid", gap: 5, fontSize: 11 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{t("appSettings.dataDirectory")}</span>
        <code style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={status?.dataRoot}>{status?.dataRoot || "…"}</code>
      </div>
      <div style={{ color: "var(--text-muted)" }}>
        {t("appSettings.dataSource", { source: status ? t(`appSettings.dataSource.${status.dataSource}`) : "…" })}
        <span style={{ marginLeft: 10 }}>{t("appSettings.coreSource", { source: status ? t(`appSettings.coreSource.${status.coreSource}`) : "…" })}</span>
      </div>
      {status?.fallbackReason ? <div className="native-inline-alert is-error" role="status">{t("appSettings.dataFallback", { reason: status.fallbackReason })}</div> : null}
      {status && !status.canChangeDataRoot ? <div style={sectionHintStyle}>{t("appSettings.dataEnvironmentLocked")}</div> : null}
      {error ? <div className="native-inline-alert is-error" role="alert">{error}</div> : null}
      <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
        <button type="button" className="native-button native-button-primary" disabled={!status?.canChangeDataRoot || busy} onClick={() => void changeRoot}>{t("appSettings.dataChoose")}</button>
        <button type="button" className="native-button" disabled={!status?.canChangeDataRoot || busy} onClick={() => void resetRoot}>{t("appSettings.dataReset")}</button>
      </div>
    </div>
  </div>;
}
function ChoiceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="native-button"
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        minWidth: 88,
        borderColor: active ? "var(--accent)" : "var(--border)",
        color: active ? "var(--accent)" : "var(--text-muted)",
        fontWeight: active ? 700 : 500,
      }}
    >
      {children}
    </button>
  );
}

const metaChipStyle = (emphasized: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  maxWidth: "100%",
  padding: "6px 9px",
  border: `1px solid ${emphasized ? "var(--accent)" : "var(--border)"}`,
  borderRadius: 7,
  background: emphasized
    ? "color-mix(in srgb, var(--accent) 10%, transparent)"
    : "var(--bg)",
  color: emphasized ? "var(--accent)" : "var(--text-muted)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: emphasized ? 700 : 500,
  lineHeight: 1.35,
  textDecoration: "none",
});

function VersionChip({
  currentValue,
  latestValue,
  versionsMatch,
  updateAvailable,
  href,
  title,
  ariaLabel,
  versionLabel,
  currentLabel,
  latestLabel,
  upgradeAvailableLabel,
}: {
  currentValue: string;
  latestValue: string;
  versionsMatch: boolean;
  updateAvailable: boolean;
  href: string;
  title: string;
  ariaLabel: string;
  versionLabel: string;
  currentLabel: string;
  latestLabel: string;
  upgradeAvailableLabel: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      aria-label={ariaLabel}
      style={metaChipStyle(updateAvailable)}
      onClick={(event) => handleExternalLinkClick(event, href)}
    >
      {versionsMatch ? (
        <>
          <span style={{ opacity: 0.72, fontWeight: 500 }}>{versionLabel}</span>
          <span>{currentValue}</span>
        </>
      ) : (
        <>
          <span style={{ opacity: 0.72, fontWeight: 500 }}>{currentLabel}</span>
          <span>{currentValue}</span>
          <span aria-hidden="true" style={{ width: 1, height: 13, background: "currentColor", opacity: 0.2 }} />
          <span style={{ opacity: updateAvailable ? 0.9 : 0.72, fontWeight: 500 }}>{latestLabel}</span>
          <span style={{ color: updateAvailable ? "var(--accent)" : undefined, fontWeight: updateAvailable ? 800 : undefined }}>
            {latestValue}
          </span>
          {updateAvailable ? (
            <span
              style={{
                padding: "1px 5px",
                borderRadius: 999,
                background: "var(--accent)",
                color: "var(--bg-panel)",
                fontSize: 9,
                fontWeight: 800,
                whiteSpace: "nowrap",
              }}
            >
              {upgradeAvailableLabel}
            </span>
          ) : null}
        </>
      )}
      <span aria-hidden="true">↗</span>
    </a>
  );
}

export function AppSettings({ onClose, initialSection = null }: { onClose: () => void; initialSection?: "mobile" | null }) {
  const { t, locale, setLocale, supportedLocales } = useI18n();
  const { theme, setTheme } = useTheme();
  const desktop = isTauriDesktop();
  const [components, setComponents] = useState<AppComponentReleaseInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [upgradeProgress, setUpgradeProgress] = useState<DesktopUpgradeProgress | null>(null);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [upgradeErrorDetails, setUpgradeErrorDetails] = useState<ReturnType<typeof desktopUpgradeErrorDetails> | null>(null);
  const [closeQuits, setCloseQuits] = useState(() => getPrefBool(APP_PREF_KEYS.closeQuits, false));
  const [notifyOnComplete, setNotifyOnComplete] = useState(() => getPrefBool(APP_PREF_KEYS.notifyOnComplete, true));
  const [notificationTest, setNotificationTest] = useState("");
  const [testingNotification, setTestingNotification] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermissionStatus | null>(null);

  const refreshNotificationStatus = useCallback(async () => {
    if (!desktop) return;
    try {
      setNotificationStatus(await getNotificationPermissionStatusNative());
    } catch {
      setNotificationStatus(null);
    }
  }, [desktop]);

  useEffect(() => {
    void refreshNotificationStatus();
  }, [refreshNotificationStatus]);

  const checkForUpdates = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/updates?refresh=1", { cache: "no-store", signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as AppUpdatesResponse;
      setComponents(Array.isArray(data.components) ? data.components : []);
      setLoadError(hasAppUpdateCheckError(data, "edupi-desktop") ? "checkFailed" : null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLoadError("checkFailed");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkForUpdates(controller.signal);
    return () => controller.abort();
  }, [checkForUpdates]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !upgradeProgress) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, upgradeProgress]);

  useEffect(() => {
    if (initialSection !== "mobile") return;
    let innerFrame = 0;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        document.getElementById("mobile-bridge-settings")?.scrollIntoView({ block: "center" });
      });
    });
    return () => {
      cancelAnimationFrame(outerFrame);
      if (innerFrame) cancelAnimationFrame(innerFrame);
    };
  }, [initialSection]);

  const appRelease = useMemo(
    () => components.find((component) => component.project === "edupi-desktop"),
    [components],
  );
  const pendingUpdates = useMemo(
    () => components.filter((component) => component.updateAvailable),
    [components],
  );
  const updateAvailable = pendingUpdates.length > 0;
  const notificationAuthorized = notificationStatus?.authorizationStatus !== undefined
    && notificationStatus.authorizationStatus >= 2;
  const canUpgrade = desktop && !loading && updateAvailable && !upgradeProgress;
  const downloadPercent = upgradeProgress?.phase === "downloading"
    && upgradeProgress.totalBytes
    ? Math.min(100, Math.round((upgradeProgress.downloadedBytes ?? 0) / upgradeProgress.totalBytes * 100))
    : null;
  const upgradeLabel = upgradeProgress?.phase === "checking"
    ? t("appSettings.preparing")
    : upgradeProgress?.phase === "downloading"
      ? (downloadPercent === null
        ? t("appSettings.downloading")
        : t("appSettings.downloadingPercent", { percent: downloadPercent }))
      : upgradeProgress?.phase === "verifying"
        ? t("appSettings.verifying")
      : upgradeProgress?.phase === "installing"
        ? t("appSettings.installing")
        : t("appSettings.update");

  const latestReleaseText = loading
    ? "…"
    : loadError
      ? t("appSettings.checkFailed")
      : !appRelease || appRelease.releaseStatus === "unknown"
        ? t("appSettings.releaseUnavailable")
        : appRelease.releaseStatus === "unpublished" || !appRelease.latestVersion
          ? t("appSettings.noReleases")
          : `v${appRelease.latestVersion}`;

  const statusText = loading
    ? t("appSettings.checkingReleases")
    : loadError
      ? t("appSettings.checkFailed")
      : updateAvailable
        ? t("appSettings.updateAvailable")
        : t("appSettings.upToDate");

  const currentVersion = appRelease?.currentVersion ?? APP_VERSION;
  const currentVersionText = `v${currentVersion === APP_VERSION ? APP_VERSION_DISPLAY : currentVersion}`;
  const versionsMatch = Boolean(
    appRelease?.latestVersion
      && compareAppVersions(currentVersion, appRelease.latestVersion) === 0,
  );
  const versionAriaLabel = versionsMatch
    ? `${t("appSettings.version")}: ${currentVersionText}. ${statusText}`
    : `${t("appSettings.currentVersion")}: ${currentVersionText}. ${t("appSettings.latestRelease")}: ${latestReleaseText}. ${statusText}`;

  const handleUpgrade = async () => {
    if (!canUpgrade) return;
    setUpgradeError(null);
    setUpgradeErrorDetails(null);
    try {
      const result = await installLatestDesktopRelease(setUpgradeProgress);
      if (!result.installed) {
        setUpgradeProgress(null);
        setUpgradeError(t("appSettings.noSignedBundle", { name: APP_DISTRIBUTION_NAME }));
      }
    } catch (error) {
      setUpgradeProgress(null);
      const kind = desktopUpgradeErrorKind(error) as DesktopUpgradeErrorStage;
      setUpgradeError(t(
        kind === "manifest"
          ? "appSettings.manifestFailed"
          : kind === "download"
            ? "appSettings.downloadFailed"
            : kind === "signature"
              ? "appSettings.signatureFailed"
              : kind === "install"
                ? "appSettings.installFailed"
                : "appSettings.updateFailed",
      ));
      setUpgradeErrorDetails(desktopUpgradeErrorDetails(error));
    }
  };

  return (
    <div
      className="native-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !upgradeProgress) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background: "rgba(0,0,0,0.4)",
      }}
    >
      <section
        className="native-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-settings-title"
        style={{
          width: "min(620px, 100%)",
          height: "min(720px, calc(100vh - 36px))",
          maxHeight: "min(720px, calc(100vh - 36px))",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "var(--bg-panel)",
          color: "var(--text)",
          boxShadow: "0 22px 70px rgba(0,0,0,0.32)",
        }}
      >
        <header className="native-modal-header" style={{ display: "flex", flexShrink: 0, alignItems: "flex-start", gap: 14, padding: "20px 22px 17px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 className="native-modal-title" id="app-settings-title" style={{ margin: 0, fontSize: 18, lineHeight: 1.25 }}>
              {PRODUCT_NAME}
            </h2>
            <div style={{ marginTop: 5, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
              {t("appSettings.tagline", { product: PRODUCT_NAME })}
            </div>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <VersionChip
                currentValue={currentVersionText}
                latestValue={latestReleaseText}
                versionsMatch={versionsMatch}
                updateAvailable={updateAvailable}
                href={appRelease?.releaseUrl ?? APP_RELEASES_URL}
                title={statusText}
                ariaLabel={versionAriaLabel}
                versionLabel={t("appSettings.version")}
                currentLabel={t("appSettings.currentVersion")}
                latestLabel={t("appSettings.latestRelease")}
                upgradeAvailableLabel={t("appSettings.upgradeAvailable")}
              />
              <button
                className="native-button"
                type="button"
                disabled={loading || Boolean(upgradeProgress)}
                onClick={() => void checkForUpdates()}
              >
                {loading ? t("appSettings.checking") : t("appSettings.checkUpdates")}
              </button>
              {desktop && (updateAvailable || upgradeProgress) && (
                <button
                  className="native-button native-button-primary"
                  type="button"
                  disabled={!canUpgrade}
                  onClick={() => void handleUpgrade()}
                  title={t("appSettings.updateNote", { name: APP_DISTRIBUTION_NAME })}
                  style={{ minWidth: 112 }}
                >
                  {upgradeLabel}
                </button>
              )}
            </div>
            {upgradeError && (
              <div className="native-inline-alert is-error" role="alert" style={{ marginTop: 9 }}>
                <div>{upgradeError}</div>
                {upgradeErrorDetails ? (
                  <details style={{ marginTop: 5, fontSize: 11 }}>
                    <summary style={{ cursor: "pointer" }}>{t("appSettings.updateDiagnostics")}</summary>
                    <div style={{ marginTop: 5, display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 8px", color: "var(--text-muted)" }}>
                      <span>{t("appSettings.updateStage")}</span><span>{t(`appSettings.updateStage.${upgradeErrorDetails.stage}`)}</span>
                      <span>{t("appSettings.updateHost")}</span><span>{upgradeErrorDetails.host}</span>
                      <span>{t("appSettings.updateRetries")}</span><span>{upgradeErrorDetails.retryCount}</span>
                      <span>{t("appSettings.updateErrorCode")}</span><span>{upgradeErrorDetails.errorCode}</span>
                    </div>
                  </details>
                ) : null}
              </div>
            )}
          </div>
          <button
            className="native-modal-close"
            type="button"
            onClick={onClose}
            disabled={Boolean(upgradeProgress)}
            aria-label={t("appSettings.close")}
            title={t("appSettings.close")}
            style={{ padding: "1px 5px", border: 0, background: "transparent", color: "var(--text-muted)", cursor: upgradeProgress ? "default" : "pointer", fontSize: 21, lineHeight: 1, opacity: upgradeProgress ? 0.35 : 1 }}
          >
            ×
          </button>
        </header>

        <div style={{ minHeight: 0, flex: 1, overflowY: "auto", padding: "18px 22px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          <TeacherContextSettingsCard />
          <div className="native-settings-card" style={sectionCardStyle}>
            <div style={sectionTitleStyle}>{t("appSettings.languageSection")}</div>
            <div style={sectionHintStyle}>{t("appSettings.languageHint")}</div>
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {supportedLocales.map((plugin) => (
                <ChoiceButton
                  key={plugin.id}
                  active={locale === plugin.id}
                  onClick={() => setLocale(plugin.id as typeof locale)}
                >
                  {plugin.label}
                </ChoiceButton>
              ))}
            </div>
          </div>

          <div className="native-settings-card" style={sectionCardStyle}>
            <div style={sectionTitleStyle}>{t("appSettings.appearanceSection")}</div>
            <div style={sectionHintStyle}>{t("appSettings.appearanceHint")}</div>
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <ChoiceButton active={theme === "light"} onClick={() => setTheme("light")}>
                {t("appSettings.themeLight")}
              </ChoiceButton>
              <ChoiceButton active={theme === "dark"} onClick={() => setTheme("dark")}>
                {t("appSettings.themeDark")}
              </ChoiceButton>
            </div>
          </div>

          {desktop && (
            <EduPiDataSettingsCard />
          )}

          {desktop && <MobileBridgeSettingsCard />}

          <JevSettingsCard />

          {desktop && (
            <ComputerUseSettingsCard />
          )}

          {desktop && (
            <div className="native-settings-card" style={sectionCardStyle}>
              <div style={sectionTitleStyle}>{t("appSettings.desktopSection")}</div>
              <div style={sectionHintStyle}>{t("appSettings.desktopHint")}</div>
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={closeQuits}
                    onChange={(event) => {
                      const next = event.target.checked;
                      setCloseQuits(next);
                      setPrefBool(APP_PREF_KEYS.closeQuits, next);
                      void setCloseQuitsNative(next);
                    }}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{t("appSettings.closeQuits")}</div>
                    <div style={{ marginTop: 2, color: "var(--text-dim)", fontSize: 11, lineHeight: 1.45 }}>
                      {t("appSettings.closeQuitsHint")}
                    </div>
                  </span>
                </label>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={notifyOnComplete}
                    onChange={(event) => {
                      const next = event.target.checked;
                      setNotifyOnComplete(next);
                      setPrefBool(APP_PREF_KEYS.notifyOnComplete, next);
                    }}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{t("appSettings.notifyOnComplete")}</div>
                    <div style={{ marginTop: 2, color: "var(--text-dim)", fontSize: 11, lineHeight: 1.45 }}>
                      {t("appSettings.notifyOnCompleteHint")}
                    </div>
                  </span>
                </label>
                <button
                  type="button"
                  className="native-button"
                  disabled={testingNotification || !notifyOnComplete}
                  onClick={async () => {
                    setTestingNotification(true);
                    setNotificationTest("");
                    try {
                      await testDesktopNotification();
                      await refreshNotificationStatus();
                      setNotificationTest("系统已接受通知；点击通知应打开提醒");
                    } catch (error) {
                      await refreshNotificationStatus();
                      setNotificationTest(error instanceof Error ? error.message : "通知测试失败");
                    } finally { setTestingNotification(false); }
                  }}
                >
                  {testingNotification ? "发送中…" : "测试通知跳转"}
                </button>
                <div className="computer-use-status-row"><strong>系统通知</strong><span className={notificationAuthorized ? "is-ready" : "is-off"}>{notificationStatusLabel(notificationStatus)}</span></div>
                {notificationTest ? <p role="status">{notificationTest}</p> : null}
                <button
                  type="button"
                  className="native-button"
                  onClick={() => void quitAppNative()}
                  style={{ alignSelf: "flex-start", marginTop: 2 }}
                >
                  {t("appSettings.quitApp")}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
