import { NextResponse } from "next/server";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { DESKTOP_INSTANCE_ID_ENV, DESKTOP_INSTANCE_ID_HEADER } from "@/lib/desktop-api";
import { hasJsonContentType } from "@/lib/request-security";
import { readRequestBytesWithinLimit } from "@/lib/bounded-form-data";
import { notificationClaimsAreCurrent, validNotificationProofRequest, NOTIFICATION_PROOF_NONCE_HEADER, NOTIFICATION_PROOF_DEADLINE_MS } from "@/lib/edupi-reminder-notification-proof";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  try {
    const bytes = await readRequestBytesWithinLimit(request, 4096);
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
    if (!validNotificationProofRequest(value)) return NextResponse.json({ error: "操作无效" }, { status: 400 });
    const instanceId = process.env[DESKTOP_INSTANCE_ID_ENV];
    if (!instanceId || !/^[a-f0-9]{64}$/.test(instanceId)) throw new Error("提醒服务标识不可用");
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(NOTIFICATION_PROOF_DEADLINE_MS)]);
    if (!await notificationClaimsAreCurrent(value.claims, { signal })) return NextResponse.json({ error: "提醒已变化" }, { status: 409 });
    if (signal.aborted) throw new Error("提醒校验暂不可用");
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store", [DESKTOP_INSTANCE_ID_HEADER]: instanceId, [NOTIFICATION_PROOF_NONCE_HEADER]: value.nonce } });
  } catch { return NextResponse.json({ error: "提醒校验暂不可用" }, { status: 503 }); }
}
