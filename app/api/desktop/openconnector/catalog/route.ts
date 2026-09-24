import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { hasJsonContentType } from "@/lib/request-security";
import { parseCatalogQuery } from "@/lib/openconnector-catalog-contract";
import { CatalogProcessError, runCatalogQuery } from "@/lib/openconnector-catalog-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return reply({ ok: false, code: "desktop_authorization_required" }, 403);
  if (!hasJsonContentType(request)) return reply({ ok: false, code: "invalid_catalog_request" }, 415);

  let query;
  try {
    query = parseCatalogQuery(await parseJsonWithinLimit(request, 1024));
  } catch (error) {
    return reply({ ok: false, code: error instanceof RequestBodyTooLargeError ? "catalog_request_too_large" : "invalid_catalog_request" }, error instanceof RequestBodyTooLargeError ? 413 : 400);
  }
  if (!query) return reply({ ok: false, code: "invalid_catalog_request" }, 400);

  try {
    return reply({ ok: true, data: await runCatalogQuery(query) }, 200);
  } catch (error) {
    const code = error instanceof CatalogProcessError ? error.code : "catalog_unavailable";
    const status = code === "catalog_timeout" ? 504 : code === "catalog_invalid_response" ? 502 : code === "invalid_catalog_request" ? 400 : 503;
    return reply({ ok: false, code }, status);
  }
}
