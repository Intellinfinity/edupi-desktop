import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  BrowserDecisionAdapter,
  DecisionPolicy,
  JevDecisionProvider,
  createBrowserDecisionAdapterFromEnv,
  resolveJevConfig,
} = await jiti.import("./browser-decision.ts");

const page = () => ({
  url: "https://example.test/form",
  title: "Form",
  text: "Search students",
  fingerprint: "page-1",
  elements: [
    { id: "search", role: "textbox", label: "Search", operations: ["CLICK", "TYPE_TEXT"] },
    { id: "submit", role: "button", label: "Send message", operations: ["CLICK"] },
  ],
});

const candidate = (overrides = {}) => ({
  operation: "CLICK",
  target: { elementId: "submit", label: "Send message" },
  confidence: 0.91,
  probabilities: {
    operation: { CLICK: 0.91, WAIT: 0.09 },
    target: { submit: 1 },
  },
  provider: "jev",
  latencyMs: 25,
  providerTrace: { model: "jev-latest" },
  ...overrides,
});

function fakeProvider(value = candidate()) {
  return {
    id: "fake",
    calls: 0,
    async decide() {
      this.calls += 1;
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

test("jev is disabled unless endpoint and key are configured", () => {
  assert.equal(resolveJevConfig({}).enabled, false);
  assert.equal(resolveJevConfig({
    EDUPI_JEV_ENABLED: "1",
    EDUPI_JEV_ENDPOINT: "https://api.typesafe.ai/v1/systemone",
    EDUPI_JEV_API_KEY: "test-key-1234567",
  }).enabled, true);
  assert.equal(resolveJevConfig({
    EDUPI_JEV_ENABLED: "1",
    EDUPI_JEV_ENDPOINT: "http://typesafe.example.test/v1/systemone",
    EDUPI_JEV_API_KEY: "test-key-1234567",
  }).enabled, false);
  assert.equal(createBrowserDecisionAdapterFromEnv({
    env: {
      EDUPI_JEV_ENABLED: "1",
      EDUPI_JEV_ENDPOINT: "https://api.typesafe.ai/v1/systemone",
      EDUPI_JEV_API_KEY: "test-key-1234567",
    },
  }), null);
});

test("decision output carries operation target probabilities provider latency and trace", async () => {
  const adapter = new BrowserDecisionAdapter({
    provider: fakeProvider(),
    policy: new DecisionPolicy(),
  });
  const result = await adapter.decide({ goal: "Send the report", page: page() });
  assert.equal(result.status, "decision");
  assert.equal(result.decision.operation, "CLICK");
  assert.equal(result.decision.target.elementId, "submit");
  assert.equal(result.decision.confidence, 0.91);
  assert.equal(result.decision.provider, "jev");
  assert.equal(result.decision.latencyMs, 25);
  assert.equal(result.decision.probabilities.target.submit, 1);
  assert.ok(result.decision.trace.length >= 2);
  assert.equal(result.decision.requiresConfirmation, true);
});

test("unreadable snapshots fall back without calling the provider", async () => {
  const provider = fakeProvider();
  const adapter = new BrowserDecisionAdapter({
    provider,
    policy: new DecisionPolicy(),
    fallback: fakeProvider(candidate({ operation: "WAIT", target: null, provider: "browser-llm", probabilities: { operation: { WAIT: 1 }, target: {} } })),
  });
  const result = await adapter.decide({ goal: "Search", page: { ...page(), elements: [] } });
  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "page_unreadable");
  assert.equal(provider.calls, 0);
});

test("malformed browser fields are rejected before the provider call", async () => {
  const provider = fakeProvider();
  const adapter = new BrowserDecisionAdapter({
    provider,
    policy: new DecisionPolicy(),
    fallback: fakeProvider(candidate({ operation: "WAIT", target: null, provider: "browser-llm", probabilities: { operation: { WAIT: 1 }, target: {} } })),
  });
  const result = await adapter.decide({ goal: "Search", page: { ...page(), text: null } });
  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "page_unreadable");
  assert.equal(provider.calls, 0);
});

test("SELECT decisions must identify an observed option", () => {
  const policy = new DecisionPolicy();
  const selectPage = {
    ...page(),
    elements: [{
      id: "grade",
      role: "combobox",
      label: "Grade",
      operations: ["SELECT"],
      options: [{ value: "7", label: "Year 7" }],
    }],
  };
  const review = policy.review(candidate({
    operation: "SELECT",
    target: { elementId: "grade", label: "Grade" },
    probabilities: { operation: { SELECT: 1 }, target: { grade: 1 } },
  }), selectPage);
  assert.equal(review.ok, false);
  assert.equal(review.reason, "invalid_decision");
});

test("low confidence and blocked decisions fall back to the existing browser provider", async () => {
  const fallback = fakeProvider(candidate({ operation: "WAIT", target: null, provider: "browser-llm", confidence: 0.8, probabilities: { operation: { WAIT: 1 }, target: {} } }));
  for (const bad of [
    candidate({ confidence: 0.2, probabilities: { operation: { CLICK: 0.2, WAIT: 0.8 }, target: { submit: 1 } } }),
    candidate({ operation: "BLOCKED", target: null, probabilities: { operation: { BLOCKED: 1 }, target: {} } }),
  ]) {
    const adapter = new BrowserDecisionAdapter({
      provider: fakeProvider(bad),
      fallback,
      policy: new DecisionPolicy({ minConfidence: 0.6 }),
    });
    const result = await adapter.decide({ goal: "Search", page: page() });
    assert.equal(result.status, "fallback");
    assert.ok(["low_confidence", "blocked"].includes(result.reason));
    assert.equal(result.decision.provider, "browser-llm");
  }
});

test("TYPE_TEXT fallback must supply its own validated text", async () => {
  const fallback = fakeProvider(candidate({
    operation: "TYPE_TEXT",
    target: { elementId: "search", label: "Search" },
    probabilities: { operation: { TYPE_TEXT: 1 }, target: { search: 1 } },
    provider: "browser-llm",
    text: "期中成绩",
  }));
  const adapter = new BrowserDecisionAdapter({
    provider: fakeProvider(candidate({ confidence: 0.2, probabilities: { operation: { CLICK: 0.2, WAIT: 0.8 }, target: { submit: 1 } } })),
    fallback,
    policy: new DecisionPolicy(),
  });

  const result = await adapter.decide({ goal: "Search", page: page() });

  assert.equal(result.status, "fallback");
  assert.equal(result.decision.text, "期中成绩");
});

test("service timeout opens the circuit and later calls use the fallback directly", async () => {
  const fallback = fakeProvider(candidate({ operation: "WAIT", target: null, provider: "browser-llm", probabilities: { operation: { WAIT: 1 }, target: {} } }));
  const adapter = new BrowserDecisionAdapter({
    provider: fakeProvider(Object.assign(new Error("offline"), { code: "service_unavailable" })),
    fallback,
    policy: new DecisionPolicy({ maxConsecutiveFailures: 2 }),
  });
  assert.equal((await adapter.decide({ goal: "x", page: page() })).reason, "service_unavailable");
  assert.equal((await adapter.decide({ goal: "x", page: page() })).reason, "service_unavailable");
  const direct = await adapter.decide({ goal: "x", page: page() });
  assert.equal(direct.reason, "consecutive_failures");
});

test("TYPE_TEXT generates text only after a usable JEV decision", async () => {
  const textCalls = [];
  const adapter = new BrowserDecisionAdapter({
    provider: fakeProvider(candidate({
      operation: "TYPE_TEXT",
      target: { elementId: "search", label: "Search" },
      probabilities: { operation: { TYPE_TEXT: 1 }, target: { search: 1 } },
    })),
    policy: new DecisionPolicy(),
    generateText: async (context) => {
      textCalls.push(context);
      return "期中成绩";
    },
  });
  const result = await adapter.decide({ goal: "Search 期中成绩", page: page() });
  assert.equal(result.status, "decision");
  assert.equal(result.decision.text, "期中成绩");
  assert.equal(textCalls.length, 1);
  assert.equal(textCalls[0].field.label, "Search");
});

test("JevDecisionProvider sends structured state and validates TypeSafe answers", async () => {
  const requests = [];
  const provider = new JevDecisionProvider({
    endpoint: "https://typesafe.test/v1/systemone",
    apiKey: "secret",
    model: "jev-test",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({
        answers: {
          operation: {
            choice: "CLICK",
            confidence: 0.88,
            probabilities: {
              CLICK: 0.88,
              TYPE_TEXT: 0.02,
              SCROLL_DOWN: 0.02,
              SCROLL_UP: 0.01,
              WAIT: 0.02,
              DONE: 0.02,
              BLOCKED: 0.03,
            },
          },
          click_target: { choice: "2", confidence: 0.99, probabilities: { "1": 0.01, "2": 0.99 } },
        },
        model: "jev-test",
      }), { status: 200 });
    },
  });
  const decision = await provider.decide({ goal: "Submit", page: page() });
  assert.equal(decision.operation, "CLICK");
  assert.equal(decision.target.elementId, "submit");
  assert.equal(requests[0].state.elements.length, 2);
  assert.equal("screenshot" in requests[0].state, false);
  assert.equal(JSON.stringify(requests[0]).includes("secret"), false);
});

test("JevDecisionProvider offers only observed operations and selects the exact dropdown option", async () => {
  const requests = [];
  const provider = new JevDecisionProvider({
    endpoint: "https://typesafe.test/v1/systemone",
    apiKey: "secret",
    model: "jev-test",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({
        answers: {
          operation: {
            choice: "SELECT",
            confidence: 0.92,
            probabilities: { SELECT: 0.92, SCROLL_DOWN: 0.02, SCROLL_UP: 0.01, WAIT: 0.01, DONE: 0.02, BLOCKED: 0.02 },
          },
          select_target: {
            choice: "1:2",
            confidence: 0.71,
            probabilities: { "1:1": 0.29, "1:2": 0.71 },
          },
        },
        model: "jev-test",
      }), { status: 200 });
    },
  });
  const selectPage = {
    ...page(),
    elements: [{
      id: "grade",
      role: "combobox",
      label: "Grade",
      operations: ["SELECT"],
      options: [
        { value: "7", label: "Year 7" },
        { value: "8", label: "Year 8" },
      ],
    }],
  };

  const decision = await provider.decide({ goal: "Choose Year 8", page: selectPage });

  assert.equal(decision.operation, "SELECT");
  assert.equal(decision.target.elementId, "grade");
  assert.equal(decision.target.optionValue, "8");
  assert.equal(decision.confidence, 0.71);
  assert.equal("CLICK" in requests[0].questions.operation.criteria, false);
  assert.equal("TYPE_TEXT" in requests[0].questions.operation.criteria, false);
  assert.deepEqual(Object.keys(requests[0].questions.select_target.criteria), ["1:1", "1:2"]);
});

test("JevDecisionProvider rejects incomplete probability sets", async () => {
  const provider = new JevDecisionProvider({
    endpoint: "https://typesafe.test/v1/systemone",
    apiKey: "secret",
    fetchImpl: async () => new Response(JSON.stringify({
      answers: {
        operation: { choice: "CLICK", confidence: 1, probabilities: { CLICK: 1 } },
        click_target: { choice: "2", confidence: 1, probabilities: { "2": 1 } },
      },
    }), { status: 200 }),
  });

  await assert.rejects(
    provider.decide({ goal: "Submit", page: page() }),
    (error) => error.reason === "provider_error",
  );
});

test("TYPE_TEXT timeout falls back even when the text provider ignores cancellation", { timeout: 1_000 }, async () => {
  const fallback = fakeProvider(candidate({
    operation: "WAIT",
    target: null,
    provider: "browser-llm",
    probabilities: { operation: { WAIT: 1 }, target: {} },
  }));
  const adapter = new BrowserDecisionAdapter({
    provider: fakeProvider(candidate({
      operation: "TYPE_TEXT",
      target: { elementId: "search", label: "Search" },
      probabilities: { operation: { TYPE_TEXT: 1 }, target: { search: 1 } },
    })),
    fallback,
    policy: new DecisionPolicy({ timeoutMs: 100 }),
    generateText: async () => await new Promise(() => {}),
  });

  const result = await adapter.decide({ goal: "Search", page: page() });

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "text_generation_failed");
});
