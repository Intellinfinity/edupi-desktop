import type { MaterialStagingDescriptor } from "./edupi-material-staging";
export type { MaterialStagingDescriptor } from "./edupi-material-staging";

type MaterialStagingFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseDescriptor(value: unknown): MaterialStagingDescriptor | null {
  const descriptor = record(value);
  if (!descriptor) return null;
  const keys = Object.keys(descriptor);
  const expected = ["staging_id", "staging_path", "original_name", "expected_size_bytes", "source_hash", "kind", "source_scope"];
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))
    || typeof descriptor.staging_id !== "string" || !/^stg_[a-f0-9]{32}$/.test(descriptor.staging_id)
    || typeof descriptor.staging_path !== "string" || !descriptor.staging_path.trim()
    || typeof descriptor.original_name !== "string" || !descriptor.original_name.trim() || descriptor.original_name !== descriptor.original_name.trim()
    || descriptor.original_name.length > 240 || /[\\/\u0000-\u001f\u007f]/.test(descriptor.original_name)
    || typeof descriptor.expected_size_bytes !== "number" || !Number.isSafeInteger(descriptor.expected_size_bytes) || descriptor.expected_size_bytes <= 0
    || typeof descriptor.source_hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(descriptor.source_hash)
    || (descriptor.kind !== "image" && descriptor.kind !== "pdf" && descriptor.kind !== "word" && descriptor.kind !== "calendar")
    || descriptor.source_scope !== "desktop_staging") return null;
  return descriptor as unknown as MaterialStagingDescriptor;
}

async function parseResponse(response: Response): Promise<MaterialStagingDescriptor[]> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    raw = null;
  }
  if (!response.ok) {
    if (record(raw)?.code === "unsupported_type") throw new Error("不支持这类文件，请选择 Word、PDF、图片或 ICS 日历");
    throw new Error("材料暂存服务暂不可用，请稍后重试。");
  }
  const body = record(raw);
  if (!body || Object.keys(body).length !== 1 || !Array.isArray(body.staged)) throw new Error("材料暂存响应无效。");
  const descriptors = body.staged.map(parseDescriptor);
  if (descriptors.some((item) => item === null)) throw new Error("材料暂存响应无效。");
  return descriptors as MaterialStagingDescriptor[];
}

export async function stageBrowserMaterialFiles(
  files: File[],
  fetcher: MaterialStagingFetcher = fetch,
  headers?: HeadersInit,
): Promise<MaterialStagingDescriptor[]> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  return parseResponse(await fetcher("/api/edupi/materials/staging", {
    method: "POST",
    ...(headers ? { headers } : {}),
    body: form,
  }));
}

export async function stageNativeMaterialPaths(
  sourcePaths: string[],
  headers: HeadersInit,
  fetcher: MaterialStagingFetcher = fetch,
): Promise<MaterialStagingDescriptor[]> {
  return parseResponse(await fetcher("/api/edupi/materials/staging", {
    method: "POST",
    headers,
    body: JSON.stringify({ sourcePaths }),
  }));
}

export async function loadStagedMaterials(
  headers?: HeadersInit,
  fetcher: MaterialStagingFetcher = fetch,
): Promise<MaterialStagingDescriptor[]> {
  return parseResponse(await fetcher("/api/edupi/materials/staging", {
    method: "GET",
    headers,
    cache: "no-store",
  }));
}

export async function removeStagedMaterial(
  stagingId: string,
  headers?: HeadersInit,
  fetcher: MaterialStagingFetcher = fetch,
): Promise<MaterialStagingDescriptor[]> {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Content-Type", "application/json");
  return parseResponse(await fetcher("/api/edupi/materials/staging", {
    method: "DELETE",
    headers: requestHeaders,
    body: JSON.stringify({ stagingId }),
  }));
}
