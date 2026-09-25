import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  INTENTS,
  interpretIntent,
  loadFixtures,
  makeIntentRequest,
  queryIntent,
  runIntentPreflight,
  scoreIntentResults,
} from "./jev-intent-preflight.mjs";

function answer(choice, confidence = 0.9) {
  const probabilities = Object.fromEntries(Object.keys(INTENTS).map((key) => [key, key === choice ? 1 : 0]));
  return { answers: { intent: { choice, confidence, probabilities } } };
}

test("synthetic cases and sealed labels are separate and cover Core's six domains plus unclear", async () => {
  const fixtures = await loadFixtures();
  assert.equal(fixtures.cases.length, 21);
  assert.deepEqual(new Set(Object.values(fixtures.labels)), new Set(Object.keys(INTENTS)));
  assert.deepEqual(new Set(Object.values(fixtures.labelCounts)), new Set([3]));
  const request = makeIntentRequest(fixtures.cases[0].text);
  assert.deepEqual(request.state, { teacher_request: fixtures.cases[0].text });
  assert.deepEqual(Object.keys(request), ["model", "state", "questions"]);
  assert.equal(request.questions.intent.type, "choice");
});

test("intent interpretation rejects malformed probabilities and never routes low-confidence or unclear answers", () => {
  assert.equal(interpretIntent(answer("teaching_preparation")).prediction, "teaching_preparation");
  assert.equal(interpretIntent(answer("teaching_preparation", 0.4)).reason, "low_confidence");
  assert.equal(interpretIntent(answer("unclear")).reason, "model_unclear");
  const malformed = answer("teaching_preparation");
  delete malformed.answers.intent.probabilities.safety_privacy;
  assert.equal(interpretIntent(malformed).reason, "invalid_answer");
  assert.equal(interpretIntent({ answers: { intent: { ...answer("teaching_preparation").answers.intent, choice: "toString" } } }).reason, "invalid_answer");
});

test("preflight sends only a synthetic utterance, caps calls, and scores abstention without claiming a formal blind", async () => {
  const fixtures = await loadFixtures();
  const calls = [];
  const report = await runIntentPreflight({
    fixtures,
    maxCalls: 3,
    config: { endpoint: "https://example.test/v1/systemone", apiKey: "test-secret-value", model: "fixture", timeoutMs: 500, minConfidence: 0.6 },
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify(answer(calls.length === 2 ? "unclear" : fixtures.labels[fixtures.cases[(calls.length - 1) * 3].id])), { status: 200 });
    },
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(report.results.map(({ id }) => id), ["teach-01", "student-01", "reflection-01"]);
  assert.deepEqual(calls.map((call) => Object.keys(call.state)), [["teacher_request"], ["teacher_request"], ["teacher_request"]]);
  assert.equal(calls.every((call) => !JSON.stringify(call).includes("synthetic_spec")), true);
  assert.equal(report.score.correct, 2);
  assert.equal(report.score.abstained, 1);
  assert.equal(report.score.formal_blind_status, "not_run");
});

test("invalid responses and transport errors abstain without leaking response contents", async () => {
  const config = { endpoint: "https://example.test/v1/systemone", apiKey: "test-secret", model: "fixture", timeoutMs: 500, minConfidence: 0.6, text: "请帮我安排明天的数学课。" };
  const invalid = await queryIntent({ ...config, fetchImpl: async () => new Response('{"secret":"do-not-print"}', { status: 200 }) });
  assert.equal(invalid.reason, "invalid_answer");
  assert.equal(JSON.stringify(invalid).includes("do-not-print"), false);
  const failed = await queryIntent({ ...config, fetchImpl: async () => { throw new Error("Bearer test-secret"); } });
  assert.equal(failed.reason, "service_unavailable");
  assert.equal(JSON.stringify(failed).includes("test-secret"), false);
  const http = await queryIntent({ ...config, fetchImpl: async () => new Response("Bearer test-secret", { status: 429 }) });
  assert.equal(http.reason, "http_429");
  assert.equal(JSON.stringify(http).includes("test-secret"), false);
});

test("live preflight refuses invalid thresholds before making a network call", async () => {
  const fixtures = await loadFixtures();
  let calls = 0;
  await assert.rejects(runIntentPreflight({
    fixtures,
    maxCalls: 1,
    config: { endpoint: "https://example.test/v1/systemone", apiKey: "test-secret-value", model: "fixture", timeoutMs: 500, minConfidence: -1 },
    fetchImpl: async () => { calls++; return new Response(); },
  }), /invalid_config/u);
  assert.equal(calls, 0);
});

test("scoring marks safety misroutes and gives credit for an explicit unclear judgment", () => {
  const score = scoreIntentResults([
    { id: "s", prediction: "student_followup" },
    { id: "u", prediction: null, reason: "model_unclear" },
  ], { s: "safety_privacy", u: "unclear" });
  assert.equal(score.safetyFalseNegative, 1);
  assert.equal(score.correct, 1);
  assert.equal(score.accepted, 1);
  assert.equal(score.formal_blind_status, "not_run");
});

test("fixture loader rejects labels without matching input cases", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edupi-jev-preflight-"));
  try {
    await writeFile(join(directory, "contexts.json"), JSON.stringify({ version: 1, kind: "edupi_jev_intent_synthetic_preflight", cases: [{ id: "teach-01", text: "明天备课需要练习。" }] }));
    await writeFile(join(directory, "synthetic-labels.json"), JSON.stringify({ version: 1, kind: "edupi_jev_intent_synthetic_labels", label_source: "synthetic_spec", labels: { "other-01": "unclear" } }));
    await assert.rejects(loadFixtures(directory), /invalid_fixture/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fixture loader rejects apparent seven-domain sets collapsed to one label", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edupi-jev-preflight-"));
  try {
    const contexts = await readFile(new URL("../fixtures/jev-intent-preflight/contexts.json", import.meta.url), "utf8");
    const labels = JSON.parse(await readFile(new URL("../fixtures/jev-intent-preflight/synthetic-labels.json", import.meta.url), "utf8"));
    labels.labels = Object.fromEntries(Object.keys(labels.labels).map((id) => [id, "teaching_preparation"]));
    await writeFile(join(directory, "contexts.json"), contexts);
    await writeFile(join(directory, "synthetic-labels.json"), JSON.stringify(labels));
    await assert.rejects(loadFixtures(directory), /invalid_fixture/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
