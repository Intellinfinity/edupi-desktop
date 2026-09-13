import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("./route.ts");
const { projectModel } = await jiti.import("../../../../lib/model-provider-projection.ts");

test("provider-models rejects malformed provider ids before loading the runtime", async () => {
  const response = await GET(new Request("http://localhost/api/models-config/provider-models?provider=../secret"));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Provider ID/);
});

test("provider-models never returns credentials or request headers", async () => {
  const projected = projectModel({
    id: "model-a",
    name: "Model A",
    apiKey: "should-not-leak",
    headers: { Authorization: "should-not-leak" },
    api: "openai-completions",
    compat: { thinkingFormat: "deepseek", headers: { Authorization: "should-not-leak" } },
  });
  assert.deepEqual(projected, {
    id: "model-a",
    name: "Model A",
    api: "openai-completions",
    compat: { thinkingFormat: "deepseek" },
  });
  assert.equal("cost" in projectModel({ id: "incomplete", cost: { input: 1, output: 2 } }), false);
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /apiKey|headers\s*:/);
  assert.match(source, /runtime\.getModels\(/);
  assert.match(source, /runtime\.getProviders\(\)/);
});
