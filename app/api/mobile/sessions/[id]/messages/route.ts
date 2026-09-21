import { NextResponse } from "next/server";
import { authorizeMobileRequest } from "@/lib/mobile-bridge";
import { readMobileSession } from "@/lib/mobile-session";
import { resolveSessionPath } from "@/lib/session-reader";
import { startHarnessSession } from "@/lib/harness/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorizeMobileRequest(request, "mobile:chat")) return NextResponse.json({ error: "手机尚未完成配对" }, { status: 401 });
  const { id } = await params;
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 16_384) return NextResponse.json({ error: "请求过大" }, { status: 413 });
  const body = await request.json().catch(() => ({})) as { message?: unknown };
  if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 4_000) {
    return NextResponse.json({ error: "消息不能为空且不能超过 4000 字" }, { status: 400 });
  }
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath || !(await readMobileSession(id))) return NextResponse.json({ error: "对话不存在" }, { status: 404 });
    const { session } = await startHarnessSession(id, filePath, undefined, { accessMode: "approval" });
    const state = await session.send({ type: "get_state" }) as { isStreaming?: boolean; isPromptRunning?: boolean };
    if (state.isStreaming || state.isPromptRunning) return NextResponse.json({ error: "对话正在生成，请稍后" }, { status: 409 });
    await session.send({ type: "mobile_prompt", message: body.message.trim() });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "手机消息发送失败" }, { status: 503 });
  }
}
