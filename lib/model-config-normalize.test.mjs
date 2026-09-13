import assert from "node:assert/strict";
import test from "node:test";
import { normalizeModelCost, normalizeModelEntry, normalizeModelsConfig } from "./model-config-normalize.ts";

test("incomplete model costs are omitted instead of producing invalid models.json", () => {
  assert.equal(normalizeModelCost({ input: 1, output: 2, cacheRead: 3 }), undefined);
  assert.deepEqual(
    normalizeModelEntry({ id: "model", cost: { input: 1, output: 2, cacheRead: 3 } }),
    { id: "model" },
  );
});

test("complete model costs and valid tiers survive normalization", () => {
  const cost = {
    input: 1,
    output: 2,
    cacheRead: 3,
    cacheWrite: 4,
    tiers: [{ inputTokensAbove: 1000, input: 0.5, output: 1, cacheRead: 0.2, cacheWrite: 0.3 }],
  };
  assert.deepEqual(normalizeModelCost(cost), cost);
});

test("models config normalization cleans every provider model", () => {
  assert.deepEqual(
    normalizeModelsConfig({ providers: { deepseek: { models: [{ id: "m", cost: { input: 1, output: 2 } }] } } }),
    { providers: { deepseek: { models: [{ id: "m" }] } } },
  );
});
