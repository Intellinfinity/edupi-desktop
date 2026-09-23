import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { pairDocumentEvents, documentPairingFingerprint } = await jiti.import("./edupi-document-pairing.ts");
const { stableDocumentOccurrenceVariantRef } = await jiti.import("./edupi-schedule-upload.ts");

function event(date, id, notes = null) {
  return { event_id: id, date, end_date: null, name: "教研会", type: "meeting", confidence: "inferred",
    notes, time_interval: null, location: null };
}
function occurrence(value, ref) {
  return { sourceOccurrenceRef: ref || stableDocumentOccurrenceVariantRef(value), eventId: `core-${value.event_id}`,
    contentFingerprint: `sha256:${"a".repeat(64)}`, content: value, evidenceIds: [] };
}

test("same-name simultaneous changes require explicit, distinct teacher mappings", () => {
  const oldA = event("2026-10-20", "old-a");
  const oldB = event("2026-10-21", "old-b");
  const newA = event("2026-10-22", "new-a");
  const newB = event("2026-10-23", "new-b");
  const old = [occurrence(oldA), occurrence(oldB)];
  const incoming = [newA, newB];
  const preview = pairDocumentEvents(incoming, old);
  assert.equal(preview.reviewGroups.length, 1);
  assert.equal(preview.reviewGroups[0].incoming.length, 2);
  assert.equal(preview.reviewGroups[0].current.length, 2);
  const choices = [
    { incomingVariantRef: stableDocumentOccurrenceVariantRef(newA), currentSourceOccurrenceRef: old[1].sourceOccurrenceRef },
    { incomingVariantRef: stableDocumentOccurrenceVariantRef(newB), currentSourceOccurrenceRef: old[0].sourceOccurrenceRef },
  ];
  const matched = pairDocumentEvents(incoming, old, choices);
  assert.deepEqual(matched.reviewGroups, []);
  assert.equal(matched.assignments.get(newA), old[1]);
  assert.equal(matched.assignments.get(newB), old[0]);
  assert.throws(() => pairDocumentEvents(incoming, old, choices.slice(0, 1)), /逐项|配对/u);
  assert.throws(() => pairDocumentEvents(incoming, old, [choices[0], { ...choices[1], currentSourceOccurrenceRef: old[1].sourceOccurrenceRef }]), /重复|配对/u);
  assert.throws(() => pairDocumentEvents(incoming, old, [choices[0], { ...choices[1], currentSourceOccurrenceRef: "foreign-ref" }]), /来源|配对/u);
});

test("exact and one-to-one matches remain automatic while explicit new is possible", () => {
  const oldA = event("2026-10-20", "old-a");
  const oldB = event("2026-10-21", "old-b");
  const old = [occurrence(oldA), occurrence(oldB)];
  const movedB = event("2026-10-22", "new-b");
  const automatic = pairDocumentEvents([oldA, movedB], old);
  assert.equal(automatic.reviewGroups.length, 0);
  assert.equal(automatic.assignments.get(oldA), old[0]);
  assert.equal(automatic.assignments.get(movedB), old[1]);
  const movedA = event("2026-10-23", "new-a");
  const explicit = pairDocumentEvents([movedA, movedB], old, [
    { incomingVariantRef: stableDocumentOccurrenceVariantRef(movedA), currentSourceOccurrenceRef: null },
    { incomingVariantRef: stableDocumentOccurrenceVariantRef(movedB), currentSourceOccurrenceRef: old[1].sourceOccurrenceRef },
  ]);
  assert.equal(explicit.assignments.get(movedA), null);
  assert.equal(explicit.assignments.get(movedB), old[1]);
  assert.throws(() => pairDocumentEvents([oldA, movedB], old, [{ incomingVariantRef: stableDocumentOccurrenceVariantRef(oldA), currentSourceOccurrenceRef: null }]), /多余|配对/u);
});

test("preview fingerprint ignores generated model ids and input order but binds actual facts", () => {
  const first = event("2026-10-20", "random-a");
  const second = event("2026-10-21", "random-b");
  assert.equal(documentPairingFingerprint([first, second]), documentPairingFingerprint([
    { ...second, event_id: "different-b" }, { ...first, event_id: "different-a" },
  ]));
  assert.notEqual(documentPairingFingerprint([first, second]), documentPairingFingerprint([{ ...first, date: "2026-10-22" }, second]));
});
