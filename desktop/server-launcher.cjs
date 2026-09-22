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

module.exports = { resolveEduPiLaunchRoots };
