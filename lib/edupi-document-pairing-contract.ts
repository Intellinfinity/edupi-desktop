export type DocumentPairingChoice = {
  incomingVariantRef: string;
  currentSourceOccurrenceRef: string | null;
};

export type DocumentPairingSubmission = {
  recognitionFingerprint: string;
  pairings: DocumentPairingChoice[];
};

export type DocumentPairingItem = {
  date: string;
  endDate: string | null;
  name: string;
  type: string;
  time: string | null;
  location: string | null;
  notes: string | null;
};

export type DocumentPairingPreview = {
  stagingId: string;
  sourceId: string;
  sourceFingerprint: string;
  recognitionFingerprint: string;
  groups: Array<{
    anchor: string;
    incoming: Array<DocumentPairingItem & { variantRef: string }>;
    current: Array<DocumentPairingItem & { sourceOccurrenceRef: string }>;
  }>;
};
