import { NextResponse } from "next/server";
import { CalendarSourceError, readCoreCalendarSources } from "@/lib/edupi-calendar-sources";
import { isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Calendar source request rejected" }, { status: 403 });
  try {
    const result = await readCoreCalendarSources(request.signal);
    return NextResponse.json({ sources: result.sources.map((source) => ({
      sourceId: source.sourceId,
      label: source.label,
      eventCount: source.eventCount,
      fingerprint: source.fingerprint,
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof CalendarSourceError ? error.code : "unavailable";
    return NextResponse.json({ error: "日历来源暂不可用。", code }, { status: 503 });
  }
}
