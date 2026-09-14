import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const model = await jiti.import("./edupi-fact-lifecycle-model.ts");
const requests = await jiti.import("./edupi-fact-lifecycle-request.ts");
const server = await jiti.import("./edupi-fact-lifecycle-server.ts");
const lifecycle = await jiti.import("./edupi-fact-lifecycle.ts");

const accepted = { id: "fact-old", entityId: "student-1", kind: "error_pattern", predicate: "math.sign", value: "仍需练习", subjectRef: "数学", topicRef: "移项", confidence: { basis: "explicit", score: 1 }, status: "accepted", sourceIds: ["source-1"], observationIds: ["observation-1"], conflictIds: ["conflict-1"], hasPredecessor: false, revision: 3 };
const candidate = { ...accepted, id: "fact-new", kind: "progress", value: "已经掌握", status: "pending_review", revision: 1 };
const spine = { acceptedFacts: [accepted], factCandidates: [candidate], conflicts: [{ id: "conflict-1", entityId: "student-1", predicate: "math.sign", factIds: ["fact-old", "fact-new"], sourceIds: ["source-1"], revision: 0 }], entities: [], observations: [], hypotheses: [], studentViews: [], teachingView: { acceptedFactIds: [], bySubject: [] }, nextLessonFactIds: [], uses: [], stateHash: "sha256:x", generatedAt: "2026-09-15T00:00:00.000Z" };

test("maps Core facts into explicit insight categories and conflicts", () => {
  assert.equal(model.factInsightCategory(candidate), "learning");
  assert.equal(model.factInsightStatus(candidate), "fact_pending");
  assert.equal(model.conflictingAcceptedFact(candidate, spine).id, accepted.id);
  assert.deepEqual(model.conflictingAcceptedFacts(candidate, spine).map((fact) => fact.id), [accepted.id]);
});

test("parses only bounded fact lifecycle requests", () => {
  const review = { action: "review", expectedRevision: 1, decision: "accept", reviewer: "teacher", note: null, supersedesFactId: "fact-old", supersedesFactRevision: 3 };
  assert.deepEqual(requests.parseFactMutationBody(review), review);
  assert.equal(requests.parseFactMutationBody({ ...review, token: "secret" }), null);
  assert.equal(requests.parseFactMutationBody({ ...review, supersedesFactRevision: null }), null);
  assert.equal(requests.parseFactMutationBody({ ...review, decision: "reject" }), null);
  assert.deepEqual(requests.parseFactMutationBody({ action: "modify", expectedRevision: 2, replacementValue: "基本掌握", reviewer: "teacher", note: "复测" }), { action: "modify", expectedRevision: 2, replacementValue: "基本掌握", reviewer: "teacher", note: "复测" });
  assert.deepEqual(requests.parseDeletedFactPage("http://localhost/api/edupi/facts/deleted?offset=100&limit=100"), { offset: 100, limit: 100 });
  assert.equal(requests.parseDeletedFactPage("http://localhost/api/edupi/facts/deleted?offset=0&limit=101"), null);
});

test("binds request identity to both conflicting fact revisions", () => {
  const input = { action: "review", expectedRevision: 1, decision: "accept", reviewer: "teacher", note: null, supersedesFactId: "fact-old", supersedesFactRevision: 3 };
  const id = lifecycle.factMutationRequestId("fact-new", input);
  assert.equal(id, lifecycle.factMutationRequestId("fact-new", structuredClone(input)));
  assert.notEqual(id, lifecycle.factMutationRequestId("fact-new", { ...input, supersedesFactRevision: 4 }));
  assert.notEqual(id, lifecycle.factMutationRequestId("fact-new", { ...input, supersedesFactId: null, supersedesFactRevision: null }));
});

test("finds a deleted fact after the first 100 rows without imposing a total cap", async () => {
  const calls = [];
  const first = Array.from({ length: 100 }, (_, index) => ({ factId: `other-${index}`, revision: 1 }));
  const target = { factId: "fact-target", revision: 7 };
  const found = await lifecycle.findDeletedEducationFact("fact-target", 7, undefined, async (offset, limit) => {
    calls.push([offset, limit]);
    return offset === 0
      ? { total: 2_101, offset: 0, limit, nextOffset: 100, facts: first, externalSend: false }
      : { total: 2_101, offset: 100, limit, nextOffset: 101, facts: [target], externalSend: false };
  });
  assert.equal(found, target);
  assert.deepEqual(calls, [[0, 100], [100, 100]]);
});

test("reconciles each fact action against the refreshed Core projection", () => {
  const base = { requestId: "request", factId: candidate.id, resultFactId: candidate.id, revision: 2, status: "accepted", supersededFactId: accepted.id, replayed: false, externalSend: false };
  const acceptedData = { factSpine: { ...spine, acceptedFacts: [{ ...candidate, status: "accepted", revision: 2 }], factCandidates: [] } };
  assert.equal(server.verifiesFactMutation(acceptedData, { ...base, action: "review" }, { action: "review", expectedRevision: 1, decision: "accept", reviewer: "teacher", note: null, supersedesFactId: accepted.id, supersedesFactRevision: 3 }), true);
  const duplicateAcceptedData = { factSpine: { ...spine, acceptedFacts: [accepted, { ...candidate, status: "accepted", revision: 2 }], factCandidates: [] } };
  assert.equal(server.verifiesFactMutation(duplicateAcceptedData, { ...base, action: "review" }, { action: "review", expectedRevision: 1, decision: "accept", reviewer: "teacher", note: null, supersedesFactId: accepted.id, supersedesFactRevision: 3 }), false);
  assert.equal(server.verifiesFactMutation(acceptedData, { ...base, action: "restore" }, { action: "restore", expectedRevision: 1, reviewer: "teacher", supersedesFactId: accepted.id, supersedesFactRevision: 3 }), true);
  assert.equal(server.verifiesFactMutation(duplicateAcceptedData, { ...base, action: "restore" }, { action: "restore", expectedRevision: 1, reviewer: "teacher", supersedesFactId: accepted.id, supersedesFactRevision: 3 }), false);
  assert.equal(server.verifiesFactMutation({ factSpine: { ...spine, factCandidates: [] } }, { ...base, action: "review", status: "rejected", supersededFactId: null }, { action: "review", expectedRevision: 1, decision: "reject", reviewer: "teacher", note: null, supersedesFactId: null, supersedesFactRevision: null }), true);
  assert.equal(server.verifiesFactMutation({ factSpine: { ...spine, acceptedFacts: [], factCandidates: [] } }, { ...base, action: "delete", status: "deleted", supersededFactId: null }, { action: "delete", expectedRevision: 1, reviewer: "teacher" }), true);
});
