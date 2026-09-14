import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { deleteEducationEntity, restoreEducationEntity } from "@/lib/edupi-education-server";
import { ENTITY_DELETE_KINDS, EntityDeleteError, type EntityDeleteKind } from "@/lib/edupi-entity-delete";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;
const BODY_KEYS = new Set(["note"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function statusFor(code: string): number {
  if (code === "invalid_request") return 400;
  if (code === "target_not_found" || code === "target_not_deleted") return 404;
  if (["stale_snapshot", "stale_tombstone", "target_changed", "legacy_identity_unresolvable", "material_unavailable"].includes(code)) return 409;
  return 503;
}

async function requestInput(request: Request, params: Promise<{ kind: string; id: string }>): Promise<{ kind: EntityDeleteKind; id: string; note: string | null }> {
  const { kind, id } = await params;
  const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
  const note = body?.note;
  if (!ENTITY_DELETE_KINDS.includes(kind as EntityDeleteKind)
    || typeof id !== "string" || !id.trim() || id.length > 160 || /[\u0000-\u001f\u007f]/u.test(id)
    || !body || Object.keys(body).some((key) => !BODY_KEYS.has(key))
    || (note !== null && note !== undefined && (typeof note !== "string" || !note.trim() || note.length > 1000))) {
    throw new EntityDeleteError("invalid_request", "对象字段无效。");
  }
  return { kind: kind as EntityDeleteKind, id: id.trim(), note: typeof note === "string" ? note.trim() : null };
}

async function handle(request: Request, context: { params: Promise<{ kind: string; id: string }> }, action: "delete" | "restore") {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: action === "delete" ? "删除请求被拒绝。" : "恢复请求被拒绝。", code: "forbidden" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "请使用 JSON。", code: "invalid_content_type" }, { status: 415 });
  try {
    const input = await requestInput(request, context.params);
    const result = action === "delete"
      ? await deleteEducationEntity({ ...input, signal: request.signal })
      : await restoreEducationEntity({ ...input, signal: request.signal });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "请求过大。", code: "too_large" }, { status: 413 });
    const code = error instanceof EntityDeleteError ? error.code : "unavailable";
    return NextResponse.json({ error: error instanceof Error ? error.message : action === "delete" ? "删除暂不可用。" : "恢复暂不可用。", code }, { status: statusFor(code) });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ kind: string; id: string }> }) {
  return handle(request, context, "delete");
}

export async function POST(request: Request, context: { params: Promise<{ kind: string; id: string }> }) {
  return handle(request, context, "restore");
}
