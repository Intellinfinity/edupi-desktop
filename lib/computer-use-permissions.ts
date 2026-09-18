export type ComputerUsePermission = "accessibility" | "screen_recording";

export type ComputerUsePermissionFlow = {
  permission: ComputerUsePermission;
  screenRecordingRequested: boolean;
};

export type ComputerUsePrimaryAction =
  | { kind: "detect" }
  | { kind: "request"; permission: ComputerUsePermission }
  | { kind: "restart" }
  | { kind: "enable" }
  | { kind: "stop" };

export function nextMissingComputerUsePermission(status: {
  accessibility: boolean | null;
  screenRecording: boolean | null;
}): ComputerUsePermission | null {
  if (status.accessibility === false) return "accessibility";
  if (status.screenRecording === false) return "screen_recording";
  return null;
}

export function computerUsePermissionFlowAfterStatus(
  status: {
    accessibility: boolean | null;
    screenRecording: boolean | null;
  },
  flow: ComputerUsePermissionFlow | null,
): ComputerUsePermissionFlow | null {
  if (!flow) return null;
  if (flow.permission === "accessibility") {
    if (status.accessibility === false) return flow;
    if (status.screenRecording === false) {
      return { permission: "screen_recording", screenRecordingRequested: false };
    }
    return null;
  }
  return status.screenRecording === false ? flow : null;
}

export function computerUsePrimaryAction(options: {
  status: {
    enabled: boolean;
    accessibility: boolean | null;
    screenRecording: boolean | null;
  } | null;
  flow: ComputerUsePermissionFlow | null;
}): ComputerUsePrimaryAction {
  const { status, flow } = options;
  if (!status) return { kind: "detect" };

  const missing = nextMissingComputerUsePermission(status);
  if (missing) {
    if (flow?.permission === missing) {
      if (missing === "screen_recording" && flow.screenRecordingRequested) {
        return { kind: "restart" };
      }
      return { kind: "request", permission: missing };
    }
    return { kind: "request", permission: missing };
  }
  return status.enabled ? { kind: "stop" } : { kind: "enable" };
}

export function computerUsePrimaryActionLabel(action: ComputerUsePrimaryAction): string {
  switch (action.kind) {
    case "detect":
      return "检测权限";
    case "request":
      return "一键处理权限";
    case "restart":
      return "授权后重启";
    case "enable":
      return "开启控制";
    case "stop":
      return "停止控制";
  }
}
