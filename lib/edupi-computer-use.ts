export const COMPUTER_USE_ACTIONS = [
  "status",
  "observe",
  "screenshot",
  "cursor_position",
  "list_windows",
  "click_element",
  "right_click_element",
  "double_click_element",
  "set_element_value",
  "launch",
  "left_click",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "mouse_move",
  "left_click_drag",
  "type",
  "key",
  "scroll",
  "focus_window",
  "wait",
] as const;

export type ComputerUseAction = (typeof COMPUTER_USE_ACTIONS)[number];

export type ComputerUseInput = {
  action: ComputerUseAction;
  snapshot_id?: string;
  ref?: number;
  text?: string;
  target?: string;
  app?: string;
  x?: number;
  y?: number;
  start_x?: number;
  start_y?: number;
  end_x?: number;
  end_y?: number;
  key?: string;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  display?: number;
  window_id?: number;
  seconds?: number;
};

export type ComputerUseStatus = {
  enabled: boolean;
  accessibility: boolean | null;
  screenRecording: boolean | null;
  host?: ComputerUseHostIdentity;
};

export type ComputerUseHostIdentity = {
  appName: string;
  appVersion: string;
  platform: string;
  processId: number;
  executablePath: string | null;
  bundlePath: string | null;
  bundleId: string;
  signingTeam: string | null;
};

export type NativeComputerUseResult = {
  content: string;
  isError: boolean;
  images: Array<{ mediaType: string; data: string }>;
  snapshotId: string | null;
  operationId: string;
};

export type ComputerUseBridgeResult =
  | { ok: true; result: NativeComputerUseResult }
  | { ok: false; error: string };

const ACTION_SET = new Set<string>(COMPUTER_USE_ACTIONS);
const MAX_TEXT_BYTES = 20_000;
const MAX_LAUNCH_BYTES = 2_048;
const MAX_KEY_BYTES = 96;
const MAX_RESULT_TEXT = 200_000;
const MAX_IMAGE_BASE64 = 7_100_000;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("桌面控制参数必须是对象");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): void {
  const unsupported = Object.keys(value).find((key) => !allowed.includes(key));
  if (unsupported) throw new Error(`不支持的桌面控制参数：${unsupported}`);
}

function stringValue(value: Record<string, unknown>, key: string, maxBytes: number): string {
  const result = value[key];
  if (typeof result !== "string" || !result) throw new Error(`${key} 不能为空`);
  if (new TextEncoder().encode(result).byteLength > maxBytes || result.includes("\0")) throw new Error(`${key} 过长或包含空字符`);
  return result;
}

function integer(value: Record<string, unknown>, key: string, required = true): number | undefined {
  const result = value[key];
  if (result === undefined && !required) return undefined;
  if (!Number.isSafeInteger(result)) throw new Error(`${key} 必须是整数`);
  return result as number;
}

function coordinate(value: Record<string, unknown>, key: string): void {
  const result = integer(value, key)!;
  if (result < -2_147_483_648 || result > 2_147_483_647) throw new Error(`${key} 超出桌面坐标范围`);
}

function snapshot(value: Record<string, unknown>): void {
  const id = stringValue(value, "snapshot_id", 96);
  if (!/^snapshot-[A-Za-z0-9-]+$/.test(id)) throw new Error("snapshot_id 无效");
}

export function validateComputerUseInput(raw: unknown): ComputerUseInput {
  const value = record(raw);
  if (typeof value.action !== "string" || !ACTION_SET.has(value.action)) throw new Error("不支持的桌面控制动作");
  const action = value.action as ComputerUseAction;
  if (action === "status" || action === "observe" || action === "cursor_position" || action === "list_windows") {
    exactKeys(value, ["action"]);
  } else if (action === "screenshot") {
    exactKeys(value, ["action", "display"]);
    const display = integer(value, "display", false);
    if (display !== undefined && (display < 0 || display > 4_294_967_295)) throw new Error("display 超出范围");
  } else if (action === "wait") {
    exactKeys(value, ["action", "seconds"]);
    if (value.seconds !== undefined && (typeof value.seconds !== "number" || !Number.isFinite(value.seconds) || value.seconds < 0 || value.seconds > 5)) throw new Error("seconds 必须在 0 到 5 之间");
  } else if (action === "click_element" || action === "right_click_element" || action === "double_click_element") {
    exactKeys(value, ["action", "ref", "snapshot_id"]);
    const ref = integer(value, "ref")!;
    if (ref <= 0 || ref > 4_294_967_295) throw new Error("ref 超出范围");
    snapshot(value);
  } else if (action === "set_element_value") {
    exactKeys(value, ["action", "ref", "text", "snapshot_id"]);
    const ref = integer(value, "ref")!;
    if (ref <= 0 || ref > 4_294_967_295) throw new Error("ref 超出范围");
    stringValue(value, "text", MAX_TEXT_BYTES);
    snapshot(value);
  } else if (action === "launch") {
    exactKeys(value, ["action", "target", "app"]);
    stringValue(value, "target", MAX_LAUNCH_BYTES);
    if (value.app !== undefined) stringValue(value, "app", MAX_LAUNCH_BYTES);
  } else if (["left_click", "right_click", "middle_click", "double_click", "triple_click", "mouse_move"].includes(action)) {
    exactKeys(value, ["action", "x", "y", "snapshot_id"]);
    coordinate(value, "x");
    coordinate(value, "y");
    snapshot(value);
  } else if (action === "left_click_drag") {
    exactKeys(value, ["action", "start_x", "start_y", "end_x", "end_y", "snapshot_id"]);
    for (const key of ["start_x", "start_y", "end_x", "end_y"]) coordinate(value, key);
    snapshot(value);
  } else if (action === "type") {
    exactKeys(value, ["action", "text", "snapshot_id"]);
    stringValue(value, "text", MAX_TEXT_BYTES);
    snapshot(value);
  } else if (action === "key") {
    exactKeys(value, ["action", "key", "snapshot_id"]);
    const key = stringValue(value, "key", MAX_KEY_BYTES);
    if (!/^[A-Za-z0-9+_-]+$/.test(key)) throw new Error("key 包含不支持的字符");
    snapshot(value);
  } else if (action === "scroll") {
    exactKeys(value, ["action", "direction", "amount", "x", "y", "snapshot_id"]);
    if (!(["up", "down", "left", "right"] as const).includes(value.direction as "up")) throw new Error("direction 必须是 up、down、left 或 right");
    const amount = integer(value, "amount", false);
    if (amount !== undefined && (amount < 1 || amount > 100)) throw new Error("amount 必须在 1 到 100 之间");
    if (value.x !== undefined) coordinate(value, "x");
    if (value.y !== undefined) coordinate(value, "y");
    snapshot(value);
  } else if (action === "focus_window") {
    exactKeys(value, ["action", "window_id", "snapshot_id"]);
    const id = integer(value, "window_id")!;
    if (id <= 0 || id > 4_294_967_295) throw new Error("window_id 超出范围");
    snapshot(value);
  }
  return value as ComputerUseInput;
}

export function computerActionNeedsApproval(action: ComputerUseAction): boolean {
  return action !== "status" && action !== "wait";
}

function preview(value: string | undefined, max = 80): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

export function describeComputerAction(input: ComputerUseInput): string {
  if (input.action === "status") return "读取桌面控制状态";
  if (input.action === "observe") return "读取当前桌面的无障碍结构与屏幕画面";
  if (input.action === "screenshot") return `截取${input.display === undefined ? "主" : `第 ${input.display}`}显示器`;
  if (input.action === "list_windows") return "读取当前打开的窗口列表";
  if (input.action === "cursor_position") return "读取鼠标位置";
  if (input.action.includes("element")) return `${input.action} 元素 [${input.ref}]${input.text ? `，内容“${preview(input.text)}”` : ""}`;
  if (input.action === "launch") return `打开“${preview(input.target)}”${input.app ? `，使用 ${preview(input.app)}` : ""}`;
  if (input.action === "type") return `向当前控件输入“${preview(input.text)}”`;
  if (input.action === "key") return `按键 ${input.key}`;
  if (input.action === "scroll") return `向 ${input.direction} 滚动 ${input.amount ?? 3} 格`;
  if (input.action === "focus_window") return `切换到窗口 ${input.window_id}`;
  if (input.action === "left_click_drag") return `从 (${input.start_x}, ${input.start_y}) 拖到 (${input.end_x}, ${input.end_y})`;
  if (input.action === "wait") return `等待 ${input.seconds ?? 1} 秒`;
  return `${input.action} (${input.x}, ${input.y})`;
}

export function parseComputerUseBridgeResult(raw: unknown): ComputerUseBridgeResult {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { ok: false, error: "桌面控制返回了无效响应" };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "桌面控制返回了无效响应" };
  const source = value as Record<string, unknown>;
  if (source.ok === false) {
    return { ok: false, error: typeof source.error === "string" && source.error.length <= 2_000 ? source.error : "桌面控制失败" };
  }
  if (source.ok !== true || !source.result || typeof source.result !== "object" || Array.isArray(source.result)) return { ok: false, error: "桌面控制返回了无效响应" };
  const result = source.result as Record<string, unknown>;
  if (typeof result.content !== "string" || result.content.length > MAX_RESULT_TEXT || typeof result.isError !== "boolean" || typeof result.operationId !== "string" || result.operationId.length > 128) {
    return { ok: false, error: "桌面控制结果格式无效" };
  }
  if (result.snapshotId !== null && (typeof result.snapshotId !== "string" || !/^snapshot-[A-Za-z0-9-]+$/.test(result.snapshotId))) {
    return { ok: false, error: "桌面控制快照标识无效" };
  }
  if (!Array.isArray(result.images) || result.images.length > 2) return { ok: false, error: "桌面控制图像结果无效" };
  const images: NativeComputerUseResult["images"] = [];
  for (const image of result.images) {
    if (!image || typeof image !== "object" || Array.isArray(image)) return { ok: false, error: "桌面控制图像结果无效" };
    const candidate = image as Record<string, unknown>;
    if (candidate.mediaType !== "image/png" || typeof candidate.data !== "string" || candidate.data.length > MAX_IMAGE_BASE64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(candidate.data)) {
      return { ok: false, error: "桌面控制图像结果无效" };
    }
    images.push({ mediaType: candidate.mediaType, data: candidate.data });
  }
  return {
    ok: true,
    result: {
      content: result.content,
      isError: result.isError,
      images,
      snapshotId: result.snapshotId as string | null,
      operationId: result.operationId,
    },
  };
}
