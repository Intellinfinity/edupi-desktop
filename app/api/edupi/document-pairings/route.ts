import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { CalendarSourceError } from "@/lib/edupi-calendar-sources";
import { previewDocumentSchedulePairings } from "@/lib/edupi-document-schedule-sync";
import { MaterialRecognitionError } from "@/lib/edupi-material-recognition";
import { MaterialRecognitionAdmissionError, withMaterialRecognitionLock } from "@/lib/edupi-material-recognition-lock";
import { listStagedMaterials } from "@/lib/edupi-material-staging";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Document pairing request rejected" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Use application/json" }, { status: 415 });
  try {
    const body: unknown = await parseJsonWithinLimit(request, MAX_BODY_BYTES);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "逐项配对请求无效。", code: "invalid_envelope" }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    if (Object.keys(input).sort().join("|") !== "sourceFingerprint|sourceId|stagingId"
      || typeof input.stagingId !== "string" || !/^stg_[a-f0-9]{32}$/u.test(input.stagingId)
      || typeof input.sourceId !== "string" || !/^document-source-[a-f0-9]{32}$/u.test(input.sourceId)
      || typeof input.sourceFingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(input.sourceFingerprint)) {
      return NextResponse.json({ error: "逐项配对请求无效。", code: "invalid_envelope" }, { status: 400 });
    }
    const descriptor = listStagedMaterials().find(item => item.staging_id === input.stagingId);
    if (!descriptor) return NextResponse.json({ error: "暂存材料不存在或已经处理。", code: "staging_missing" }, { status: 409 });
    const preview = await withMaterialRecognitionLock(descriptor.staging_id, () => previewDocumentSchedulePairings({
      descriptor, requestedSourceId: input.sourceId as string, expectedSourceFingerprint: input.sourceFingerprint as string,
      signal: request.signal,
    }));
    return NextResponse.json(preview, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "逐项配对请求过大。", code: "too_large" }, { status: 413 });
    if (error instanceof MaterialRecognitionError) return NextResponse.json({ error: error.message, code: error.code }, {
      status: error.code === "ambiguous_schedule" ? 409 : error.code === "invalid_output" ? 400 : 503,
    });
    if (error instanceof CalendarSourceError) return NextResponse.json({ error: error.message, code: error.code }, {
      status: error.code === "invalid_calendar_source_projection" ? 503 : 409,
    });
    if (error instanceof MaterialRecognitionAdmissionError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    return NextResponse.json({ error: "逐项配对暂不可用。", code: "unavailable" }, { status: 503 });
  }
}
