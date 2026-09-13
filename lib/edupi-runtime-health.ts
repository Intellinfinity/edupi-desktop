export type CoreRuntimeScheduler = {
  kind: "core_runtime_g1_processor" | "core_runtime_g1_live_processor";
  timer_active: boolean;
  interval_ms: number | null;
  last_timer_check_at: string | null;
  next_timer_check_at: string | null;
  timer_error_code: string | null;
};

export type CoreRuntimeHealth = {
  lifecycle: "starting" | "ready" | "degraded" | "draining" | "failed" | "stopped";
  core_commit: string;
  component_manifest_hash: string;
  queue: { total: number; queued: number; claimed: number; completed: number; failed: number; cancelled: number };
  capabilities: {
    internal_timer: "activation_pending" | "active";
    g1_processor: "activation_pending" | "active";
    g3_processor: "activation_pending" | "active";
  };
  scheduler: CoreRuntimeScheduler | null;
};

export type ProjectedCoreRuntimeHealth = CoreRuntimeHealth & {
  status: "ready" | "degraded" | "starting" | "draining" | "failed" | "stopped";
  reason: string | null;
};

const lifecycles = new Set(["starting", "ready", "degraded", "draining", "failed", "stopped"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function projectCoreRuntimeHealth(response: unknown, expectedCoreCommit: string, expectedComponentManifestHash: string): ProjectedCoreRuntimeHealth {
  const envelope = record(response);
  const health = record(envelope?.result);
  const capabilities = record(health?.capabilities);
  const queue = record(health?.queue);
  const scheduler = health?.scheduler === null ? null : record(health?.scheduler);
  if (envelope?.ok !== true || envelope.operation !== "health" || !health || !capabilities || !queue
    || !lifecycles.has(String(health.lifecycle)) || health.core_commit !== expectedCoreCommit
    || health.component_manifest_hash !== expectedComponentManifestHash
    || !["internal_timer", "g1_processor", "g3_processor"].every(key => ["active", "activation_pending"].includes(String(capabilities[key])))
    || !["total", "queued", "claimed", "completed", "failed", "cancelled"].every(key => Number.isInteger(queue[key]))) {
    throw new Error("Core Runtime health is invalid");
  }
  if (scheduler && (typeof scheduler.kind !== "string" || typeof scheduler.timer_active !== "boolean"
    || !(scheduler.interval_ms === null || Number.isInteger(scheduler.interval_ms))
    || !["last_timer_check_at", "next_timer_check_at", "timer_error_code"].every(key => scheduler[key] === null || typeof scheduler[key] === "string"))) {
    throw new Error("Core Runtime scheduler health is invalid");
  }

  const lifecycle = health.lifecycle as CoreRuntimeHealth["lifecycle"];
  let status: ProjectedCoreRuntimeHealth["status"] = lifecycle;
  let reason: string | null = lifecycle === "ready" ? null : `Core Runtime ${lifecycle}`;
  if (lifecycle === "ready" && (capabilities.g1_processor !== "active" || capabilities.internal_timer !== "active" || !scheduler?.timer_active)) {
    status = "degraded";
    reason = "课程准备自动检查未启动";
  } else if (lifecycle === "ready" && scheduler?.timer_error_code) {
    status = "degraded";
    reason = `自动检查失败：${scheduler.timer_error_code}`;
  }

  return {
    status,
    reason,
    lifecycle,
    core_commit: health.core_commit as string,
    component_manifest_hash: health.component_manifest_hash as string,
    queue: queue as unknown as CoreRuntimeHealth["queue"],
    capabilities: capabilities as unknown as CoreRuntimeHealth["capabilities"],
    scheduler: scheduler as CoreRuntimeScheduler | null,
  };
}
