import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { hasJsonContentType } from "@/lib/request-security";
import { listStagedMaterials, MaterialStagingError } from "@/lib/edupi-material-staging";
import { withMaterialRecognitionLock, MaterialRecognitionAdmissionError } from "@/lib/edupi-material-recognition-lock";
import { recognizeStagedMaterial, MaterialRecognitionError } from "@/lib/edupi-material-recognition";
import { calendarRecognitionFingerprint } from "@/lib/edupi-calendar-file-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "请使用 JSON" }, { status: 415 });
  try {
    const body = await parseJsonWithinLimit(request, 1024) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1
      || typeof body.stagingId !== "string" || !/^stg_[a-f0-9]{32}$/u.test(body.stagingId)) {
      return NextResponse.json({ error: "暂存材料无效" }, { status: 400 });
    }
    const descriptor = listStagedMaterials().find(item => item.staging_id === body.stagingId && item.kind === "calendar");
    if (!descriptor) return NextResponse.json({ error: "日历材料已失效，请重新上传" }, { status: 409 });
    const recognition = await withMaterialRecognitionLock(descriptor.staging_id, () => recognizeStagedMaterial(descriptor));
    return NextResponse.json({ stagingId: descriptor.staging_id, sourceHash: descriptor.source_hash,
      fingerprint: calendarRecognitionFingerprint(recognition), mode: recognition.calendar_mode || "full_snapshot",
      events: recognition.events.map(item => ({ id: item.event_id, date: item.date, endDate: item.end_date,
        type: item.type, name: item.name, time: item.time_interval
          ? `${item.time_interval.start}—${item.time_interval.end}` : null,
        location: item.location ?? null, notes: item.notes })),
      cancelledCount: recognition.cancelled_occurrence_refs?.length || 0,
      affectedSeriesCount: recognition.affected_series_refs?.length || 0, externalSend: false },
    { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "请求过大" }, { status: 413 });
    if (error instanceof MaterialRecognitionAdmissionError) return NextResponse.json({ error: "材料正在识别，请稍后重试" }, { status: 409 });
    if (error instanceof MaterialRecognitionError) return NextResponse.json({ error: error.message, code: error.code },
      { status: error.code === "too_large" ? 413 : error.code === "invalid_output" ? 400 : error.code === "ambiguous_schedule" ? 409 : 503 });
    if (error instanceof MaterialStagingError) return NextResponse.json({ error: "材料暂不可用" }, { status: 503 });
    return NextResponse.json({ error: "日历预览暂不可用" }, { status: 503 });
  }
}
