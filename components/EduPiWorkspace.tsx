"use client";

import { useEffect, useState } from "react";

type EduPiStatus = {
  scope: string;
  externalSend: boolean;
  requiresTeacherReview: boolean;
  core: {
    status: "ready" | "degraded" | "starting" | "draining" | "failed" | "stopped" | "unavailable";
    reason?: string;
    contractVersion?: string;
    schemaHash?: string;
    componentManifestHash?: string;
    supportedCommands: string[];
    supportedProjections: string[];
  };
  projection: { status: "ready" | "unavailable"; reason: string | null };
};

function StatusCard({ label, value, detail, ready, mark }: { label: string; value: string; detail: string; ready: boolean; mark: string }) {
  return (
    <article className="edupi-metric-card edupi-metric-card--students">
      <div className="edupi-metric-card__head">
        <span className="edupi-metric-card__mark" aria-hidden="true">{mark}</span>
        <span className="edupi-metric-card__label">{label}</span>
        <span className={`edupi-metric-card__dot edupi-metric-card__dot--${ready ? "ready" : "setup"}`} aria-label={ready ? "可用" : "不可用"} />
      </div>
      <div className="edupi-metric-card__value">{value}</div>
      <div className="edupi-metric-card__foot">
        <span className={`edupi-metric-card__state edupi-metric-card__state--${ready ? "ready" : "setup"}`}>{detail}</span>
      </div>
    </article>
  );
}

export function EduPiWorkspace() {
  const [status, setStatus] = useState<EduPiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/edupi/status?summary=1", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<EduPiStatus>;
      })
      .then(setStatus)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, []);

  return (
    <section className="edupi-workspace">
      <div className="edupi-workspace__header">
        <div>
          <div className="edupi-workspace__eyebrow"><span>EDUPI</span><i />教师工作台</div>
          <h1>EduPi 教师工作台</h1>
          <p>Core 连接、合同身份与教师内部投影</p>
        </div>
        <div className="edupi-workspace__mode"><span />教师内部模式</div>
      </div>
      {error ? <div className="edupi-workspace__error">状态读取失败：{error}</div> : null}
      {status ? (
        <>
          <div className="edupi-metrics">
            <StatusCard label="Core" value={status.core.status === "ready" ? "已连接" : status.core.status === "degraded" ? "需处理" : "不可用"} detail={status.core.reason || "Runtime 与自动检查已验证"} ready={status.core.status === "ready"} mark="核" />
            <StatusCard label="合同" value={status.core.contractVersion ? `v${status.core.contractVersion}` : "—"} detail={status.core.schemaHash ? `${status.core.schemaHash.slice(0, 18)}…` : "身份未验证"} ready={Boolean(status.core.contractVersion)} mark="约" />
            <StatusCard label="教育投影" value={status.projection.status === "ready" ? "已启用" : "待启用"} detail={status.projection.reason || "已验证"} ready={status.projection.status === "ready"} mark="映" />
          </div>
          <div className="edupi-workspace__footer">
            <span className="edupi-policy-chip edupi-policy-chip--muted"><i />外发 <b>{status.externalSend ? "开启" : "关闭"}</b></span>
            <span className="edupi-policy-chip edupi-policy-chip--review"><i />教师审核 <b>{status.requiresTeacherReview ? "必须" : "不要求"}</b></span>
          </div>
        </>
      ) : null}
    </section>
  );
}
