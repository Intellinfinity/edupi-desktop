#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = resolve(root, "fixtures/jev-intent-preflight");
export const INTENTS = Object.freeze({
  teaching_preparation: "Plan or adapt a lesson, exercise, or teaching material",
  student_followup: "Review a student's learning over time or plan individual follow-up",
  lesson_reflection: "Reflect on a lesson already taught and identify adjustments",
  calendar_administration: "Manage school calendar, timetable, or schedule conflicts",
  parent_communication: "Prepare communication with a parent or guardian; never send it",
  safety_privacy: "Check student safety, privacy, permissions, or inappropriate classification",
  unclear: "The teacher's intent is insufficiently specified or outside these domains",
});

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export async function loadFixtures(directory = fixtureRoot) {
  const [contexts, labels] = await Promise.all([
    readFile(resolve(directory, "contexts.json"), "utf8").then(JSON.parse),
    readFile(resolve(directory, "synthetic-labels.json"), "utf8").then(JSON.parse),
  ]);
  if (!isRecord(contexts) || contexts.version !== 1 || contexts.kind !== "edupi_jev_intent_synthetic_preflight"
    || !Array.isArray(contexts.cases) || !isRecord(labels) || labels.version !== 1
    || labels.kind !== "edupi_jev_intent_synthetic_labels" || labels.label_source !== "synthetic_spec"
    || !isRecord(labels.labels)) throw new Error("invalid_fixture");
  const ids = new Set();
  for (const item of contexts.cases) {
    if (!isRecord(item) || Object.keys(item).sort().join() !== "id,text" || typeof item.id !== "string"
      || !/^[a-z]+-[0-9]{2}$/u.test(item.id) || ids.has(item.id)
      || typeof item.text !== "string" || item.text.trim() !== item.text || item.text.length < 8 || item.text.length > 500
      || !Object.hasOwn(INTENTS, labels.labels[item.id])) throw new Error("invalid_fixture");
    ids.add(item.id);
  }
  const labelCounts = Object.fromEntries(Object.keys(INTENTS).map((intent) => [intent, 0]));
  for (const label of Object.values(labels.labels)) labelCounts[label] += 1;
  if (ids.size !== Object.keys(labels.labels).length || Object.values(labelCounts).some((count) => count < 3)
    || Object.keys(labels.labels).some((id) => !ids.has(id))) throw new Error("invalid_fixture");
  return { cases: contexts.cases, labels: labels.labels, labelCounts };
}

export function makeIntentRequest(text, model = "jev-latest") {
  if (typeof text !== "string" || text.length < 8 || text.length > 500) throw new Error("invalid_case");
  return {
    model,
    state: { teacher_request: text },
    questions: {
      intent: {
        type: "choice",
        criteria: INTENTS,
        instructions: "Choose the primary teacher-work intent. If context is insufficient, choose unclear. Do not draft a reply, act, or infer facts about a student.",
      },
    },
  };
}

export function interpretIntent(payload, minConfidence = 0.6) {
  const answer = payload?.answers?.intent;
  const probabilities = answer?.probabilities;
  const keys = Object.keys(INTENTS);
  if (!isRecord(probabilities) || Object.keys(probabilities).length !== keys.length
    || keys.some((key) => typeof probabilities[key] !== "number" || !Number.isFinite(probabilities[key])
      || probabilities[key] < 0 || probabilities[key] > 1)
    || Math.abs(keys.reduce((total, key) => total + probabilities[key], 0) - 1) > 0.02
    || typeof answer?.choice !== "string" || !Object.hasOwn(INTENTS, answer.choice)
    || typeof answer.confidence !== "number" || !Number.isFinite(answer.confidence)
    || answer.confidence < 0 || answer.confidence > 1
    || probabilities[answer.choice] < Math.max(...keys.map((key) => probabilities[key])) - 1e-6) {
    return { prediction: null, reason: "invalid_answer" };
  }
  if (answer.choice === "unclear") return { prediction: null, choice: "unclear", confidence: answer.confidence, reason: "model_unclear" };
  if (answer.confidence < minConfidence) return { prediction: null, choice: answer.choice, confidence: answer.confidence, reason: "low_confidence" };
  return { prediction: answer.choice, choice: answer.choice, confidence: answer.confidence, probabilities };
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("invalid_answer");
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 256_000) {
      await reader.cancel();
      throw new Error("invalid_answer");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } catch {
    throw new Error("invalid_answer");
  }
}

export async function queryIntent({ endpoint, apiKey, model, timeoutMs, minConfidence, text, fetchImpl = fetch }) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(makeIntentRequest(text, model)),
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) return { prediction: null, reason: `http_${response.status}`, latencyMs: Date.now() - started };
    const result = interpretIntent(await boundedJson(response), minConfidence);
    return { ...result, latencyMs: Date.now() - started };
  } catch (cause) {
    return { prediction: null, reason: controller.signal.aborted ? "timeout" : cause instanceof Error && cause.message === "invalid_answer" ? "invalid_answer" : "service_unavailable", latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export function scoreIntentResults(results, labels) {
  const classes = Object.keys(INTENTS);
  const scoredChoice = (row) => row.reason === "model_unclear" ? "unclear" : row.prediction;
  const correct = results.filter((row) => scoredChoice(row) === labels[row.id]).length;
  const accepted = results.filter((row) => row.prediction !== null).length;
  const safetyFalseNegative = results.filter((row) => labels[row.id] === "safety_privacy"
    && row.prediction !== null && row.prediction !== "safety_privacy").length;
  const f1 = classes.map((label) => {
    const tp = results.filter((row) => scoredChoice(row) === label && labels[row.id] === label).length;
    const fp = results.filter((row) => scoredChoice(row) === label && labels[row.id] !== label).length;
    const fn = results.filter((row) => scoredChoice(row) !== label && labels[row.id] === label).length;
    return tp === 0 ? 0 : 2 * tp / (2 * tp + fp + fn);
  });
  return {
    cases: results.length,
    accepted,
    abstained: results.length - accepted,
    correct,
    accuracy: results.length ? correct / results.length : 0,
    coverage: results.length ? accepted / results.length : 0,
    macroF1: f1.reduce((sum, value) => sum + value, 0) / f1.length,
    safetyFalseNegative,
    formal_blind_status: "not_run",
    label_source: "synthetic_spec",
  };
}

export async function runIntentPreflight({ fixtures, maxCalls, config, fetchImpl = fetch }) {
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > fixtures.cases.length) throw new Error("invalid_max_calls");
  if (!config || typeof config.endpoint !== "string" || typeof config.apiKey !== "string" || config.apiKey.length < 16
    || typeof config.model !== "string" || !config.model
    || !Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 30_000
    || typeof config.minConfidence !== "number" || !Number.isFinite(config.minConfidence)
    || config.minConfidence < 0.01 || config.minConfidence > 1) throw new Error("invalid_config");
  const selection = [];
  for (let offset = 0; offset < 3; offset++) {
    for (let index = offset; index < fixtures.cases.length; index += 3) selection.push(fixtures.cases[index]);
  }
  const results = [];
  for (const item of selection.slice(0, maxCalls)) {
    const result = await queryIntent({ ...config, text: item.text, fetchImpl });
    results.push({ id: item.id, ...result });
  }
  return { kind: "synthetic_jev_intent_preflight", model_calls: results.length, results, score: scoreIntentResults(results, fixtures.labels) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixtures = await loadFixtures();
  if (process.argv.length === 3 && process.argv[2] === "--check") {
    process.stdout.write(`${JSON.stringify({ status: "passed", cases: fixtures.cases.length, domains: Object.keys(fixtures.labelCounts).length, labelCounts: fixtures.labelCounts, provider_calls: 0, formal_blind_status: "not_run" })}\n`);
  } else if (process.argv[2] === "--live" && process.argv.length <= 4) {
    const option = process.argv[3] || "--max-calls=3";
    const match = /^--max-calls=([1-9][0-9]?)$/u.exec(option);
    if (!match) throw new Error("use --live --max-calls=N");
    const { createJiti } = await import("jiti");
    const { loadJevRuntimeEnvironment, readJevSettingsStatus } = await createJiti(import.meta.url).import("../lib/integrations/jev-settings.ts");
    const status = await readJevSettingsStatus();
    if (!status.active) throw new Error("jev_not_configured");
    const environment = loadJevRuntimeEnvironment();
    const report = await runIntentPreflight({
      fixtures,
      maxCalls: Number(match[1]),
      config: {
        endpoint: status.endpoint,
        apiKey: environment.EDUPI_JEV_API_KEY,
        model: status.model,
        timeoutMs: status.timeoutMs,
        minConfidence: status.minConfidence,
      },
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    throw new Error("use --check or --live --max-calls=N");
  }
}
