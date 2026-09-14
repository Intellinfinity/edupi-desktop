import { NextResponse } from "next/server";
import { EntityDeleteError, readEntityDeletionLedger } from "@/lib/edupi-entity-delete";
import { isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "删除记录请求被拒绝。", code: "forbidden" }, { status: 403 });
  try {
    const ledger = await readEntityDeletionLedger({ signal: request.signal });
    return NextResponse.json({ deletions: ledger.deletions, history: ledger.history });
  } catch (error) {
    const code = error instanceof EntityDeleteError ? error.code : "unavailable";
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除记录暂不可用。", code }, { status: 503 });
  }
}
