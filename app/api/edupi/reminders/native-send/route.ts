import path from "node:path";
import { NextResponse } from "next/server";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { DESKTOP_INSTANCE_ID_ENV, DESKTOP_INSTANCE_ID_HEADER } from "@/lib/desktop-api";
import { hasJsonContentType } from "@/lib/request-security";
import { readRequestBytesWithinLimit } from "@/lib/bounded-form-data";
import { resolveEduPiDataRoot } from "@/lib/edupi-core-root";
import { notificationClaimsAreCurrent, readCurrentReminderEducation, reminderNotificationSourceFingerprint,
  validNotificationProofRequest, NOTIFICATION_PROOF_NONCE_HEADER, NOTIFICATION_PROOF_DEADLINE_MS } from "@/lib/edupi-reminder-notification-proof";
import { updateReminderStore } from "@/lib/edupi-reminder-store";

export const dynamic = "force-dynamic";
const NOTIFICATION_DISPATCH_ID_HEADER = "x-pi-reminder-dispatch-id";

/** Atomically cross the native-send boundary. A timeout after this point is unknown, never retryable. */
export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  try {
    const bytes = await readRequestBytesWithinLimit(request, 4096);
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
    if (!validNotificationProofRequest(value)) return NextResponse.json({ error: "操作无效" }, { status: 400 });
    const instanceId = process.env[DESKTOP_INSTANCE_ID_ENV];
    if (!instanceId || !/^[a-f0-9]{64}$/u.test(instanceId)) throw new Error("提醒服务标识不可用");
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(NOTIFICATION_PROOF_DEADLINE_MS)]);
    const root = resolveEduPiDataRoot().root;
    const file = path.join(root, ".edupi", "desktop", "reminders.json");
    let currentData: Awaited<ReturnType<typeof readCurrentReminderEducation>> | null = null;
    const state = await updateReminderStore(file, {}, { id: "*", type: "begin_notification_send", claims: value.claims, instanceId }, Date.now(), {
      sourceFingerprint: item => currentData ? reminderNotificationSourceFingerprint(item, currentData) : "",
      authorizeNativeSend: async () => {
        if (signal.aborted) return false;
        const allowed = await notificationClaimsAreCurrent(value.claims, { signal, readData: async () => {
          const data = await readCurrentReminderEducation(signal);
          if (data.workspace !== root) throw new Error("提醒工作区已变化");
          currentData = data;
          return data;
        } });
        return allowed && !signal.aborted;
      },
      currentTime: Date.now,
    });
    if (!state.nativeDispatchId) throw new Error("提醒关联已变化");
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store", [DESKTOP_INSTANCE_ID_HEADER]: instanceId,
      [NOTIFICATION_PROOF_NONCE_HEADER]: value.nonce, [NOTIFICATION_DISPATCH_ID_HEADER]: state.nativeDispatchId } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === "提醒关联已变化" ? "提醒已变化" : "提醒校验暂不可用" },
      { status: error instanceof Error && error.message === "提醒关联已变化" ? 409 : 503 });
  }
}
