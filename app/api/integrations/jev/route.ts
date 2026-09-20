import { NextResponse } from "next/server";
import {
  DecisionProviderError,
  JevDecisionProvider,
  resolveJevConfig,
} from "@/lib/integrations/browser-decision";
import {
  clearJevApiKey,
  loadJevRuntimeEnvironment,
  readJevSettingsStatus,
  saveJevSettings,
} from "@/lib/integrations/jev-settings";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_096;

function isLoopbackRequest(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host || /[\s/@\\]/u.test(host)) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.replace(/^\[|\]$/gu, "").toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function allowed(request: Request): boolean {
  return isLoopbackRequest(request) && isApiRequestAllowed(request);
}

function denied(status = 403) {
  return NextResponse.json({ error: "请求被拒绝。" }, { status });
}

async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error("请求过大");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new Error("请求过大");
  return JSON.parse(text);
}

export async function GET(request: Request) {
  if (!allowed(request)) return denied();
  try {
    return NextResponse.json(await readJevSettingsStatus());
  } catch {
    return NextResponse.json({ error: "JEV 设置不可用。" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!allowed(request)) return denied();
  if (!hasJsonContentType(request)) return denied(415);
  try {
    const current = await readJevSettingsStatus();
    if (current.environmentManaged) {
      return NextResponse.json({ error: "JEV 当前由环境变量管理。" }, { status: 409 });
    }
    await saveJevSettings(await readBody(request));
    return NextResponse.json(await readJevSettingsStatus());
  } catch (error) {
    const message = error instanceof Error && /请求过大/u.test(error.message)
      ? "请求过大。"
      : "JEV 设置无效。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  if (!allowed(request)) return denied();
  try {
    const current = await readJevSettingsStatus();
    if (current.environmentManaged) {
      return NextResponse.json({ error: "JEV 当前由环境变量管理。" }, { status: 409 });
    }
    await clearJevApiKey();
    return NextResponse.json(await readJevSettingsStatus());
  } catch {
    return NextResponse.json({ error: "无法移除 JEV 密钥。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!allowed(request)) return denied();
  if (!hasJsonContentType(request)) return denied(415);
  try {
    await readBody(request);
    const runtime = loadJevRuntimeEnvironment();
    const config = resolveJevConfig({ ...runtime, EDUPI_JEV_ENABLED: "1" });
    if (!config.enabled) {
      return NextResponse.json({ error: "请先保存有效的 JEV URL 和 API Key。" }, { status: 400 });
    }
    const provider = new JevDecisionProvider({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: config.model,
    });
    const decision = await provider.decide({
      surface: "browser",
      goal: "Choose WAIT for this connection test.",
      page: {
        url: "https://edupi.local/jev-connection-test",
        title: "EduPi JEV connection test",
        text: "Connection test only. Do not click the control.",
        fingerprint: "jev-test-v1",
        elements: [{ id: "noop", role: "button", label: "Do not click", operations: ["CLICK"] }],
      },
      history: [],
    }, request.signal);
    return NextResponse.json({
      ok: true,
      provider: decision.provider,
      model: typeof decision.providerTrace.model === "string" ? decision.providerTrace.model : config.model,
      latencyMs: decision.latencyMs,
    });
  } catch (error) {
    const code = error instanceof DecisionProviderError ? error.reason : "connection_failed";
    return NextResponse.json({ error: "JEV 连接测试失败。", code }, { status: 502 });
  }
}
