"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");

function firstConfigured(environment, names) {
  return names.map((name) => environment[name]).find((value) => typeof value === "string" && value) ?? "";
}

function resolveConfiguredRoot(value) {
  return value ? path.resolve(value) : "";
}

function resolveEduPiLaunchRoots(environment = process.env) {
  const dataRoot = resolveConfiguredRoot(
    firstConfigured(environment, ["EDUPI_DATA_ROOT", "EDUPI_PROJECT_ROOT", "EDUPI_WORKSPACE"]),
  );
  const coreRoot = resolveConfiguredRoot(
    firstConfigured(environment, ["EDUPI_CORE_ROOT", "EDUPI_PROJECT_ROOT", "EDUPI_WORKSPACE"]) || dataRoot,
  );
  return {
    PI_DESKTOP_STATE_DIR: resolveConfiguredRoot(environment.PI_DESKTOP_STATE_DIR || ""),
    EDUPI_PROJECT_ROOT: dataRoot,
    EDUPI_DATA_ROOT: dataRoot,
    EDUPI_CORE_ROOT: coreRoot,
    EDUPI_CORE_ALLOWED_ROOT: resolveConfiguredRoot(
      environment.EDUPI_CORE_ALLOWED_ROOT || (coreRoot ? path.dirname(coreRoot) : ""),
    ),
    EDUPI_DATA_ALLOWED_ROOT: resolveConfiguredRoot(
      environment.EDUPI_DATA_ALLOWED_ROOT || (dataRoot ? path.dirname(dataRoot) : ""),
    ),
  };
}

function shouldWakeCoreAtPackagedStart(environment = process.env) {
  const port = Number(environment.PORT);
  const parentPid = Number(environment.PI_WEB_PARENT_PID);
  return environment.NODE_ENV === "production"
    && environment.EDUPI_CORE_VALIDATION_MODE === "bundled"
    && environment.HOSTNAME === "127.0.0.1"
    && /^\d{1,5}$/.test(environment.PORT || "") && Number.isInteger(port) && port > 0 && port <= 65_535
    && /^\d+$/.test(environment.PI_WEB_PARENT_PID || "") && Number.isSafeInteger(parentPid) && parentPid > 0
    && typeof environment.PI_DESKTOP_INSTANCE_ID === "string" && environment.PI_DESKTOP_INSTANCE_ID.length > 0;
}

function waitForWakeRetry(delay, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (completed) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), delay);
    timer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function wakeRetryDelay(failures) {
  return Math.min(30_000, 250 * 2 ** Math.max(0, failures - 12));
}

async function wakePackagedCoreAtStartup(environment = process.env, fetcher = fetch, options = {}) {
  if (!shouldWakeCoreAtPackagedStart(environment)) return "skipped";
  const { signal, sleep = waitForWakeRetry, onRetry } = options;
  const origin = `http://127.0.0.1:${environment.PORT}`;
  let failures = 0;
  let coreErrors = 0;
  while (!signal?.aborted) {
    let verified = false;
    try {
      const response = await fetcher(`${origin}/api/desktop/identity`, {
        cache: "no-store",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(1_500)]) : AbortSignal.timeout(1_500),
      });
      if (response.status === 204) {
        if (response.headers.get("x-pi-desktop-instance") !== environment.PI_DESKTOP_INSTANCE_ID) return "identity_mismatch";
        verified = true;
      }
    } catch { /* Next.js may not be listening yet. */ }
    if (signal?.aborted) return "cancelled";
    if (verified) {
      try {
        // This is only a readiness retry. One successful ensure starts the
        // existing Core G1 processor, which owns scheduling and durable claims.
        const response = await fetcher(`${origin}/api/edupi/preparation`, {
          method: "POST",
          headers: { "content-type": "application/json", origin },
          body: JSON.stringify({ action: "ensure" }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
        });
        if (response.ok) {
          const status = await response.json();
          if (status?.state === "error") {
            if (++coreErrors >= 3) return "degraded";
          } else return "ready";
        }
      } catch { /* Preparation may still be compiling or temporarily unavailable. */ }
      if (signal?.aborted) return "cancelled";
    }
    failures++;
    onRetry?.({ failures, phase: verified ? "preparation" : "identity" });
    if (!await sleep(wakeRetryDelay(failures), signal)) return "cancelled";
  }
  return "cancelled";
}

if (require.main === module) {
  Object.assign(process.env, resolveEduPiLaunchRoots());

  const expectedParentPid = Number.parseInt(process.env.PI_WEB_PARENT_PID ?? "", 10);

  // EduPi is installed next to this desktop bundle in development and can be
  // selected explicitly by the packaged app. Never infer a secret or channel
  // credential here; only pass the project/data roots used by the read-only
  // teacher workspace and the Pi runtime.

  // A normal App quit is handled by the Rust shell. This small watchdog also
  // prevents the local server from becoming orphaned if the GUI process crashes
  // or is force-terminated by macOS.
  const parentWatchdog = setInterval(() => {
    if (!Number.isInteger(expectedParentPid) || process.ppid === 1) {
      process.exit(0);
    }

    try {
      process.kill(expectedParentPid, 0);
    } catch {
      process.exit(0);
    }
  }, 1_000);
  parentWatchdog.unref();

  // The standalone Next.js entrypoint is CommonJS.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("./server.js");

  void wakePackagedCoreAtStartup(process.env, fetch, {
    onRetry: ({ failures, phase }) => {
      if (failures === 12 || failures % 24 === 0) {
        console.warn("[edupi runtime] packaged startup wake pending", phase, failures);
      }
    },
  }).then((status) => {
    if (status !== "ready" && status !== "skipped") console.warn("[edupi runtime] packaged startup wake", status);
  });

  if (process.env.EDUPI_MOBILE_BRIDGE_ENABLED === "1") {
    const host = process.env.EDUPI_MOBILE_BRIDGE_HOST;
    const port = Number(process.env.PORT);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    if (require("node:net").isIP(host) && Number.isInteger(port) && port > 0 && port <= 65_535) {
      // This listener is bound to the LAN interface, never to the desktop's loopback address.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createMobileGateway } = require("./mobile-gateway.cjs");
      const gateway = createMobileGateway({ upstreamPort: port });
      gateway.on("error", (error) => console.error("Mobile gateway unavailable:", error.code || "listen_failed"));
      gateway.listen(port, host);
    }
  }
}

module.exports = { resolveEduPiLaunchRoots, shouldWakeCoreAtPackagedStart, wakePackagedCoreAtStartup };
