import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { authorizeMobileRequest } from "@/lib/mobile-bridge";
import { EDUPI_ROOT } from "@/lib/edupi-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorizeMobileRequest(request, "mobile:read")) return NextResponse.json({ error: "手机尚未完成配对" }, { status: 401 });
  try {
    const file = join(EDUPI_ROOT, ".edupi", "desktop", "reminders.json");
    const info = await stat(file);
    if (!info.isFile() || info.size > 512 * 1024) return NextResponse.json({ reminders: [] }, { headers: { "Cache-Control": "no-store" } });
    const raw = await readFile(file, "utf8");
    const value = JSON.parse(raw) as { items?: unknown[] };
    const items = Array.isArray(value.items) ? value.items.slice(0, 20) : [];
    return NextResponse.json({ reminders: items }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ reminders: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
