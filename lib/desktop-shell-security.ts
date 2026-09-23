import { createLocalBashOperations, type BashOperations, type BashSpawnContext } from "@earendil-works/pi-coding-agent";

const DESKTOP_SECRET_KEYS = [
  "PI_DESKTOP_API_TOKEN",
  "PI_DESKTOP_INSTANCE_ID",
  "EDUPI_OPENCONNECTOR_RUNTIME_TOKEN",
  "EDUPI_OPENCONNECTOR_ADMIN_TOKEN",
  "EDUPI_JEV_API_KEY",
  "EDUPI_JEV_TEXT_MODEL_API_KEY",
] as const;

export function redactDesktopSecrets(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  for (const key of DESKTOP_SECRET_KEYS) delete sanitized[key];
  return sanitized;
}

export function redactDesktopSpawnContext(context: BashSpawnContext): BashSpawnContext {
  return { ...context, env: redactDesktopSecrets(context.env) };
}

export function createDesktopSafeBashOperations(shellPath?: string): BashOperations {
  const local = createLocalBashOperations({ shellPath });
  return {
    exec: (command, cwd, options) => local.exec(command, cwd, {
      ...options,
      env: redactDesktopSecrets(options.env ?? process.env),
    }),
  };
}
