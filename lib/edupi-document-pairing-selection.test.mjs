import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { documentPairingSubmission } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./edupi-document-pairing-selection.ts");

const preview = {
  stagingId: `stg_${"a".repeat(32)}`,
  sourceId: `document-source-${"b".repeat(32)}`,
  sourceFingerprint: `sha256:${"c".repeat(64)}`,
  recognitionFingerprint: `sha256:${"d".repeat(64)}`,
  groups: [{ anchor: "same-name", incoming: [
    { variantRef: "first", date: "2026-10-20", endDate: null, name: "教研会", type: "meeting", time: null, location: null, notes: "一年级" },
    { variantRef: "second", date: "2026-10-20", endDate: null, name: "教研会", type: "meeting", time: null, location: null, notes: "二年级" },
  ], current: [
    { sourceOccurrenceRef: "__new", date: "2026-10-20", endDate: null, name: "教研会", type: "meeting", time: null, location: null, notes: "一年级" },
    { sourceOccurrenceRef: "old-b", date: "2026-10-20", endDate: null, name: "教研会", type: "meeting", time: null, location: null, notes: "二年级" },
  ] }],
};

test("UI option indexes preserve a real Core ref named __new", () => {
  assert.deepEqual(documentPairingSubmission(preview, { first: "0", second: "1" }).pairings, [
    { incomingVariantRef: "first", currentSourceOccurrenceRef: "__new" },
    { incomingVariantRef: "second", currentSourceOccurrenceRef: "old-b" },
  ]);
  assert.equal(documentPairingSubmission(preview, { first: "__new", second: "1" }).pairings[0].currentSourceOccurrenceRef, null);
});

test("missing, repeated and invalid selections reject before intake", () => {
  assert.throws(() => documentPairingSubmission(preview, { first: "0" }), /选择/u);
  assert.throws(() => documentPairingSubmission(preview, { first: "0", second: "0" }), /只能配对一次/u);
  assert.throws(() => documentPairingSubmission(preview, { first: "999", second: "1" }), /已失效/u);
  assert.throws(() => documentPairingSubmission(preview, { first: "old-b", second: "1" }), /已失效/u);
});
