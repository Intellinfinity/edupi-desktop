import { NextResponse } from "next/server";
import { CalendarSourceError, readCoreCalendarSources } from "@/lib/edupi-calendar-sources";
import { projectTimetableSourceOptions } from "@/lib/edupi-timetable-source-alias";
import { isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Timetable source request rejected" }, { status: 403 });
  try {
    const read = await readCoreCalendarSources(request.signal);
    return NextResponse.json({ sources: projectTimetableSourceOptions(read) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof CalendarSourceError ? error.code : "unavailable";
    return NextResponse.json({ error: "课表来源暂不可用。", code }, { status: 503 });
  }
}
