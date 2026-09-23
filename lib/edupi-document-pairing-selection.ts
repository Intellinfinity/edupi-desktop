import type { DocumentPairingPreview, DocumentPairingSubmission } from "./edupi-document-pairing-contract";

/** UI values are indexes, never Core occurrence refs; "__new" cannot collide with a ref. */
export function documentPairingSubmission(
  preview: DocumentPairingPreview,
  selected: Readonly<Record<string, string>>,
): DocumentPairingSubmission {
  const usedCurrent = new Set<string>();
  const pairings: DocumentPairingSubmission["pairings"] = [];
  for (const group of preview.groups) {
    for (const incoming of group.incoming) {
      const value = selected[incoming.variantRef];
      if (!value) throw new Error("请为每条新事项选择原事项或新增事项。");
      let currentSourceOccurrenceRef: string | null = null;
      if (value !== "__new") {
        if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw new Error("逐项配对已失效，请重新核对。");
        currentSourceOccurrenceRef = group.current[Number(value)]?.sourceOccurrenceRef ?? null;
        if (!currentSourceOccurrenceRef) throw new Error("逐项配对已失效，请重新核对。");
        if (usedCurrent.has(currentSourceOccurrenceRef)) throw new Error("同一原事项只能配对一次。");
        usedCurrent.add(currentSourceOccurrenceRef);
      }
      pairings.push({ incomingVariantRef: incoming.variantRef, currentSourceOccurrenceRef });
    }
  }
  return { recognitionFingerprint: preview.recognitionFingerprint, pairings };
}
