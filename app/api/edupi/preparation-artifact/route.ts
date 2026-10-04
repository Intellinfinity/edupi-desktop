import { NextResponse } from "next/server";
import { preparationArtifactRequest } from "@/lib/edupi-preparation-artifact-server";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";
const validId = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= 160;
function failure(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === "artifact_read_only") return NextResponse.json({ code, error: "该草稿已暂缓，仅可查看；未保存的修改已保留" }, { status: 409 });
  if (code === "stale_revision" || code === "stale_source") return NextResponse.json({ code, error: "产物或来源已更新，草稿已保留，请重新读取版本后核对" }, { status: 409 });
  if (code === "artifact_unavailable") return NextResponse.json({ code, error: "产物已失效或不可用" }, { status: 404 });
  if (code === "invalid_input" || error instanceof RequestBodyTooLargeError) return NextResponse.json({ code: "invalid_input", error: "正文不能为空且最多100 KB" }, { status: 400 });
  return NextResponse.json({ code: "unavailable", error: "产物读取或保存未确认，请重试" }, { status: 503 });
}
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  const query = new URL(request.url).searchParams, artifactId = query.get("artifactId"), rawRevision = query.get("revision");
  if (!validId(artifactId) || rawRevision !== null && (!/^\d+$/.test(rawRevision) || !Number.isSafeInteger(Number(rawRevision)) || Number(rawRevision) < 1)) return NextResponse.json({ error: "参数无效" }, { status: 400 });
  try { return NextResponse.json(await preparationArtifactRequest("read", { artifact_id: artifactId, ...(rawRevision === null ? {} : { revision: Number(rawRevision) }) }, request.signal)); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  try {
    const body = await parseJsonWithinLimit(request, 620000) as Record<string, unknown> | null;
    if (!body || Array.isArray(body) || Object.keys(body).some(key => !["artifactId", "expectedRevision", "content"].includes(key)) || !validId(body.artifactId) || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1 || typeof body.content !== "string" || !body.content.trim() || Buffer.byteLength(body.content) > 100000) return NextResponse.json({ error: "参数无效或正文超过100 KB" }, { status: 400 });
    return NextResponse.json(await preparationArtifactRequest("revise", { artifact_id: body.artifactId, expected_revision: body.expectedRevision, content: body.content, actor: "teacher" }, request.signal));
  } catch (error) { return failure(error); }
}
