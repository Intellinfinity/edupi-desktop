function verifiedProxy(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("更新代理设置不可用");
  const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/u.exec(value);
  const port = Number(match?.[1]);
  if (!match || port < 1 || port > 65_535) throw new Error("更新代理设置不可用");
  return value;
}

export async function getUpdateProxyNative(): Promise<string | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  return verifiedProxy(await invoke<string | null>("get_update_proxy"));
}

export async function setUpdateProxyNative(proxy: string): Promise<string | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  return verifiedProxy(await invoke<string | null>("set_update_proxy", { proxy }));
}
