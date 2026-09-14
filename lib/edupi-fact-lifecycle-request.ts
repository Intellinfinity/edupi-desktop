import { FACT_REVIEW_DECISIONS, type FactMutationInput, type FactReviewDecision } from "./edupi-fact-lifecycle-model";

type RawRecord = Record<string, unknown>;

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function exact(value: RawRecord, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return normalized && normalized.length <= max && !/[\u0000-\u001f\u007f]/u.test(normalized) ? normalized : null;
}

function note(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  return text(value, 1000) ?? undefined;
}

function revision(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

export function parseFactId(value: unknown): string | null {
  return text(value, 160);
}

export function parseFactMutationBody(value: unknown): FactMutationInput | null {
  const source = record(value);
  if (!source || typeof source.action !== "string") return null;
  const expectedRevision = revision(source.expectedRevision);
  const reviewer = text(source.reviewer, 160);
  if (expectedRevision === null || !reviewer) return null;
  if (source.action === "review") {
    if (!exact(source, ["action", "expectedRevision", "decision", "reviewer", "note", "supersedesFactId", "supersedesFactRevision"])) return null;
    const parsedNote = note(source.note);
    const supersedesFactId = source.supersedesFactId === null ? null : text(source.supersedesFactId, 160);
    const supersedesFactRevision = source.supersedesFactRevision === null ? null : revision(source.supersedesFactRevision);
    if (!FACT_REVIEW_DECISIONS.includes(source.decision as FactReviewDecision) || parsedNote === undefined
      || source.supersedesFactId !== null && supersedesFactId === null
      || source.supersedesFactRevision !== null && supersedesFactRevision === null || (supersedesFactId === null) !== (supersedesFactRevision === null)
      || source.decision !== "accept" && supersedesFactId !== null) return null;
    return { action: "review", expectedRevision, decision: source.decision as FactReviewDecision, reviewer, note: parsedNote, supersedesFactId, supersedesFactRevision };
  }
  if (source.action === "modify") {
    if (!exact(source, ["action", "expectedRevision", "replacementValue", "reviewer", "note"])) return null;
    const replacementValue = text(source.replacementValue, 4000);
    const parsedNote = note(source.note);
    return replacementValue && parsedNote !== undefined ? { action: "modify", expectedRevision, replacementValue, reviewer, note: parsedNote } : null;
  }
  if (source.action === "delete") return exact(source, ["action", "expectedRevision", "reviewer"]) ? { action: "delete", expectedRevision, reviewer } : null;
  if (source.action === "restore") {
    if (!exact(source, ["action", "expectedRevision", "reviewer", "supersedesFactId", "supersedesFactRevision"])) return null;
    const supersedesFactId = source.supersedesFactId === null ? null : text(source.supersedesFactId, 160);
    const supersedesFactRevision = source.supersedesFactRevision === null ? null : revision(source.supersedesFactRevision);
    return source.supersedesFactId !== null && supersedesFactId === null || source.supersedesFactRevision !== null && supersedesFactRevision === null
      || (supersedesFactId === null) !== (supersedesFactRevision === null)
      ? null : { action: "restore", expectedRevision, reviewer, supersedesFactId, supersedesFactRevision };
  }
  return null;
}

export function parseDeletedFactPage(url: string): { offset: number; limit: number } | null {
  const params = new URL(url).searchParams;
  if ([...params.keys()].some((key) => key !== "offset" && key !== "limit")) return null;
  const offset = params.has("offset") ? Number(params.get("offset")) : 0;
  const limit = params.has("limit") ? Number(params.get("limit")) : 20;
  return Number.isInteger(offset) && offset >= 0 && offset <= 1_000_000 && Number.isInteger(limit) && limit >= 1 && limit <= 100 ? { offset, limit } : null;
}
