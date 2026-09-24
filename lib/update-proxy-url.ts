/** A local HTTP proxy only; never accept remote proxies or embedded credentials. */
export function parseUpdateProxyInput(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("只支持不含凭据的本机 HTTP 代理");
  }
  const port = Number(url.port);
  if (value.includes("?") || value.includes("#") || url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !Number.isInteger(port)
    || port < 1 || port > 65_535 || url.username || url.password || url.pathname !== "/"
    || url.search || url.hash) {
    throw new Error("只支持不含凭据的本机 HTTP 代理");
  }
  return `http://127.0.0.1:${port}`;
}
